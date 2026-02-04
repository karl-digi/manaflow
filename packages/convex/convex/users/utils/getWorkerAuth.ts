import {
  verifyTaskRunToken,
  type TaskRunTokenPayload,
} from "@cmux/shared/convex-safe";
import { jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../../../_shared/convex-env";

// Task run token payload (from workers)
export type WorkerAuthContext = {
  token: string;
  payload: TaskRunTokenPayload;
  type: "taskRun";
};

// Sandbox JWT payload (from ACP sandboxes)
const sandboxJwtPayloadSchema = z.object({
  sandboxId: z.string(),
  teamId: z.string(),
});

export type SandboxJwtPayload = z.infer<typeof sandboxJwtPayloadSchema>;

export type SandboxAuthContext = {
  token: string;
  payload: SandboxJwtPayload;
  type: "sandbox";
};

export type AuthContext = WorkerAuthContext | SandboxAuthContext;

type GetWorkerAuthOptions = {
  loggerPrefix?: string;
};

export async function getWorkerAuth(
  req: Request,
  options?: GetWorkerAuthOptions
): Promise<AuthContext | null> {
  const token = req.headers.get("x-cmux-token");
  if (!token) {
    return null;
  }

  const prefix = options?.loggerPrefix ?? "[convex.workerAuth]";

  // First try to verify as task run token
  try {
    const payload = await verifyTaskRunToken(
      token,
      env.CMUX_TASK_RUN_JWT_SECRET
    );
    return { token, payload, type: "taskRun" };
  } catch {
    // Not a task run token, try sandbox JWT
  }

  // Try to verify as sandbox JWT
  try {
    const secret = env.ACP_CALLBACK_SECRET ?? env.CMUX_TASK_RUN_JWT_SECRET;
    if (!secret) {
      console.error(`${prefix} No secret configured for JWT verification`);
      return null;
    }

    const result = await jwtVerify(token, new TextEncoder().encode(secret));
    const parsed = sandboxJwtPayloadSchema.safeParse(result.payload);
    if (parsed.success) {
      return { token, payload: parsed.data, type: "sandbox" };
    }
    console.error(`${prefix} Invalid sandbox JWT payload`, parsed.error);
  } catch (error) {
    console.error(`${prefix} Failed to verify token`, error);
  }

  return null;
}
