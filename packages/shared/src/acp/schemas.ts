import { z } from "zod";
import { isJsonValue, type JsonValue } from "../json";

export const AcpMessagePayloadSchema = z.custom<JsonValue>(
  (value) => isJsonValue(value),
  {
    message: "Invalid ACP payload",
  }
);

export const AcpIngestMessageSchema = z.object({
  kind: z.enum(["prompt", "update", "stop", "error"]),
  role: z.enum(["user", "agent", "tool", "system"]),
  payload: AcpMessagePayloadSchema,
  sessionUpdateType: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative().optional(),
});

export type AcpIngestMessage = z.infer<typeof AcpIngestMessageSchema>;

export const AcpThreadUpdateSchema = z.object({
  sessionId: z.string().optional(),
  status: z.enum(["pending", "running", "completed", "error"]).optional(),
  lastStopReason: z.string().optional(),
  errorMessage: z.string().optional(),
  title: z.string().optional(),
});

export type AcpThreadUpdate = z.infer<typeof AcpThreadUpdateSchema>;

export const AcpIngestRequestSchema = z.object({
  provider: z.string().min(1),
  threadId: z.string().optional(),
  sessionId: z.string().optional(),
  messages: z.array(AcpIngestMessageSchema).optional(),
  threadUpdate: AcpThreadUpdateSchema.optional(),
});

export type AcpIngestRequest = z.infer<typeof AcpIngestRequestSchema>;
