"use client";

import { useMemo } from "react";
import type { Doc, Id } from "@cmux/convex/dataModel";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

interface AgentReviewState {
  agentName: string;
  taskRunId?: Id<"taskRuns">;
  status: "idle" | "starting" | "running" | "completed" | "failed";
  logs: string[];
  review?: string;
  error?: string;
}

interface ConsolidatedReviewSummaryProps {
  teamSlugOrId: string;
  agentStates: Record<string, AgentReviewState>;
  taskRuns: Doc<"taskRuns">[];
}

export function ConsolidatedReviewSummary({
  teamSlugOrId,
  agentStates,
  taskRuns,
}: ConsolidatedReviewSummaryProps) {
  const agents = Object.values(agentStates);
  const completedAgents = agents.filter((a) => a.status === "completed");
  const runningAgents = agents.filter(
    (a) => a.status === "running" || a.status === "starting"
  );
  const failedAgents = agents.filter((a) => a.status === "failed");

  // Get crowned run if any
  const crownedRun = useMemo(() => {
    return taskRuns.find((run) => run.isCrowned);
  }, [taskRuns]);

  // Calculate overall status
  const overallStatus = useMemo(() => {
    if (failedAgents.length === agents.length) return "failed";
    if (completedAgents.length === agents.length) return "completed";
    if (runningAgents.length > 0) return "running";
    if (completedAgents.length > 0) return "partial";
    return "idle";
  }, [agents.length, completedAgents.length, runningAgents.length, failedAgents.length]);

  return (
    <div className="flex h-full flex-col overflow-auto bg-white p-6 dark:bg-neutral-950">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
            Consolidated Review
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Multi-agent analysis of the pull request
          </p>
        </div>
        <StatusBadge status={overallStatus} />
      </div>

      {/* Progress section */}
      <div className="mb-6 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span className="text-neutral-600 dark:text-neutral-400">
            Review Progress
          </span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">
            {completedAgents.length} / {agents.length} agents complete
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className={cn(
              "h-full transition-all duration-500",
              overallStatus === "completed"
                ? "bg-emerald-500"
                : overallStatus === "failed"
                  ? "bg-rose-500"
                  : "bg-blue-500"
            )}
            style={{
              width: `${(completedAgents.length / Math.max(agents.length, 1)) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Agent sections */}
      <div className="space-y-4">
        {agents.map((agent) => (
          <AgentReviewSection
            key={agent.agentName}
            agent={agent}
            taskRun={taskRuns.find((r) => r._id === agent.taskRunId)}
            isCrowned={crownedRun?._id === agent.taskRunId}
            teamSlugOrId={teamSlugOrId}
          />
        ))}
      </div>

      {/* Consolidated insights (when all completed) */}
      {overallStatus === "completed" && (
        <ConsolidatedInsights agents={agents} taskRuns={taskRuns} />
      )}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: "idle" | "running" | "completed" | "partial" | "failed";
}) {
  const config = {
    idle: {
      label: "Not Started",
      icon: Clock,
      className: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800",
    },
    running: {
      label: "In Progress",
      icon: Clock,
      className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    },
    completed: {
      label: "Complete",
      icon: CheckCircle2,
      className:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    },
    partial: {
      label: "Partial",
      icon: AlertTriangle,
      className:
        "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    },
    failed: {
      label: "Failed",
      icon: XCircle,
      className: "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300",
    },
  };

  const { label, icon: Icon, className } = config[status];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        className
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
}

function AgentReviewSection({
  agent,
  taskRun,
  isCrowned,
  teamSlugOrId,
}: {
  agent: AgentReviewState;
  taskRun?: Doc<"taskRuns">;
  isCrowned: boolean;
  teamSlugOrId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Get agent icon based on provider
  const providerIcon = useMemo(() => {
    if (agent.agentName.includes("claude")) return "🟣";
    if (agent.agentName.includes("codex") || agent.agentName.includes("gpt"))
      return "🟢";
    if (agent.agentName.includes("gemini")) return "🔵";
    return "⚪";
  }, [agent.agentName]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition",
        isCrowned
          ? "border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-900/10"
          : "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
      )}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{providerIcon}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-neutral-900 dark:text-neutral-100">
                {agent.agentName}
              </span>
              {isCrowned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  <Sparkles className="h-3 w-3" />
                  Winner
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {agent.status === "idle" && "Waiting to start"}
              {agent.status === "starting" && "Starting up..."}
              {agent.status === "running" && "Analyzing code..."}
              {agent.status === "completed" && "Review complete"}
              {agent.status === "failed" && (agent.error ?? "Review failed")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <AgentStatusIcon status={agent.status} />
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-neutral-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-neutral-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
          {agent.status === "completed" ? (
            <AgentReviewContent
              agent={agent}
              taskRun={taskRun}
              teamSlugOrId={teamSlugOrId}
            />
          ) : agent.status === "failed" ? (
            <div className="text-sm text-rose-600 dark:text-rose-400">
              {agent.error ?? "Review failed unexpectedly"}
            </div>
          ) : (
            <div className="text-sm text-neutral-500 dark:text-neutral-400">
              {agent.logs.length > 0 ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">
                  {agent.logs.slice(-20).join("")}
                </pre>
              ) : (
                "Waiting for output..."
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentStatusIcon({
  status,
}: {
  status: AgentReviewState["status"];
}) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="h-5 w-5 text-emerald-500" />;
    case "failed":
      return <XCircle className="h-5 w-5 text-rose-500" />;
    case "running":
    case "starting":
      return (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
      );
    default:
      return <Clock className="h-5 w-5 text-neutral-400" />;
  }
}

function AgentReviewContent({
  agent,
  taskRun,
  teamSlugOrId: _teamSlugOrId,
}: {
  agent: AgentReviewState;
  taskRun?: Doc<"taskRuns">;
  teamSlugOrId: string;
}) {
  // Extract review from logs or summary
  const reviewContent = useMemo(() => {
    if (taskRun?.summary) return taskRun.summary;
    if (agent.review) return agent.review;

    // Try to extract from logs (last meaningful output)
    if (agent.logs.length > 0) {
      const fullLog = agent.logs.join("");
      // Look for common review patterns
      const summaryMatch = fullLog.match(/## Summary[\s\S]*$/);
      if (summaryMatch) return summaryMatch[0];
      // Return last 500 chars as fallback
      return fullLog.slice(-500);
    }

    return "Review content not available";
  }, [agent, taskRun]);

  return (
    <div className="prose prose-sm prose-neutral max-w-none dark:prose-invert">
      <div className="whitespace-pre-wrap text-sm">{reviewContent}</div>

      {/* Links to PR and diff if available */}
      {taskRun?.pullRequestUrl && (
        <div className="mt-4 flex gap-3">
          <a
            href={taskRun.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            View PR →
          </a>
        </div>
      )}
    </div>
  );
}

function ConsolidatedInsights({
  agents,
  taskRuns: _taskRuns,
}: {
  agents: AgentReviewState[];
  taskRuns: Doc<"taskRuns">[];
}) {
  // This would ideally use an LLM to consolidate insights
  // For now, show a simple summary
  const completedCount = agents.filter((a) => a.status === "completed").length;

  return (
    <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-800 dark:bg-emerald-900/20">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        <h2 className="text-lg font-semibold text-emerald-900 dark:text-emerald-100">
          Consolidated Insights
        </h2>
      </div>
      <p className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">
        Analysis complete from {completedCount} agent
        {completedCount !== 1 ? "s" : ""}. Review each agent's feedback above
        for detailed findings.
      </p>

      {/* Common themes would be extracted here */}
      <div className="mt-4 space-y-2">
        <div className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
          Review Checklist:
        </div>
        <ul className="list-inside list-disc space-y-1 text-sm text-emerald-700 dark:text-emerald-300">
          <li>Check each agent's findings for unique perspectives</li>
          <li>Look for consensus on critical issues</li>
          <li>Address any security or performance concerns</li>
          <li>Review suggested improvements</li>
        </ul>
      </div>
    </div>
  );
}
