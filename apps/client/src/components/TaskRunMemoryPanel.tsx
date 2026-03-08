import { useState, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { Brain, FileText, Calendar, CheckSquare, Mail, AlertCircle, Clock, ArrowRight, Megaphone, MessageSquare, CheckCheck } from "lucide-react";
import clsx from "clsx";

export interface TaskRunMemoryPanelProps {
  teamSlugOrId: string;
  taskRunId: Id<"taskRuns"> | null | undefined;
}

type MemoryType = "knowledge" | "daily" | "tasks" | "mailbox";

const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  knowledge: "Knowledge",
  daily: "Daily Logs",
  tasks: "Tasks",
  mailbox: "Mailbox",
};

const MEMORY_TYPE_ICONS: Record<MemoryType, React.ElementType> = {
  knowledge: Brain,
  daily: Calendar,
  tasks: CheckSquare,
  mailbox: Mail,
};

export function TaskRunMemoryPanel({ teamSlugOrId, taskRunId }: TaskRunMemoryPanelProps) {
  const [selectedType, setSelectedType] = useState<MemoryType>("knowledge");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const snapshots = useQuery(
    api.agentMemoryQueries.getByTaskRun,
    taskRunId ? { teamSlugOrId, taskRunId } : "skip"
  );

  // Group snapshots by type
  const snapshotsByType = useMemo(() => {
    if (!snapshots) return null;

    const grouped: Record<MemoryType, typeof snapshots> = {
      knowledge: [],
      daily: [],
      tasks: [],
      mailbox: [],
    };

    for (const snapshot of snapshots) {
      const type = snapshot.memoryType as MemoryType;
      if (grouped[type]) {
        grouped[type].push(snapshot);
      }
    }

    // Sort daily logs by date (newest first)
    grouped.daily.sort((a, b) => {
      const dateA = a.date ?? "";
      const dateB = b.date ?? "";
      return dateB.localeCompare(dateA);
    });

    return grouped;
  }, [snapshots]);

  // Get available dates for daily logs
  const dailyDates = useMemo(() => {
    if (!snapshotsByType?.daily) return [];
    return snapshotsByType.daily.map((s) => s.date).filter((d): d is string => Boolean(d));
  }, [snapshotsByType?.daily]);

  // Get the selected snapshot content
  const selectedContent = useMemo(() => {
    if (!snapshotsByType) return null;

    if (selectedType === "daily") {
      // For daily logs, show the selected date's content
      const dateToShow = selectedDate ?? dailyDates[0];
      if (!dateToShow) return null;
      const snapshot = snapshotsByType.daily.find((s) => s.date === dateToShow);
      return snapshot ?? null;
    }

    // For other types, get the first (and only) snapshot
    return snapshotsByType[selectedType][0] ?? null;
  }, [snapshotsByType, selectedType, selectedDate, dailyDates]);

  // Empty state - no task run selected (check before loading to avoid spinner when skipped)
  if (!taskRunId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-neutral-500 dark:text-neutral-400">
        <Brain className="size-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
          No run selected
        </div>
        <p className="text-xs">Select a task run to view its memory</p>
      </div>
    );
  }

  // Loading state (only shown when taskRunId exists but data is loading)
  if (snapshots === undefined) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
        <div className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-300" />
        <span className="text-sm">Loading memory...</span>
      </div>
    );
  }

  // Empty state - no memory synced
  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-neutral-500 dark:text-neutral-400">
        <Brain className="size-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
          No memory synced
        </div>
        <p className="text-xs">Memory will appear here after the agent completes</p>
      </div>
    );
  }

  const renderTabButton = (type: MemoryType) => {
    const Icon = MEMORY_TYPE_ICONS[type];
    const count = snapshotsByType?.[type]?.length ?? 0;
    const isActive = selectedType === type;

    return (
      <button
        key={type}
        type="button"
        onClick={() => {
          setSelectedType(type);
          if (type === "daily") {
            setSelectedDate(null); // Reset to latest date
          }
        }}
        className={clsx(
          "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors",
          isActive
            ? "bg-neutral-100 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
            : "text-neutral-600 hover:bg-neutral-50 dark:text-neutral-400 dark:hover:bg-neutral-800/50",
          count === 0 && "opacity-50"
        )}
        disabled={count === 0}
      >
        <Icon className="size-3.5" />
        {MEMORY_TYPE_LABELS[type]}
        {count > 1 && (
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
            ({count})
          </span>
        )}
      </button>
    );
  };

  const renderContent = () => {
    if (!selectedContent) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-500 dark:text-neutral-400">
          <FileText className="size-6 text-neutral-400 dark:text-neutral-500" />
          <span className="text-sm">No {MEMORY_TYPE_LABELS[selectedType].toLowerCase()} content</span>
        </div>
      );
    }

    const { content, truncated, agentName, createdAt } = selectedContent;

    return (
      <div className="flex h-full min-h-0 flex-col">
        {/* Metadata bar */}
        <div className="flex items-center gap-3 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
          {agentName && (
            <span className="flex items-center gap-1">
              <span className="font-medium text-neutral-600 dark:text-neutral-300">Agent:</span>
              {agentName}
            </span>
          )}
          {createdAt && (
            <span className="flex items-center gap-1">
              <Clock className="size-3" />
              {new Date(createdAt).toLocaleString()}
            </span>
          )}
          {truncated && (
            <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <AlertCircle className="size-3" />
              Truncated
            </span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {selectedType === "mailbox" ? (
            // Mailbox - render messages in friendly format, fallback to JSON
            (() => {
              const messages = parseMailboxContent(content);
              if (messages) {
                return <MailboxMessageList messages={messages} />;
              }
              // Fallback to raw JSON if parsing fails
              return (
                <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-700 dark:text-neutral-300">
                  {formatJsonContent(content)}
                </pre>
              );
            })()
          ) : selectedType === "tasks" ? (
            // Tasks - render as formatted JSON
            <pre className="whitespace-pre-wrap font-mono text-xs text-neutral-700 dark:text-neutral-300">
              {formatJsonContent(content)}
            </pre>
          ) : (
            // Markdown content - render as preformatted text with basic styling
            <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm text-neutral-700 dark:text-neutral-300">
                {content}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1.5 dark:border-neutral-800">
        {(["knowledge", "daily", "tasks", "mailbox"] as MemoryType[]).map(renderTabButton)}

        {/* Date selector for daily logs */}
        {selectedType === "daily" && dailyDates.length > 1 && (
          <select
            value={selectedDate ?? dailyDates[0] ?? ""}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="ml-auto rounded border border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800"
          >
            {dailyDates.map((date) => (
              <option key={date} value={date}>
                {date}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0">
        {renderContent()}
      </div>
    </div>
  );
}

function formatJsonContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    // If not valid JSON, return as-is
    return content;
  }
}

// Message type for mailbox entries
interface MailboxMessage {
  id: string;
  from: string;
  to: string;
  type?: "handoff" | "request" | "status";
  message: string;
  timestamp: string;
  read?: boolean;
}

// Parse mailbox content and extract messages
function parseMailboxContent(content: string): MailboxMessage[] | null {
  try {
    const parsed = JSON.parse(content);
    if (parsed.messages && Array.isArray(parsed.messages)) {
      return parsed.messages;
    }
    return null;
  } catch {
    return null;
  }
}

// Get icon for message type
function getMessageTypeIcon(type?: string) {
  switch (type) {
    case "handoff":
      return ArrowRight;
    case "request":
      return MessageSquare;
    case "status":
      return Megaphone;
    default:
      return Mail;
  }
}

// Get color classes for message type
function getMessageTypeColor(type?: string) {
  switch (type) {
    case "handoff":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
    case "request":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400";
    case "status":
      return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
    default:
      return "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400";
  }
}

// Render mailbox messages in a friendly format
function MailboxMessageList({ messages }: { messages: MailboxMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-neutral-500 dark:text-neutral-400">
        <Mail className="size-6 text-neutral-400 dark:text-neutral-500" />
        <span className="text-sm">No messages in mailbox</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {messages.map((msg) => {
        const Icon = getMessageTypeIcon(msg.type);
        const typeColor = getMessageTypeColor(msg.type);
        const timestamp = new Date(msg.timestamp).toLocaleString();
        const isBroadcast = msg.to === "*";

        return (
          <div
            key={msg.id}
            className={clsx(
              "rounded-lg border p-3",
              msg.read
                ? "border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/50"
                : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            )}
          >
            {/* Header row */}
            <div className="flex items-center gap-2 text-xs">
              {/* Message type badge */}
              <span className={clsx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium", typeColor)}>
                <Icon className="size-3" />
                {msg.type ?? "message"}
              </span>

              {/* From/To */}
              <span className="text-neutral-500 dark:text-neutral-400">
                <span className="font-medium text-neutral-700 dark:text-neutral-300">{msg.from}</span>
                {" "}
                <ArrowRight className="inline-block size-3" />
                {" "}
                <span className="font-medium text-neutral-700 dark:text-neutral-300">
                  {isBroadcast ? "all agents" : msg.to}
                </span>
              </span>

              {/* Read indicator */}
              {msg.read && (
                <span className="ml-auto flex items-center gap-1 text-neutral-400 dark:text-neutral-500">
                  <CheckCheck className="size-3" />
                  read
                </span>
              )}
            </div>

            {/* Message content */}
            <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap">
              {msg.message}
            </div>

            {/* Timestamp */}
            <div className="mt-2 flex items-center gap-1 text-xs text-neutral-400 dark:text-neutral-500">
              <Clock className="size-3" />
              {timestamp}
            </div>
          </div>
        );
      })}
    </div>
  );
}
