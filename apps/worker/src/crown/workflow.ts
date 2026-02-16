import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Id } from "@cmux/convex/dataModel";

import { log } from "../logger";
import { convexRequest } from "./convex";
import {
  autoCommitAndPush,
  buildCommitMessage,
  collectDiffForRun,
  detectGitRepoPath,
  ensureBranchesAvailable,
  getCurrentBranch,
  runGitCommand,
} from "./git";
import {
  buildPullRequestBody,
  buildPullRequestTitle,
  createPullRequest,
} from "./pullRequest";
import {
  type CandidateData,
  type CrownEvaluationResponse,
  type CrownSummarizationResponse,
  type CrownWorkerCheckResponse,
  type WorkerAllRunsCompleteResponse,
  type WorkerPushAuthResponse,
  type WorkerRunContext,
  type WorkerTaskRunResponse,
} from "./types";
import { WORKSPACE_ROOT } from "./utils";
import { runTaskScreenshots } from "../screenshotCollector/runTaskScreenshots";
import type { RunTaskScreenshotsOptions } from "../screenshotCollector/runTaskScreenshots";

async function uploadScreenshotsWithLogging(
  options: RunTaskScreenshotsOptions | null,
  taskRunId: string
): Promise<void> {
  if (!options) {
    log("WARN", "Skipping screenshot workflow due to missing task id", {
      taskRunId,
    });
    return;
  }

  try {
    await runTaskScreenshots(options);
  } catch (screenshotError) {
    log("ERROR", "Automated screenshot workflow encountered an error", {
      taskRunId,
      error:
        screenshotError instanceof Error
          ? screenshotError.message
          : String(screenshotError),
    });
  }
}

type WorkerCompletionOptions = {
  taskRunId: string;
  token: string;
  prompt: string;
  convexUrl?: string;
  agentModel?: string;
  teamId?: string;
  taskId?: string;
  elapsedMs?: number;
  exitCode?: number;
};

export async function handleWorkerTaskCompletion(
  options: WorkerCompletionOptions
): Promise<void> {
  const {
    taskRunId,
    token,
    prompt,
    convexUrl,
    agentModel,
    teamId,
    taskId,
    elapsedMs,
    exitCode = 0,
  } = options;

  if (!token) {
    log("ERROR", "Missing worker token for task run completion", { taskRunId });
    return;
  }

  const detectedGitPath = await detectGitRepoPath();

  log("INFO", "Worker task completion handler started", {
    taskRunId,
    workspacePath: WORKSPACE_ROOT,
    gitRepoPath: detectedGitPath,
    envWorkspacePath: process.env.CMUX_WORKSPACE_PATH,
    agentModel,
    elapsedMs,
    exitCode,
    convexUrl,
  });

  const runContext: WorkerRunContext = {
    token,
    prompt,
    agentModel,
    teamId,
    taskId,
    convexUrl,
  };

  const baseUrlOverride = runContext.convexUrl;

  const info = await convexRequest<WorkerTaskRunResponse>(
    "/api/crown/check",
    runContext.token,
    {
      taskRunId,
      checkType: "info",
    },
    baseUrlOverride
  );

  if (!info) {
    log(
      "ERROR",
      "Failed to load task run info - endpoint not found or network error",
      {
        taskRunId,
        info,
        convexUrl: baseUrlOverride,
      }
    );
    return;
  } else if (!info.ok || !info.taskRun) {
    log("ERROR", "Task run info response invalid", {
      taskRunId,
      response: info,
      hasOk: info?.ok,
      hasTaskRun: info?.taskRun,
    });
    return;
  }

  const taskRunInfo = info.taskRun;

  const screenshotWorkflowEnabled = info.screenshotWorkflowEnabled ?? false;

  if (screenshotWorkflowEnabled) {
    void uploadScreenshotsWithLogging(
      {
        taskId: info.taskRun.taskId as Id<"tasks">,
        taskRunId: taskRunId as Id<"taskRuns">,
        token: runContext.token,
        convexUrl: runContext.convexUrl,
      },
      taskRunId
    );
  } else {
    log("INFO", "Screenshot workflow disabled (CMUX_ENABLE_SCREENSHOT_WORKFLOW not set to true/1)", {
      taskRunId,
    });
  }

  const hasGitRepo = existsSync(join(detectedGitPath, ".git"));

  log("INFO", "[AUTOCOMMIT] Git operations check", {
    taskRunId,
    hasGitRepo,
    workspaceRoot: WORKSPACE_ROOT,
    gitDirPath: join(detectedGitPath, ".git"),
  });

  if (!hasGitRepo) {
    log("ERROR", "[AUTOCOMMIT] No git repository found, cannot autocommit", {
      taskRunId,
      detectedGitPath,
    });
  } else {
    const promptForCommit = info.task?.text ?? runContext.prompt ?? "cmux task";

    const commitMessage = buildCommitMessage({
      prompt: promptForCommit,
      agentName: agentModel ?? runContext.agentModel ?? "cmux-agent",
    });

    // Branch should already be created by startup commands
    let branchForCommit = taskRunInfo.newBranch;
    if (!branchForCommit) {
      // Fallback to current branch if newBranch not available
      branchForCommit = await getCurrentBranch();
      log("INFO", "[AUTOCOMMIT] Using current branch as newBranch not set", {
        taskRunId,
        currentBranch: branchForCommit,
      });
    } else {
      // Verify we're on the expected branch
      const currentBranch = await getCurrentBranch();
      if (currentBranch !== branchForCommit) {
        log(
          "WARN",
          "[AUTOCOMMIT] Current branch differs from expected branch",
          {
            taskRunId,
            expectedBranch: branchForCommit,
            currentBranch,
          }
        );
        // Try to checkout to the expected branch
        const checkoutResult = await runGitCommand(
          `git checkout ${branchForCommit}`,
          true
        );
        if (checkoutResult && checkoutResult.exitCode === 0) {
          log("INFO", "[AUTOCOMMIT] Checked out to expected branch", {
            taskRunId,
            branch: branchForCommit,
          });
        } else {
          log(
            "WARN",
            "[AUTOCOMMIT] Failed to checkout to expected branch, will use current branch",
            {
              taskRunId,
              expectedBranch: branchForCommit,
              currentBranch,
              error: checkoutResult?.stderr,
            }
          );
          branchForCommit = currentBranch;
        }
      }
    }

    log("INFO", "[AUTOCOMMIT] Preparing to autocommit and push", {
      taskRunId,
      branchForCommit,
      projectFullName: info?.task?.projectFullName,
      hasInfo: Boolean(info),
      hasTask: Boolean(info?.task),
      hasTaskRun: Boolean(taskRunInfo),
      taskRunNewBranch: taskRunInfo.newBranch,
    });

    if (!branchForCommit) {
      log("ERROR", "[AUTOCOMMIT] Unable to resolve branch name", {
        taskRunId,
        taskRunNewBranch: taskRunInfo.newBranch,
      });
    } else {
      const remoteUrl = info?.task?.projectFullName
        ? `https://github.com/${info.task.projectFullName}.git`
        : undefined;

      log("INFO", "[AUTOCOMMIT] Starting autoCommitAndPush", {
        taskRunId,
        branchForCommit,
        remoteUrl: remoteUrl || "using existing remote",
        commitMessage,
        hasGitRepo,
        gitRepoPath: detectedGitPath,
      });

      try {
        let cachedPushAuth:
          | { token: string; repoFullName: string }
          | null
          | undefined;

        const tokenSupplier = async (): Promise<{
          token: string;
          repoFullName: string;
        } | null> => {
          if (cachedPushAuth !== undefined) {
            return cachedPushAuth;
          }

          const pushAuth = await convexRequest<WorkerPushAuthResponse>(
            "/api/crown/check",
            runContext.token,
            {
              taskRunId,
              checkType: "push-auth",
            },
            baseUrlOverride
          );

          if (
            pushAuth?.ok &&
            pushAuth.source === "github_app" &&
            pushAuth.token &&
            pushAuth.repoFullName
          ) {
            cachedPushAuth = {
              token: pushAuth.token,
              repoFullName: pushAuth.repoFullName,
            };
            log("INFO", "[AUTOCOMMIT] Fresh push token obtained", {
              taskRunId,
              repoFullName: pushAuth.repoFullName,
              source: pushAuth.source,
            });
            return cachedPushAuth;
          }

          log("WARN", "[AUTOCOMMIT] Could not obtain fresh push token", {
            taskRunId,
            source: pushAuth?.source ?? "none",
            reason: pushAuth?.reason,
          });
          cachedPushAuth = null;
          return null;
        };

        const autoCommitResult = await autoCommitAndPush({
          branchName: branchForCommit,
          commitMessage,
          remoteUrl,
          tokenSupplier,
        });

        if (autoCommitResult.success) {
          log("INFO", "[AUTOCOMMIT] autoCommitAndPush completed successfully", {
            taskRunId,
            branch: branchForCommit,
            pushedRepos: autoCommitResult.pushedRepos,
          });
        } else {
          log("WARN", "[AUTOCOMMIT] autoCommitAndPush completed with issues", {
            taskRunId,
            branch: branchForCommit,
            pushedRepos: autoCommitResult.pushedRepos,
            errors: autoCommitResult.errors,
          });
        }
      } catch (error) {
        log("ERROR", "[AUTOCOMMIT] Worker auto-commit failed with exception", {
          taskRunId,
          branch: branchForCommit,
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        });
      }
    }
  }

  const completion = await convexRequest<WorkerTaskRunResponse>(
    "/api/crown/complete",
    runContext.token,
    {
      taskRunId,
      exitCode,
    },
    baseUrlOverride
  );

  if (!completion?.ok) {
    log("ERROR", "Worker completion request failed", { taskRunId });
    return;
  }

  log("INFO", "Worker marked as complete, preparing for crown check", {
    taskRunId,
    taskId: runContext.taskId,
  });

  const completedRunInfo = completion.taskRun ?? taskRunInfo;
  const realTaskId = completedRunInfo?.taskId;

  if (!realTaskId) {
    log("ERROR", "Missing real task ID from task run after worker completion", {
      taskRunId,
      hasCompletedRunInfo: Boolean(completedRunInfo),
      hasInfoTaskRun: Boolean(taskRunInfo),
    });
    return;
  }

  runContext.taskId = realTaskId;
  runContext.teamId = completedRunInfo.teamId ?? runContext.teamId;

  await startCrownEvaluation({
    taskRunId,
    currentTaskId: realTaskId,
    runContext,
    baseUrlOverride,
    agentModel,
    elapsedMs,
  });
}

async function startCrownEvaluation({
  taskRunId,
  currentTaskId,
  runContext,
  baseUrlOverride,
  agentModel,
  elapsedMs,
}: {
  taskRunId: string;
  currentTaskId: string;
  runContext: WorkerRunContext;
  baseUrlOverride?: string;
  agentModel?: string;
  elapsedMs?: number;
}): Promise<void> {
  log("INFO", "Starting crown evaluation attempt", {
    taskRunId,
    taskId: currentTaskId,
  });

  let allComplete = false;
  let completionState: WorkerAllRunsCompleteResponse | null = null;

  completionState = await convexRequest<WorkerAllRunsCompleteResponse>(
    "/api/crown/check",
    runContext.token,
    {
      taskId: currentTaskId,
      checkType: "all-complete",
    },
    baseUrlOverride
  );

  if (!completionState?.ok) {
    log("ERROR", "Failed to verify task run completion state", {
      taskRunId,
      taskId: currentTaskId,
    });
    return;
  }

  log("INFO", "Task completion state check", {
    taskRunId,
    taskId: currentTaskId,
    allComplete: completionState.allComplete,
    totalStatuses: completionState.statuses.length,
    completedCount: completionState.statuses.filter(
      (status) => status.status === "completed"
    ).length,
  });

  if (completionState.allComplete) {
    allComplete = true;
  }

  if (!allComplete || !completionState) {
    log(
      "INFO",
      "Task runs still pending after retries; deferring crown evaluation",
      {
        taskRunId,
        taskId: currentTaskId,
        statuses: completionState?.statuses || [],
      }
    );
    return;
  }

  log("INFO", "All task runs complete; checking if evaluation needed", {
    taskRunId,
    taskId: currentTaskId,
  });

  const crownData = await convexRequest<CrownWorkerCheckResponse>(
    "/api/crown/check",
    runContext.token,
    {
      taskId: currentTaskId,
    },
    baseUrlOverride
  );

  if (!crownData?.ok) {
    return;
  }

  if (!crownData.task) {
    log("ERROR", "Missing task in crown check response", {
      taskRunId,
      taskId: currentTaskId,
    });
    return;
  }

  if (crownData.existingEvaluation) {
    log(
      "INFO",
      "Crown evaluation already exists (another worker completed it)",
      {
        taskRunId,
        winnerRunId: crownData.existingEvaluation.winnerRunId,
        evaluatedAt: new Date(
          crownData.existingEvaluation.evaluatedAt
        ).toISOString(),
      }
    );
    return;
  }

  if (!crownData.shouldEvaluate && !crownData.singleRunWinnerId) {
    log("INFO", "Evaluation not needed at this time", {
      taskRunId,
      taskId: currentTaskId,
    });
    return;
  }

  const completedRuns = crownData.runs.filter(
    (run) => run.status === "completed"
  );

  log("INFO", "Crown readiness status", {
    taskRunId,
    taskId: currentTaskId,
    totalRuns: crownData.runs.length,
    completedRuns: completedRuns.length,
    shouldEvaluate: crownData.shouldEvaluate,
    singleRunWinnerId: crownData.singleRunWinnerId,
  });

  // Pass undefined to let collectDiffForRun auto-detect the default branch
  const baseBranch = crownData.task.baseBranch || undefined;

  if (crownData.singleRunWinnerId) {
    if (crownData.singleRunWinnerId !== taskRunId) {
      log("INFO", "Single-run winner already handled by another run", {
        taskRunId,
        winnerRunId: crownData.singleRunWinnerId,
      });
      return;
    }

    const singleRun = crownData.runs.find((run) => run.id === taskRunId);
    if (!singleRun) {
      log("ERROR", "Single-run entry missing during crown", { taskRunId });
      return;
    }

    let gitDiff: string;
    try {
      gitDiff = await collectDiffForRun(baseBranch, singleRun.newBranch);
    } catch (diffError) {
      const errorMessage = diffError instanceof Error ? diffError.message : String(diffError);
      log("ERROR", "Failed to collect diff for single-run crown evaluation", {
        taskRunId,
        baseBranch,
        branch: singleRun.newBranch,
        error: errorMessage,
      });

      // Mark the crown evaluation as error so user can retry
      await convexRequest(
        "/api/crown/finalize",
        runContext.token,
        {
          taskId: crownData.taskId,
          winnerRunId: null,
          reason: `Diff collection failed: ${errorMessage}`,
          evaluationPrompt: "Failed to collect git diff",
          evaluationResponse: JSON.stringify({
            winner: null,
            reason: errorMessage,
            isFallback: true,
          }),
          candidateRunIds: [singleRun.id],
          isFallback: true,
          evaluationNote: `Failed to collect git diff between ${baseBranch} and ${singleRun.newBranch}: ${errorMessage}. This may happen if the workspace is not a git repository or the branches don't exist.`,
        },
        baseUrlOverride
      );
      return;
    }

    log("INFO", "Built crown candidate", {
      runId: singleRun.id,
      branch: singleRun.newBranch,
    });

    const candidate: CandidateData = {
      runId: singleRun.id,
      agentName: singleRun.agentName ?? "unknown agent",
      gitDiff,
      newBranch: singleRun.newBranch,
    };

    const branchesReady = await ensureBranchesAvailable(
      [{ id: candidate.runId, newBranch: candidate.newBranch }],
      baseBranch
    );
    if (!branchesReady) {
      // Branch may not be on remote (e.g., push failed due to permissions)
      // but we can still proceed with crown evaluation using local diff
      log("WARN", "Branches not ready on remote; proceeding with local diff", {
        taskRunId,
        elapsedMs,
      });
    }

    log("INFO", "Single run detected, skipping evaluation", {
      taskRunId,
      runId: candidate.runId,
      agentName: candidate.agentName,
    });

    const summarizationResponse =
      await convexRequest<CrownSummarizationResponse>(
        "/api/crown/summarize",
        runContext.token,
        {
          prompt: crownData.task?.text || "Task description not available",
          gitDiff: candidate.gitDiff,
          teamSlugOrId: runContext.teamId,
        },
        baseUrlOverride
      );

    const summary = summarizationResponse?.summary
      ? summarizationResponse.summary.slice(0, 8000)
      : undefined;

    log("INFO", "Single-run summarization response", {
      taskRunId,
      summaryPreview: summary?.slice(0, 120),
    });

    await convexRequest(
      "/api/crown/finalize",
      runContext.token,
      {
        taskId: crownData.taskId,
        winnerRunId: candidate.runId,
        reason: "Single run automatically selected (no competition)",
        evaluationPrompt: "Single run - no evaluation needed",
        evaluationResponse: JSON.stringify({
          winner: 0,
          reason: "Single run - no competition",
        }),
        candidateRunIds: [candidate.runId],
        summary,
      },
      baseUrlOverride
    );

    log("INFO", "Crowned task with single-run winner", {
      taskId: crownData.taskId,
      winnerRunId: candidate.runId,
      agentModel: agentModel ?? runContext.agentModel,
      elapsedMs,
    });
    return;
  }

  let completedRunsWithDiff: (CandidateData | null)[];
  try {
    completedRunsWithDiff = await Promise.all(
      completedRuns.map(async (run) => {
        try {
          const gitDiff = await collectDiffForRun(baseBranch, run.newBranch);
          log("INFO", "Built crown candidate", {
            runId: run.id,
            branch: run.newBranch,
          });
          return {
            runId: run.id,
            agentName: run.agentName ?? "unknown agent",
            gitDiff,
            newBranch: run.newBranch,
          } satisfies CandidateData;
        } catch (diffError) {
          const errorMessage = diffError instanceof Error ? diffError.message : String(diffError);
          log("ERROR", "Failed to collect diff for run", {
            runId: run.id,
            baseBranch,
            branch: run.newBranch,
            error: errorMessage,
          });
          // Return null for failed runs - we'll filter them out
          return null;
        }
      })
    );
  } catch (allDiffError) {
    const errorMessage = allDiffError instanceof Error ? allDiffError.message : String(allDiffError);
    log("ERROR", "Failed to collect diffs for multi-run crown evaluation", {
      taskRunId,
      error: errorMessage,
    });

    // Mark the crown evaluation as error so user can retry
    await convexRequest(
      "/api/crown/finalize",
      runContext.token,
      {
        taskId: crownData.taskId,
        winnerRunId: null,
        reason: `Diff collection failed: ${errorMessage}`,
        evaluationPrompt: "Failed to collect git diffs",
        evaluationResponse: JSON.stringify({
          winner: null,
          reason: errorMessage,
          isFallback: true,
        }),
        candidateRunIds: completedRuns.map((run) => run.id),
        isFallback: true,
        evaluationNote: `Failed to collect git diffs for crown evaluation: ${errorMessage}`,
      },
      baseUrlOverride
    );
    return;
  }

  const candidates = completedRunsWithDiff.filter(
    (candidate): candidate is CandidateData => candidate !== null
  );

  if (candidates.length === 0) {
    log("ERROR", "No candidates available for crown evaluation (all diff collections failed)", {
      taskRunId,
    });
    // Mark the crown evaluation as error since all candidates failed
    await convexRequest(
      "/api/crown/finalize",
      runContext.token,
      {
        taskId: crownData.taskId,
        winnerRunId: null,
        reason: "All candidate diff collections failed",
        evaluationPrompt: "No diffs available for evaluation",
        evaluationResponse: JSON.stringify({
          winner: null,
          reason: "All candidate diff collections failed - workspace may not be a git repository",
          isFallback: true,
        }),
        candidateRunIds: completedRuns.map((run) => run.id),
        isFallback: true,
        evaluationNote: "Failed to collect git diffs for all candidates. This may happen if the workspace is not a git repository or the branches don't exist.",
      },
      baseUrlOverride
    );
    return;
  }

  if (!runContext.teamId) {
    log("ERROR", "Missing teamId for crown evaluation", { taskRunId });
    return;
  }

  if (!crownData.task?.text) {
    log("ERROR", "Missing task text for crown evaluation", {
      taskRunId,
      hasTask: !!crownData.task,
      hasText: !!crownData.task?.text,
    });
    return;
  }

  const promptText = crownData.task.text;

  log("INFO", "Preparing crown evaluation request", {
    taskRunId,
    hasPrompt: true,
    promptPreview: promptText.slice(0, 100),
    candidatesCount: candidates.length,
    teamId: runContext.teamId,
  });

  const evaluationResponse = await convexRequest<CrownEvaluationResponse>(
    "/api/crown/evaluate-agents",
    runContext.token,
    {
      prompt: promptText,
      candidates,
      teamSlugOrId: runContext.teamId,
    },
    baseUrlOverride
  );

  if (!evaluationResponse) {
    log("ERROR", "Crown evaluation response missing", {
      taskRunId,
    });
    return;
  }

  log("INFO", "Crown evaluation response", {
    taskRunId,
    winner: evaluationResponse.winner,
    reason: evaluationResponse.reason,
    isFallback: evaluationResponse.isFallback,
  });

  // Handle "no winner" case (fallback)
  if (evaluationResponse.winner === null) {
      log("WARN", "No winner selected by crown evaluation (fallback)", {
          taskRunId,
          reason: evaluationResponse.reason,
      });

      await convexRequest(
        "/api/crown/finalize",
        runContext.token,
        {
          taskId: crownData.taskId,
          winnerRunId: null,
          reason: evaluationResponse.reason,
          evaluationPrompt: `Task: ${promptText}\nCandidates: ${JSON.stringify(candidates)}`,
          evaluationResponse: JSON.stringify(evaluationResponse),
          candidateRunIds: candidates.map((candidate) => candidate.runId),
          isFallback: true,
          evaluationNote: evaluationResponse.evaluationNote || "No winner selected",
        },
        baseUrlOverride
      );
      return;
  }

  const winnerIndex = evaluationResponse.winner;
  const winnerCandidate = candidates[winnerIndex];
  
  if (!winnerCandidate) {
    log("ERROR", "Unable to find winner candidate by index", {
      taskRunId,
      winnerIndex,
      totalCandidates: candidates.length,
    });
    return;
  }

  const summaryResponse = await convexRequest<CrownSummarizationResponse>(
    "/api/crown/summarize",
    runContext.token,
    {
      prompt: promptText,
      gitDiff: winnerCandidate.gitDiff,
      teamSlugOrId: runContext.teamId,
    },
    baseUrlOverride
  );

  log("INFO", "Crown summarization response", {
    taskRunId,
    summaryPreview: summaryResponse?.summary?.slice(0, 120),
  });

  const summary = summaryResponse?.summary
    ? summaryResponse.summary.slice(0, 8000)
    : undefined;

  // Always generate PR title and description (for manual draft PRs even if auto-PR is disabled)
  const pullRequestTitle = buildPullRequestTitle(promptText);
  const pullRequestDescription = buildPullRequestBody({
    summary,
    prompt: promptText,
    agentName: winnerCandidate.agentName,
    branch: winnerCandidate.newBranch || "",
    taskId: crownData.taskId,
    runId: winnerCandidate.runId,
  });

  const prMetadata = await createPullRequest({
    check: crownData,
    winner: winnerCandidate,
    summary,
    context: runContext,
  });

  const reason =
    evaluationResponse.reason || `Selected ${winnerCandidate.agentName}`;

  await convexRequest(
    "/api/crown/finalize",
    runContext.token,
    {
      taskId: crownData.taskId,
      winnerRunId: winnerCandidate.runId,
      reason,
      evaluationPrompt: `Task: ${promptText}\nCandidates: ${JSON.stringify(candidates)}`,
      evaluationResponse: JSON.stringify(
        evaluationResponse ?? {
          winner: candidates.indexOf(winnerCandidate),
          reason,
          fallback: true,
        }
      ),
      candidateRunIds: candidates.map((candidate) => candidate.runId),
      summary,
      pullRequest: prMetadata?.pullRequest,
      // Use pre-generated title/description (available for manual PRs even if auto-PR disabled)
      pullRequestTitle: prMetadata?.title || pullRequestTitle,
      pullRequestDescription: prMetadata?.description || pullRequestDescription,
      isFallback: evaluationResponse.isFallback,
      evaluationNote: evaluationResponse.evaluationNote,
    },
    baseUrlOverride
  );

  log("INFO", "Crowned task after evaluation", {
    taskId: crownData.taskId,
    winnerRunId: winnerCandidate.runId,
    winnerAgent: winnerCandidate.agentName,
    agentModel: agentModel ?? runContext.agentModel,
    elapsedMs,
  });
}
