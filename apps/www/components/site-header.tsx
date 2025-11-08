import { getCmuxGithubRepoMetadata } from "@/lib/github/get-cmux-repo-metadata";

import { SiteHeaderClient, type SiteHeaderClientProps } from "./site-header-client";

export type SiteHeaderProps = Omit<SiteHeaderClientProps, "githubStars">;

export async function SiteHeader(props: SiteHeaderProps) {
  const repo = await getCmuxGithubRepoMetadata();

  return <SiteHeaderClient {...props} githubStars={repo.stargazersCount} />;
}
