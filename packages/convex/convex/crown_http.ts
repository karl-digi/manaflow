import {
  CrownEvaluationRequestSchema,
  CrownSummarizationRequestSchema,
  WorkerCheckSchema,
  WorkerCompleteRequestSchema,
  WorkerFinalizeSchema,
  type CrownEvaluationRequest,
  type CrownWorkerCheckResponse,
  type WorkerAllRunsCompleteResponse,
  type WorkerRunStatus,
  type WorkerTaskRunResponse,
} from "@cmux/shared/convex-safe";
import { env } from "../_shared/convex-env";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { httpAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { getWorkerAuth } from "./users/utils/getWorkerAuth";
import type { WorkerAuthContext } from "./users/utils/getWorkerAuth";
import {
  buildCrownEvaluationPrompt,
  parseCrownEvaluationPrompt,
} from "./crown/retryData";

type TaskRunDoc = Doc<"taskRuns">;
type TeamMembershipDoc = Doc<"teamMemberships">;

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function ensureJsonRequest(
  req: Request
): Promise<{ json: unknown } | Response> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonResponse(
      { code: 415, message: "Content-Type must be application/json" },
      415
    );
  }

  try {
    const json = await req.json();
    return { json };
  } catch {
    return jsonResponse({ code: 400, message: "Invalid JSON body" }, 400);
  }
}

function ensureStackAuth(req: Request): Response | void {
  const stackAuthHeader = req.headers.get("x-stack-auth");
  if (!stackAuthHeader) {
    console.error("[convex.crown] Missing x-stack-auth header");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  try {
    const parsed = JSON.parse(stackAuthHeader) as { accessToken?: string };
    if (!parsed.accessToken) {
      console.error(
        "[convex.crown] Missing access token in x-stack-auth header"
      );
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
  } catch (error) {
    console.error("[convex.crown] Failed to parse x-stack-auth header", error);
    return jsonResponse(
      { code: 400, message: "Invalid stack auth header" },
      400
    );
  }
}

async function ensureTeamMembership(
  ctx: ActionCtx,
  teamSlugOrId: string
): Promise<Response | { teamId: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    console.warn("[convex.crown] Anonymous request rejected");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const team = await ctx.runQuery(api.teams.get, { teamSlugOrId });
  if (!team) {
    console.warn("[convex.crown] Team not found", { teamSlugOrId });
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const memberships = await ctx.runQuery(api.teams.listTeamMemberships, {});
  const hasMembership = memberships.some(
    (membership: TeamMembershipDoc) => membership.teamId === team.uuid
  );

  if (!hasMembership) {
    console.warn("[convex.crown] User missing membership", {
      teamSlugOrId,
      userId: identity.subject,
    });
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  return { teamId: team.uuid };
}

async function resolveTeamSlugOrId(
  ctx: ActionCtx,
  teamSlugOrId?: string
): Promise<Response | { teamSlugOrId: string }> {
  if (teamSlugOrId) {
    const membership = await ensureTeamMembership(ctx, teamSlugOrId);
    if (membership instanceof Response) {
      return membership;
    }
    return { teamSlugOrId };
  }

  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    console.warn("[convex.crown] Anonymous request rejected");
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const memberships = await ctx.runQuery(api.teams.listTeamMemberships, {});
  if (memberships.length === 0) {
    console.warn("[convex.crown] User has no team memberships", {
      userId: identity.subject,
    });
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const primary = memberships[0];
  const slugOrId = primary.team?.slug ?? primary.teamId;
  if (!slugOrId) {
    console.error("[convex.crown] Unable to resolve default team", {
      membership: primary,
    });
    return jsonResponse({ code: 500, message: "Team resolution failed" }, 500);
  }

  return { teamSlugOrId: slugOrId };
}

async function loadTaskRunForWorker(
  ctx: ActionCtx,
  auth: WorkerAuthContext,
  runId?: Id<"taskRuns">
): Promise<Response | Doc<"taskRuns">> {
  const taskRunId = runId ?? (auth.payload.taskRunId as Id<"taskRuns">);
  const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
    id: taskRunId,
  });
  if (!taskRun) {
    console.warn("[convex.crown] Task run not found for worker", {
      taskRunId,
    });
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }

  if (
    taskRun.teamId !== auth.payload.teamId ||
    taskRun.userId !== auth.payload.userId
  ) {
    console.warn(
      "[convex.crown] Worker attempted to access unauthorized task run",
      {
        taskRunId,
        workerTeamId: auth.payload.teamId,
        taskRunTeamId: taskRun.teamId,
      }
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  return taskRun;
}

export const crownEvaluate = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.crown]",
  });

  if (!workerAuth) {
    const stackAuthError = ensureStackAuth(req);
    if (stackAuthError) throw stackAuthError;
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = CrownEvaluationRequestSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn("[convex.crown] Invalid evaluation payload", {
      errors: validation.error.issues,
      receivedBody: parsed.json,
    });
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const data: CrownEvaluationRequest = validation.data;

  const teamSlugOrId = workerAuth
    ? workerAuth.payload.teamId
    : data.teamSlugOrId;

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  let teamContext: { teamId: string; userId: string } | null = null;

  if (workerAuth) {
    teamContext = {
      teamId: workerAuth.payload.teamId,
      userId: workerAuth.payload.userId,
    };
  } else {
    const membership = await ensureTeamMembership(ctx, teamSlugOrId);
    if (membership instanceof Response) return membership;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      console.warn("[convex.crown] Missing identity during evaluation request");
      return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
    }
    teamContext = { teamId: membership.teamId, userId: identity.subject };
  }

  if (!teamContext) {
    console.error("[convex.crown] Failed to resolve team context");
    return jsonResponse({ code: 500, message: "Team resolution failed" }, 500);
  }

  let targetTaskId: Id<"tasks"> | null = null;

  const candidateWithRunId = data.candidates.find(
    (candidate) => candidate.runId
  );

  if (candidateWithRunId?.runId) {
    try {
      const run = await ctx.runQuery(internal.taskRuns.getById, {
        id: candidateWithRunId.runId as Id<"taskRuns">,
      });
      if (
        run &&
        run.teamId === teamContext.teamId &&
        run.userId === teamContext.userId
      ) {
        targetTaskId = run.taskId;
      }
    } catch (error) {
      console.error("[convex.crown] Failed to resolve task from candidate", {
        runId: candidateWithRunId.runId,
        error,
      });
    }
  }

  if (!targetTaskId && workerAuth?.payload.taskRunId) {
    try {
      const run = await ctx.runQuery(internal.taskRuns.getById, {
        id: workerAuth.payload.taskRunId as Id<"taskRuns">,
      });
      if (run) {
        targetTaskId = run.taskId;
      }
    } catch (error) {
      console.error("[convex.crown] Failed to resolve task from worker run", {
        taskRunId: workerAuth.payload.taskRunId,
        error,
      });
    }
  }

  if (targetTaskId) {
    try {
      const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
        id: targetTaskId,
      });
      if (
        task &&
        task.teamId === teamContext.teamId &&
        task.userId === teamContext.userId &&
        task.crownEvaluationStatus !== "in_progress"
      ) {
        await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
          taskId: targetTaskId,
          teamId: teamContext.teamId,
          userId: teamContext.userId,
          status: "in_progress",
          clearError: true,
        });
      }
    } catch (error) {
      console.error("[convex.crown] Failed to mark crown in progress", {
        taskId: targetTaskId,
        error,
      });
    }
  }

  if (workerAuth && targetTaskId) {
    try {
      const evaluationPrompt = buildCrownEvaluationPrompt(
        data.prompt,
        data.candidates
      );
      const candidateRunIds = data.candidates
        .map((candidate) => candidate.runId)
        .filter((id): id is string => Boolean(id));

      const retryData = JSON.stringify({
        evaluationPrompt,
        candidateRunIds,
        teamId: teamContext.teamId,
        userId: teamContext.userId,
      });

      await ctx.runMutation(internal.tasks.setCrownRetryDataInternal, {
        taskId: targetTaskId,
        teamId: teamContext.teamId,
        userId: teamContext.userId,
        retryData,
        overwrite: true,
      });
    } catch (error) {
      console.error("[convex.crown] Failed to store crown retry data", {
        taskId: targetTaskId,
        error,
      });
    }
  }

  try {
    const candidates = data.candidates.map((candidate, index) => ({
      modelName:
        candidate.agentName ??
        candidate.modelName ??
        `candidate-${candidate.index ?? index}`,
      gitDiff: candidate.gitDiff,
      index: candidate.index ?? index,
    }));

    const result = await ctx.runAction(api.crown.actions.evaluate, {
      prompt: data.prompt,
      candidates,
      teamSlugOrId,
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("[convex.crown] Evaluation error", error);
    return jsonResponse({ code: 500, message: "Evaluation failed" }, 500);
  }
});

export const crownSummarize = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.crown]",
  });

  if (!workerAuth) {
    const stackAuthError = ensureStackAuth(req);
    if (stackAuthError) throw stackAuthError;
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;
  const validation = CrownSummarizationRequestSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn("[convex.crown] Invalid summarization payload", {
      errors: validation.error,
      receivedBody: parsed.json,
    });
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const data = validation.data;

  let teamSlugOrId = data.teamSlugOrId;
  if (workerAuth) {
    teamSlugOrId = workerAuth.payload.teamId;
  } else {
    const resolvedTeam = await resolveTeamSlugOrId(ctx, teamSlugOrId);
    if (resolvedTeam instanceof Response) return resolvedTeam;
    teamSlugOrId = resolvedTeam.teamSlugOrId;
  }

  if (!teamSlugOrId) {
    return jsonResponse(
      { code: 400, message: "teamSlugOrId is required" },
      400
    );
  }

  if (workerAuth) {
    try {
      const taskRunId = workerAuth.payload.taskRunId as Id<"taskRuns"> | undefined;
      if (taskRunId) {
        const run = await ctx.runQuery(internal.taskRuns.getById, {
          id: taskRunId,
        });
        if (
          run &&
          run.teamId === workerAuth.payload.teamId &&
          run.userId === workerAuth.payload.userId
        ) {
          const runsForTeam = await ctx.runQuery(
            internal.taskRuns.listByTaskAndTeamInternal,
            {
              taskId: run.taskId,
              teamId: workerAuth.payload.teamId,
              userId: workerAuth.payload.userId,
            }
          );
          const completedRuns = runsForTeam.filter(
            (candidateRun: TaskRunDoc) => candidateRun.status === "completed"
          );

          const isSingleRunTask =
            runsForTeam.length === 1 && completedRuns.length === 1;

          if (isSingleRunTask) {
            const candidates = [
              {
                runId: run._id,
                agentName: run.agentName ?? "unknown agent",
                modelName: run.agentName ?? "unknown agent",
                gitDiff: data.gitDiff,
                newBranch: run.newBranch ?? null,
                index: 0,
              },
            ];

            const evaluationPrompt = buildCrownEvaluationPrompt(
              data.prompt,
              candidates
            );

            const retryData = JSON.stringify({
              evaluationPrompt,
              candidateRunIds: [run._id],
              teamId: workerAuth.payload.teamId,
              userId: workerAuth.payload.userId,
            });

            await ctx.runMutation(internal.tasks.setCrownRetryDataInternal, {
              taskId: run.taskId,
              teamId: workerAuth.payload.teamId,
              userId: workerAuth.payload.userId,
              retryData,
              overwrite: false,
            });
          }
        }
      }
    } catch (error) {
      console.error("[convex.crown] Failed to store single-run retry data", {
        error,
      });
    }
  }

  try {
    const result = await ctx.runAction(api.crown.actions.summarize, {
      prompt: data.prompt,
      gitDiff: data.gitDiff,
      teamSlugOrId,
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("[convex.crown] Summarization error", error);
    return jsonResponse({ code: 500, message: "Summarization failed" }, 500);
  }
});

export const crownWorkerCheck = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.crown]",
  });
  if (!workerAuth) {
    throw jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = WorkerCheckSchema.safeParse(parsed.json ?? {});
  if (!validation.success) {
    console.warn(
      "[convex.crown] Invalid worker check payload",
      validation.error
    );
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const requestType = validation.data.checkType ?? "crown";
  let { taskRunId, taskId } = validation.data;

  if (requestType === "info") {
    const resolvedTaskRunId =
      taskRunId ?? (workerAuth.payload.taskRunId as Id<"taskRuns"> | undefined);

    if (resolvedTaskRunId) {
      console.log("[convex.crown] Worker info request", {
        taskRunId: resolvedTaskRunId,
        providedTaskRunId: Boolean(taskRunId),
        resolvedFromToken: !taskRunId,
        workerTeamId: workerAuth.payload.teamId,
        workerUserId: workerAuth.payload.userId,
      });
      return handleInfoRequest(ctx, workerAuth, resolvedTaskRunId);
    }

    console.warn("[convex.crown] Missing taskRunId for worker info request", {
      requestHasTaskRunId: Boolean(taskRunId),
      tokenHasTaskRunId: Boolean(workerAuth.payload.taskRunId),
    });
    return jsonResponse({ code: 400, message: "Task run not specified" }, 400);
  }

  if (requestType === "all-complete" && taskId) {
    return handleAllCompleteRequest(ctx, workerAuth, taskId);
  }

  return handleCrownCheckRequest(ctx, workerAuth, validation.data);
});

async function handleInfoRequest(
  ctx: ActionCtx,
  workerAuth: WorkerAuthContext,
  taskRunId: Id<"taskRuns">
): Promise<Response> {
  console.log("[convex.crown] Handling worker taskRun info request", {
    taskRunId,
    workerTeamId: workerAuth.payload.teamId,
    workerUserId: workerAuth.payload.userId,
  });
  const taskRun = await ctx.runQuery(internal.taskRuns.getById, {
    id: taskRunId,
  });
  if (!taskRun) {
    console.warn("[convex.crown] Task run not found for worker info request", {
      taskRunId,
    });
    return jsonResponse({ code: 404, message: "Task run not found" }, 404);
  }
  if (
    taskRun.teamId !== workerAuth.payload.teamId ||
    taskRun.userId !== workerAuth.payload.userId
  ) {
    console.warn(
      "[convex.crown] Worker attempted to access unauthorized task run",
      {
        taskRunId,
        workerTeamId: workerAuth.payload.teamId,
        taskRunTeamId: taskRun.teamId,
        workerUserId: workerAuth.payload.userId,
        taskRunUserId: taskRun.userId,
      }
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
    id: taskRun.taskId,
  });

  const screenshotWorkflowEnabled =
    env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "true" ||
    env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "1";

  const response = {
    ok: true,
    taskRun: {
      id: taskRun._id,
      taskId: taskRun.taskId,
      teamId: taskRun.teamId,
      newBranch: taskRun.newBranch ?? null,
      agentName: taskRun.agentName ?? null,
      isPreviewJob: Boolean(taskRun.isPreviewJob),
    },
    task: task
      ? {
          id: task._id,
          text: task.text,
        }
      : null,
    screenshotWorkflowEnabled,
  } satisfies WorkerTaskRunResponse;
  return jsonResponse(response);
}

async function handleAllCompleteRequest(
  ctx: ActionCtx,
  workerAuth: WorkerAuthContext,
  taskId: Id<"tasks">
): Promise<Response> {
  const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
    id: taskId,
  });
  if (!task) {
    return jsonResponse({ code: 404, message: "Task not found" }, 404);
  }
  if (
    task.teamId !== workerAuth.payload.teamId ||
    task.userId !== workerAuth.payload.userId
  ) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const runsForTeam = await ctx.runQuery(
    internal.taskRuns.listByTaskAndTeamInternal,
    {
      taskId,
      teamId: workerAuth.payload.teamId,
      userId: workerAuth.payload.userId,
    }
  );

  const statuses = runsForTeam.map((run: TaskRunDoc) => ({
    id: run._id,
    status: run.status,
  }));

  const allComplete =
    runsForTeam.length > 0 &&
    runsForTeam.every((run: TaskRunDoc) =>
      ["completed", "failed"].includes(run.status)
    );

  const response = {
    ok: true,
    taskId,
    allComplete,
    statuses,
  } satisfies WorkerAllRunsCompleteResponse;
  return jsonResponse(response);
}

async function handleCrownCheckRequest(
  ctx: ActionCtx,
  workerAuth: WorkerAuthContext,
  data: { taskRunId?: Id<"taskRuns">; taskId?: Id<"tasks"> }
): Promise<Response> {
  const taskRun = await loadTaskRunForWorker(ctx, workerAuth, data.taskRunId);
  if (taskRun instanceof Response) return taskRun;

  const taskId = data.taskId ?? taskRun.taskId;
  if (taskId !== taskRun.taskId) {
    console.warn("[convex.crown] Worker taskId mismatch", {
      providedTaskId: data.taskId,
      expectedTaskId: taskRun.taskId,
    });
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
    id: taskId,
  });
  if (!task) {
    return jsonResponse({ code: 404, message: "Task not found" }, 404);
  }
  if (
    task.teamId !== workerAuth.payload.teamId ||
    task.userId !== workerAuth.payload.userId
  ) {
    console.warn(
      "[convex.crown] Worker attempted to access unauthorized task",
      { taskId }
    );
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  let currentStatus = task.crownEvaluationStatus ?? null;
  let currentError = task.crownEvaluationError ?? null;

  const [runsForTeam, workspaceSettings, existingEvaluation] =
    await Promise.all([
      ctx.runQuery(internal.taskRuns.listByTaskAndTeamInternal, {
        taskId,
        teamId: workerAuth.payload.teamId,
        userId: workerAuth.payload.userId,
      }),
      ctx.runQuery(internal.workspaceSettings.getByTeamAndUserInternal, {
        teamId: workerAuth.payload.teamId,
        userId: workerAuth.payload.userId,
      }),
      ctx.runQuery(internal.crown.getEvaluationByTaskInternal, {
        taskId,
        teamId: workerAuth.payload.teamId,
        userId: workerAuth.payload.userId,
      }),
    ]);

  const allRunsFinished = runsForTeam.every((run: TaskRunDoc) =>
    ["completed", "failed"].includes(run.status)
  );
  const completedRuns = runsForTeam.filter(
    (run: TaskRunDoc) => run.status === "completed"
  );

  const shouldEvaluate =
    allRunsFinished &&
    completedRuns.length >= 2 &&
    !existingEvaluation;

  const singleRunWinnerId =
    allRunsFinished && completedRuns.length === 1 && !existingEvaluation
      ? completedRuns[0]._id
      : null;

  // Set crown evaluation status to pending for both multi-run (shouldEvaluate) and single-run cases
  const needsCrownStatusUpdate =
    (shouldEvaluate || singleRunWinnerId) &&
    currentStatus !== "pending" &&
    currentStatus !== "in_progress" &&
    !existingEvaluation;

  if (needsCrownStatusUpdate) {
    try {
      await ctx.runMutation(internal.tasks.setCrownEvaluationStatusInternal, {
        taskId,
        teamId: workerAuth.payload.teamId,
        userId: workerAuth.payload.userId,
        status: "pending",
        clearError: true,
      });
      currentStatus = "pending";
      currentError = null;
    } catch (error) {
      console.error("[convex.crown] Failed to mark crown pending", {
        taskId,
        error,
      });
    }
  }

  const response = {
    ok: true,
    taskId,
    allRunsFinished,
    shouldEvaluate,
    singleRunWinnerId,
    existingEvaluation: existingEvaluation
      ? {
          winnerRunId: existingEvaluation.winnerRunId,
          evaluatedAt: existingEvaluation.evaluatedAt,
        }
      : null,
    task: {
      text: task.text,
      crownEvaluationStatus: currentStatus,
      crownEvaluationError: currentError,
      isCompleted: task.isCompleted,
      baseBranch: task.baseBranch ?? null,
      projectFullName: task.projectFullName ?? null,
      autoPrEnabled: workspaceSettings?.autoPrEnabled ?? false,
    },
    runs: runsForTeam.map((run: TaskRunDoc) => ({
      id: run._id,
      status: run.status as WorkerRunStatus,
      agentName: run.agentName ?? null,
      newBranch: run.newBranch ?? null,
      exitCode: run.exitCode ?? null,
      completedAt: run.completedAt ?? null,
    })),
  } satisfies CrownWorkerCheckResponse;
  return jsonResponse(response);
}

export const crownWorkerFinalize = httpAction(async (ctx, req) => {
  const workerAuth = await getWorkerAuth(req, {
    loggerPrefix: "[convex.crown]",
  });
  if (!workerAuth) {
    throw jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = WorkerFinalizeSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn(
      "[convex.crown] Invalid worker finalize payload",
      validation.error
    );
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const taskId = validation.data.taskId;
  const winnerRunId = validation.data.winnerRunId;
  const candidateRunIds = validation.data.candidateRunIds;

  const task = await ctx.runQuery(internal.tasks.getByIdInternal, {
    id: taskId,
  });
  if (!task) {
    return jsonResponse({ code: 404, message: "Task not found" }, 404);
  }
  if (
    task.teamId !== workerAuth.payload.teamId ||
    task.userId !== workerAuth.payload.userId
  ) {
    return jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const existingEvaluation = await ctx.runQuery(
    internal.crown.getEvaluationByTaskInternal,
    {
      taskId,
      teamId: workerAuth.payload.teamId,
      userId: workerAuth.payload.userId,
    }
  );

  if (existingEvaluation) {
    return jsonResponse({
      ok: true,
      alreadyEvaluated: true,
      winnerRunId: existingEvaluation.winnerRunId,
    });
  }

  // Extract isFallback and evaluationNote from evaluationResponse JSON if not provided directly
  // This maintains backward compatibility with workers that don't send these fields separately
  let isFallback = validation.data.isFallback;
  let evaluationNote = validation.data.evaluationNote;

  if (isFallback === undefined || evaluationNote === undefined) {
    try {
      const parsedEvalResponse = JSON.parse(validation.data.evaluationResponse);
      if (isFallback === undefined && typeof parsedEvalResponse.isFallback === "boolean") {
        isFallback = parsedEvalResponse.isFallback;
      }
      if (evaluationNote === undefined && typeof parsedEvalResponse.evaluationNote === "string") {
        evaluationNote = parsedEvalResponse.evaluationNote;
      }
    } catch (error) {
      // evaluationResponse might not be valid JSON - this is expected for older workers
      console.error("[convex.crown] Failed to parse evaluationResponse for fallback fields", {
        taskId,
        error,
      });
    }
  }

  try {
    const summaryMissing =
      !validation.data.summary || validation.data.summary.trim().length === 0;

    let summary = validation.data.summary;

    if (winnerRunId && summaryMissing) {
      const parsedFromRequest = parseCrownEvaluationPrompt(
        validation.data.evaluationPrompt
      );

      let parsedFromTask: ReturnType<typeof parseCrownEvaluationPrompt> | null =
        null;
      if (!parsedFromRequest && task.crownEvaluationRetryData) {
        try {
          const stored = JSON.parse(task.crownEvaluationRetryData) as {
            evaluationPrompt?: string;
          };
          if (stored.evaluationPrompt) {
            parsedFromTask = parseCrownEvaluationPrompt(stored.evaluationPrompt);
          }
        } catch (error) {
          console.error("[convex.crown] Failed to parse stored retry data", {
            taskId,
            error,
          });
        }
      }

      const parsed = parsedFromRequest ?? parsedFromTask;
      const candidate = parsed?.candidates.find(
        (candidateItem) => candidateItem.runId === winnerRunId
      );

      if (!parsed || !candidate) {
        const winningId = await ctx.runMutation(internal.crown.workerFinalize, {
          taskId,
          teamId: workerAuth.payload.teamId,
          userId: workerAuth.payload.userId,
          winnerRunId: null,
          reason: "Summarization failed (missing summary)",
          summary: undefined,
          evaluationPrompt: validation.data.evaluationPrompt,
          evaluationResponse: validation.data.evaluationResponse,
          candidateRunIds,
          pullRequest: validation.data.pullRequest,
          pullRequestTitle: validation.data.pullRequestTitle,
          pullRequestDescription: validation.data.pullRequestDescription,
          isFallback,
          evaluationNote:
            "Summarization failed (missing summary) and Convex could not reconstruct the winner diff",
        });
        return jsonResponse({ ok: true, winnerRunId: winningId });
      }

      try {
        const summaryResponse = await ctx.runAction(api.crown.actions.summarize, {
          prompt: parsed.prompt,
          gitDiff: candidate.gitDiff,
          teamSlugOrId: workerAuth.payload.teamId,
        });
        summary = summaryResponse.summary.slice(0, 8000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const winningId = await ctx.runMutation(internal.crown.workerFinalize, {
          taskId,
          teamId: workerAuth.payload.teamId,
          userId: workerAuth.payload.userId,
          winnerRunId: null,
          reason: "Summarization failed",
          summary: undefined,
          evaluationPrompt: validation.data.evaluationPrompt,
          evaluationResponse: validation.data.evaluationResponse,
          candidateRunIds,
          pullRequest: validation.data.pullRequest,
          pullRequestTitle: validation.data.pullRequestTitle,
          pullRequestDescription: validation.data.pullRequestDescription,
          isFallback,
          evaluationNote: `Summarization failed: ${message}`,
        });
        return jsonResponse({ ok: true, winnerRunId: winningId });
      }
    }

    const winningId = await ctx.runMutation(internal.crown.workerFinalize, {
      taskId,
      teamId: workerAuth.payload.teamId,
      userId: workerAuth.payload.userId,
      winnerRunId,
      reason: validation.data.reason,
      summary,
      evaluationPrompt: validation.data.evaluationPrompt,
      evaluationResponse: validation.data.evaluationResponse,
      candidateRunIds,
      pullRequest: validation.data.pullRequest,
      pullRequestTitle: validation.data.pullRequestTitle,
      pullRequestDescription: validation.data.pullRequestDescription,
      isFallback,
      evaluationNote,
    });

    return jsonResponse({ ok: true, winnerRunId: winningId });
  } catch (error) {
    console.error("[convex.crown] Worker finalize failed", error);
    return jsonResponse({ code: 500, message: "Finalize failed" }, 500);
  }
});

export const crownWorkerComplete = httpAction(async (ctx, req) => {
  const auth = await getWorkerAuth(req, { loggerPrefix: "[convex.crown]" });
  if (!auth) {
    console.error("[convex.crown] Auth failed for worker complete");
    throw jsonResponse({ code: 401, message: "Unauthorized" }, 401);
  }

  const parsed = await ensureJsonRequest(req);
  if (parsed instanceof Response) return parsed;

  const validation = WorkerCompleteRequestSchema.safeParse(parsed.json);
  if (!validation.success) {
    console.warn(
      "[convex.crown] Invalid worker complete payload",
      validation.error
    );
    return jsonResponse({ code: 400, message: "Invalid input" }, 400);
  }

  const taskRunId = validation.data.taskRunId;

  const existingRun = await loadTaskRunForWorker(ctx, auth, taskRunId);
  if (existingRun instanceof Response) {
    console.error("[convex.crown] Failed to load task run", { taskRunId });
    return existingRun;
  }

  await ctx.runMutation(internal.taskRuns.workerComplete, {
    taskRunId,
    exitCode: validation.data.exitCode,
  });

  const updatedRun = await ctx.runQuery(internal.taskRuns.getById, {
    id: taskRunId,
  });

  const task = updatedRun
    ? await ctx.runQuery(internal.tasks.getByIdInternal, {
        id: updatedRun.taskId,
      })
    : null;

  // Trigger repo discovery for custom environment tasks
  // This enables git diff UI to work immediately without client-side discovery
  if (
    updatedRun?.vscode?.containerName &&
    !updatedRun.discoveredRepos?.length &&
    updatedRun.environmentId
  ) {
    console.log(
      "[convex.crown] Scheduling repo discovery for custom env task:",
      taskRunId
    );
    await ctx.scheduler.runAfter(0, internal.discoverReposAction.discoverRepos, {
      runId: taskRunId,
      sandboxId: updatedRun.vscode.containerName,
    });
  }

  const containerSettings = await ctx.runQuery(
    internal.containerSettings.getContainerSettingsInternal,
    {
      teamId: auth.payload.teamId,
      userId: auth.payload.userId,
    }
  );

  if (containerSettings?.autoCleanupEnabled && updatedRun?.vscode) {
    const reviewMinutes = containerSettings.reviewPeriodMinutes ?? 60;
    const scheduledStopAt = containerSettings.stopImmediatelyOnCompletion
      ? Date.now()
      : Date.now() + reviewMinutes * 60 * 1000;

    await ctx.runMutation(internal.taskRuns.updateScheduledStopInternal, {
      taskRunId,
      scheduledStopAt,
    });
  }

  // Try to create/link a preview run for this task run if it has PR info
  // This enables screenshot capture and GitHub comment posting for crown tasks
  const screenshotWorkflowEnabled =
    env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "true" ||
    env.CMUX_ENABLE_SCREENSHOT_WORKFLOW === "1";

  if (!screenshotWorkflowEnabled) {
    console.log("[convex.crown] Screenshot workflow disabled (CMUX_ENABLE_SCREENSHOT_WORKFLOW not set to true/1)", {
      taskRunId,
    });
  } else {
    try {
      const previewResult = await ctx.runMutation(
        internal.previewRuns.enqueueFromTaskRun,
        { taskRunId }
      );

      if (previewResult.created && previewResult.previewRunId) {
        console.log("[convex.crown] Preview run created/linked for task run", {
          taskRunId,
          previewRunId: previewResult.previewRunId,
          isNew: previewResult.isNew,
        });

        // If a new preview run was created, dispatch it to start the preview job
        if (previewResult.isNew) {
          await ctx.scheduler.runAfter(
            0,
            internal.preview_jobs.requestDispatch,
            { previewRunId: previewResult.previewRunId }
          );
          console.log("[convex.crown] Preview job dispatch scheduled", {
            taskRunId,
            previewRunId: previewResult.previewRunId,
          });
        }
      } else {
        console.log("[convex.crown] No preview run created for task run", {
          taskRunId,
          reason: previewResult.reason,
        });
      }
    } catch (error) {
      // Don't fail the completion if preview run creation fails
      console.error("[convex.crown] Failed to create preview run for task run", {
        taskRunId,
        error,
      });
    }
  }

  const response = {
    ok: true,
    taskRun: updatedRun
      ? {
          id: updatedRun._id,
          taskId: updatedRun.taskId,
          teamId: updatedRun.teamId,
          newBranch: updatedRun.newBranch ?? null,
          agentName: updatedRun.agentName ?? null,
        }
      : null,
    task: task
      ? {
          id: task._id,
          text: task.text,
        }
      : null,
  } satisfies WorkerTaskRunResponse;
  return jsonResponse(response);
});
