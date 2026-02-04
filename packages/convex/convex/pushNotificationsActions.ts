"use node";

import { v } from "convex/values";
import { z } from "zod";
import { connect, type ClientHttp2Session } from "node:http2";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { SignJWT, importPKCS8 } from "jose";

type ApnsEnvironment = "development" | "production";

const apnsErrorSchema = z.object({ reason: z.string() });

export const sendTaskRunNotification = internalAction({
  args: {
    taskId: v.id("tasks"),
    taskRunId: v.optional(v.id("taskRuns")),
    teamId: v.string(),
    userId: v.string(),
    type: v.union(v.literal("run_completed"), v.literal("run_failed")),
  },
  handler: async (ctx, args) => {
    const summary = await ctx.runQuery(internal.pushTokens.getTaskSummary, {
      taskId: args.taskId,
    });

    const title =
      args.type === "run_completed" ? "Task completed" : "Task failed";
    const body = summary.title;

    const payload = {
      aps: {
        alert: {
          title,
          body,
        },
        sound: "default",
      },
      data: {
        taskId: args.taskId,
        taskRunId: args.taskRunId ?? null,
        teamId: args.teamId,
        type: args.type,
      },
    };

    await sendToUser(ctx, args.userId, payload);
  },
});

export const sendTestNotification = internalAction({
  args: {
    userId: v.string(),
    title: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const payload = {
      aps: {
        alert: {
          title: args.title,
          body: args.body,
        },
        sound: "default",
      },
      data: {
        type: "test",
      },
    };

    await sendToUser(ctx, args.userId, payload, "test");
  },
});

type TokenInfo = {
  token: string;
  environment: ApnsEnvironment;
  bundleId: string;
};

type ApnsConfig = {
  teamId: string;
  keyId: string;
  privateKey: string;
};

type PushActionCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

function loadApnsConfig(): ApnsConfig | null {
  const teamId = process.env.APNS_TEAM_ID;
  const keyId = process.env.APNS_KEY_ID;
  const base64Key = process.env.APNS_PRIVATE_KEY_BASE64;

  if (!teamId || !keyId || !base64Key) {
    return null;
  }

  const privateKey = Buffer.from(base64Key, "base64").toString("utf8");

  return {
    teamId,
    keyId,
    privateKey,
  };
}

async function sendToUser(
  ctx: PushActionCtx,
  userId: string,
  payload: Record<string, unknown>,
  debugTag?: string,
): Promise<void> {
  const config = loadApnsConfig();
  if (!config) {
    console.error("[push] Missing APNs config, skipping notification send.");
    return;
  }

  const tokens = await ctx.runQuery(
    internal.pushTokens.listActiveTokensForUser,
    { userId },
  );

  if (tokens.length === 0) {
    if (debugTag) {
      console.log(`[push] ${debugTag} no active tokens for user ${userId}`);
    }
    return;
  }

  const tokenGroups = groupByEnvironment(tokens);

  for (const [environment, groupTokens] of tokenGroups) {
    const host = environment === "development"
      ? "api.sandbox.push.apple.com"
      : "api.push.apple.com";

    const client = connect(`https://${host}`);
    try {
      const jwt = await createApnsJwt(config);

      for (const tokenInfo of groupTokens) {
        const result = await sendApnsNotification({
          client,
          jwt,
          token: tokenInfo.token,
          bundleId: tokenInfo.bundleId,
          payload,
          onInvalidToken: async (reason) => {
            await ctx.runMutation(internal.pushTokens.markTokenInvalid, {
              token: tokenInfo.token,
              reason,
            });
          },
        });
        if (debugTag) {
          const reason = result.reason ?? "ok";
          console.log(
            `[push] ${debugTag} env=${environment} token=${tokenInfo.token} status=${result.status} reason=${reason}`,
          );
        }
      }
    } catch (error) {
      console.error("[push] Failed to send APNs notifications", error);
    } finally {
      client.close();
    }
  }
}

async function createApnsJwt(config: ApnsConfig): Promise<string> {
  const key = await importPKCS8(config.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt()
    .setExpirationTime("50m")
    .sign(key);
}

function groupByEnvironment(tokens: TokenInfo[]): Map<ApnsEnvironment, TokenInfo[]> {
  const groups = new Map<ApnsEnvironment, TokenInfo[]>();
  for (const token of tokens) {
    const list = groups.get(token.environment) ?? [];
    list.push(token);
    groups.set(token.environment, list);
  }
  return groups;
}

async function sendApnsNotification({
  client,
  jwt,
  token,
  bundleId,
  payload,
  onInvalidToken,
}: {
  client: ClientHttp2Session;
  jwt: string;
  token: string;
  bundleId: string;
  payload: Record<string, unknown>;
  onInvalidToken: (reason: string) => Promise<void>;
}): Promise<{ status: number; reason: string | null }> {
  const headers = {
    ":method": "POST",
    ":path": `/3/device/${token}`,
    authorization: `bearer ${jwt}`,
    "apns-topic": bundleId,
    "apns-push-type": "alert",
    "apns-priority": "10",
  };

  try {
    const response = await requestApns(client, headers, payload);
    const reason = response.body ? parseApnsReason(response.body) : null;
    if (response.status >= 400) {
      console.error(
        `[push] APNs error status=${response.status} reason=${reason ?? "unknown"}`,
      );
      if (response.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
        await onInvalidToken(reason ?? "Unregistered");
      }
    }
    return { status: response.status, reason };
  } catch (error) {
    console.error("[push] APNs request failed", error);
    return { status: 0, reason: null };
  }
}

async function requestApns(
  client: ClientHttp2Session,
  headers: Record<string, string>,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = client.request(headers);
    let responseBody = "";
    let status = 0;

    req.setEncoding("utf8");
    req.on("response", (responseHeaders) => {
      const headerStatus = responseHeaders[":status"];
      if (typeof headerStatus === "number") {
        status = headerStatus;
      }
    });
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      resolve({ status, body: responseBody });
    });
    req.on("error", (error) => {
      reject(error);
    });

    req.end(JSON.stringify(payload));
  });
}

function parseApnsReason(body: string): string | null {
  if (!body) {
    return null;
  }
  try {
    const parsed = apnsErrorSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.reason : null;
  } catch (error) {
    console.error("[push] Failed to parse APNs error body", error);
    return null;
  }
}
