import { GitHubIcon } from "@/components/icons/github";
import { api } from "@cmux/convex/api";
import { Link } from "@tanstack/react-router";
import { useQuery as useConvexQuery } from "convex/react";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import {
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { SidebarListItem } from "./SidebarListItem";
import { SidebarProjectGroup } from "./SidebarProjectGroup";
import { SIDEBAR_PRS_DEFAULT_LIMIT } from "./const";
import type {
  SectionPreferences,
  SidebarPreferenceHandlers,
} from "./sidebar-types";
import {
  filterRelevant,
  getGroupDisplayName,
  groupItemsByProject,
  sortItems,
} from "./sidebar-utils";
import type { Doc } from "@cmux/convex/dataModel";

const RELEVANT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const CHRONOLOGICAL_LIST_KEY = "__cmux_chronological_list__";
const CHRONOLOGICAL_INITIAL_DISPLAY_COUNT = 5;

type Props = {
  teamSlugOrId: string;
  preferences: SectionPreferences;
  onPreferencesChange: SidebarPreferenceHandlers;
  limit?: number;
};

export function SidebarPullRequestList({
  teamSlugOrId,
  preferences,
  onPreferencesChange,
  limit = SIDEBAR_PRS_DEFAULT_LIMIT,
}: Props) {
  const prs = useConvexQuery(api.github_prs.listPullRequests, {
    teamSlugOrId,
    state: "open",
    limit,
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const list = useMemo(() => prs ?? [], [prs]);

  const filteredAndSorted = useMemo(() => {
    const relevanceCutoff = Date.now() - RELEVANT_WINDOW_MS;
    const filtered = filterRelevant(list, preferences.showFilter, (pr) => {
      const activityAt = pr.updatedAt ?? pr.createdAt ?? 0;
      return activityAt >= relevanceCutoff;
    });

    return sortItems(filtered, (pr) =>
      preferences.sortBy === "updated"
        ? (pr.updatedAt ?? pr.createdAt ?? 0)
        : (pr.createdAt ?? pr.updatedAt ?? 0)
    );
  }, [list, preferences.showFilter, preferences.sortBy]);

  const grouped = useMemo(
    () => groupItemsByProject(filteredAndSorted, (pr) => pr.repoFullName),
    [filteredAndSorted]
  );
  const groupedEntries = useMemo(() => Array.from(grouped.entries()), [grouped]);
  const isChronologicalExpanded =
    preferences.expandedGroups[CHRONOLOGICAL_LIST_KEY] ?? false;
  const hasChronologicalOverflow =
    filteredAndSorted.length > CHRONOLOGICAL_INITIAL_DISPLAY_COUNT;
  const visibleChronologicalItems =
    hasChronologicalOverflow && !isChronologicalExpanded
      ? filteredAndSorted.slice(0, CHRONOLOGICAL_INITIAL_DISPLAY_COUNT)
      : filteredAndSorted;
  const chronologicalRemainingCount = Math.max(
    0,
    filteredAndSorted.length - visibleChronologicalItems.length
  );

  if (prs === undefined) {
    return (
      <ul className="flex flex-col gap-px" aria-label="Loading pull requests">
        {Array.from({ length: limit }).map((_, index) => (
          <li key={index} className="px-2 py-1.5">
            <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
          </li>
        ))}
      </ul>
    );
  }

  if (filteredAndSorted.length === 0) {
    return (
      <p className="mt-1 pl-2 pr-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
        {preferences.showFilter === "relevant"
          ? "No relevant pull requests"
          : "No pull requests"}
      </p>
    );
  }

  if (preferences.organizeMode === "chronological") {
    return (
      <div className="space-y-px">
        {visibleChronologicalItems.map((pr) => (
          <PullRequestListItem
            key={`${pr.repoFullName}#${pr.number}`}
            pr={pr}
            teamSlugOrId={teamSlugOrId}
            expanded={expanded}
            setExpanded={setExpanded}
          />
        ))}

        {hasChronologicalOverflow ? (
          <button
            type="button"
            onClick={() =>
              onPreferencesChange.toggleGroupExpanded(CHRONOLOGICAL_LIST_KEY)
            }
            className="w-full rounded-sm px-2 py-0.5 text-left text-[11px] text-neutral-500 hover:bg-neutral-200/45 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800/45 dark:hover:text-neutral-200"
          >
            {isChronologicalExpanded
              ? "Show less"
              : `Show more (${chronologicalRemainingCount})`}
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-px">
      {groupedEntries.map(([groupKey, groupItems]) => (
        <SidebarProjectGroup
          key={groupKey}
          groupKey={groupKey}
          displayName={getGroupDisplayName(groupKey)}
          items={groupItems}
          isCollapsed={preferences.collapsedGroups[groupKey] ?? false}
          onToggleCollapse={() => onPreferencesChange.toggleGroupCollapsed(groupKey)}
          isExpanded={preferences.expandedGroups[groupKey] ?? false}
          onToggleExpand={() => onPreferencesChange.toggleGroupExpanded(groupKey)}
          getItemKey={(pr) => `${pr.repoFullName}#${pr.number}`}
          renderItem={(pr) => (
            <PullRequestListItem
              pr={pr}
              teamSlugOrId={teamSlugOrId}
              expanded={expanded}
              setExpanded={setExpanded}
            />
          )}
        />
      ))}
    </div>
  );
}

type PullRequestListItemProps = {
  pr: Doc<"pullRequests">;
  teamSlugOrId: string;
  expanded: Record<string, boolean>;
  setExpanded: Dispatch<SetStateAction<Record<string, boolean>>>;
};

function PullRequestListItem({ pr, teamSlugOrId, expanded, setExpanded }: PullRequestListItemProps) {
  const [owner = "", repo = ""] = pr.repoFullName?.split("/", 2) ?? ["", ""];
  const itemKey = `${pr.repoFullName}#${pr.number}`;
  const isExpanded = expanded[itemKey] ?? false;
  const branchLabel = pr.headRef;

  const secondaryParts = [
    branchLabel,
    `${pr.repoFullName}#${pr.number}`,
    pr.authorLogin,
  ]
    .filter(Boolean)
    .map(String);
  const secondary = secondaryParts.join(" • ");
  const leadingIcon = pr.merged ? (
    <GitMerge className="w-3 h-3 text-purple-500" />
  ) : pr.state === "closed" ? (
    <GitPullRequestClosed className="w-3 h-3 text-red-500" />
  ) : pr.draft ? (
    <GitPullRequestDraft className="w-3 h-3 text-neutral-500" />
  ) : (
    <GitPullRequest className="w-3 h-3 text-[#1f883d] dark:text-[#238636]" />
  );

  const handleToggle = (
    _event?: MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => {
    setExpanded((prev) => ({
      ...prev,
      [itemKey]: !isExpanded,
    }));
  };

  return (
    <div className="rounded-md select-none">
      <Link
        to="/$teamSlugOrId/prs-only/$owner/$repo/$number"
        params={{
          teamSlugOrId,
          owner,
          repo,
          number: String(pr.number),
        }}
        className="group block"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          handleToggle(event);
        }}
      >
        <SidebarListItem
          paddingLeft={10}
          toggle={{
            expanded: isExpanded,
            onToggle: handleToggle,
            visible: true,
          }}
          title={pr.title}
          titleClassName="text-[13px] text-neutral-950 dark:text-neutral-100"
          secondary={secondary || undefined}
          meta={leadingIcon}
        />
      </Link>
      {isExpanded && pr.htmlUrl ? (
        <div className="mt-px flex flex-col" role="group">
          <a
            href={pr.htmlUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              event.stopPropagation();
            }}
            className="mt-px flex w-full items-center rounded-md pr-2 py-1 text-xs transition-colors hover:bg-neutral-200/45 dark:hover:bg-neutral-800/45"
            style={{ paddingLeft: "32px" }}
          >
            <GitHubIcon
              className="mr-2 h-3 w-3 text-neutral-400 grayscale opacity-60"
              aria-hidden
            />
            <span className="text-neutral-600 dark:text-neutral-400">
              GitHub
            </span>
          </a>
        </div>
      ) : null}
    </div>
  );
}

export default SidebarPullRequestList;
