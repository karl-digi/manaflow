import {
  CONNECT_GITHUB_ACTION,
  DEFAULT_GITHUB_CONNECT_MESSAGE,
  GITHUB_CREDENTIALS_REQUIRED_MARKER,
} from "@cmux/shared";
import { dockerLogger } from "../utils/fileLogger";
import { getWwwClient } from "../utils/wwwClient";
import { getWwwOpenApiModule } from "../utils/wwwOpenApiModule";
import {
  VSCodeInstance,
  type VSCodeInstanceConfig,
  type VSCodeInstanceInfo,
} from "./VSCodeInstance";

const {
  getApiSandboxesByIdStatus,
  postApiSandboxesByIdPublishDevcontainer,
  postApiSandboxesByIdStop,
  postApiSandboxesStart,
} = await getWwwOpenApiModule();

function extractGithubCredentialError(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "object" && error !== null) {
    const action = (error as { action?: string }).action;
    const code = (error as { code?: string }).code;
    const message = (error as { message?: string }).message;
    if (
      (typeof action === "string" && action === CONNECT_GITHUB_ACTION) ||
      (typeof code === "string" && code.startsWith("GITHUB_"))
    ) {
      return typeof message === "string"
        ? message
        : DEFAULT_GITHUB_CONNECT_MESSAGE;
    }
  }
  if (typeof error === "string") {
    const normalized = error.toLowerCase();
    if (
      normalized.includes("github access token not found") ||
      normalized.includes("github account not found") ||
      normalized.includes("resolve github credentials")
    ) {
      return error;
    }
  }
  return null;
}

export class CmuxVSCodeInstance extends VSCodeInstance {
  private sandboxId: string | null = null;
  private workerUrl: string | null = null;
  private vscodeBaseUrl: string | null = null;
  private provider: VSCodeInstanceInfo["provider"] = "morph";
  private repoUrl?: string;
  private branch?: string;
  private newBranch?: string;
  private environmentId?: string;
  private taskRunJwt?: string;

  constructor(config: VSCodeInstanceConfig) {
    super(config);
    const cfg = config as VSCodeInstanceConfig & {
      repoUrl?: string;
      branch?: string;
      newBranch?: string;
      environmentId?: string;
      taskRunJwt?: string;
    };
    this.repoUrl = cfg.repoUrl;
    this.branch = cfg.branch;
    this.newBranch = cfg.newBranch;
    this.environmentId = cfg.environmentId;
    this.taskRunJwt = cfg.taskRunJwt;
  }

  async start(): Promise<VSCodeInstanceInfo> {
    dockerLogger.info(
      `[CmuxVSCodeInstance ${this.instanceId}] Requesting sandbox start via www API`
    );
    const startRes = await postApiSandboxesStart({
      client: getWwwClient(),
      body: {
        teamSlugOrId: this.teamSlugOrId,
        ttlSeconds: 60 * 60,
        metadata: {
          instance: `cmux-${this.taskRunId}`,
          agentName: this.config.agentName || "",
        },
        taskRunId: this.taskRunId,
        taskRunJwt: this.taskRunJwt || "",
        isCloudWorkspace: this.config.agentName === "cloud-workspace",
        ...(this.environmentId ? { environmentId: this.environmentId } : {}),
        ...(this.repoUrl
          ? {
            repoUrl: this.repoUrl,
            branch: this.branch,
            newBranch: this.newBranch,
            depth: 1,
          }
          : {}),
      },
    });
    const data = startRes.data;
    if (!data) {
      const maybeError = (startRes as { error?: unknown }).error;
      const githubErrorMessage = extractGithubCredentialError(maybeError);
      if (githubErrorMessage) {
        throw new Error(
          `${GITHUB_CREDENTIALS_REQUIRED_MARKER} ${githubErrorMessage}`.trim()
        );
      }
      const fallbackMessage =
        typeof maybeError === "string" && maybeError.length > 0
          ? maybeError
          : "Failed to start sandbox";
      throw new Error(fallbackMessage);
    }

    this.sandboxId = data.instanceId;
    this.vscodeBaseUrl = data.vscodeUrl;
    this.workerUrl = data.workerUrl;
    this.provider = data.provider || "morph";

    const workspaceUrl = this.getWorkspaceUrl(this.vscodeBaseUrl);
    dockerLogger.info(`[CmuxVSCodeInstance] VS Code URL: ${workspaceUrl}`);
    dockerLogger.info(`[CmuxVSCodeInstance] Worker URL: ${this.workerUrl}`);

    // Connect to the worker if available
    if (this.workerUrl) {
      try {
        await this.connectToWorker(this.workerUrl);
        dockerLogger.info(
          `[CmuxVSCodeInstance ${this.instanceId}] Connected to worker`
        );
      } catch (error) {
        dockerLogger.error(
          `[CmuxVSCodeInstance ${this.instanceId}] Failed to connect to worker`,
          error
        );
      }
    }

    return {
      url: this.vscodeBaseUrl!,
      workspaceUrl,
      instanceId: this.instanceId,
      taskRunId: this.taskRunId,
      provider: this.provider,
    };
  }

  async stop(): Promise<void> {
    // Disconnect socket and ask www to stop
    await this.disconnectFromWorker();
    if (this.sandboxId) {
      try {
        await postApiSandboxesByIdStop({
          client: getWwwClient(),
          path: { id: this.sandboxId },
        });
      } catch (e) {
        dockerLogger.warn(`[CmuxVSCodeInstance] stop failed`, e);
      }
    }
    await this.baseStop();
  }

  async getStatus(): Promise<{ running: boolean; info?: VSCodeInstanceInfo }> {
    if (!this.sandboxId) return { running: false };
    try {
      const res = await getApiSandboxesByIdStatus({
        client: getWwwClient(),
        path: { id: this.sandboxId },
        responseStyle: "data",
      });
      const st = res as unknown as {
        running: boolean;
        vscodeUrl?: string;
        workerUrl?: string;
        provider?: VSCodeInstanceInfo["provider"];
      };
      if (st.running && st.vscodeUrl) {
        return {
          running: true,
          info: {
            url: st.vscodeUrl,
            workspaceUrl: this.getWorkspaceUrl(st.vscodeUrl),
            instanceId: this.instanceId,
            taskRunId: this.taskRunId,
            provider: st.provider || this.provider,
          },
        };
      }
      return { running: false };
    } catch {
      return { running: false };
    }
  }

  // Bridge for agentSpawner to publish devcontainer networking (Morph-backed)
  async setupDevcontainer(): Promise<void> {
    if (!this.sandboxId) return;
    try {
      await postApiSandboxesByIdPublishDevcontainer({
        client: getWwwClient(),
        path: { id: this.sandboxId },
        body: {
          teamSlugOrId: this.teamSlugOrId,
          taskRunId: this.taskRunId,
        },
      });
    } catch (e) {
      dockerLogger.warn(
        `[CmuxVSCodeInstance] setupDevcontainer failed for sandbox ${this.sandboxId}`,
        e
      );
    }
  }

  getName(): string {
    return this.sandboxId || this.instanceId;
  }
}
