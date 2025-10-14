#!/usr/bin/env python3
"""
Provision a Morph instance from an existing snapshot, perform parallelized
environment setup that mirrors the Dockerfile, validate critical tooling, and
snapshot the configured system.

The flow:
1. Boot an instance from the provided snapshot (default snapshot_i7l4i12s)
2. Expose the standard cmux HTTP services
3. Execute dependency graph tasks concurrently using Morph's async APIs
4. Run in-instance sanity checks (cargo/node/bun/uv/envd/envctl + service curls)
5. Snapshot the configured instance, start a new instance from that snapshot,
   and rerun sanity checks for validation
"""

from __future__ import annotations

import argparse
import asyncio
import atexit
import json
import os
import shutil
import shlex
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import textwrap
import time
import typing as t
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import dotenv
import httpx
import paramiko
from morphcloud.api import (
    ApiError,
    Instance,
    InstanceExecResponse,
    MorphCloudClient,
    Snapshot,
)

from morph_common import ensure_docker_cli_plugins

Command = t.Union[str, t.Sequence[str]]
TaskFunc = t.Callable[["TaskContext"], t.Awaitable[None]]

EXEC_HTTP_PORT = 39375
EXEC_BINARY_NAME = "cmux-execd"
EXEC_REMOTE_PATH = "/usr/local/bin/cmux-execd"
EXEC_TEMP_PATH = "/tmp/cmux-execd"
EXEC_BUILD_TARGET_ENV = "CMUX_EXEC_TARGET"
DEFAULT_EXEC_BUILD_TARGET = "linux/amd64"
EXEC_SOURCE_PATH = Path("scripts/execd/main.go")
EXEC_BUILD_OUTPUT_DIR = Path("scripts/execd/dist")
VSCODE_HTTP_PORT = 39378
VNC_HTTP_PORT = 39380
CDP_HTTP_PORT = 39381
CDP_PROXY_BINARY_NAME = "cmux-cdp-proxy"


@dataclass(slots=True)
class ResourceProfile:
    name: str
    cpu_quota: int | None = None
    cpu_period: int | None = None
    cpu_weight: int | None = None
    memory_high: int | None = None
    memory_max: int | None = None
    io_weight: int | None = None


dotenv.load_dotenv()


class Console:
    def __init__(self) -> None:
        self.quiet = False

    def info(self, value: str) -> None:
        if not self.quiet:
            print(value)

    def always(self, value: str) -> None:
        print(value)


class TimingsCollector:
    def __init__(self) -> None:
        self._entries: list[tuple[str, float]] = []

    def add(self, label: str, duration: float) -> None:
        self._entries.append((label, duration))

    def summary(self) -> list[str]:
        if not self._entries:
            return []

        lines: list[str] = []
        task_timings: dict[str, float] = {}
        layer_timings: list[tuple[str, float, list[str]]] = []

        # Separate task and layer timings
        for label, duration in self._entries:
            if label.startswith("task:"):
                task_name = label[5:]
                task_timings[task_name] = duration
            elif label.startswith("layer:"):
                layer_tasks = label[6:].split("+")
                layer_timings.append((label[6:], duration, layer_tasks))

        # Show layer-by-layer breakdown
        if layer_timings:
            lines.append("Parallel Execution Layers:")
            for layer_name, layer_duration, tasks in layer_timings:
                lines.append(f"\n  Layer (wall time: {layer_duration:.2f}s):")
                for task_name in sorted(tasks):
                    task_duration = task_timings.get(task_name, 0.0)
                    lines.append(f"    ├─ {task_name}: {task_duration:.2f}s")

        # Calculate totals
        total_wall_time = sum(d for label, d in self._entries if label.startswith("layer:"))
        total_cpu_time = sum(task_timings.values())

        lines.append(f"\nTotal wall time: {total_wall_time:.2f}s")
        lines.append(f"Total CPU time: {total_cpu_time:.2f}s")
        if total_wall_time > 0:
            parallelism = total_cpu_time / total_wall_time
            lines.append(f"Effective parallelism: {parallelism:.2f}x")

        return lines



async def _run_command(
    ctx: "TaskContext",
    label: str,
    command: Command,
    *,
    timeout: float | None = None,
) -> InstanceExecResponse:
    ctx.console.info(f"[{label}] running...")
    command_parts = _shell_command(command)
    attempts = 0
    max_attempts = 3
    while True:
        attempts += 1
        try:
            result = await ctx.instance.aexec(
                command_parts,
                timeout=timeout,
            )
        except (httpx.HTTPError, OSError, socket.error) as exc:
            if attempts < max_attempts:
                delay = min(2**attempts, 8)
                ctx.console.info(
                    f"[{label}] retrying after remote exec failure ({exc}) "
                    f"(attempt {attempts}/{max_attempts}) in {delay}s"
                )
                await asyncio.sleep(delay)
                continue
            raise
        stdout_lines = result.stdout.splitlines()
        stderr_lines = result.stderr.splitlines()
        for line in stdout_lines:
            ctx.console.info(f"[{label}] {line}")
        for line in stderr_lines:
            ctx.console.info(f"[{label}][stderr] {line}")
        exit_code = result.exit_code
        if exit_code not in (0, None):
            error_parts = [f"{label} failed with exit code {exit_code}"]
            if result.stdout.strip():
                error_parts.append(f"stdout:\n{result.stdout.rstrip()}")
            if result.stderr.strip():
                error_parts.append(f"stderr:\n{result.stderr.rstrip()}")
            raise RuntimeError("\n".join(error_parts))
        return result


@dataclass(slots=True)
class TaskContext:
    instance: Instance
    repo_root: Path
    remote_repo_root: str
    remote_repo_tar: str
    exec_service_url: str
    console: Console
    timings: TimingsCollector
    resource_profile: ResourceProfile | None = None
    cgroup_path: str | None = None
    exec_client: HttpExecClient | None = field(default=None, init=False)
    environment_prelude: str = field(default="", init=False)

    def __post_init__(self) -> None:
        exports = textwrap.dedent(
            """
            export RUSTUP_HOME=/usr/local/rustup
            export CARGO_HOME=/usr/local/cargo
            export PATH="/root/.local/bin:/usr/local/cargo/bin:/usr/local/go/bin:/usr/local/bin:$PATH"
            """
        ).strip()
        self.environment_prelude = exports

    async def run(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None = None,
    ) -> InstanceExecResponse:
        command_with_env = self._apply_environment(command)
        command_to_run = (
            _wrap_command_with_cgroup(self.cgroup_path, command_with_env)
            if self.cgroup_path
            else command_with_env
        )
        if self.exec_client is not None:
            return await self.exec_client.run(
                label,
                command_to_run,
                timeout=timeout,
            )
        return await _run_command(self, label, command_to_run, timeout=timeout)

    async def run_via_ssh(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None = None,
        use_cgroup: bool = True,
    ) -> InstanceExecResponse:
        command_with_env = self._apply_environment(command)
        command_to_run = (
            _wrap_command_with_cgroup(self.cgroup_path, command_with_env)
            if use_cgroup and self.cgroup_path
            else command_with_env
        )
        return await _run_command(self, label, command_to_run, timeout=timeout)

    def _apply_environment(self, command: Command) -> Command:
        if not self.environment_prelude:
            return command
        if isinstance(command, str):
            return f"{self.environment_prelude}\n{command}"
        quoted = " ".join(shlex.quote(str(part)) for part in command)
        return f"{self.environment_prelude}\n{quoted}"


@dataclass(frozen=True)
class TaskDefinition:
    name: str
    func: TaskFunc
    dependencies: tuple[str, ...]
    description: str | None = None


class TaskRegistry:
    def __init__(self) -> None:
        self._tasks: dict[str, TaskDefinition] = {}

    def task(
        self,
        *,
        name: str,
        deps: t.Iterable[str] = (),
        description: str | None = None,
    ) -> t.Callable[[TaskFunc], TaskFunc]:
        def decorator(func: TaskFunc) -> TaskFunc:
            if name in self._tasks:
                raise ValueError(f"Task '{name}' already registered")
            self._tasks[name] = TaskDefinition(
                name=name,
                func=func,
                dependencies=tuple(deps),
                description=description,
            )
            return func

        return decorator

    @property
    def tasks(self) -> dict[str, TaskDefinition]:
        return dict(self._tasks)


registry = TaskRegistry()


def send_macos_notification(console: Console, title: str, message: str) -> None:
    if sys.platform != "darwin":
        return
    if shutil.which("osascript") is None:
        return
    script = f"display notification {json.dumps(message)} with title {json.dumps(title)}"
    try:
        subprocess.run(["osascript", "-e", script], check=False)
    except Exception as exc:  # noqa: BLE001
        console.info(f"Failed to send macOS notification: {exc}")


def _exec_git(repo_root: Path, args: list[str]) -> str | None:
    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")
    git_candidates = [env.get("GIT_EXE"), env.get("GIT_BINARY"), "git"]
    errors: list[str] = []
    for candidate in git_candidates:
        if not candidate:
            continue
        try:
            completed = subprocess.run(
                [candidate, *args],
                cwd=str(repo_root),
                env=env,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError:
            errors.append(f"{candidate}: not found")
            continue
        if completed.returncode == 0:
            return completed.stdout
        errors.append(
            completed.stderr.strip() or f"{candidate}: exit code {completed.returncode}"
        )
    if errors:
        raise RuntimeError(f"git command {' '.join(args)} failed: {'; '.join(errors)}")
    return None


def list_repo_files(repo_root: Path) -> list[Path]:
    output = _exec_git(
        repo_root,
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    )
    if output is None:
        files: list[Path] = []
        for path in repo_root.rglob("*"):
            if path.is_file() and ".git" not in path.parts:
                files.append(path.relative_to(repo_root))
        return files
    entries = [entry for entry in output.split("\0") if entry]
    return [Path(entry) for entry in entries]


def create_repo_archive(repo_root: Path) -> Path:
    files = list_repo_files(repo_root)
    tmp = tempfile.NamedTemporaryFile(prefix="cmux-repo-", suffix=".tar", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    with tarfile.open(tmp_path, "w") as tar:
        for rel_path in files:
            full_path = repo_root / rel_path
            if not full_path.exists():
                continue
            tar.add(full_path, arcname=str(rel_path))
    return tmp_path


async def _expose_standard_ports(
    instance: Instance,
    console: Console,
) -> dict[int, str]:
    ports = [EXEC_HTTP_PORT, 39376, 39377, VSCODE_HTTP_PORT, 39379, VNC_HTTP_PORT, CDP_HTTP_PORT, 39382]
    console.info("Exposing standard HTTP services...")

    async def _expose(port: int) -> tuple[int, str]:
        url = await instance.aexpose_http_service(name=f"port-{port}", port=port)
        return port, url

    exposed = await asyncio.gather(*(_expose(port) for port in ports))
    mapping: dict[int, str] = {}
    for port, url in exposed:
        console.info(f"Exposed port {port} → {url}")
        mapping[port] = url
    return mapping


async def _await_instance_ready(instance: Instance, *, console: Console) -> None:
    console.info(f"Waiting for instance {instance.id} to become ready...")
    await instance.await_until_ready()
    console.info(f"Instance {instance.id} is ready")


def _stop_instance(instance: Instance, console: Console) -> None:
    try:
        console.info(f"Stopping instance {instance.id}...")
        instance.stop()
        console.info(f"Instance {instance.id} stopped")
    except Exception as exc:  # noqa: BLE001
        console.always(f"Failed to stop instance {instance.id}: {exc}")


def _shell_command(command: Command) -> list[str]:
    if isinstance(command, str):
        script = f"set -euo pipefail\n{command}"
        return ["bash", "-lc", script]
    return list(command)


def _wrap_command_with_cgroup(cgroup_path: str, command: Command) -> Command:
    cgroup = shlex.quote(cgroup_path)
    prelude = textwrap.dedent(
        f"""
        if [ -d {cgroup} ] && [ -w {cgroup}/cgroup.procs ]; then
            printf '%d\\n' $$ > {cgroup}/cgroup.procs || true
        fi
        """
    ).strip()
    if isinstance(command, str):
        return f"{prelude}\n{command}"
    quoted = " ".join(shlex.quote(str(part)) for part in command)
    return f"{prelude}\n{quoted}"


class HttpExecClient:
    def __init__(self, base_url: str, console: Console) -> None:
        self._base_url = base_url.rstrip("/")
        self._console = console
        parsed = urllib.parse.urlparse(self._base_url)
        self._ssl_context: ssl.SSLContext | None
        if parsed.scheme == "https":
            self._ssl_context = ssl.create_default_context()
        else:
            self._ssl_context = None

    async def wait_ready(
        self,
        *,
        retries: int = 20,
        delay: float = 0.5,
    ) -> None:
        for attempt in range(1, retries + 1):
            try:
                await asyncio.to_thread(self._check_health)
                return
            except Exception:
                if attempt == retries:
                    break
                await asyncio.sleep(delay)
        raise RuntimeError("exec service did not become ready")

    def _check_health(self) -> None:
        url = urllib.parse.urljoin(f"{self._base_url}/", "healthz")
        request = urllib.request.Request(url, method="GET")
        kwargs: dict[str, t.Any] = {"timeout": 5}
        if self._ssl_context is not None:
            kwargs["context"] = self._ssl_context
        with urllib.request.urlopen(request, **kwargs) as response:
            status = response.getcode()
            if status != 200:
                raise RuntimeError(f"unexpected health status {status}")

    async def run(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None,
    ) -> InstanceExecResponse:
        return await asyncio.to_thread(
            self._run_sync,
            label,
            command,
            timeout,
        )

    def _run_sync(
        self,
        label: str,
        command: Command,
        timeout: float | None,
    ) -> InstanceExecResponse:
        exec_cmd = _shell_command(command)
        command_str = exec_cmd if isinstance(exec_cmd, str) else shlex.join(exec_cmd)
        url = urllib.parse.urljoin(f"{self._base_url}/", "exec")
        payload: dict[str, t.Any] = {"command": command_str}
        if timeout is not None:
            payload["timeout_ms"] = max(int(timeout * 1000), 1)
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        request = urllib.request.Request(url, data=data, headers=headers, method="POST")
        kwargs: dict[str, t.Any] = {}
        if timeout is not None:
            kwargs["timeout"] = max(timeout + 5, 30.0)
        if self._ssl_context is not None:
            kwargs["context"] = self._ssl_context

        try:
            response = urllib.request.urlopen(request, **kwargs)
        except urllib.error.URLError as exc:
            raise RuntimeError(f"exec service request failed: {exc}") from exc

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code: int | None = None
        try:
            status = response.getcode()
            if status != 200:
                body = response.read().decode("utf-8", "replace")
                raise RuntimeError(
                    f"exec service returned status {status}: {body.strip()}"
                )
            for raw_line in response:
                line = raw_line.decode("utf-8", "replace").rstrip("\r\n")
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    stderr_parts.append(f"invalid exec response: {line}")
                    self._console.info(
                        f"[{label}][stderr] invalid exec response: {line}"
                    )
                    continue
                event_type = event.get("type")
                if event_type == "stdout":
                    data_value = str(event.get("data", ""))
                    stdout_parts.append(data_value)
                    for sub_line in data_value.splitlines():
                        self._console.info(f"[{label}] {sub_line}")
                elif event_type == "stderr":
                    data_value = str(event.get("data", ""))
                    stderr_parts.append(data_value)
                    for sub_line in data_value.splitlines():
                        self._console.info(f"[{label}][stderr] {sub_line}")
                elif event_type == "exit":
                    try:
                        exit_code = int(event.get("code", 0))
                    except (TypeError, ValueError):
                        exit_code = 1
                elif event_type == "error":
                    message = str(event.get("message", ""))
                    stderr_parts.append(message)
                    self._console.info(f"[{label}][stderr] {message}")
                else:
                    stderr_parts.append(f"unknown event type: {line}")
                    self._console.info(f"[{label}][stderr] unknown event: {line}")
        finally:
            response.close()

        stdout_text = "".join(stdout_parts)
        stderr_text = "".join(stderr_parts)
        if exit_code is None:
            self._console.info(
                f"[{label}] Warning: exec service did not report exit code, assuming success"
            )
            exit_code = 0
        if exit_code not in (0, None):
            # downstream code expects non-zero exit to raise
            error_parts = [f"{label} failed with exit code {exit_code}"]
            if stdout_text.strip():
                error_parts.append(f"stdout:\n{stdout_text.rstrip()}")
            if stderr_text.strip():
                error_parts.append(f"stderr:\n{stderr_text.rstrip()}")
            raise RuntimeError("\n".join(error_parts))
        return InstanceExecResponse(
            exit_code=exit_code,
            stdout=stdout_text,
            stderr=stderr_text,
        )


def _parse_go_target(target: str) -> tuple[str, str]:
    normalized = target.lower().strip()
    prefixes = ("bun-", "go-", "golang-")
    for prefix in prefixes:
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :]
            break
    normalized = normalized.replace("-", "/").replace("_", "/")
    parts = [part for part in normalized.split("/") if part]
    if len(parts) < 2:
        raise ValueError(f"invalid Go target '{target}', expected format GOOS/GOARCH")
    goos, goarch = parts[0], parts[1]
    architecture_aliases = {
        "x64": "amd64",
        "x86_64": "amd64",
        "amd64": "amd64",
        "arm64": "arm64",
        "aarch64": "arm64",
    }
    goarch = architecture_aliases.get(goarch, goarch)
    return goos, goarch


def _build_exec_binary_sync(repo_root: Path, console: Console) -> Path:
    go = shutil.which("go")
    if go is None:
        raise RuntimeError(
            "Go toolchain not found in PATH. Install Go to build the exec daemon."
        )
    entry_path = repo_root / EXEC_SOURCE_PATH
    if not entry_path.exists():
        raise FileNotFoundError(
            f"exec daemon entrypoint not found at {entry_path}. "
            "Did you run this from the repository root?"
        )
    target = os.environ.get(EXEC_BUILD_TARGET_ENV, DEFAULT_EXEC_BUILD_TARGET)
    try:
        goos, goarch = _parse_go_target(target)
    except ValueError as exc:  # noqa: F841
        raise RuntimeError(str(exc)) from exc
    output_dir = repo_root / EXEC_BUILD_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    binary_path = (output_dir / EXEC_BINARY_NAME).resolve()
    console.info(
        f"Building {EXEC_BINARY_NAME} with Go (GOOS={goos}, GOARCH={goarch}) "
        f"from {EXEC_SOURCE_PATH}..."
    )
    env = dict(os.environ)
    env.update(
        {
            "GOOS": goos,
            "GOARCH": goarch,
            "CGO_ENABLED": "0",
        }
    )
    command = [
        go,
        "build",
        "-o",
        str(binary_path),
        ".",
    ]
    result = subprocess.run(command, cwd=str(entry_path.parent), env=env, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"failed to build {EXEC_BINARY_NAME} (go exit {result.returncode})"
        )
    if not binary_path.exists():
        raise FileNotFoundError(
            f"expected exec binary at {binary_path}, but it was not produced"
        )
    console.info(f"Built exec binary at {binary_path}")
    return binary_path

async def setup_exec_service(
    ctx: TaskContext,
    *,
    binary_path: Path,
    service_url: str,
) -> HttpExecClient:
    ctx.console.info("Uploading exec service binary...")
    upload_attempts = 0
    while True:
        try:
            await ctx.instance.aupload(str(binary_path), EXEC_TEMP_PATH)
            break
        except (ApiError, httpx.HTTPError, paramiko.SSHException, OSError) as exc:
            upload_attempts += 1
            if upload_attempts >= 5:
                raise
            delay = 1.5 * upload_attempts
            ctx.console.info(
                f"Retrying exec upload (attempt {upload_attempts}/5) after error: {exc}"
            )
            await asyncio.sleep(delay)
    remote_binary = shlex.quote(EXEC_REMOTE_PATH)
    remote_temp = shlex.quote(EXEC_TEMP_PATH)
    log_path = "/var/log/cmux-execd.log"
    await ctx.run_via_ssh(
        "verify-exec-upload",
        f"ls -l {remote_temp}",
        use_cgroup=False,
    )
    start_script = textwrap.dedent(
        f"""
        set -euo pipefail
        install -Dm0755 {remote_temp} {remote_binary}
        rm -f {remote_temp}
        if command -v pkill >/dev/null 2>&1; then
            pkill -x {EXEC_BINARY_NAME} || true
        else
            pids=$(ps -eo pid,comm | awk '$2 == "{EXEC_BINARY_NAME}" {{print $1}}')
            if [ -n "$pids" ]; then
                kill $pids || true
            fi
        fi
        mkdir -p /var/log
        nohup {remote_binary} --port {EXEC_HTTP_PORT} >{shlex.quote(log_path)} 2>&1 &
        if command -v pgrep >/dev/null 2>&1; then
            sleep 1
            if ! pgrep -x {EXEC_BINARY_NAME} >/dev/null 2>&1; then
                echo "cmux-execd failed to start" >&2
                if [ -f {shlex.quote(log_path)} ]; then
                    tail -n 50 {shlex.quote(log_path)} >&2 || true
                fi
                exit 1
            fi
        fi
        """
    )
    await ctx.run_via_ssh(
        "start-exec-service",
        start_script,
        use_cgroup=False,
    )
    client = HttpExecClient(service_url, ctx.console)
    await client.wait_ready(retries=30, delay=0.5)
    ctx.exec_client = client
    ctx.console.info("Exec service ready")
    return client


@registry.task(
    name="build-setup-exec-binary",
    description="Build and setup exec binary",
)
async def build_exec_binary(ctx: TaskContext) -> None:
    repo_root = ctx.repo_root
    console = ctx.console
    ctx.console.info("Building exec binary...")
    exec_binary_path = await asyncio.to_thread(_build_exec_binary_sync, repo_root, console)
    ctx.console.info("Built exec binary")

    ctx.console.info(f"Setting up exec service at {ctx.exec_service_url}")
    await setup_exec_service(ctx, binary_path=exec_binary_path, service_url=ctx.exec_service_url)
    ctx.console.info("Exec service setup complete")


def _build_resource_profile(args: argparse.Namespace) -> ResourceProfile:
    cpu_period = 100_000
    cpu_quota: int | None = None
    if args.vcpus and args.vcpus > 0:
        cpu_quota = max(int(args.vcpus * cpu_period * 0.9), cpu_period)

    memory_high: int | None = None
    memory_max: int | None = None
    memory_bytes = args.memory * 1024 * 1024
    if memory_bytes > 0:
        memory_high = max(memory_bytes * 9 // 10, 1)
        memory_max = max(memory_bytes * 95 // 100, memory_high)

    return ResourceProfile(
        name="cmux-provision",
        cpu_quota=cpu_quota,
        cpu_period=cpu_quota and cpu_period,
        cpu_weight=80,
        memory_high=memory_high,
        memory_max=memory_max,
        io_weight=200,
    )

@registry.task(
    name="configure-provisioning-cgroup",
    description="Configure provisioning cgroup",
)
async def configure_provisioning_cgroup(ctx: TaskContext) -> None:
    ctx.console.info("Configuring provisioning cgroup...")
    profile = ctx.resource_profile
    if profile is None:
        ctx.console.info("Resource profile not provided; skipping cgroup configuration")
        return

    cgroup_path = f"/sys/fs/cgroup/{profile.name}"
    quoted_cgroup_path = shlex.quote(cgroup_path)
    cpu_max_value = (
        f"{profile.cpu_quota} {profile.cpu_period}"
        if profile.cpu_quota is not None and profile.cpu_period is not None
        else ""
    )
    cpu_quota_value = str(profile.cpu_quota) if profile.cpu_quota is not None else ""
    cpu_period_value = str(profile.cpu_period) if profile.cpu_period is not None else ""
    cpu_weight_value = str(profile.cpu_weight) if profile.cpu_weight is not None else ""
    memory_high_value = (
        str(profile.memory_high) if profile.memory_high is not None else ""
    )
    memory_max_value = str(profile.memory_max) if profile.memory_max is not None else ""
    io_weight_value = str(profile.io_weight) if profile.io_weight is not None else ""

    script = textwrap.dedent(
        f"""
        set -euo pipefail
        CG_ROOT="/sys/fs/cgroup"
        if [ -f "${{CG_ROOT}}/cgroup.controllers" ]; then
            TARGET={quoted_cgroup_path}
            mkdir -p "${{TARGET}}"
            controllers="$(cat "${{CG_ROOT}}/cgroup.controllers")"
            enable_controller() {{
                local ctrl="$1"
                if printf '%s' "${{controllers}}" | grep -qw "$ctrl"; then
                    if ! grep -qw "$ctrl" "${{CG_ROOT}}/cgroup.subtree_control"; then
                        echo "+$ctrl" > "${{CG_ROOT}}/cgroup.subtree_control" || true
                    fi
                fi
            }}
            enable_controller cpu
            enable_controller io
            enable_controller memory
            if [ -n "{cpu_max_value}" ] && [ -w "${{TARGET}}/cpu.max" ]; then
                echo "{cpu_max_value}" > "${{TARGET}}/cpu.max"
            fi
            if [ -n "{cpu_weight_value}" ] && [ -w "${{TARGET}}/cpu.weight" ]; then
                echo "{cpu_weight_value}" > "${{TARGET}}/cpu.weight"
            fi
            if [ -n "{memory_high_value}" ] && [ -w "${{TARGET}}/memory.high" ]; then
                echo "{memory_high_value}" > "${{TARGET}}/memory.high"
            fi
            if [ -n "{memory_max_value}" ] && [ -w "${{TARGET}}/memory.max" ]; then
                echo "{memory_max_value}" > "${{TARGET}}/memory.max"
            fi
            if [ -n "{io_weight_value}" ] && [ -w "${{TARGET}}/io.weight" ]; then
                echo "{io_weight_value}" > "${{TARGET}}/io.weight"
            fi
            exit 0
        fi
        if command -v cgcreate >/dev/null 2>&1 && command -v cgset >/dev/null 2>&1; then
            cgcreate -g cpu,memory,blkio:{profile.name} || true
            if [ -n "{cpu_period_value}" ] && [ -n "{cpu_quota_value}" ]; then
                cgset -r cpu.cfs_period_us={cpu_period_value} {profile.name} || true
                cgset -r cpu.cfs_quota_us={cpu_quota_value} {profile.name} || true
            fi
            if [ -n "{memory_max_value}" ]; then
                cgset -r memory.limit_in_bytes={memory_max_value} {profile.name} || true
            fi
            if [ -n "{memory_high_value}" ]; then
                cgset -r memory.soft_limit_in_bytes={memory_high_value} {profile.name} || true
            fi
            if [ -n "{io_weight_value}" ]; then
                cgset -r blkio.weight={io_weight_value} {profile.name} || true
            fi
        fi
        exit 0
        """
    )
    await ctx.run("configure-resource-cgroup", script)
    verification = await ctx.run(
        "verify-resource-cgroup",
        textwrap.dedent(
            f"""
            if [ -d {quoted_cgroup_path} ] && [ -f {quoted_cgroup_path}/cgroup.procs ]; then
                echo ready
            fi
            """
        ),
    )
    if (verification.stdout or "").strip() == "ready":
        ctx.cgroup_path = cgroup_path
        ctx.console.info(f"Resource cgroup active at {cgroup_path}")
    else:
        ctx.console.info(
            "Cgroup controllers unavailable; continuing without resource isolation"
        )


@registry.task(
    name="apt-bootstrap",
    description="Install core apt utilities and set up package sources",
)
async def task_apt_bootstrap(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        
        # Configure APT for parallel downloads (16 parallel to saturate 2gbps)
        cat > /etc/apt/apt.conf.d/99parallel << 'EOF'
        Acquire::Queue-Mode "host";
        APT::Acquire::Max-Parallel-Downloads "16";
        Acquire::http::Pipeline-Depth "10";
        Acquire::https::Pipeline-Depth "10";
        EOF
        
        # Update and install core utilities needed for source setup
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            ca-certificates curl wget jq git gnupg lsb-release \
            tar unzip xz-utils zip bzip2 gzip htop
        
        # Setup GitHub CLI repository
        install -m 0755 -d /usr/share/keyrings
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
            | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
        arch="$(dpkg --print-architecture)"
        echo "deb [arch=${arch} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
            > /etc/apt/sources.list.d/github-cli.list
        
        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("apt-bootstrap", cmd)


@registry.task(
    name="install-base-packages",
    deps=("apt-bootstrap",),
    description="Install build-essential tooling and utilities",
)
async def task_install_base_packages(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        
        # Single apt-get update to pick up all configured sources
        DEBIAN_FRONTEND=noninteractive apt-get update
        
        # Install all packages in parallel in a single command
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            build-essential make pkg-config g++ libssl-dev \
            ruby-full perl software-properties-common \
            tigervnc-standalone-server tigervnc-common \
            python3-websockify websockify \
            xvfb \
            x11-xserver-utils xterm novnc \
            x11vnc \
            tmux \
            gh \
            zsh \
            zsh-autosuggestions \
            ripgrep
        
        # Download and install Chrome
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
            ;;
          arm64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb"
            ;;
          *)
            echo "Unsupported architecture: ${arch}" >&2
            exit 1
            ;;
        esac
        cd /tmp
        curl -fsSL -o chrome.deb "${chrome_url}"
        DEBIAN_FRONTEND=noninteractive apt-get install -y ./chrome.deb || true
        DEBIAN_FRONTEND=noninteractive apt-get install -yf
        rm -f chrome.deb
        
        # Clean up
        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("install-base-packages", cmd)


@registry.task(
    name="ensure-docker",
    deps=("install-base-packages",),
    description="Install Docker engine and CLI plugins",
)
async def task_ensure_docker(ctx: TaskContext) -> None:
    install_cmd = textwrap.dedent(
        """
        set -euo pipefail
        if command -v docker >/dev/null 2>&1; then
          docker --version
        else
          DEBIAN_FRONTEND=noninteractive apt-get update
          DEBIAN_FRONTEND=noninteractive apt-get install -y \
            ca-certificates curl gnupg lsb-release \
            docker.io python3-docker git
          systemctl enable docker >/dev/null 2>&1 || true
          systemctl restart docker || true
        fi
        for attempt in $(seq 1 30); do
          if docker info >/dev/null 2>&1; then
            echo "Docker ready"
            break
          fi
          if [ "$attempt" -eq 30 ]; then
            echo "Docker failed to start after 30 attempts" >&2
            exit 1
          fi
          sleep 2
        done
        docker --version
        """
    )
    await ctx.run("ensure-docker-basic", install_cmd)
    await ctx.run("ensure-docker-plugins", ensure_docker_cli_plugins())


@registry.task(
    name="install-node-runtime",
    deps=("install-base-packages",),
    description="Install Node.js runtime and pnpm via corepack",
)
async def task_install_node(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        NODE_VERSION="24.9.0"
        arch="$(uname -m)"
        case "${arch}" in
          x86_64) node_arch="x64" ;;
          aarch64|arm64) node_arch="arm64" ;;
          *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
        esac
        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "${tmp_dir}"' EXIT
        cd "${tmp_dir}"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
        grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -
        tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1
        cd /
        ln -sf /usr/local/bin/node /usr/bin/node
        ln -sf /usr/local/bin/npm /usr/bin/npm
        ln -sf /usr/local/bin/npx /usr/bin/npx
        ln -sf /usr/local/bin/corepack /usr/bin/corepack
        npm install -g node-gyp
        corepack enable
        corepack prepare pnpm@10.14.0 --activate
        """
    )
    await ctx.run("install-node-runtime", cmd)


@registry.task(
    name="install-nvm",
    deps=("install-node-runtime",),
    description="Install nvm for runtime use",
)
async def task_install_nvm(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export NVM_DIR="/root/.nvm"
        mkdir -p "${NVM_DIR}"
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh" | bash
        cat <<'PROFILE' > /etc/profile.d/nvm.sh
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
        PROFILE
        bash -lc 'source /etc/profile.d/nvm.sh && nvm --version'
        """
    )
    await ctx.run("install-nvm", cmd)


@registry.task(
    name="install-bun",
    deps=("install-base-packages",),
    description="Install Bun runtime",
)
async def task_install_bun(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        curl -fsSL https://bun.sh/install | bash
        install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun
        ln -sf /usr/local/bin/bun /usr/local/bin/bunx
        bun --version
        bunx --version
        """
    )
    await ctx.run("install-bun", cmd)


@registry.task(
    name="install-go-toolchain",
    deps=("install-base-packages",),
    description="Install Go toolchain for building CMux helpers",
)
async def task_install_go_toolchain(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        GO_VERSION="1.25.2"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            GO_ARCH="amd64"
            ;;
          aarch64|arm64)
            GO_ARCH="arm64"
            ;;
          *)
            echo "Unsupported architecture for Go: ${ARCH}" >&2
            exit 1
            ;;
        esac
        TMP_DIR="$(mktemp -d)"
        trap 'rm -rf "${TMP_DIR}"' EXIT
        cd "${TMP_DIR}"
        curl -fsSLo go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
        rm -rf /usr/local/go
        tar -C /usr/local -xzf go.tar.gz
        install -d /usr/local/bin
        ln -sf /usr/local/go/bin/go /usr/local/bin/go
        ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
        /usr/local/go/bin/go version
        """
    )
    await ctx.run("install-go-toolchain", cmd)


@registry.task(
    name="install-uv-python",
    deps=("apt-bootstrap",),
    description="Install uv CLI and provision default Python runtime",
)
async def task_install_uv_python(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        ARCH="$(uname -m)"
        curl -LsSf https://astral.sh/uv/install.sh | sh
        export PATH="${HOME}/.local/bin:/usr/local/cargo/bin:${PATH}"
        uv python install --default
        PIP_VERSION="$(curl -fsSL https://pypi.org/pypi/pip/json | jq -r '.info.version')"
        python3 -m pip install --break-system-packages --upgrade "pip==${PIP_VERSION}"
        ln -sf /usr/bin/python3 /usr/bin/python
        """
    )
    await ctx.run("install-uv-python", cmd)


@registry.task(
    name="install-rust-toolchain",
    deps=("install-base-packages",),
    description="Install Rust toolchain via rustup",
)
async def task_install_rust_toolchain(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        install -d -m 0755 "${RUSTUP_HOME}" "${CARGO_HOME}"
        install -d -m 0755 "${CARGO_HOME}/bin"
        export PATH="${CARGO_HOME}/bin:${PATH}"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            RUST_HOST_TARGET="x86_64-unknown-linux-gnu"
            ;;
          aarch64|arm64)
            RUST_HOST_TARGET="aarch64-unknown-linux-gnu"
            ;;
          *)
            echo "Unsupported architecture: ${ARCH}" >&2
            exit 1
            ;;
        esac
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
          sh -s -- -y --no-modify-path --profile minimal
        source "${CARGO_HOME}/env"
        rustup component add rustfmt
        rustup target add "${RUST_HOST_TARGET}"
        rustup default stable
        """
    )
    await ctx.run("install-rust-toolchain", cmd)


@registry.task(
    name="install-openvscode",
    deps=("apt-bootstrap",),
    description="Install OpenVSCode server",
)
async def task_install_openvscode(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest | jq -r '.tag_name' | sed 's|^openvscode-server-v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/openvscode-server
        url="https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${CODE_RELEASE}/openvscode-server-v${CODE_RELEASE}-linux-${ARCH}.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}"
        tar xf /tmp/openvscode-server.tar.gz -C /app/openvscode-server --strip-components=1
        rm -f /tmp/openvscode-server.tar.gz
        """
    )
    await ctx.run("install-openvscode", cmd)


@registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies",),
    description="Package the cmux VS Code extension for installation",
)
async def task_package_vscode_extension(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}/packages/vscode-extension
        bun run package
        latest_vsix="$(ls -1t cmux-vscode-extension-*.vsix 2>/dev/null | head -n 1)"
        if [ -z "${{latest_vsix}}" ] || [ ! -f "${{latest_vsix}}" ]; then
          echo "cmux VS Code extension package not found" >&2
          exit 1
        fi
        install -Dm0644 "${{latest_vsix}}" /tmp/cmux-vscode-extension.vsix
        """
    )
    await ctx.run("package-vscode-extension", cmd)


@registry.task(
    name="install-openvscode-extensions",
    deps=("install-openvscode", "package-vscode-extension"),
    description="Preinstall language extensions for OpenVSCode",
)
async def task_install_openvscode_extensions(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export HOME=/root
        server_root="/app/openvscode-server"
        bin_path="${server_root}/bin/openvscode-server"
        if [ ! -x "${bin_path}" ]; then
          echo "OpenVSCode binary not found at ${bin_path}" >&2
          exit 1
        fi
        extensions_dir="/root/.openvscode-server/extensions"
        user_data_dir="/root/.openvscode-server/data"
        mkdir -p "${extensions_dir}" "${user_data_dir}"
        cmux_vsix="/tmp/cmux-vscode-extension.vsix"
        if [ ! -f "${cmux_vsix}" ]; then
          echo "cmux extension package missing at ${cmux_vsix}" >&2
          exit 1
        fi
        install_from_file() {
          local package_path="$1"
          "${bin_path}" \
            --install-extension "${package_path}" \
            --force \
            --extensions-dir "${extensions_dir}" \
            --user-data-dir "${user_data_dir}"
        }
        install_from_file "${cmux_vsix}"
        rm -f "${cmux_vsix}"
        download_dir="$(mktemp -d)"
        cleanup() {
          rm -rf "${download_dir}"
        }
        trap cleanup EXIT
        download_extension() {
          local publisher="$1"
          local name="$2"
          local version="$3"
          local destination="$4"
          local tmpfile="${destination}.download"
          local url="https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage"
          if ! curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o "${tmpfile}" "${url}"; then
            echo "Failed to download ${publisher}.${name}@${version}" >&2
            rm -f "${tmpfile}"
            return 1
          fi
          if gzip -t "${tmpfile}" >/dev/null 2>&1; then
            gunzip -c "${tmpfile}" > "${destination}"
            rm -f "${tmpfile}"
          else
            mv "${tmpfile}" "${destination}"
          fi
        }
        while IFS='|' read -r publisher name version; do
          [ -z "${publisher}" ] && continue
          download_extension "${publisher}" "${name}" "${version}" "${download_dir}/${publisher}.${name}.vsix" &
        done <<'EXTENSIONS'
        anthropic|claude-code|2.0.13
        openai|chatgpt|0.5.19
        ms-vscode|vscode-typescript-next|5.9.20250531
        ms-python|python|2025.6.1
        ms-python|vscode-pylance|2025.8.100
        ms-python|debugpy|2025.14.0
        EXTENSIONS
        wait
        set -- "${download_dir}"/*.vsix
        for vsix in "$@"; do
          if [ -f "${vsix}" ]; then
            install_from_file "${vsix}"
          fi
        done
        """
    )
    await ctx.run("install-openvscode-extensions", cmd)


@registry.task(
    name="install-cursor-cli",
    deps=("apt-bootstrap",),
    description="Install Cursor CLI",
)
async def task_install_cursor(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        curl https://cursor.com/install -fsS | bash
        /root/.local/bin/cursor-agent --version
        """
    )
    await ctx.run("install-cursor-cli", cmd)




@registry.task(
    name="install-global-cli",
    deps=("install-bun", "install-node-runtime"),
    description="Install global agent CLIs with bun",
)
async def task_install_global_cli(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        bun add -g @openai/codex@0.42.0 @anthropic-ai/claude-code@2.0.13 \
          @google/gemini-cli@0.1.21 opencode-ai@0.6.4 codebuff \
          @devcontainers/cli @sourcegraph/amp
        """
    )
    await ctx.run("install-global-cli", cmd)


@registry.task(
    name="configure-zsh",
    deps=("install-base-packages",),
    description="Install zsh configuration and default prompt",
)
async def task_configure_zsh(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        r"""
        set -eux
        zsh_path="$(command -v zsh)"
        if [ -z "${zsh_path}" ]; then
          echo "zsh not found" >&2
          exit 1
        fi
        current_shell="$(getent passwd root | cut -d: -f7 || true)"
        if [ "${current_shell}" != "${zsh_path}" ]; then
          if command -v chsh >/dev/null 2>&1; then
            chsh -s "${zsh_path}" root
          else
            usermod -s "${zsh_path}" root
          fi
        fi
        mkdir -p /root
        autosuggestions="/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
        cat > /root/.zshrc <<EOF
export SHELL="${zsh_path}"
export PATH="/usr/local/bin:/usr/local/cargo/bin:\$HOME/.local/bin:\$PATH"
export XDG_RUNTIME_DIR="/run/user/0"

alias code='/app/openvscode-server/bin/openvscode-server'
alias c='code'
alias g='git'

autoload -Uz colors vcs_info
colors
setopt PROMPT_SUBST

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:git*:*' formats '%F{yellow}git:%b%f'
zstyle ':vcs_info:git*:*' actionformats '%F{yellow}git:%b*%f'

precmd() {
  vcs_info
}

PROMPT='%F{cyan}%n%f %F{green}%~%f\${vcs_info_msg_0_:+ \${vcs_info_msg_0_}} %# '
EOF
        if [ -f "${autosuggestions}" ]; then
          cat >> /root/.zshrc <<'EOF'

if [ -f "${autosuggestions}" ]; then
  source "${autosuggestions}"
  bindkey '^ ' autosuggest-accept
fi
EOF
        fi
        cat >> /root/.zshrc <<'EOF'
HISTFILE=~/.zsh_history
setopt HIST_IGNORE_DUPS HIST_VERIFY
EOF
        cat > /root/.zprofile <<'EOF'
[[ -f ~/.zshrc ]] && source ~/.zshrc
EOF
        mkdir -p /etc/profile.d
        cat <<'EOF' > /etc/profile.d/cmux-paths.sh
export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME=/usr/local/cargo
export PATH="/usr/local/bin:/usr/local/cargo/bin:$HOME/.local/bin:$PATH"
EOF
        if ! grep -q "alias g='git'" /root/.bashrc 2>/dev/null; then
          echo "alias g='git'" >> /root/.bashrc
        fi
        """
    )
    await ctx.run("configure-zsh", cmd)


@registry.task(
    name="upload-repo",
    deps=("apt-bootstrap",),
    description="Upload repository to the instance",
)
async def task_upload_repo(ctx: TaskContext) -> None:
    archive = await asyncio.to_thread(create_repo_archive, ctx.repo_root)
    try:
        await ctx.instance.aupload(str(archive), ctx.remote_repo_tar)
        extract_cmd = textwrap.dedent(
            f"""
            rm -rf {shlex.quote(ctx.remote_repo_root)}
            mkdir -p {shlex.quote(ctx.remote_repo_root)}
            tar -xf {shlex.quote(ctx.remote_repo_tar)} -C {shlex.quote(ctx.remote_repo_root)}
            rm -f {shlex.quote(ctx.remote_repo_tar)}
            """
        )
        await ctx.run("extract-repo", extract_cmd)
    finally:
        archive.unlink(missing_ok=True)


@registry.task(
    name="install-repo-dependencies",
    deps=("upload-repo", "install-bun", "install-node-runtime"),
    description="Install workspace dependencies via bun",
)
async def task_install_repo_dependencies(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        f"""
        export PATH="/usr/local/bin:$PATH"
        cd {shlex.quote(ctx.remote_repo_root)}
        bun install --frozen-lockfile
        """
    )
    await ctx.run("install-repo-dependencies", cmd)


@registry.task(
    name="install-service-scripts",
    deps=("upload-repo", "install-base-packages"),
    description="Install VNC startup script (includes Chrome DevTools)",
)
async def task_install_service_scripts(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -d /usr/local/lib/cmux
        install -m 0755 {repo}/configs/systemd/bin/cmux-start-chrome /usr/local/lib/cmux/cmux-start-chrome
        """
    )
    await ctx.run("install-service-scripts", cmd)


@registry.task(
    name="build-cdp-proxy",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build and install Chrome DevTools proxy binary",
)
async def task_build_cdp_proxy(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/lib/cmux
        cd {repo}/scripts/cdp-proxy
        go build -trimpath -o /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} .
        if [ ! -x /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} ]; then
          echo "Failed to build {CDP_PROXY_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-cdp-proxy", cmd)


@registry.task(
    name="install-systemd-units",
    deps=(
        "upload-repo",
        "install-openvscode",
        "install-openvscode-extensions",
        "install-service-scripts",
        "build-worker",
        "build-cdp-proxy",
        "configure-zsh",
    ),
    description="Install cmux systemd units and helpers",
)
async def task_install_systemd_units(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail

        install -d /usr/local/lib/cmux
        install -Dm0644 {repo}/configs/systemd/cmux.target /usr/lib/systemd/system/cmux.target
        install -Dm0644 {repo}/configs/systemd/cmux-openvscode.service /usr/lib/systemd/system/cmux-openvscode.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker.service /usr/lib/systemd/system/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-proxy.service /usr/lib/systemd/system/cmux-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-dockerd.service /usr/lib/systemd/system/cmux-dockerd.service
        install -Dm0644 {repo}/configs/systemd/cmux-devtools.service /usr/lib/systemd/system/cmux-devtools.service
        install -Dm0644 {repo}/configs/systemd/cmux-xvfb.service /usr/lib/systemd/system/cmux-xvfb.service
        install -Dm0644 {repo}/configs/systemd/cmux-x11vnc.service /usr/lib/systemd/system/cmux-x11vnc.service
        install -Dm0644 {repo}/configs/systemd/cmux-websockify.service /usr/lib/systemd/system/cmux-websockify.service
        install -Dm0644 {repo}/configs/systemd/cmux-cdp-proxy.service /usr/lib/systemd/system/cmux-cdp-proxy.service
        install -Dm0755 {repo}/configs/systemd/bin/configure-openvscode /usr/local/lib/cmux/configure-openvscode
        touch /usr/local/lib/cmux/dockerd.flag
        mkdir -p /var/log/cmux
        mkdir -p /root/workspace
        mkdir -p /etc/systemd/system/multi-user.target.wants
        mkdir -p /etc/systemd/system/cmux.target.wants
        ln -sf /usr/lib/systemd/system/cmux.target /etc/systemd/system/multi-user.target.wants/cmux.target
        ln -sf /usr/lib/systemd/system/cmux-openvscode.service /etc/systemd/system/cmux.target.wants/cmux-openvscode.service
        ln -sf /usr/lib/systemd/system/cmux-worker.service /etc/systemd/system/cmux.target.wants/cmux-worker.service
        ln -sf /usr/lib/systemd/system/cmux-proxy.service /etc/systemd/system/cmux.target.wants/cmux-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-dockerd.service /etc/systemd/system/cmux.target.wants/cmux-dockerd.service
        ln -sf /usr/lib/systemd/system/cmux-devtools.service /etc/systemd/system/cmux.target.wants/cmux-devtools.service
        ln -sf /usr/lib/systemd/system/cmux-xvfb.service /etc/systemd/system/cmux.target.wants/cmux-xvfb.service
        ln -sf /usr/lib/systemd/system/cmux-x11vnc.service /etc/systemd/system/cmux.target.wants/cmux-x11vnc.service
        ln -sf /usr/lib/systemd/system/cmux-websockify.service /etc/systemd/system/cmux.target.wants/cmux-websockify.service
        ln -sf /usr/lib/systemd/system/cmux-cdp-proxy.service /etc/systemd/system/cmux.target.wants/cmux-cdp-proxy.service
        systemctl daemon-reload
        systemctl enable cmux.target
        chown root:root /usr/local
        chown root:root /usr/local/bin
        chmod 0755 /usr/local
        chmod 0755 /usr/local/bin
        if [ -f /usr/local/bin/fetch-mmds-keys ]; then
            chown root:root /usr/local/bin/fetch-mmds-keys
            chmod 0755 /usr/local/bin/fetch-mmds-keys
        fi
        systemctl restart ssh
        systemctl is-active --quiet ssh
        systemctl start cmux.target || true
        """
    )
    await ctx.run("install-systemd-units", cmd)


@registry.task(
    name="install-prompt-wrapper",
    deps=("upload-repo",),
    description="Install prompt-wrapper helper",
)
async def task_install_prompt_wrapper(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -m 0755 {repo}/prompt-wrapper.sh /usr/local/bin/prompt-wrapper
        """
    )
    await ctx.run("install-prompt-wrapper", cmd)


@registry.task(
    name="install-tmux-conf",
    deps=("upload-repo",),
    description="Install tmux configuration",
)
async def task_install_tmux_conf(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0644 {repo}/configs/tmux.conf /etc/tmux.conf
        """
    )
    await ctx.run("install-tmux-conf", cmd)


@registry.task(
    name="install-collect-scripts",
    deps=("upload-repo",),
    description="Install worker helper scripts",
)
async def task_install_collect_scripts(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0755 {repo}/apps/worker/scripts/collect-relevant-diff.sh /usr/local/bin/cmux-collect-relevant-diff.sh
        install -Dm0755 {repo}/apps/worker/scripts/collect-crown-diff.sh /usr/local/bin/cmux-collect-crown-diff.sh
        """
    )
    await ctx.run("install-collect-scripts", cmd)


@registry.task(
    name="build-worker",
    deps=("install-repo-dependencies",),
    description="Build worker bundle and install helper scripts",
)
async def task_build_worker(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}
        bun build ./apps/worker/src/index.ts \\
          --target node \\
          --outdir ./apps/worker/build \\
          --external @cmux/convex \\
          --external 'node:*'
        if [ ! -f ./apps/worker/build/index.js ]; then
          echo "Worker build output missing at ./apps/worker/build/index.js" >&2
          exit 1
        fi
        install -d /builtins
        cat <<'JSON' > /builtins/package.json
{{"name":"builtins","type":"module","version":"1.0.0"}}
JSON
        rm -rf /builtins/build
        cp -r ./apps/worker/build /builtins/build
        install -Dm0755 ./apps/worker/wait-for-docker.sh /usr/local/bin/wait-for-docker.sh
        """
    )
    await ctx.run("build-worker", cmd)


@registry.task(
    name="build-env-binaries",
    deps=("upload-repo", "install-rust-toolchain"),
    description="Build envd/envctl binaries via cargo install",
)
async def task_build_env_binaries(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        export PATH="${{CARGO_HOME}}/bin:$PATH"
        cd {repo}
        cargo install --path crates/cmux-env --locked --force
        """
    )
    await ctx.run("build-env-binaries", cmd, timeout=60 * 30)


@registry.task(
    name="build-cmux-proxy",
    deps=("upload-repo", "install-rust-toolchain"),
    description="Build cmux-proxy binary via cargo install",
)
async def task_build_cmux_proxy(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        export PATH="${{CARGO_HOME}}/bin:$PATH"
        cd {repo}
        cargo install --path crates/cmux-proxy --locked --force
        """
    )
    await ctx.run("build-cmux-proxy", cmd, timeout=60 * 30)


@registry.task(
    name="build-cmux-xterm",
    deps=("upload-repo", "install-rust-toolchain"),
    description="Build cmux-xterm binary via cargo install",
)
async def task_build_cmux_xterm(ctx: TaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        export PATH="${{CARGO_HOME}}/bin:$PATH"
        cd {repo}
        cargo install --path crates/cmux-xterm --locked --force
        """
    )
    await ctx.run("build-cmux-xterm", cmd, timeout=60 * 30)


@registry.task(
    name="link-rust-binaries",
    deps=("build-env-binaries", "build-cmux-proxy", "build-cmux-xterm"),
    description="Symlink built Rust binaries into /usr/local/bin",
)
async def task_link_rust_binaries(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        install -m 0755 /usr/local/cargo/bin/envd /usr/local/bin/envd
        install -m 0755 /usr/local/cargo/bin/envctl /usr/local/bin/envctl
        install -m 0755 /usr/local/cargo/bin/cmux-proxy /usr/local/bin/cmux-proxy
        install -m 0755 /usr/local/cargo/bin/cmux-xterm /usr/local/bin/cmux-xterm
        """
    )
    await ctx.run("link-rust-binaries", cmd)


@registry.task(
    name="configure-envctl",
    deps=("link-rust-binaries", "configure-zsh"),
    description="Configure envctl defaults",
)
async def task_configure_envctl(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        envctl --version
        envctl install-hook bash
        envctl install-hook zsh
        cat <<'PROFILE' > /root/.profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        cat <<'PROFILE' > /root/.bash_profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        mkdir -p /run/user/0
        chmod 700 /run/user/0
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.bashrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.bashrc
        fi
        if ! grep -q 'cmux-paths.sh' /root/.bashrc 2>/dev/null; then
          echo '[ -f /etc/profile.d/cmux-paths.sh ] && . /etc/profile.d/cmux-paths.sh' >> /root/.bashrc
        fi
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.zshrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.zshrc
        fi
        """
    )
    await ctx.run("configure-envctl", cmd)


async def run_task_graph(registry: TaskRegistry, ctx: TaskContext) -> None:
    remaining = registry.tasks
    completed: set[str] = set()
    while remaining:
        ready = [
            name
            for name, task in remaining.items()
            if all(dep in completed for dep in task.dependencies)
        ]
        if not ready:
            unresolved = ", ".join(remaining)
            raise RuntimeError(f"Dependency cycle detected: {unresolved}")
        tasks_to_run = [remaining[name] for name in ready]
        for task in tasks_to_run:
            ctx.console.info(f"→ starting task {task.name}")
        start = time.perf_counter()
        await asyncio.gather(
            *(_run_task_with_timing(ctx, task) for task in tasks_to_run)
        )
        duration = time.perf_counter() - start
        layer_label = f"layer:{'+'.join(ready)}"
        ctx.timings.add(layer_label, duration)
        ctx.console.info(
            f"✓ Layer completed in {duration:.2f}s (tasks: {', '.join(ready)})"
        )
        for task in tasks_to_run:
            completed.add(task.name)
            remaining.pop(task.name, None)


async def _run_task_with_timing(ctx: TaskContext, task: TaskDefinition) -> None:
    start = time.perf_counter()
    await task.func(ctx)
    duration = time.perf_counter() - start
    ctx.timings.add(f"task:{task.name}", duration)
    ctx.console.info(f"✓ {task.name} completed in {duration:.2f}s")


@registry.task(
    name="check-cargo",
    deps=("install-rust-toolchain",),
    description="Verify cargo is installed and working",
)
async def task_check_cargo(ctx: TaskContext) -> None:
    await ctx.run("check-cargo", "PATH=/usr/local/cargo/bin:$PATH cargo --version")


@registry.task(
    name="check-node",
    deps=("install-node-runtime",),
    description="Verify node is installed and working",
)
async def task_check_node(ctx: TaskContext) -> None:
    await ctx.run("check-node", "node --version")


@registry.task(
    name="check-bun",
    deps=("install-bun",),
    description="Verify bun is installed and working",
)
async def task_check_bun(ctx: TaskContext) -> None:
    await ctx.run("check-bun", "bun --version && bunx --version")


@registry.task(
    name="check-uv",
    deps=("install-uv-python",),
    description="Verify uv is installed and working",
)
async def task_check_uv(ctx: TaskContext) -> None:
    await ctx.run("check-uv", "uv --version && uvx --version")


@registry.task(
    name="check-gh",
    deps=("install-base-packages",),
    description="Verify GitHub CLI is installed and working",
)
async def task_check_gh(ctx: TaskContext) -> None:
    await ctx.run("check-gh", "gh --version")


@registry.task(
    name="check-envctl",
    deps=("configure-envctl",),
    description="Verify envctl is installed and working",
)
async def task_check_envctl(ctx: TaskContext) -> None:
    await ctx.run("check-envctl", "envctl --version && command -v envd")


@registry.task(
    name="check-ssh-service",
    deps=("install-systemd-units",),
    description="Verify SSH service is active",
)
async def task_check_ssh_service(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        status_output="$(systemctl status ssh --no-pager)"
        printf '%s\n' "$status_output"
        if ! printf '%s\n' "$status_output" | grep -Fq "active (running)"; then
          echo "ERROR: ssh service status did not report active (running)" >&2
          exit 1
        fi
        """
    )
    await ctx.run("check-ssh-service", cmd)


@registry.task(
    name="check-vscode",
    deps=("install-systemd-units",),
    description="Verify VS Code endpoint is accessible",
)
async def task_check_vscode(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        for attempt in $(seq 1 15); do
          if curl -fsS -o /dev/null http://127.0.0.1:39378/; then
            echo "VS Code endpoint is reachable"
            exit 0
          fi
          sleep 2
        done
        echo "ERROR: VS Code endpoint not reachable after 30s" >&2
        systemctl status cmux-openvscode.service --no-pager || true
        exit 1
        """
    )
    await ctx.run("check-vscode", cmd)


@registry.task(
    name="check-vscode-via-proxy",
    deps=("install-systemd-units",),
    description="Verify VS Code endpoint is accessible through cmux-proxy",
)
async def task_check_vscode_via_proxy(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        for attempt in $(seq 1 15); do
          if curl -fsS -H 'X-Cmux-Port-Internal: 39378' http://127.0.0.1:39379/ >/dev/null; then
            echo "VS Code endpoint is reachable via cmux-proxy"
            exit 0
          fi
          sleep 2
        done
        echo "ERROR: VS Code endpoint via cmux-proxy not reachable after 30s" >&2
        systemctl status cmux-proxy.service --no-pager || true
        systemctl status cmux-openvscode.service --no-pager || true
        tail -n 80 /var/log/cmux/cmux-proxy.log || true
        tail -n 80 /var/log/cmux/openvscode.log || true
        exit 1
        """
    )
    await ctx.run("check-vscode-via-proxy", cmd)


@registry.task(
    name="check-vnc",
    deps=("install-systemd-units",),
    description="Verify VNC packages and endpoint are accessible",
)
async def task_check_vnc(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        # Verify VNC binaries are installed
        vncserver -version
        if ! command -v websockify >/dev/null 2>&1; then
          echo "websockify not installed" >&2
          exit 1
        fi
        websockify --help >/dev/null
        
        # Verify VNC endpoint is accessible
        sleep 5
        for attempt in $(seq 1 15); do
          if curl -fsS -o /dev/null http://127.0.0.1:39380/vnc.html; then
            echo "VNC endpoint is reachable"
            exit 0
          fi
          sleep 2
        done
        echo "ERROR: VNC endpoint not reachable after 30s" >&2
        systemctl status cmux-xvfb.service --no-pager || true
        systemctl status cmux-x11vnc.service --no-pager || true
        systemctl status cmux-websockify.service --no-pager || true
        systemctl status cmux-devtools.service --no-pager || true
        tail -n 60 /var/log/cmux/xvfb.log || true
        tail -n 40 /var/log/cmux/chrome.log || true
        tail -n 40 /var/log/cmux/x11vnc.log || true
        tail -n 40 /var/log/cmux/websockify.log || true
        exit 1
        """
    )
    await ctx.run("check-vnc", cmd)


@registry.task(
    name="check-devtools",
    deps=("install-systemd-units",),
    description="Verify Chrome browser and DevTools endpoint are accessible",
)
async def task_check_devtools(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        # Verify Chrome is installed
        google-chrome --version
        
        # Verify DevTools endpoint is accessible
        sleep 5
        for attempt in $(seq 1 45); do
          if curl -fsS -o /dev/null http://127.0.0.1:39381/json/version; then
            echo "DevTools endpoint is reachable"
            exit 0
          fi
          sleep 2
        done
        echo "ERROR: DevTools endpoint not reachable after 90s" >&2
        systemctl status cmux-devtools.service --no-pager || true
        systemctl status cmux-xvfb.service --no-pager || true
        systemctl status cmux-cdp-proxy.service --no-pager || true
        ss -ltnp | grep 3938 || true
        tail -n 100 /var/log/cmux/chrome.log || true
        tail -n 40 /var/log/cmux/x11vnc.log || true
        exit 1
        """
    )
    await ctx.run("check-devtools", cmd)

@registry.task(
    name="check-worker",
    deps=("install-systemd-units",),
    description="Verify worker service is running",
)
async def task_check_worker(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        for attempt in $(seq 1 30); do
          if systemctl is-active --quiet cmux-worker.service; then
            if health="$(curl -fsS http://127.0.0.1:39377/health)"; then
              printf '%s\n' "$health"
              exit 0
            fi
          fi
          sleep 2
        done
        echo "ERROR: cmux-worker service failed health check" >&2
        systemctl status cmux-worker.service --no-pager || true
        tail -n 80 /var/log/cmux/worker.log || true
        exit 1
        """
    )
    await ctx.run("check-worker", cmd)


@registry.task(
    name="check-cmux-xterm",
    deps=("link-rust-binaries",),
    description="Verify cmux-xterm binary is installed and working",
)
async def task_check_cmux_xterm(ctx: TaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        if ! command -v cmux-xterm >/dev/null 2>&1; then
          echo "ERROR: cmux-xterm binary not found in PATH" >&2
          exit 1
        fi
        cmux-xterm --version || cmux-xterm --help >/dev/null 2>&1 || true
        echo "cmux-xterm binary is installed"
        """
    )
    await ctx.run("check-cmux-xterm", cmd)


async def verify_devtools_via_exposed_url(
    port_map: dict[int, str],
    *,
    console: Console,
) -> None:
    cdp_base_url = port_map.get(CDP_HTTP_PORT)
    if cdp_base_url is None:
        raise RuntimeError("Failed to expose DevTools service URL via Morph")
    version_url = urllib.parse.urljoin(
        cdp_base_url.rstrip("/") + "/",
        "json/version",
    )
    console.info(f"Verifying DevTools via exposed URL: {version_url}")
    max_attempts = 45
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(5.0, connect=5.0, read=5.0),
        follow_redirects=True,
    ) as client:
        for attempt in range(1, max_attempts + 1):
            try:
                response = await client.get(
                    version_url,
                    headers={"Accept": "application/json"},
                )
            except (httpx.HTTPError, ssl.SSLError, OSError) as exc:
                console.info(
                    f"Attempt {attempt}/{max_attempts} failed to reach DevTools via Morph: {exc}"
                )
            else:
                if response.status_code == httpx.codes.OK:
                    console.info("DevTools endpoint is reachable via Morph exposed URL")
                    return
                console.info(
                    f"Attempt {attempt}/{max_attempts} returned HTTP "
                    f"{response.status_code} from DevTools via Morph"
                )
            if attempt < max_attempts:
                await asyncio.sleep(2)
    raise RuntimeError(
        "DevTools endpoint not reachable via Morph exposed URL after multiple attempts"
    )


async def snapshot_instance(
    instance: Instance,
    *,
    console: Console,
) -> Snapshot:
    console.info(f"Snapshotting instance {instance.id}...")
    snapshot = await instance.asnapshot()
    console.info(f"Created snapshot {snapshot.id}")
    return snapshot


async def provision_and_snapshot(args: argparse.Namespace) -> None:
    console = Console()
    timings = TimingsCollector()
    client = MorphCloudClient()
    started_instances: list[Instance] = []

    def _cleanup() -> None:
        while started_instances:
            inst = started_instances.pop()
            _stop_instance(inst, console)

    def _sync_cleanup() -> None:
        _cleanup()

    atexit.register(_sync_cleanup)

    repo_root = Path(args.repo_root).resolve()

    instance = await client.instances.aboot(
        args.snapshot_id,
        vcpus=args.vcpus,
        memory=args.memory,
        disk_size=args.disk_size,
        ttl_seconds=args.ttl_seconds,
        ttl_action=args.ttl_action,
    )
    started_instances.append(instance)
    await _await_instance_ready(instance, console=console)
    console.always(
        f"Dashboard: https://cloud.morph.so/web/instances/{instance.id}?ssh=true"
    )
    port_map = await _expose_standard_ports(instance, console)
    exec_service_url = port_map.get(EXEC_HTTP_PORT)
    if exec_service_url is None:
        raise RuntimeError("Failed to expose exec service port on primary instance")

    resource_profile = _build_resource_profile(args)

    ctx = TaskContext(
        instance=instance,
        repo_root=repo_root,
        remote_repo_root="/cmux",
        remote_repo_tar="/tmp/cmux-repo.tar",
        console=console,
        timings=timings,
        resource_profile=resource_profile,
        exec_service_url=exec_service_url
    )

    await run_task_graph(registry, ctx)
    await verify_devtools_via_exposed_url(port_map, console=console)

    graph = format_dependency_graph(registry)
    if graph:
        console.always("\nDependency Graph")
        for line in graph.splitlines():
            console.always(line)

    summary = timings.summary()
    if summary:
        console.always("\nTiming Summary")
        for line in summary:
            console.always(line)

    vscode_url = port_map.get(VSCODE_HTTP_PORT)
    if vscode_url is None:
        raise RuntimeError("Failed to expose VS Code service URL")
    vnc_base_url = port_map.get(VNC_HTTP_PORT)
    if vnc_base_url is None:
        raise RuntimeError("Failed to expose VNC service URL")
    vnc_url = urllib.parse.urljoin(vnc_base_url.rstrip("/") + "/", "vnc.html")

    console.always(f"VS Code is at this URL: {vscode_url}")
    console.always(f"VNC is at this URL: {vnc_url}")

    send_macos_notification(
        console,
        "Verify cmux workspace",
        f"VS Code: {vscode_url} / VNC: {vnc_url}",
    )
    console.info("Sent verification notification (macOS only).")
    console.always(
        "Review the workspace URLs above, then press Enter to create the snapshot."
    )
    await asyncio.to_thread(input, "")

    snapshot = await snapshot_instance(instance, console=console)

    console.always(f"Snapshot created: {snapshot.id}")
    console.always(f"Provisioning complete. Snapshot id: {snapshot.id}")
    console.always(f"Primary instance: {instance.id}")


def format_dependency_graph(registry: TaskRegistry) -> str:
    tasks = registry.tasks
    if not tasks:
        return ""

    children: dict[str, list[str]] = {name: [] for name in tasks}
    for task in tasks.values():
        for dependency in task.dependencies:
            children.setdefault(dependency, []).append(task.name)
    for child_list in children.values():
        child_list.sort()

    roots = sorted(
        name for name, definition in tasks.items() if not definition.dependencies
    )

    lines: list[str] = []

    def render_node(
        node: str,
        prefix: str,
        is_last: bool,
        path: set[str],
    ) -> None:
        connector = "└─" if is_last else "├─"
        lines.append(f"{prefix}{connector} {node}")
        if node in path:
            lines.append(f"{prefix}   ↻ cycle")
            return
        descendants = children.get(node, [])
        if not descendants:
            return
        next_prefix = f"{prefix}   " if is_last else f"{prefix}│  "
        next_path = set(path)
        next_path.add(node)
        for index, child in enumerate(descendants):
            render_node(child, next_prefix, index == len(descendants) - 1, next_path)

    for root_index, root in enumerate(roots):
        if root_index:
            lines.append("")
        lines.append(root)
        descendants = children.get(root, [])
        for index, child in enumerate(descendants):
            render_node(child, "", index == len(descendants) - 1, {root})

    orphaned = sorted(
        name
        for name in tasks
        if name not in roots
        and all(name not in children.get(other, []) for other in tasks)
    )
    for orphan in orphaned:
        if lines:
            lines.append("")
        lines.append(orphan)

    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provision Morph instance with parallel setup"
    )
    parser.add_argument(
        "--snapshot-id",
        default="snapshot_3fjuvxbs",
        help="Base snapshot id to boot from",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root to upload (default: current directory)",
    )
    parser.add_argument("--vcpus", type=int, default=4, help="vCPU count for instance")
    parser.add_argument(
        "--memory",
        type=int,
        default=16_384,
        help="Memory (MiB) for instance",
    )
    parser.add_argument(
        "--disk-size",
        type=int,
        default=32_768,
        help="Disk size (MiB) for instance",
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=3600,
        help="TTL seconds for created instances",
    )
    parser.add_argument(
        "--ttl-action",
        default="pause",
        choices=("pause", "stop"),
        help="Action when TTL expires",
    )
    parser.add_argument(
        "--print-deps",
        action="store_true",
        help="Print dependency graph and exit",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if getattr(args, "print_deps", False):
        graph = format_dependency_graph(registry)
        if graph:
            print(graph)
        return
    asyncio.run(provision_and_snapshot(args))


if __name__ == "__main__":
    main()
