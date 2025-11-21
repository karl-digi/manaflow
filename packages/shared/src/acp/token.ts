import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

const AcpThreadTokenPayloadSchema = z.object({
  threadId: z.string().min(1),
  teamId: z.string().min(1),
  userId: z.string().min(1),
  provider: z.string().min(1),
});

export type AcpThreadTokenPayload = z.infer<typeof AcpThreadTokenPayloadSchema>;

function toKey(secret: string | Uint8Array): Uint8Array {
  return typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
}

export async function signAcpThreadToken(
  payload: AcpThreadTokenPayload,
  secret: string | Uint8Array
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .sign(toKey(secret));
}

export async function verifyAcpThreadToken(
  token: string,
  secret: string | Uint8Array
): Promise<AcpThreadTokenPayload> {
  const verification = await jwtVerify(token, toKey(secret));
  const parsed = AcpThreadTokenPayloadSchema.safeParse(verification.payload);

  if (!parsed.success) {
    throw new Error("Invalid ACP thread token payload");
  }

  return parsed.data;
}
