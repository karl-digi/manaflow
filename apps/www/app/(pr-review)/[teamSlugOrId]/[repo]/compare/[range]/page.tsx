import { Suspense, use } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { type Team } from "@stackframe/stack";

import {
  DiffViewerSkeleton,
  ErrorPanel,
  GitHubLinkButton,
  PullRequestChangeSummary,
  PullRequestDiffContent,
  summarizeFiles,
  formatRelativeTimeFromNow,
} from "@/lib/pr/pr-shared";
import type { GithubDiffFile } from "@/components/pr/pull-request-diff-viewer";
import { fetchCompare } from "@/lib/github/fetch-compare";
import type { GithubCompare } from "@/lib/github/fetch-compare";
import { isGithubApiError } from "@/lib/github/errors";
import { stackServerApp } from "@/lib/utils/stack";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  range: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function getFirstTeam(): Promise<Team | null> {
  const teams = await stackServerApp.listTeams();
  const firstTeam = teams[0];
  if (!firstTeam) {
    return null;
  }
  return firstTeam;
}

type ParsedCompareRange = {
  base: string;
  head: string;
  label: string;
};

export function parseCompareRange(range: string): ParsedCompareRange | null {
  const parts = range.split("...");
  if (parts.length !== 2) {
    return null;
  }

  const [base, head] = parts;
  if (!base || !head) {
    return null;
  }

  const label = `${base}...${head}`;
  return { base, head, label };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { teamSlugOrId: githubOwner, repo, range } = await params;
  const parsedRange = parseCompareRange(range);

  if (!parsedRange) {
    return {
      title: `Invalid comparison • ${githubOwner}/${repo}`,
      description: "The provided comparison range is not valid.",
    };
  }

  return {
    title: `Compare ${parsedRange.label} · ${githubOwner}/${repo}`,
    description: `Diff between ${parsedRange.base} and ${parsedRange.head}.`,
  };
}

type ComparePromise = ReturnType<typeof fetchCompare>;

export default async function ComparePage({ params }: PageProps) {
  const user = await stackServerApp.getUser({ or: "redirect" });
  const selectedTeam = user.selectedTeam || (await getFirstTeam());
  if (!selectedTeam) {
    throw notFound();
  }

  const {
    teamSlugOrId: githubOwner,
    repo,
    range,
  } = await params;

  const parsedRange = parseCompareRange(range);
  if (!parsedRange) {
    notFound();
  }

  const basehead = parsedRange.label;
  const comparePromise = fetchCompare(githubOwner, repo, basehead);

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <div className="flex w-full flex-col gap-8 px-6 pb-16 pt-10 sm:px-8 lg:px-12">
        <Suspense fallback={<CompareHeaderSkeleton />}>
          <CompareHeader
            promise={comparePromise}
            githubOwner={githubOwner}
            repo={repo}
            base={parsedRange.base}
            head={parsedRange.head}
          />
        </Suspense>

        <Suspense fallback={<DiffViewerSkeleton />}>
          <CompareDiffSection
            promise={comparePromise}
            githubOwner={githubOwner}
            repo={repo}
            teamSlugOrId={selectedTeam.id}
          />
        </Suspense>
      </div>
    </div>
  );
}

function CompareHeader({
  promise,
  githubOwner,
  repo,
  base,
  head,
}: {
  promise: ComparePromise;
  githubOwner: string;
  repo: string;
  base: string;
  head: string;
}) {
  try {
    const compare = use(promise);
    return (
      <CompareHeaderContent
        compare={compare}
        githubOwner={githubOwner}
        repo={repo}
        base={base}
        head={head}
      />
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "This comparison could not be found or you might not have access to view it."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load comparison"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function CompareHeaderContent({
  compare,
  githubOwner,
  repo,
  base,
  head,
}: {
  compare: GithubCompare;
  githubOwner: string;
  repo: string;
  base: string;
  head: string;
}) {
  const repoFullName = `${githubOwner}/${repo}`;
  const encodedLabel = `${encodeURIComponent(base)}...${encodeURIComponent(
    head
  )}`;
  const githubUrl =
    compare.permalink_url ??
    compare.html_url ??
    `https://github.com/${repoFullName}/compare/${encodedLabel}`;
  const files = extractDiffFiles(compare);
  const totals = summarizeFiles(files);
  const totalCommits = compare.total_commits ?? compare.commits?.length ?? 0;
  const aheadBy = compare.ahead_by ?? 0;
  const behindBy = compare.behind_by ?? 0;
  const headCommit = compare.commits?.[compare.commits.length - 1] ?? null;
  const updatedAtIso =
    headCommit?.commit?.committer?.date ?? headCommit?.commit?.author?.date;
  const updatedAtLabel = updatedAtIso
    ? formatRelativeTimeFromNow(new Date(updatedAtIso))
    : null;

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
            <span>{repoFullName}</span>
            <span className="text-neutral-400">•</span>
            <span>
              {totalCommits} commit{totalCommits === 1 ? "" : "s"}
            </span>
            <span className="text-neutral-400">•</span>
            <span>
              {aheadBy} ahead / {behindBy} behind
            </span>
          </div>

          <h1 className="mt-2 text-xl font-semibold leading-tight text-neutral-900">
            Compare {base}...{head}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
            {updatedAtLabel ? (
              <>
                <span>Head updated {updatedAtLabel}</span>
                <span className="text-neutral-400">•</span>
              </>
            ) : null}
            <span>{base}</span>
            <span className="text-neutral-400">→</span>
            <span>{head}</span>
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 text-xs lg:items-end">
          <PullRequestChangeSummary
            changedFiles={files.length}
            additions={totals.additions}
            deletions={totals.deletions}
          />
          <GitHubLinkButton href={githubUrl} />
        </div>
      </div>
    </section>
  );
}

function CompareDiffSection({
  promise,
  githubOwner,
  repo,
  teamSlugOrId,
}: {
  promise: ComparePromise;
  githubOwner: string;
  repo: string;
  teamSlugOrId: string;
}) {
  try {
    const compare = use(promise);
    const files = extractDiffFiles(compare);
    const totals = summarizeFiles(files);
    const repoFullName = `${githubOwner}/${repo}`;
    const commitRef = compare.commits?.[compare.commits.length - 1]?.sha;

    if (files.length === 0) {
      return (
        <section className="rounded-xl border border-neutral-200 bg-white p-6 text-sm text-neutral-600 shadow-sm">
          This comparison does not introduce any file changes.
        </section>
      );
    }

    return (
      <PullRequestDiffContent
        files={files}
        fileCount={totals.fileCount}
        additions={totals.additions}
        deletions={totals.deletions}
        teamSlugOrId={teamSlugOrId}
        repoFullName={repoFullName}
        commitRef={commitRef}
      />
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "File changes for this comparison could not be retrieved."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load comparison files"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function extractDiffFiles(compare: GithubCompare): GithubDiffFile[] {
  if (!compare.files) {
    return [];
  }

  return compare.files.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    previous_filename: file.previous_filename,
    patch: file.patch ?? undefined,
  }));
}

function CompareHeaderSkeleton() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-24 rounded bg-neutral-200" />
        <div className="h-8 w-2/3 rounded bg-neutral-200" />
        <div className="h-4 w-1/2 rounded bg-neutral-200" />
        <div className="h-4 w-1/3 rounded bg-neutral-200" />
      </div>
    </div>
  );
}
