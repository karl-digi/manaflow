/**
 * Morph sandbox provider implementation.
 *
 * Uses Morph cloud API to spawn and manage sandboxes.
 * https://cloud.morph.so/
 */

import { Effect } from "effect";
import { TracingLive } from "../../convex/effect/tracing";
import type {
  SandboxInstance,
  SandboxProvider,
  SandboxSpawnOptions,
  SandboxStatusInfo,
} from "./types";

interface MorphStartResponse {
  id: string;
  status?: string;
}

interface MorphStatusResponse {
  id: string;
  status: string;
  network?: {
    ip?: string;
    ports?: Record<string, number>;
  };
}

type SpanAttributes = Record<string, boolean | number | string | undefined>;

const sanitizeAttributes = (
  attributes: SpanAttributes
): Record<string, boolean | number | string> => {
  const sanitized: Record<string, boolean | number | string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

const traceMorph = async <T>(
  name: string,
  attributes: SpanAttributes,
  task: () => Promise<T>
): Promise<T> => {
  return Effect.runPromise(
    Effect.tryPromise({
      try: task,
      catch: (error) => {
        console.error(`[morph] ${name} failed`, error);
        return error instanceof Error ? error : new Error(`morph.${name} failed`);
      },
    }).pipe(
      Effect.withSpan(`morph.${name}`, { attributes: sanitizeAttributes(attributes) }),
      Effect.provide(TracingLive)
    )
  );
};

export class MorphSandboxProvider implements SandboxProvider {
  readonly name = "morph" as const;
  private readonly apiKey: string;
  private readonly baseUrl = "https://cloud.morph.so/api";

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("MORPH_API_KEY is required");
    }
    this.apiKey = apiKey;
  }

  async spawn(options: SandboxSpawnOptions): Promise<SandboxInstance> {
    return traceMorph(
      "spawn",
      {
        snapshotId: options.snapshotId ?? "none",
        ttlSeconds: options.ttlSeconds,
        ttlAction: options.ttlAction ?? "pause",
        teamId: options.teamId,
      },
      async () => {
        // Morph API: POST /instance?snapshot_id=xxx with body for metadata/ttl/setup
        const url = new URL(`${this.baseUrl}/instance`);
        url.searchParams.set("snapshot_id", options.snapshotId ?? "");

        const response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            ttl_seconds: options.ttlSeconds,
            ttl_action: options.ttlAction ?? "pause",
            metadata: {
              app: "cmux-acp",
              teamId: options.teamId,
              ...options.metadata,
            },
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("[morph] Failed to spawn instance:", text);
          throw new Error(`Failed to spawn Morph instance: ${response.status}`);
        }

        const data = (await response.json()) as MorphStartResponse;

        // HTTP service is already exposed in the snapshot (see snapshot provisioning)
        // No need to call expose again - it's inherited from the snapshot

        // Morph VMs are accessible at {service-name}-{instanceId}.http.cloud.morph.so
        // Instance ID uses underscore (morphvm_xxx) but URL uses hyphen (morphvm-xxx)
        // We expose the ACP server as service name "acp"
        const urlSafeId = data.id.replace(/_/g, "-");
        const sandboxUrl = `https://acp-${urlSafeId}.http.cloud.morph.so`;

        return {
          instanceId: data.id,
          provider: "morph",
          sandboxUrl,
        };
      }
    );
  }

  async stop(instanceId: string): Promise<void> {
    return traceMorph(
      "stop",
      { instanceId },
      async () => {
        const response = await fetch(`${this.baseUrl}/instance/${instanceId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        if (!response.ok) {
          const text = await response.text();
          console.error("[morph] Failed to stop instance:", text);
          throw new Error(`Failed to stop Morph instance: ${response.status}`);
        }
      }
    );
  }

  async pause(instanceId: string): Promise<void> {
    return traceMorph(
      "pause",
      { instanceId },
      async () => {
        const response = await fetch(
          `${this.baseUrl}/instance/${instanceId}/pause`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          console.error("[morph] Failed to pause instance:", text);
          throw new Error(`Failed to pause Morph instance: ${response.status}`);
        }
      }
    );
  }

  async resume(instanceId: string): Promise<void> {
    return traceMorph(
      "resume",
      { instanceId },
      async () => {
        const response = await fetch(
          `${this.baseUrl}/instance/${instanceId}/resume`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          }
        );

        if (!response.ok) {
          const text = await response.text();
          console.error("[morph] Failed to resume instance:", text);
          throw new Error(`Failed to resume Morph instance: ${response.status}`);
        }
      }
    );
  }

  async getStatus(instanceId: string): Promise<SandboxStatusInfo> {
    return traceMorph(
      "getStatus",
      { instanceId },
      async () => {
        const response = await fetch(`${this.baseUrl}/instance/${instanceId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            return { status: "stopped" };
          }
          const text = await response.text();
          console.error("[morph] Failed to get instance status:", text);
          throw new Error(
            `Failed to get Morph instance status: ${response.status}`
          );
        }

        const data = (await response.json()) as MorphStatusResponse;

        // Map Morph status to our status
        const statusMap: Record<string, SandboxStatusInfo["status"]> = {
          starting: "starting",
          running: "running",
          ready: "running", // Morph returns "ready" for healthy instances
          paused: "paused",
          stopping: "stopping",
          stopped: "stopped",
          error: "error",
        };

        return {
          status: statusMap[data.status] ?? "error",
          sandboxUrl: data.network?.ip
            ? `http://${data.network.ip}:${data.network.ports?.["39384"] ?? 39384}`
            : undefined,
        };
      }
    );
  }
}
