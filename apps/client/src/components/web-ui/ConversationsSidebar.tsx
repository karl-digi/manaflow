import { Link } from "@tanstack/react-router";
import {
  Bot,
  Cpu,
  Sparkles,
  TerminalSquare,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import clsx from "clsx";
import type { Doc } from "@cmux/convex/dataModel";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";

export type ConversationScope = "mine" | "all";

export type ConversationListEntry = {
  conversation: Doc<"conversations">;
  preview: {
    text: string | null;
    kind: "text" | "image" | "resource" | "empty";
  };
  unread: boolean;
  latestMessageAt: number;
};

interface ConversationsSidebarProps {
  teamSlugOrId: string;
  scope: ConversationScope;
  onScopeChange: (scope: ConversationScope) => void;
  entries: ConversationListEntry[];
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
  onLoadMore: (count: number) => void;
  activeConversationId?: string;
  onNewConversation: () => void;
  isCreating: boolean;
}

const PAGE_SIZE = 30;

const providerMeta: Record<
  string,
  { label: string; icon: LucideIcon; tone: string }
> = {
  claude: { label: "Claude", icon: Bot, tone: "text-emerald-500" },
  codex: { label: "Codex", icon: TerminalSquare, tone: "text-sky-500" },
  gemini: { label: "Gemini", icon: Sparkles, tone: "text-amber-500" },
  opencode: { label: "OpenCode", icon: Cpu, tone: "text-violet-500" },
};

function formatTimestamp(value: number | null | undefined): string {
  if (!value || Number.isNaN(value)) return "";
  const now = Date.now();
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isToday = date.toDateString() === today.toDateString();
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const days = Math.floor((now - value) / 86_400_000);

  if (isToday) {
    return date.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (isYesterday) return "Yesterday";
  if (days < 7) {
    return date.toLocaleDateString(undefined, { weekday: "long" });
  }
  return date.toLocaleDateString(undefined, {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

function getProviderMeta(providerId: string | undefined): {
  label: string;
  icon: LucideIcon;
  tone: string;
} {
  if (providerId && providerMeta[providerId]) {
    return providerMeta[providerId];
  }
  return { label: providerId ?? "Agent", icon: Cpu, tone: "text-neutral-500" };
}

export function ConversationsSidebar({
  teamSlugOrId,
  scope,
  onScopeChange,
  entries,
  status,
  onLoadMore,
  activeConversationId,
  onNewConversation,
  isCreating,
}: ConversationsSidebarProps) {
  const canLoadMore = status === "CanLoadMore";

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const isLoadingMore = status === "LoadingMore";

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!canLoadMore || isLoadingMore) return;
      const remaining =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      if (remaining < 160) {
        onLoadMore(PAGE_SIZE);
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [canLoadMore, isLoadingMore, onLoadMore]);

  return (
    <aside className="flex h-dvh w-full flex-col border-b border-neutral-200/70 bg-white dark:border-neutral-800/70 dark:bg-neutral-950 md:w-[320px] md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-5 pt-6">
        <div>
          <div className="text-[11px] font-semibold text-neutral-400 dark:text-neutral-500">
            Conversations
          </div>
          <div className="mt-1 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            {teamSlugOrId}
          </div>
        </div>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={isCreating}
          className={clsx(
            "flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200/80 bg-white text-neutral-700 transition",
            "hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800/80 dark:bg-neutral-900 dark:text-neutral-200",
            "disabled:cursor-not-allowed disabled:opacity-60"
          )}
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="mt-5 px-5">
        <div className="flex rounded-full border border-neutral-200/80 bg-neutral-100/70 p-1 text-xs dark:border-neutral-800/80 dark:bg-neutral-900/70">
          {([
            { value: "mine", label: "Mine" },
            { value: "all", label: "All" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onScopeChange(option.value)}
              className={clsx(
                "flex-1 rounded-full px-3 py-2 text-[11px] font-semibold transition",
                scope === option.value
                  ? "bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100"
                  : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={scrollRef} className="mt-6 flex-1 overflow-y-auto pb-6">
        {entries.length === 0 && status === "LoadingFirstPage" ? (
          <div className="mx-4 rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-4 text-sm text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-400">
            Loading conversations…
          </div>
        ) : entries.length === 0 ? (
          <div className="mx-4 rounded-2xl border border-neutral-200/70 bg-neutral-50/80 p-4 text-sm text-neutral-500 dark:border-neutral-800/70 dark:bg-neutral-900/60 dark:text-neutral-400">
            No conversations yet. Start a new one to see it here.
          </div>
        ) : (
          <ConversationList
            entries={entries}
            teamSlugOrId={teamSlugOrId}
            activeConversationId={activeConversationId}
            status={status}
          />
        )}
      </div>
    </aside>
  );
}

interface ConversationListProps {
  teamSlugOrId: string;
  entries: ConversationListEntry[];
  activeConversationId?: string;
  status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted";
}

function ConversationList({
  teamSlugOrId,
  entries,
  activeConversationId,
  status,
}: ConversationListProps) {
  const isLoadingMore = status === "LoadingMore";

  return (
    <div>
      {entries.map((entry) => (
        <ConversationRow
          key={entry.conversation._id}
          entry={entry}
          teamSlugOrId={teamSlugOrId}
          isActive={activeConversationId === entry.conversation._id}
        />
      ))}
      {isLoadingMore ? (
        <div className="py-3 text-center text-xs text-neutral-400">
          Loading more…
        </div>
      ) : null}
      {status === "Exhausted" ? (
        <div className="flex items-center justify-center gap-2 py-2 text-[11px] text-neutral-400">
          <ChevronDown className="h-3 w-3" aria-hidden />
          End
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({
  entry,
  teamSlugOrId,
  isActive,
}: {
  entry: ConversationListEntry;
  teamSlugOrId: string;
  isActive: boolean;
}) {
  const { conversation, preview, unread, latestMessageAt } = entry;
  const provider = getProviderMeta(conversation.providerId);
  const timeLabel = formatTimestamp(latestMessageAt);
  const subtitle =
    preview.text ??
    (preview.kind === "image"
      ? "Image"
      : preview.kind === "resource"
        ? "Attachment"
        : "No messages yet");

  return (
    <Link
      to="/t/$teamSlugOrId/$conversationId"
      params={{
        teamSlugOrId,
        conversationId: conversation._id,
      }}
      className={clsx(
        "group flex items-start gap-3 border-b border-neutral-200/70 px-4 py-2.5 transition-colors",
        "hover:bg-neutral-100/80 dark:border-neutral-800/70 dark:hover:bg-neutral-900/60",
        isActive && "bg-neutral-200/60 dark:bg-neutral-900"
      )}
      activeProps={{
        className: "bg-neutral-200/60 dark:bg-neutral-900",
      }}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-neutral-200/80 bg-white text-neutral-700 dark:border-neutral-800/80 dark:bg-neutral-950/70 dark:text-neutral-200">
        <provider.icon className={clsx("h-4 w-4", provider.tone)} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[14px] font-semibold text-neutral-900 dark:text-neutral-100">
            {provider.label}
          </span>
          <div className="flex items-center gap-2">
            {unread ? (
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            ) : null}
            <span className="text-[12px] text-neutral-500 dark:text-neutral-400">
              {timeLabel}
            </span>
            <ChevronRight className="h-3 w-3 text-neutral-400 dark:text-neutral-600" />
          </div>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[12px] text-neutral-500 dark:text-neutral-400">
          {subtitle}
        </div>
      </div>
    </Link>
  );
}
