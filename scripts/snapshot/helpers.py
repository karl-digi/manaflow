from __future__ import annotations

import os
import shutil
import subprocess
import urllib.parse

from pathlib import Path

from ._types import Console


def format_package_task_label(pkg: str) -> str:
    """Create a task-friendly label from an npm package name/specifier."""
    if pkg.startswith("@"):
        version_idx = pkg.rfind("@")
        package_name = pkg[:version_idx] if version_idx > 0 else pkg
    else:
        package_name = pkg.split("@", 1)[0]
    return package_name.lstrip("@").replace("/", "-")


def is_remote_package_source(spec: str) -> bool:
    parsed = urllib.parse.urlparse(spec)
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


# bun add -g fails extracting @anthropic-ai/claude-code@2.1.89 on linux/amd64.
# Keep this list in sync with scripts/lib/ideDeps.ts:NPM_GLOBAL_INSTALL_PACKAGES.
NPM_GLOBAL_INSTALL_PACKAGES = frozenset({"@anthropic-ai/claude-code"})


def select_global_package_installer(package_name: str, spec: str) -> str:
    if is_remote_package_source(spec) or package_name in NPM_GLOBAL_INSTALL_PACKAGES:
        return "npm"
    return "bun"


def maybe_apply_ide_package_overrides(repo_root: Path, console: Console) -> None:
    raw_overrides = os.environ.get("IDE_DEPS_PACKAGE_OVERRIDES", "").strip()
    if not raw_overrides:
        return

    bun_path = shutil.which("bun")
    if bun_path is None:
        raise RuntimeError(
            "bun not found on host; install bun or unset IDE_DEPS_PACKAGE_OVERRIDES."
        )

    console.always("Applying IDE package overrides from IDE_DEPS_PACKAGE_OVERRIDES...")
    override_result = subprocess.run(
        [bun_path, "run", "./scripts/apply-ide-deps-package-overrides.ts"],
        cwd=str(repo_root),
        text=True,
    )
    if override_result.returncode != 0:
        raise RuntimeError(
            "bun run ./scripts/apply-ide-deps-package-overrides.ts "
            f"failed with exit code {override_result.returncode}"
        )
