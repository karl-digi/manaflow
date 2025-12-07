import { start } from "workflow/api";
import { handleReplyToPost } from "@/workflows/create-post";
import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { stackServerApp } from "@/stack/server";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

// Environment variable type
interface EnvVar {
  key: string;
  value: string;
}

// Get the vault secret from environment
function getVaultSecret(): string {
  const secret = process.env.STACK_DATA_VAULT_SECRET;
  if (!secret) {
    throw new Error("STACK_DATA_VAULT_SECRET environment variable is not set");
  }
  return secret;
}

// Fetch env vars from the Data Vault
async function fetchEnvVars(userId: string, repoId: string): Promise<EnvVar[]> {
  try {
    const store = await stackServerApp.getDataVaultStore("xagi");
    const key = `env:${userId}:${repoId}`;
    const value = await store.getValue(key, { secret: getVaultSecret() });

    if (!value) {
      return [];
    }

    return JSON.parse(value) as EnvVar[];
  } catch (error) {
    console.error("[API] Failed to fetch env vars:", error);
    return [];
  }
}

// Repo config to pass to the workflow
export interface RepoConfig {
  fullName: string;
  gitRemote: string;
  branch: string;
  installationId?: number;
  scripts?: {
    maintenanceScript: string;
    devScript: string;
  };
  envVars?: EnvVar[];
}

// Thread context for replies
export interface ThreadContext {
  rootPost: { content: string; author: string };
  replies: Array<{ content: string; author: string }>;
}

export async function POST(request: Request) {
  const { content, repo: repoFullName, replyTo } = (await request.json()) as {
    content: string;
    repo?: string | null;
    replyTo?: string | null;
  };

  console.log("[API] Creating post and starting reply workflow");
  console.log("[API] Selected repo:", repoFullName);
  console.log("[API] Reply to:", replyTo);

  try {
    // Get the current user for env var lookup
    const user = await stackServerApp.getUser();

    // Fetch full repo details if a repo is selected
    let repoConfig: RepoConfig | undefined;
    if (repoFullName) {
      console.log("[API] Fetching repo details for:", repoFullName);
      // Fetch repo details from Convex using the new query that includes installationId
      const repo = await convex.query(api.github.getRepoWithInstallation, {
        fullName: repoFullName,
      });
      console.log("[API] Got repo from Convex:", repo);

      if (repo) {
        // Fetch env vars for this repo if user is authenticated
        let envVars: EnvVar[] = [];
        if (user && repo._id) {
          console.log("[API] Fetching env vars for user:", user.id, "repo:", repo._id);
          envVars = await fetchEnvVars(user.id, repo._id);
          console.log("[API] Found", envVars.length, "environment variables");
        }

        repoConfig = {
          fullName: repo.fullName,
          gitRemote: repo.gitRemote,
          branch: repo.defaultBranch ?? "main",
          installationId: repo.installationId,
          scripts: repo.scripts,
          envVars: envVars.length > 0 ? envVars : undefined,
        };
        console.log("[API] Repo config:", { ...repoConfig, envVars: envVars.length > 0 ? `[${envVars.length} vars]` : undefined });
      } else {
        console.log("[API] Repo not found in database");
      }
    }

    // Fetch thread context if this is a reply
    let threadContext: ThreadContext | undefined;
    if (replyTo) {
      console.log("[API] Fetching thread context for reply");
      const thread = await convex.query(api.posts.getPostThread, {
        postId: replyTo as Id<"posts">,
      });
      if (thread) {
        threadContext = {
          rootPost: { content: thread.root.content, author: thread.root.author },
          replies: thread.replies.map((r) => ({ content: r.content, author: r.author })),
        };
        console.log("[API] Thread context:", threadContext);
      }
    }

    // Create the user's post
    const postId = await convex.mutation(api.posts.createPost, {
      content,
      author: "User",
      replyTo: replyTo ? (replyTo as Id<"posts">) : undefined,
    });

    console.log("[API] Created post:", postId);

    // Start the workflow to generate an AI reply
    // Pass repo config and thread context to the workflow
    const result = await start(handleReplyToPost, [postId, content, repoConfig, threadContext]);
    console.log("[API] Workflow started:", result);

    return NextResponse.json({
      message: "Post created and reply workflow started",
      postId,
      workflowId: result,
    });
  } catch (error) {
    console.error("[API] Failed:", error);
    return NextResponse.json(
      { error: "Failed to create post or start workflow" },
      { status: 500 }
    );
  }
}
