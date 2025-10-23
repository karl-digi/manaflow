import Link from "next/link";
import { ExternalLink, GitPullRequest } from "lucide-react";

import {
  PullRequestDiffViewer,
  type GithubDiffFile,
} from "@/components/pr/pull-request-diff-viewer";

export function summarizeFiles(files: GithubDiffFile[]): {
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

export function PullRequestDiffContent({
  files,
  fileCount,
  additions,
  deletions,
  teamSlugOrId,
  repoFullName,
  pullNumber,
  commitRef,
}: {
  files: GithubDiffFile[];
  fileCount: number;
  additions: number;
  deletions: number;
  teamSlugOrId: string;
  repoFullName: string;
  pullNumber?: number;
  commitRef?: string;
}) {
  return (
    <section className="flex flex-col gap-4">
      <PullRequestDiffSummary
        fileCount={fileCount}
        additions={additions}
        deletions={deletions}
      />
      <PullRequestDiffViewerWrapper
        files={files}
        teamSlugOrId={teamSlugOrId}
        repoFullName={repoFullName}
        pullNumber={pullNumber}
        commitRef={commitRef}
      />
    </section>
  );
}

export function PullRequestDiffSummary({
  fileCount,
  additions,
  deletions,
}: {
  fileCount: number;
  additions: number;
  deletions: number;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-neutral-900">
          Files changed
        </h2>
        <p className="text-sm text-neutral-600">
          {fileCount} file{fileCount === 1 ? "" : "s"}, {additions} additions, {deletions} deletions
        </p>
      </div>
    </header>
  );
}

export function PullRequestDiffViewerWrapper({
  files,
  teamSlugOrId,
  repoFullName,
  pullNumber,
  commitRef,
}: {
  files: GithubDiffFile[];
  teamSlugOrId: string;
  repoFullName: string;
  pullNumber?: number;
  commitRef?: string;
}) {
  return (
    <PullRequestDiffViewer
      files={files}
      teamSlugOrId={teamSlugOrId}
      repoFullName={repoFullName}
      prNumber={pullNumber}
      commitRef={commitRef}
    />
  );
}

export function PullRequestChangeSummary({
  changedFiles,
  additions,
  deletions,
}: {
  changedFiles: number;
  additions: number;
  deletions: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-neutral-600">
        <GitPullRequest className="inline h-3 w-3" /> {changedFiles}
      </span>
      <span className="text-neutral-400">•</span>
      <span className="text-emerald-700">+{additions}</span>
      <span className="text-rose-700">-{deletions}</span>
    </div>
  );
}

export function GitHubLinkButton({ href }: { href: string }) {
  return (
    <a
      className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-medium text-neutral-700 transition hover:border-neutral-400 hover:text-neutral-900"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      GitHub
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

export function DiffViewerSkeleton() {
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

export function ErrorPanel({
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

export function formatRelativeTimeFromNow(date: Date): string {
  const now = Date.now();
  const diffInSeconds = Math.round((now - date.getTime()) / 1000);

  const segments: {
    threshold: number;
    divisor: number;
    unit: Intl.RelativeTimeFormatUnit;
  }[] = [
    { threshold: 45, divisor: 1, unit: "second" },
    { threshold: 2700, divisor: 60, unit: "minute" },
    { threshold: 64800, divisor: 3600, unit: "hour" },
    { threshold: 561600, divisor: 86400, unit: "day" },
    { threshold: 2419200, divisor: 604800, unit: "week" },
    { threshold: 28512000, divisor: 2629746, unit: "month" },
  ];

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const segment of segments) {
    if (Math.abs(diffInSeconds) < segment.threshold) {
      const value = Math.round(diffInSeconds / segment.divisor);
      return rtf.format(-value, segment.unit);
    }
  }

  const years = Math.round(diffInSeconds / 31556952);
  return rtf.format(-years, "year");
}
