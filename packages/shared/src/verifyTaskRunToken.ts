import { jwtVerify } from "jose";
import { z } from "zod";

const TaskRunTokenPayloadSchema = z.object({
  taskRunId: z.string().min(1),
  teamId: z.string().min(1),
  userId: z.string().min(1),
});

export type TaskRunTokenPayload = z.infer<typeof TaskRunTokenPayloadSchema>;

function toKey(secret: string | Uint8Array): Uint8Array {
  return typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
}

export async function verifyTaskRunToken(
  token: string,
  secret: string | Uint8Array
): Promise<TaskRunTokenPayload> {
  const verification = await jwtVerify(token, toKey(secret));
  const parsed = TaskRunTokenPayloadSchema.safeParse(verification.payload);

  if (!parsed.success) {
    throw new Error("Invalid CMUX task run token payload");
  }

  return parsed.data;
}
