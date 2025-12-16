"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { cn } from "@/lib/utils";
import { Terminal, Code, Eye, GitCompare, ExternalLink } from "lucide-react";

interface AgentReviewState {
  agentName: string;
  taskRunId?: Id<"taskRuns">;
  status: "idle" | "starting" | "running" | "completed" | "failed";
  logs: string[];
  review?: string;
  error?: string;
}

interface AgentReviewPanelProps {
  teamSlugOrId: string;
  agentName: string;
  state?: AgentReviewState;
  onLogChunk?: (chunk: string) => void;
}

type ViewTab = "terminal" | "vscode" | "diff" | "browser";

export function AgentReviewPanel({
  teamSlugOrId,
  agentName: _agentName,
  state,
  onLogChunk: _onLogChunk,
}: AgentReviewPanelProps) {
  const [activeTab, setActiveTab] = useState<ViewTab>("terminal");
  const terminalRef = useRef<HTMLDivElement>(null);

  // Fetch the task run details
  const taskRun = useQuery(
    api.taskRuns.get,
    state?.taskRunId
      ? { teamSlugOrId, id: state.taskRunId }
      : "skip"
  );

  // Get VSCode URL from task run
  const vscodeUrl = taskRun?.vscode?.workspaceUrl;

  // Get browser preview URL if available
  const browserUrl = useMemo(() => {
    if (taskRun?.customPreviews && taskRun.customPreviews.length > 0) {
      return taskRun.customPreviews[0]?.url;
    }
    if (taskRun?.networking && taskRun.networking.length > 0) {
      const running = taskRun.networking.find((n) => n.status === "running");
      return running?.url;
    }
    return null;
  }, [taskRun]);

  // Auto-scroll terminal to bottom
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [state?.logs]);

  const tabs: { id: ViewTab; label: string; icon: React.ReactNode }[] = [
    { id: "terminal", label: "Terminal", icon: <Terminal className="h-4 w-4" /> },
    { id: "vscode", label: "VSCode", icon: <Code className="h-4 w-4" /> },
    { id: "diff", label: "Git Diff", icon: <GitCompare className="h-4 w-4" /> },
    { id: "browser", label: "Browser", icon: <Eye className="h-4 w-4" /> },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex items-center border-b border-neutral-200 bg-white px-4 dark:border-neutral-800 dark:bg-neutral-900">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition",
                activeTab === tab.id
                  ? "border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100"
                  : "border-transparent text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* External link to full view */}
        {vscodeUrl && (
          <a
            href={vscodeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Open Full View
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "terminal" && (
          <TerminalView
            ref={terminalRef}
            logs={state?.logs ?? []}
            status={state?.status ?? "idle"}
            taskRunId={state?.taskRunId}
            teamSlugOrId={teamSlugOrId}
          />
        )}

        {activeTab === "vscode" && (
          <VSCodeView url={vscodeUrl} status={state?.status ?? "idle"} />
        )}

        {activeTab === "diff" && (
          <DiffView
            taskRunId={state?.taskRunId}
            teamSlugOrId={teamSlugOrId}
            status={state?.status ?? "idle"}
          />
        )}

        {activeTab === "browser" && (
          <BrowserView url={browserUrl} status={state?.status ?? "idle"} />
        )}
      </div>
    </div>
  );
}

// Terminal view - shows agent logs
import React from "react";

const TerminalView = React.forwardRef<
  HTMLDivElement,
  {
    logs: string[];
    status: AgentReviewState["status"];
    taskRunId?: Id<"taskRuns">;
    teamSlugOrId: string;
  }
>(function TerminalView({ logs, status, taskRunId, teamSlugOrId }, ref) {
  // If no logs yet and we have a taskRunId, try to fetch from convex
  const storedLogs = useQuery(
    api.taskRunLogChunks.getChunks,
    taskRunId ? { teamSlugOrId, taskRunId } : "skip"
  );

  // Extract content from stored log chunks
  const displayLogs = logs.length > 0
    ? logs
    : (storedLogs ?? []).map((chunk) => chunk.content);

  return (
    <div
      ref={ref}
      className="h-full overflow-auto bg-neutral-950 p-4 font-mono text-sm text-neutral-200"
    >
      {displayLogs.length === 0 ? (
        <div className="flex h-full items-center justify-center text-neutral-500">
          {status === "idle" && "Waiting to start..."}
          {status === "starting" && "Starting agent..."}
          {status === "running" && "Connecting to terminal..."}
          {status === "completed" && "Review completed - no logs available"}
          {status === "failed" && "Review failed - no logs available"}
        </div>
      ) : (
        <pre className="whitespace-pre-wrap break-words">
          {displayLogs.map((log, i) => (
            <span key={i}>{log}</span>
          ))}
        </pre>
      )}
    </div>
  );
});

// VSCode view - embedded VSCode instance
function VSCodeView({
  url,
  status,
}: {
  url?: string | null;
  status: AgentReviewState["status"];
}) {
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <div className="text-center">
          <Code className="mx-auto h-12 w-12 text-neutral-400" />
          <p className="mt-2 text-sm text-neutral-500">
            {status === "idle" && "Start a review to open VSCode"}
            {status === "starting" && "Starting VSCode..."}
            {status === "running" && "Loading VSCode..."}
            {(status === "completed" || status === "failed") &&
              "VSCode session ended"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      className="h-full w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
      allow="clipboard-read; clipboard-write"
    />
  );
}

// Diff view - shows git diff
function DiffView({
  taskRunId,
  teamSlugOrId,
  status,
}: {
  taskRunId?: Id<"taskRuns">;
  teamSlugOrId: string;
  status: AgentReviewState["status"];
}) {
  const taskRun = useQuery(
    api.taskRuns.get,
    taskRunId ? { teamSlugOrId, id: taskRunId } : "skip"
  );

  if (!taskRunId || !taskRun) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <div className="text-center">
          <GitCompare className="mx-auto h-12 w-12 text-neutral-400" />
          <p className="mt-2 text-sm text-neutral-500">
            {status === "idle" && "Start a review to see diff"}
            {status === "starting" && "Preparing workspace..."}
            {status === "running" && "Changes will appear here..."}
            {(status === "completed" || status === "failed") &&
              "No changes available"}
          </p>
        </div>
      </div>
    );
  }

  // This would ideally use the GitDiffViewer component
  // For now, show a placeholder with link to diff view
  const diffUrl = taskRun.vscode?.workspaceUrl
    ? `${taskRun.vscode.workspaceUrl.replace("/vscode", "")}/diff`
    : null;

  return (
    <div className="flex h-full flex-col items-center justify-center bg-neutral-100 dark:bg-neutral-900">
      <GitCompare className="mx-auto h-12 w-12 text-neutral-400" />
      <p className="mt-2 text-sm text-neutral-500">
        Branch: {taskRun.newBranch ?? "unknown"}
      </p>
      {diffUrl && (
        <a
          href={diffUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex items-center gap-1.5 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          View Full Diff
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </div>
  );
}

// Browser view - embedded browser preview
function BrowserView({
  url,
  status,
}: {
  url?: string | null;
  status: AgentReviewState["status"];
}) {
  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-900">
        <div className="text-center">
          <Eye className="mx-auto h-12 w-12 text-neutral-400" />
          <p className="mt-2 text-sm text-neutral-500">
            {status === "idle" && "Start a review to see preview"}
            {status === "starting" && "Starting preview server..."}
            {status === "running" && "Preview will appear here..."}
            {(status === "completed" || status === "failed") &&
              "No preview available"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      className="h-full w-full border-0"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  );
}
