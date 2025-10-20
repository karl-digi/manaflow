import {
  DMG_SUFFIXES,
  GITHUB_RELEASE_URL,
  MacArchitecture,
  MacDownloadUrls,
  RELEASE_PAGE_URL,
} from "@/lib/releases";

export type ReleaseInfo = {
  latestVersion: string | null;
  macDownloadUrls: MacDownloadUrls;
  fallbackUrl: string;
};

type GithubRelease = {
  tag_name?: string;
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
};

const emptyDownloads: MacDownloadUrls = {
  arm64: null,
  x64: null,
};

const normalizeVersion = (tag: string): string =>
  tag.startsWith("v") ? tag.slice(1) : tag;

const DMG_EXTENSION = ".dmg";

const architectureHints: Record<
  MacArchitecture,
  Array<(value: string) => boolean>
> = {
  arm64: [
    (value) => value.includes("arm64"),
    (value) => value.includes("aarch64"),
    (value) => value.includes("arm-64"),
  ],
  x64: [
    (value) => value.includes("x64"),
    (value) => value.includes("x86_64"),
    (value) => value.includes("amd64"),
    (value) => value.includes("intel"),
  ],
};

const detectArchitectureFromName = (
  assetName: string,
): MacArchitecture | null => {
  if (!assetName.endsWith(DMG_EXTENSION)) {
    return null;
  }

  for (const [architecture, predicates] of Object.entries(architectureHints) as Array<
    [MacArchitecture, Array<(value: string) => boolean>]
  >) {
    if (predicates.some((predicate) => predicate(assetName))) {
      return architecture;
    }
  }

  for (const architecture of Object.keys(DMG_SUFFIXES) as MacArchitecture[]) {
    const suffix = DMG_SUFFIXES[architecture];

    if (assetName.endsWith(suffix)) {
      return architecture;
    }
  }

  return null;
};

export const deriveReleaseInfo = (data: GithubRelease | null): ReleaseInfo => {
  if (!data) {
    return {
      latestVersion: null,
      macDownloadUrls: { ...emptyDownloads },
      fallbackUrl: RELEASE_PAGE_URL,
    };
  }

  const latestVersion =
    typeof data.tag_name === "string" && data.tag_name.trim() !== ""
      ? normalizeVersion(data.tag_name)
      : null;

  const macDownloadUrls: MacDownloadUrls = { ...emptyDownloads };

  const unmatchedDmgUrls: string[] = [];

  if (Array.isArray(data.assets)) {
    for (const asset of data.assets) {
      const assetName = asset.name?.toLowerCase();

      if (typeof assetName !== "string") {
        continue;
      }

      const downloadUrl = asset.browser_download_url;

      if (typeof downloadUrl !== "string" || downloadUrl.trim() === "") {
        continue;
      }

      const detectedArchitecture = detectArchitectureFromName(assetName);

      if (detectedArchitecture) {
        if (!macDownloadUrls[detectedArchitecture]) {
          macDownloadUrls[detectedArchitecture] = downloadUrl;
        }
        continue;
      }

      if (assetName.endsWith(DMG_EXTENSION)) {
        unmatchedDmgUrls.push(downloadUrl);
      }
    }
  }

  if (unmatchedDmgUrls.length > 0) {
    if (!macDownloadUrls.arm64) {
      macDownloadUrls.arm64 = unmatchedDmgUrls[0] ?? null;
    }

    if (!macDownloadUrls.x64) {
      macDownloadUrls.x64 = unmatchedDmgUrls[1] ?? unmatchedDmgUrls[0] ?? null;
    }
  }

  return {
    latestVersion,
    macDownloadUrls,
    fallbackUrl: RELEASE_PAGE_URL,
  };
};

export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  try {
    const response = await fetch(GITHUB_RELEASE_URL, {
      headers: {
        Accept: "application/vnd.github+json",
      },
      next: {
        revalidate: 3600,
      },
    });

    if (!response.ok) {
      return deriveReleaseInfo(null);
    }

    const data = (await response.json()) as GithubRelease;

    return deriveReleaseInfo(data);
  } catch (error) {
    console.error("Failed to retrieve latest GitHub release", error);

    return deriveReleaseInfo(null);
  }
}
