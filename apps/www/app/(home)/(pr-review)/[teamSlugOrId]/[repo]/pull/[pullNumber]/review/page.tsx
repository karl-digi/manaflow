"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { cn } from "@/lib/utils";

import { AgentReviewPanel } from "./_components/agent-review-panel";
import { ReviewOrchestrator } from "./_components/review-orchestrator";
import { ConsolidatedReviewSummary } from "./_components/consolidated-review-summary";
import { ReviewScreenshotGallery } from "./_components/review-screenshot-gallery";
import { ReviewHeader } from "./_components/review-header";

// Default agents for PR review
const DEFAULT_REVIEW_AGENTS = [
  "claude/opus-4.5",
  "codex/gpt-5.1-codex-max",
  "gemini/3-pro-preview",
] as const;

// type ReviewAgent = (typeof DEFAULT_REVIEW_AGENTS)[number];

interface AgentReviewState {
  agentName: string;
  taskRunId?: Id<"taskRuns">;
  status: "idle" | "starting" | "running" | "completed" | "failed";
  logs: string[];
  review?: string;
  error?: string;
}

export default function PRAgentReviewPage() {
  const params = useParams<{
    teamSlugOrId: string;
    repo: string;
    pullNumber: string;
  }>();
  const searchParams = useSearchParams();

  const teamSlugOrId = params.teamSlugOrId;
  const repo = params.repo;
  const pullNumber = parseInt(params.pullNumber, 10);
  const fullRepoName = `${teamSlugOrId}/${repo}`;

  // Parse selected agents from URL or use defaults
  const selectedAgents = useMemo(() => {
    const agentsParam = searchParams.get("agents");
    if (agentsParam) {
      return agentsParam.split(",").filter(Boolean);
    }
    return [...DEFAULT_REVIEW_AGENTS];
  }, [searchParams]);

  // Track review state per agent
  const [agentStates, setAgentStates] = useState<
    Record<string, AgentReviewState>
  >(() =>
    Object.fromEntries(
      selectedAgents.map((name) => [
        name,
        { agentName: name, status: "idle", logs: [] },
      ])
    )
  );

  // Track the task ID for this review session
  const [reviewTaskId, setReviewTaskId] = useState<Id<"tasks"> | null>(null);

  // Active panel (which agent's view is shown)
  const [activeAgent, setActiveAgent] = useState<string>(selectedAgents[0] ?? "");

  // View mode: consolidated review or individual agent view
  const [viewMode, setViewMode] = useState<"consolidated" | "individual">(
    "consolidated"
  );

  // Fetch task runs for the review task
  const taskRuns = useQuery(
    api.taskRuns.getByTask,
    reviewTaskId
      ? { teamSlugOrId, taskId: reviewTaskId }
      : "skip"
  );

  // Update agent states when task runs change
  useEffect(() => {
    if (!taskRuns) return;

    setAgentStates((prev) => {
      const next = { ...prev };
      for (const run of taskRuns) {
        const agentName = run.agentName;
        if (agentName && next[agentName]) {
          next[agentName] = {
            ...next[agentName],
            taskRunId: run._id,
            status:
              run.status === "completed"
                ? "completed"
                : run.status === "failed"
                  ? "failed"
                  : run.status === "running"
                    ? "running"
                    : "starting",
          };
        }
      }
      return next;
    });
  }, [taskRuns]);

  // Callback when review task is created
  const handleReviewStarted = useCallback(
    (taskId: Id<"tasks">, taskRunIds: Id<"taskRuns">[]) => {
      setReviewTaskId(taskId);
      // Map task run IDs to agents by index
      setAgentStates((prev) => {
        const next = { ...prev };
        selectedAgents.forEach((agentName, index) => {
          if (next[agentName] && taskRunIds[index]) {
            next[agentName] = {
              ...next[agentName],
              taskRunId: taskRunIds[index],
              status: "starting",
            };
          }
        });
        return next;
      });
    },
    [selectedAgents]
  );

  // Handler for agent status updates
  const handleAgentUpdate = useCallback(
    (agentName: string, update: Partial<AgentReviewState>) => {
      setAgentStates((prev) => ({
        ...prev,
        [agentName]: { ...prev[agentName], ...update },
      }));
    },
    []
  );

  // Handler for log chunks
  const handleLogChunk = useCallback((agentName: string, chunk: string) => {
    setAgentStates((prev) => ({
      ...prev,
      [agentName]: {
        ...prev[agentName],
        logs: [...(prev[agentName]?.logs ?? []), chunk],
      },
    }));
  }, []);

  // Calculate overall review status
  const overallStatus = useMemo(() => {
    const states = Object.values(agentStates);
    if (states.every((s) => s.status === "idle")) return "idle";
    if (states.some((s) => s.status === "starting" || s.status === "running"))
      return "running";
    if (states.every((s) => s.status === "completed" || s.status === "failed"))
      return "completed";
    return "running";
  }, [agentStates]);

  // Get screenshot sets from all task runs
  const screenshotSets = useMemo(() => {
    if (!taskRuns) return [];
    return taskRuns
      .filter((run) => run.latestScreenshotSetId)
      .map((run) => ({
        runId: run._id,
        agentName: run.agentName ?? "Unknown",
        screenshotSetId: run.latestScreenshotSetId!,
      }));
  }, [taskRuns]);

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <ReviewHeader
        repoFullName={fullRepoName}
        pullNumber={pullNumber}
        status={overallStatus}
        selectedAgents={selectedAgents}
      />

      <div className="flex h-[calc(100vh-64px)]">
        {/* Left sidebar - Agent selector and status */}
        <aside className="w-64 flex-shrink-0 border-r border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
              Review Agents
            </h2>
            <div className="mt-3 space-y-2">
              {selectedAgents.map((agentName) => {
                const state = agentStates[agentName];
                return (
                  <button
                    key={agentName}
                    onClick={() => {
                      setActiveAgent(agentName);
                      setViewMode("individual");
                    }}
                    className={cn(
                      "w-full rounded-lg px-3 py-2 text-left text-sm transition",
                      activeAgent === agentName && viewMode === "individual"
                        ? "bg-neutral-100 dark:bg-neutral-800"
                        : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{agentName}</span>
                      <AgentStatusBadge status={state?.status ?? "idle"} />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-6 border-t border-neutral-200 pt-4 dark:border-neutral-800">
              <button
                onClick={() => setViewMode("consolidated")}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition",
                  viewMode === "consolidated"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300"
                    : "hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
                )}
              >
                Consolidated Review
              </button>
            </div>
          </div>

          {/* Review orchestrator - handles starting/stopping reviews */}
          <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
            <ReviewOrchestrator
              teamSlugOrId={teamSlugOrId}
              repoFullName={fullRepoName}
              pullNumber={pullNumber}
              selectedAgents={selectedAgents}
              onReviewStarted={handleReviewStarted}
              onAgentUpdate={handleAgentUpdate}
              isRunning={overallStatus === "running"}
            />
          </div>
        </aside>

        {/* Main content area */}
        <main className="flex-1 overflow-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <div className="text-neutral-500">Loading...</div>
              </div>
            }
          >
            {viewMode === "consolidated" ? (
              <ConsolidatedReviewSummary
                teamSlugOrId={teamSlugOrId}
                agentStates={agentStates}
                taskRuns={taskRuns ?? []}
              />
            ) : (
              <AgentReviewPanel
                teamSlugOrId={teamSlugOrId}
                agentName={activeAgent}
                state={agentStates[activeAgent]}
                onLogChunk={(chunk) => handleLogChunk(activeAgent, chunk)}
              />
            )}
          </Suspense>
        </main>

        {/* Right sidebar - Screenshots */}
        {screenshotSets.length > 0 && (
          <aside className="w-80 flex-shrink-0 border-l border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
            <div className="p-4">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">
                Screenshots
              </h2>
              <ReviewScreenshotGallery
                teamSlugOrId={teamSlugOrId}
                screenshotSets={screenshotSets}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function AgentStatusBadge({
  status,
}: {
  status: AgentReviewState["status"];
}) {
  const config = {
    idle: { label: "Idle", className: "bg-neutral-200 text-neutral-600" },
    starting: {
      label: "Starting",
      className: "bg-amber-100 text-amber-700 animate-pulse",
    },
    running: {
      label: "Running",
      className: "bg-blue-100 text-blue-700 animate-pulse",
    },
    completed: { label: "Done", className: "bg-emerald-100 text-emerald-700" },
    failed: { label: "Failed", className: "bg-rose-100 text-rose-700" },
  };

  const { label, className } = config[status];

  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", className)}>
      {label}
    </span>
  );
}
