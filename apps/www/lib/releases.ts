export const RELEASE_PAGE_URL =
  "https://github.com/karlorz/cmux/releases";

export const GITHUB_RELEASES_URL =
  "https://api.github.com/repos/karlorz/cmux/releases?per_page=20";

export const DMG_SUFFIXES = {
  universal: "-universal.dmg",
  arm64: "-arm64.dmg",
  x64: "-x64.dmg",
} as const;

export type MacArchitecture = keyof typeof DMG_SUFFIXES;

export type MacDownloadUrls = Record<MacArchitecture, string | null>;
