import { Daytona, Image } from "@daytonaio/sdk";
import path from "node:path";

const DEFAULT_SNAPSHOT_NAME = "cmux-devbox-full";
const DEFAULT_DOCKERFILE_PATH = path.join(
  process.cwd(),
  "packages",
  "cmux-devbox-2",
  "daytona.Dockerfile"
);

async function main(): Promise<void> {
  const snapshotName = process.env.DAYTONA_DEVBOX_SNAPSHOT_NAME ?? DEFAULT_SNAPSHOT_NAME;
  const dockerfilePath =
    process.env.DAYTONA_DEVBOX_DOCKERFILE ?? DEFAULT_DOCKERFILE_PATH;

  const forceRecreate =
    (process.env.DAYTONA_DEVBOX_FORCE_RECREATE ?? "").toLowerCase() === "true" ||
    process.env.DAYTONA_DEVBOX_FORCE_RECREATE === "1";
  const smokeTestDisabled =
    (process.env.DAYTONA_DEVBOX_SMOKE_TEST ?? "").toLowerCase() === "false" ||
    process.env.DAYTONA_DEVBOX_SMOKE_TEST === "0";

  const daytona = new Daytona();

  const sleep = async (ms: number): Promise<void> =>
    await new Promise((resolve) => setTimeout(resolve, ms));

  const isNotFoundError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    const msg = error.message.toLowerCase();
    return msg.includes("not found") || msg.includes("404");
  };

  const waitForSnapshotDeletion = async (name: string): Promise<void> => {
    const start = Date.now();
    const timeoutMs = 2 * 60 * 1000;

    for (;;) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for snapshot deletion: ${name} (${timeoutMs}ms)`
        );
      }

      try {
        await daytona.snapshot.get(name);
        await sleep(2000);
      } catch (error) {
        if (isNotFoundError(error)) return;
        throw error;
      }
    }
  };

  if (forceRecreate) {
    try {
      const existing = await daytona.snapshot.get(snapshotName);
      console.log(
        `[daytona-devbox] Deleting existing snapshot ${existing.name} (${existing.id})...`
      );
      await daytona.snapshot.delete(existing);
      await waitForSnapshotDeletion(snapshotName);
    } catch (error) {
      // If the snapshot doesn't exist, continue. Otherwise surface the failure.
      console.error("[daytona-devbox] Snapshot delete failed (continuing):", error);
    }
  }

  console.log(
    `[daytona-devbox] Creating snapshot ${snapshotName} from ${dockerfilePath}...`
  );

  const image = Image.fromDockerfile(dockerfilePath);

  let snapshot: Awaited<ReturnType<typeof daytona.snapshot.create>> | null = null;
  const createStart = Date.now();
  const createTimeoutMs = 2 * 60 * 1000;
  for (;;) {
    try {
      snapshot = await daytona.snapshot.create(
        {
          name: snapshotName,
          image,
          resources: {
            cpu: 4,
            memory: 8,
            disk: 10,
          },
        },
        { onLogs: console.log, timeout: 0 }
      );
      break;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("already exists") &&
        Date.now() - createStart < createTimeoutMs
      ) {
        console.log(
          `[daytona-devbox] Snapshot name still in use, retrying in 3s...`
        );
        await sleep(3000);
        continue;
      }
      throw error;
    }
  }
  if (!snapshot) {
    throw new Error("Snapshot creation failed unexpectedly");
  }

  console.log(
    `[daytona-devbox] Snapshot ready: ${snapshot.name} (${snapshot.id}) state=${snapshot.state}`
  );

  if (smokeTestDisabled) {
    return;
  }

  console.log(`[daytona-devbox] Running smoke test sandbox...`);

  const sandbox = await daytona.create(
    { snapshot: snapshotName, public: true },
    { timeout: 120 }
  );

  try {
    const run = async (
      command: string,
      options: { allowFail?: boolean } = {}
    ): Promise<string> => {
      const response = await sandbox.process.executeCommand(command);
      const stdout = response.result ?? "";
      if (response.exitCode !== 0 && !options.allowFail) {
        throw new Error(
          `Smoke test command failed (exit ${response.exitCode}): ${command}\n${stdout}`
        );
      }
      console.log(stdout);
      return stdout;
    };

    // Daytona doesn't run the Dockerfile CMD; start services explicitly.
    await run(
      "nohup /usr/local/bin/start-services.sh >/tmp/start-services.log 2>&1 </dev/null & echo services-started"
    );

    const waitForWorker = async (): Promise<void> => {
      const start = Date.now();
      const timeoutMs = 2 * 60 * 1000;
      for (;;) {
        const { exitCode } = await sandbox.process.executeCommand(
          "curl -sf --max-time 2 http://localhost:39377/health >/dev/null"
        );
        if (exitCode === 0) return;
        if (Date.now() - start > timeoutMs) {
          throw new Error(
            `Worker health did not become ready within ${timeoutMs}ms`
          );
        }
        await sleep(2000);
      }
    };

    await waitForWorker();

    await run("docker --version");
    await run("docker compose version || docker-compose --version || true");
    await run("which vncserver");
    await run("test -x /app/cmux-code/bin/code-server-oss && echo cmux-code-ok");
    await run("curl -sf http://localhost:39377/health && echo worker-ok");
    await run("cat /home/user/.worker-auth-token | head -c 8 && echo ...");
    await run("nc -zv 127.0.0.1 39377 2>&1 | tail -n 1");
    await run("nc -zv 127.0.0.1 39378 2>&1 | tail -n 1");
    await run("nc -zv 127.0.0.1 39380 2>&1 | tail -n 1");
    await run("docker info >/dev/null 2>&1 && echo docker-info-ok", {
      allowFail: true,
    });

    const workerPreview = await sandbox.getPreviewLink(39377);
    const vscodePreview = await sandbox.getPreviewLink(39378);
    const vncPreview = await sandbox.getPreviewLink(39380);

    console.log("[daytona-devbox] Daytona preview links:");
    console.log(`  worker: ${workerPreview.url}`);
    console.log(`  vscode: ${vscodePreview.url}`);
    console.log(`  vnc:    ${vncPreview.url}`);
  } finally {
    try {
      await sandbox.delete();
    } catch (error) {
      console.error("[daytona-devbox] Failed to delete smoke test sandbox:", error);
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exit(1);
}
