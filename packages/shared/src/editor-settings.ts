import { z } from "zod";
import { AuthFileSchema } from "./worker-schemas";

export const EditorSettingsUploadSchema = z.object({
  authFiles: z.array(AuthFileSchema).default([]),
  startupCommands: z.array(z.string()).default([]),
  sourceEditor: z.string(),
  settingsPath: z.string().optional(),
});

export type EditorSettingsUpload = z.infer<typeof EditorSettingsUploadSchema>;
