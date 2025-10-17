import { GitHubIcon } from "@/components/icons/github";
import { Link } from "@tanstack/react-router";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
} from "lucide-react";
import { type MouseEvent } from "react";
import { SidebarListItem } from "./SidebarListItem";
import type { Doc } from "@cmux/convex/dataModel";

export function SidebarPullRequestSkeletonRow() {
  return (
    <div className="px-2 py-1.5">
      <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
    </div>
  );
}

export interface SidebarPullRequestListItemProps {
  pr: Doc<"pullRequests">;
  teamSlugOrId: string;
  isExpanded: boolean;
  onToggle: (
    event?: MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => void;
  isActive?: boolean;
}

export function SidebarPullRequestListItem({
  pr,
  teamSlugOrId,
  isExpanded,
  onToggle,
  isActive = false,
}: SidebarPullRequestListItemProps) {
  const [owner = "", repo = ""] = pr.repoFullName?.split("/", 2) ?? ["", ""];
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
    event?: MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => {
    onToggle(event);
  };

  return (
    <div className="rounded-md select-none" data-active={isActive || undefined}>
      <Link
        to="/$teamSlugOrId/prs-only/$owner/$repo/$number"
        params={{
          teamSlugOrId,
          owner,
          repo,
          number: String(pr.number),
        }}
        className="group block"
        data-sidebar-pr-link="true"
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
