"use client";

import { useCallback, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { cn } from "@/lib/utils";
import { Play, Square, Loader2 } from "lucide-react";

interface AgentReviewState {
  agentName: string;
  taskRunId?: Id<"taskRuns">;
  status: "idle" | "starting" | "running" | "completed" | "failed";
  logs: string[];
  review?: string;
  error?: string;
}

interface ReviewOrchestratorProps {
  teamSlugOrId: string;
  repoFullName: string;
  pullNumber: number;
  selectedAgents: string[];
  onReviewStarted: (taskId: Id<"tasks">, taskRunIds: Id<"taskRuns">[]) => void;
  onAgentUpdate: (agentName: string, update: Partial<AgentReviewState>) => void;
  isRunning: boolean;
}

export function ReviewOrchestrator({
  teamSlugOrId,
  repoFullName,
  pullNumber,
  selectedAgents,
  onReviewStarted,
  onAgentUpdate,
  isRunning,
}: ReviewOrchestratorProps) {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createTask = useMutation(api.tasks.create);

  const handleStartReview = useCallback(async () => {
    setIsStarting(true);
    setError(null);

    try {
      // Create a task for the PR review
      const prUrl = `https://github.com/${repoFullName}/pull/${pullNumber}`;
      const prompt = `Review the pull request at ${prUrl}.

Analyze the code changes and provide:
1. A summary of what the PR does
2. Potential issues or bugs
3. Security concerns
4. Performance implications
5. Code quality observations
6. Suggestions for improvements

Be thorough but concise. Focus on actionable feedback.`;

      const result = await createTask({
        teamSlugOrId,
        text: prompt,
        projectFullName: repoFullName,
        selectedAgents,
      });

      if (result.taskId && result.taskRunIds) {
        onReviewStarted(result.taskId, result.taskRunIds);

        // Mark all agents as starting
        for (const agentName of selectedAgents) {
          onAgentUpdate(agentName, { status: "starting" });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start review";
      setError(message);
      console.error("[ReviewOrchestrator] Failed to start review:", err);
    } finally {
      setIsStarting(false);
    }
  }, [
    teamSlugOrId,
    repoFullName,
    pullNumber,
    selectedAgents,
    createTask,
    onReviewStarted,
    onAgentUpdate,
  ]);

  const handleStopReview = useCallback(() => {
    // TODO: Implement stop functionality
    // This would involve stopping the task runs in Convex
    console.log("[ReviewOrchestrator] Stop review requested");
  }, []);

  return (
    <div className="space-y-3">
      <button
        onClick={isRunning ? handleStopReview : handleStartReview}
        disabled={isStarting}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition",
          isRunning
            ? "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-300 dark:hover:bg-rose-900/50"
            : "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-700",
          isStarting && "cursor-not-allowed opacity-60"
        )}
      >
        {isStarting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Starting...
          </>
        ) : isRunning ? (
          <>
            <Square className="h-4 w-4" />
            Stop Review
          </>
        ) : (
          <>
            <Play className="h-4 w-4" />
            Start Review
          </>
        )}
      </button>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-900/30 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="text-xs text-neutral-500 dark:text-neutral-400">
        {selectedAgents.length} agent{selectedAgents.length !== 1 ? "s" : ""}{" "}
        selected
      </div>
    </div>
  );
}
