/**
 * JWT helper utilities for validating task-run JWTs in the HTTP API.
 *
 * Used by the orchestration spawn endpoint to allow agents to spawn
 * sub-agents using their task-run JWT instead of Stack Auth Bearer tokens.
 */

import { jwtVerify } from "jose";
import { z } from "zod";

const TaskRunJwtPayloadSchema = z.object({
  taskRunId: z.string().min(1),
  teamId: z.string().min(1),
  userId: z.string().min(1),
});

export type TaskRunJwtPayload = z.infer<typeof TaskRunJwtPayloadSchema>;

/**
 * Verify a task-run JWT and extract the payload.
 *
 * @param token - The JWT token to verify
 * @param secret - The secret used to sign the JWT (CMUX_TASK_RUN_JWT_SECRET)
 * @returns The validated payload with taskRunId, teamId, and userId
 * @throws Error if the token is invalid or expired
 */
export async function verifyTaskRunJwt(
  token: string,
  secret: string
): Promise<TaskRunJwtPayload> {
  const secretKey = new TextEncoder().encode(secret);

  const verification = await jwtVerify(token, secretKey);
  const parsed = TaskRunJwtPayloadSchema.safeParse(verification.payload);

  if (!parsed.success) {
    throw new Error("Invalid task-run JWT payload");
  }

  return parsed.data;
}

/**
 * Extract JWT from X-Task-Run-JWT header.
 *
 * @param headers - Request headers object
 * @returns The JWT string or null if not present
 */
export function extractTaskRunJwt(
  headers: Record<string, string | string[] | undefined>
): string | null {
  const jwt = headers["x-task-run-jwt"];
  if (typeof jwt === "string" && jwt.length > 0) {
    return jwt;
  }
  return null;
}
