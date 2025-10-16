import { ConvexError, v } from "convex/values";
import { getTeamId } from "../_shared/team";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { authMutation } from "./users/utils";
import { mutation } from "./_generated/server";

const GITHUB_HOST = "github.com";
type JobDoc = Doc<"automatedCodeReviewJobs">;

function isActiveState(state: JobDoc["state"]): boolean {
  return state === "pending" || state === "running";
}

function serializeJob(job: JobDoc) {
  return {
    jobId: job._id,
    teamId: job.teamId,
    repoFullName: job.repoFullName,
    repoUrl: job.repoUrl,
    prNumber: job.prNumber,
    commitRef: job.commitRef,
    requestedByUserId: job.requestedByUserId,
    state: job.state,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    sandboxInstanceId: job.sandboxInstanceId ?? null,
    errorCode: job.errorCode ?? null,
    errorDetail: job.errorDetail ?? null,
    codeReviewOutput: job.codeReviewOutput ?? null,
  };
}

function parseGithubLink(link: string): { repoFullName: string; repoUrl: string } {
  try {
    const url = new URL(link);
    if (url.hostname !== GITHUB_HOST) {
      throw new ConvexError(`Unsupported GitHub host: ${url.hostname}`);
    }
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new ConvexError(`Unable to parse GitHub repository from ${link}`);
    }
    const repoFullName = `${segments[0]}/${segments[1]}`;
    return {
      repoFullName,
      repoUrl: `https://${GITHUB_HOST}/${repoFullName}.git`,
    };
  } catch (error) {
    if (error instanceof ConvexError) {
      throw error;
    }
    throw new ConvexError(`Invalid GitHub URL: ${link}`);
  }
}

async function hashSha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function ensureJobOwner(requesterId: string, job: JobDoc) {
  if (job.requestedByUserId !== requesterId) {
    throw new ConvexError("Forbidden");
  }
}

async function findExistingActiveJob(
  db: MutationCtx["db"],
  teamId: string,
  repoFullName: string,
  prNumber: number,
): Promise<JobDoc | null> {
  const candidates = await db.query("automatedCodeReviewJobs").collect();
  let best: JobDoc | null = null;
  for (const job of candidates) {
    if (
      job.teamId === teamId &&
      job.repoFullName === repoFullName &&
      job.prNumber === prNumber &&
      isActiveState(job.state)
    ) {
      if (!best || job.updatedAt > best.updatedAt) {
        best = job;
      }
    }
  }
  return best;
}

export const reserveJob = authMutation({
  args: {
    teamSlugOrId: v.string(),
    githubLink: v.string(),
    prNumber: v.number(),
    commitRef: v.optional(v.string()),
    callbackTokenHash: v.string(),
  },
  handler: async (ctx, args) => {
    const { identity } = ctx;
    const teamId = await getTeamId(ctx, args.teamSlugOrId);
    const { repoFullName, repoUrl } = parseGithubLink(args.githubLink);

    const existing = await findExistingActiveJob(
      ctx.db,
      teamId,
      repoFullName,
      args.prNumber,
    );
    if (existing) {
      return {
        wasCreated: false as const,
        job: serializeJob(existing),
      };
    }

    const pullRequest = await ctx.db
      .query("pullRequests")
      .withIndex("by_team_repo_number", (q) =>
        q
          .eq("teamId", teamId)
          .eq("repoFullName", repoFullName)
          .eq("number", args.prNumber),
      )
      .first();

    const commitRef =
      args.commitRef ??
      pullRequest?.headSha ??
      pullRequest?.mergeCommitSha ??
      "unknown";

    const now = Date.now();
    const jobId = await ctx.db.insert("automatedCodeReviewJobs", {
      teamId,
      repoFullName,
      repoUrl,
      prNumber: args.prNumber,
      commitRef,
      requestedByUserId: identity.subject,
      state: "pending",
      createdAt: now,
      updatedAt: now,
      callbackTokenHash: args.callbackTokenHash,
      callbackTokenIssuedAt: now,
    });

    const job = await ctx.db.get(jobId);
    if (!job) {
      throw new ConvexError("Failed to create job");
    }

    return {
      wasCreated: true as const,
      job: serializeJob(job),
    };
  },
});

export const markJobRunning = authMutation({
  args: {
    jobId: v.id("automatedCodeReviewJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found");
    }

    ensureJobOwner(ctx.identity.subject, job);
    if (job.state === "running") {
      return serializeJob(job);
    }
    if (job.state !== "pending") {
      throw new ConvexError(`Cannot mark job ${job._id} as running from state ${job.state}`);
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "running",
      startedAt: now,
      updatedAt: now,
    });

    const updated = await ctx.db.get(job._id);
    if (!updated) {
      throw new ConvexError("Failed to update job");
    }
    return serializeJob(updated);
  },
});

export const failJob = authMutation({
  args: {
    jobId: v.id("automatedCodeReviewJobs"),
    errorCode: v.string(),
    errorDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found");
    }
    ensureJobOwner(ctx.identity.subject, job);

    if (job.state === "completed" || job.state === "failed") {
      return serializeJob(job);
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "failed",
      errorCode: args.errorCode,
      errorDetail: args.errorDetail,
      updatedAt: now,
      completedAt: now,
      callbackTokenHash: undefined,
    });

    const updated = await ctx.db.get(job._id);
    if (!updated) {
      throw new ConvexError("Failed to update job");
    }
    return serializeJob(updated);
  },
});

export const completeJobFromCallback = mutation({
  args: {
    jobId: v.id("automatedCodeReviewJobs"),
    callbackToken: v.string(),
    sandboxInstanceId: v.optional(v.string()),
    codeReviewOutput: v.record(v.string(), v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found");
    }

    if (!job.callbackTokenHash) {
      if (job.state === "completed") {
        return serializeJob(job);
      }
      throw new ConvexError("Callback token already consumed");
    }

    const hashed = await hashSha256(args.callbackToken);
    if (hashed !== job.callbackTokenHash) {
      throw new ConvexError("Invalid callback token");
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "completed",
      updatedAt: now,
      completedAt: now,
      sandboxInstanceId: args.sandboxInstanceId ?? job.sandboxInstanceId,
      codeReviewOutput: args.codeReviewOutput,
      callbackTokenHash: undefined,
      errorCode: undefined,
      errorDetail: undefined,
    });

    await ctx.db.insert("automatedCodeReviewVersions", {
      jobId: job._id,
      teamId: job.teamId,
      requestedByUserId: job.requestedByUserId,
      repoFullName: job.repoFullName,
      repoUrl: job.repoUrl,
      prNumber: job.prNumber,
      commitRef: job.commitRef,
      sandboxInstanceId: args.sandboxInstanceId ?? job.sandboxInstanceId,
      codeReviewOutput: args.codeReviewOutput,
      createdAt: now,
    });

    const updated = await ctx.db.get(job._id);
    if (!updated) {
      throw new ConvexError("Failed to update job");
    }
    return serializeJob(updated);
  },
});

export const failJobFromCallback = mutation({
  args: {
    jobId: v.id("automatedCodeReviewJobs"),
    callbackToken: v.string(),
    sandboxInstanceId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorDetail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) {
      throw new ConvexError("Job not found");
    }

    if (!job.callbackTokenHash) {
      if (job.state === "failed") {
        return serializeJob(job);
      }
      throw new ConvexError("Callback token already consumed");
    }

    const hashed = await hashSha256(args.callbackToken);
    if (hashed !== job.callbackTokenHash) {
      throw new ConvexError("Invalid callback token");
    }

    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "failed",
      updatedAt: now,
      completedAt: now,
      sandboxInstanceId: args.sandboxInstanceId ?? job.sandboxInstanceId,
      errorCode: args.errorCode ?? "callback_failed",
      errorDetail: args.errorDetail,
      callbackTokenHash: undefined,
    });

    const updated = await ctx.db.get(job._id);
    if (!updated) {
      throw new ConvexError("Failed to update job");
    }
    return serializeJob(updated);
  },
});
