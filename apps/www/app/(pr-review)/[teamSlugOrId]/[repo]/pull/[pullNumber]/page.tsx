import { Suspense, use } from "react";
import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
} from "lucide-react";

import { PullRequestDiffViewer } from "@/components/pr/pull-request-diff-viewer";
import {
  fetchPullRequest,
  fetchPullRequestFiles,
  type GithubPullRequest,
  type GithubPullRequestFile,
} from "@/lib/github/fetch-pull-request";
import { isGithubApiError } from "@/lib/github/errors";
import { cn } from "@/lib/utils";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
};

type PageProps = {
  params: Promise<PageParams>;
};

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { teamSlugOrId, repo, pullNumber: pullNumberRaw } = await params;
  const pullNumber = parsePullNumber(pullNumberRaw);

  if (pullNumber === null) {
    return {
      title: `Invalid pull request • ${teamSlugOrId}/${repo}`,
    };
  }

  try {
    const pullRequest = await fetchPullRequest(
      teamSlugOrId,
      repo,
      pullNumber,
    );

    return {
      title: `${pullRequest.title} · #${pullRequest.number} · ${teamSlugOrId}/${repo}`,
      description: pullRequest.body?.slice(0, 160),
    };
  } catch (error) {
    if (isGithubApiError(error) && error.status === 404) {
      return {
        title: `${teamSlugOrId}/${repo} · #${pullNumber}`,
      };
    }

    throw error;
  }
}

export default async function PullRequestPage({ params }: PageProps) {
  const { teamSlugOrId, repo, pullNumber: pullNumberRaw } = await params;
  const pullNumber = parsePullNumber(pullNumberRaw);

  if (pullNumber === null) {
    notFound();
  }

  const pullRequestPromise = fetchPullRequest(
    teamSlugOrId,
    repo,
    pullNumber,
  );
  const pullRequestFilesPromise = fetchPullRequestFiles(
    teamSlugOrId,
    repo,
    pullNumber,
  );

  return (
    <div className="min-h-dvh bg-neutral-50 text-neutral-900">
      <div className="flex w-full flex-col gap-8 px-6 pb-16 pt-10 sm:px-8 lg:px-12">
        <Suspense fallback={<PullRequestHeaderSkeleton />}>
          <PullRequestHeader
            promise={pullRequestPromise}
            owner={teamSlugOrId}
            repo={repo}
          />
        </Suspense>

        <Suspense fallback={<DiffViewerSkeleton />}>
          <PullRequestDiffSection promise={pullRequestFilesPromise} />
        </Suspense>
      </div>
    </div>
  );
}

type PullRequestPromise = ReturnType<typeof fetchPullRequest>;

function PullRequestHeader({
  promise,
  owner,
  repo,
}: {
  promise: PullRequestPromise;
  owner: string;
  repo: string;
}) {
  try {
    const pullRequest = use(promise);
    return (
      <PullRequestHeaderContent pullRequest={pullRequest} owner={owner} repo={repo} />
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "This pull request could not be found or you might not have access to view it."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load pull request"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function PullRequestHeaderContent({
  pullRequest,
  owner,
  repo,
}: {
  pullRequest: GithubPullRequest;
  owner: string;
  repo: string;
}) {
  const statusBadge = getStatusBadge(pullRequest);
  const createdAt = new Date(pullRequest.created_at);
  const updatedAt = new Date(pullRequest.updated_at);

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:justify-between lg:gap-8">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span
              className={cn(
                "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                statusBadge.className,
              )}
            >
              {statusBadge.label}
            </span>
            <span className="font-mono text-neutral-500">
              #{pullRequest.number}
            </span>
            <span className="text-neutral-500">
              {owner}/{repo}
            </span>
          </div>

          <h1 className="mt-3 text-2xl font-semibold leading-tight text-neutral-900 sm:text-3xl">
            {pullRequest.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
            {pullRequest.user?.login ? (
              <span>
                opened by{" "}
                <span className="font-medium text-neutral-900">
                  @{pullRequest.user.login}
                </span>
              </span>
            ) : null}
            <span className="text-neutral-400">•</span>
            <span>
              {formatRelativeTimeFromNow(createdAt)} • {formatDate(createdAt)}
            </span>
            <span className="text-neutral-400">•</span>
            <span>Updated {formatRelativeTimeFromNow(updatedAt)}</span>
          </div>
        </div>

        <aside className="flex flex-col gap-4 text-sm">
          <a
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 font-medium text-neutral-700 shadow-sm transition hover:border-neutral-400 hover:text-neutral-900"
            href={pullRequest.html_url}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
            <ExternalLink className="h-4 w-4" />
          </a>

          <div className="grid grid-cols-3 gap-4 text-center">
            <StatCard
              icon={<GitPullRequest className="h-4 w-4" />}
              label="Files"
              value={pullRequest.changed_files}
            />
            <StatCard
              icon={<GitBranch className="h-4 w-4" />}
              label="Source"
              value={
                pullRequest.head?.label ??
                pullRequest.head?.ref ??
                "unknown"
              }
            />
            <StatCard
              icon={<GitMerge className="h-4 w-4" />}
              label="Target"
              value={
                pullRequest.base?.label ??
                pullRequest.base?.ref ??
                "unknown"
              }
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-700">
            <span className="font-semibold">Δ</span>
            <div className="flex items-center gap-3">
              <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-700">
                +{pullRequest.additions}
              </span>
              <span className="rounded-md bg-rose-100 px-2 py-0.5 text-rose-700">
                -{pullRequest.deletions}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

type PullRequestFilesPromise = ReturnType<typeof fetchPullRequestFiles>;

function PullRequestDiffSection({
  promise,
}: {
  promise: PullRequestFilesPromise;
}) {
  try {
    const files = use(promise);
    const totals = summarizeFiles(files);

    return (
      <section className="flex flex-col gap-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              Files changed
            </h2>
            <p className="text-sm text-neutral-600">
              {totals.fileCount} file{totals.fileCount === 1 ? "" : "s"},{" "}
              {totals.additions} additions, {totals.deletions} deletions
            </p>
          </div>
        </header>
        <PullRequestDiffViewer files={files} />
      </section>
    );
  } catch (error) {
    if (isGithubApiError(error)) {
      const message =
        error.status === 404
          ? "File changes for this pull request could not be retrieved. The pull request may be private or missing."
          : error.message;

      return (
        <ErrorPanel
          title="Unable to load pull request files"
          message={message}
          documentationUrl={error.documentationUrl}
        />
      );
    }

    throw error;
  }
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-neutral-700">
      <span className="text-neutral-500">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="text-sm text-neutral-900">{value}</span>
    </div>
  );
}

function summarizeFiles(files: GithubPullRequestFile[]): {
  fileCount: number;
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (acc, file) => {
      acc.fileCount += 1;
      acc.additions += file.additions;
      acc.deletions += file.deletions;
      return acc;
    },
    { fileCount: 0, additions: 0, deletions: 0 },
  );
}

function getStatusBadge(pullRequest: GithubPullRequest): {
  label: string;
  className: string;
} {
  if (pullRequest.merged) {
    return {
      label: "Merged",
      className: "bg-purple-100 text-purple-700",
    };
  }

  if (pullRequest.state === "closed") {
    return {
      label: "Closed",
      className: "bg-rose-100 text-rose-700",
    };
  }

  if (pullRequest.draft) {
    return {
      label: "Draft",
      className: "bg-neutral-200 text-neutral-700",
    };
  }

  return {
    label: "Open",
    className: "bg-emerald-100 text-emerald-700",
  };
}

function PullRequestHeaderSkeleton() {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
      <div className="animate-pulse space-y-4">
        <div className="h-4 w-32 rounded bg-neutral-200" />
        <div className="h-8 w-3/4 rounded bg-neutral-200" />
        <div className="h-4 w-1/2 rounded bg-neutral-200" />
        <div className="h-4 w-full rounded bg-neutral-200" />
      </div>
    </div>
  );
}

function DiffViewerSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 rounded bg-neutral-200" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-32 rounded-xl border border-neutral-200 bg-neutral-100"
          />
        ))}
      </div>
    </div>
  );
}

function ErrorPanel({
  title,
  message,
  documentationUrl,
}: {
  title: string;
  message: string;
  documentationUrl?: string;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
      <p className="font-semibold">{title}</p>
      <p className="mt-2 leading-relaxed">{message}</p>
      {documentationUrl ? (
        <p className="mt-3 text-xs text-rose-600 underline">
          <Link href={documentationUrl} target="_blank" rel="noreferrer">
            View GitHub documentation
          </Link>
        </p>
      ) : null}
    </div>
  );
}

function parsePullNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) {
    return null;
  }

  const numericValue = Number.parseInt(raw, 10);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return numericValue;
}

function formatRelativeTimeFromNow(date: Date): string {
  const now = Date.now();
  const diffInSeconds = Math.round((now - date.getTime()) / 1000);

  const segments: {
    threshold: number;
    divisor: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { threshold: 45, divisor: 1, unit: "second" },
    { threshold: 2700, divisor: 60, unit: "minute" }, // 45 minutes
    { threshold: 64_800, divisor: 3_600, unit: "hour" }, // 18 hours
    { threshold: 561_600, divisor: 86_400, unit: "day" }, // 6.5 days
    { threshold: 2_419_200, divisor: 604_800, unit: "week" }, // 4 weeks
    { threshold: 28_512_000, divisor: 2_629_746, unit: "month" }, // 11 months
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const segment of segments) {
    if (Math.abs(diffInSeconds) < segment.threshold) {
      const value = Math.round(diffInSeconds / segment.divisor);
      return rtf.format(-value, segment.unit);
    }
  }

  const years = Math.round(diffInSeconds / 31_556_952);
  return rtf.format(-years, "year");
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
