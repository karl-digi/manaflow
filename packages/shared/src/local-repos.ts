import { z } from "zod";

export const LocalPathSuggestionSchema = z.object({
  path: z.string(),
  displayPath: z.string(),
  repoName: z.string().optional(),
  isGitRepo: z.boolean(),
});

export type LocalPathSuggestion = z.infer<typeof LocalPathSuggestionSchema>;

export const LocalRepoInfoSchema = z.object({
  path: z.string(),
  repoRoot: z.string(),
  displayPath: z.string(),
  repoName: z.string(),
  branches: z.array(z.string()),
  currentBranch: z.string().optional(),
  defaultBranch: z.string().optional(),
  remoteUrl: z.string().optional(),
  headSha: z.string().optional(),
});

export type LocalRepoInfo = z.infer<typeof LocalRepoInfoSchema>;

export const LocalRepoInfoResponseSchema = z.object({
  success: z.boolean(),
  info: LocalRepoInfoSchema.optional(),
  error: z.string().optional(),
});

export type LocalRepoInfoResponse = z.infer<typeof LocalRepoInfoResponseSchema>;
