import {
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

const hasValue = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const parseMacArchitecture = (assetName: string): MacArchitecture | null => {
  const normalized = assetName.toLowerCase();

  if (!normalized.endsWith(".dmg")) {
    return null;
  }

  if (normalized.includes("arm64") || normalized.includes("aarch64")) {
    return "arm64";
  }

  if (normalized.includes("x64") || normalized.includes("x86_64") || normalized.includes("intel")) {
    return "x64";
  }

  if (normalized.includes("arm")) {
    return "arm64";
  }

  return "x64";
};

const deriveReleaseInfo = (data: GithubRelease | null): ReleaseInfo => {
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

  if (Array.isArray(data.assets)) {
    for (const asset of data.assets) {
      if (!hasValue(asset.browser_download_url)) {
        continue;
      }

      if (typeof asset.name !== "string") {
        continue;
      }

      const architecture = parseMacArchitecture(asset.name);

      if (!architecture || macDownloadUrls[architecture]) {
        continue;
      }

      macDownloadUrls[architecture] = asset.browser_download_url.trim();
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
