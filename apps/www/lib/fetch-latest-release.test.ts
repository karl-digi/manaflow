import { describe, expect, it } from "vitest";

import { deriveReleaseInfo } from "./fetch-latest-release";

const exampleArmUrl = "https://example.com/cmux-arm64.dmg";
const exampleX64Url = "https://example.com/cmux-x64.dmg";
const exampleUniversalUrl = "https://example.com/cmux-universal.dmg";

type GithubReleaseInput = Parameters<typeof deriveReleaseInfo>[0];

describe("deriveReleaseInfo", () => {
  it("detects architecture-specific macOS DMGs even when x64 lacks a suffix", () => {
    const release: GithubReleaseInput = {
      tag_name: "v1.0.106",
      assets: [
        {
          name: "cmux-1.0.106-arm64.dmg",
          browser_download_url: exampleArmUrl,
        },
        {
          name: "cmux-1.0.106.dmg",
          browser_download_url: exampleX64Url,
        },
      ],
    };

    const result = deriveReleaseInfo(release);

    expect(result.latestVersion).toBe("1.0.106");
    expect(result.macDownloadUrls.arm64).toBe(exampleArmUrl);
    expect(result.macDownloadUrls.x64).toBe(exampleX64Url);
  });

  it("fills missing architectures with unmatched DMGs", () => {
    const release: GithubReleaseInput = {
      tag_name: "v2.0.0",
      assets: [
        {
          name: "cmux-2.0.0.dmg",
          browser_download_url: exampleUniversalUrl,
        },
      ],
    };

    const result = deriveReleaseInfo(release);

    expect(result.latestVersion).toBe("2.0.0");
    expect(result.macDownloadUrls.arm64).toBe(exampleUniversalUrl);
    expect(result.macDownloadUrls.x64).toBe(exampleUniversalUrl);
  });
});
