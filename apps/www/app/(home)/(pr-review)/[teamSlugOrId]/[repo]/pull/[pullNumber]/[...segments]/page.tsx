import { notFound, redirect } from "next/navigation";

type PageParams = {
  teamSlugOrId: string;
  repo: string;
  pullNumber: string;
  segments: string[];
};

type PageProps = {
  params: Promise<PageParams>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";

export default async function PullRequestCatchallPage({
  params,
  searchParams: searchParamsPromise,
}: PageProps): Promise<never> {
  const { teamSlugOrId, repo, pullNumber } = await params;

  if (!/^\d+$/.test(pullNumber)) {
    notFound();
  }

  const serializedSearchParams = searchParamsPromise
    ? serializeSearchParams(await searchParamsPromise)
    : "";

  const targetPath = `/${encodeURIComponent(teamSlugOrId)}/${encodeURIComponent(
    repo
  )}/pull/${encodeURIComponent(pullNumber)}`;
  redirect(
    serializedSearchParams.length > 0
      ? `${targetPath}?${serializedSearchParams}`
      : targetPath
  );
}

function serializeSearchParams(
  searchParams?: Record<string, string | string[] | undefined>
): string {
  if (!searchParams) {
    return "";
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "undefined") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        params.append(key, entry);
      }
    } else {
      params.set(key, value);
    }
  }
  return params.toString();
}
