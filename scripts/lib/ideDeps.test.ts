import { describe, expect, it } from "vitest";

import {
  applyPackageOverrides,
  formatGlobalPackageInstallLines,
  formatPackageInstallSpec,
  isRemotePackageSource,
  parsePackageOverrides,
  selectGlobalPackageInstaller,
  type IdeDeps,
} from "./ideDeps";

describe("ideDeps package overrides", () => {
  it("parses and trims JSON overrides", () => {
    expect(
      parsePackageOverrides(
        JSON.stringify({
          " @anthropic-ai/claude-code ": " 2.1.87 ",
          "@openai/codex":
            " https://example.com/releases/download/codex.tgz ",
        }),
      ),
    ).toEqual({
      "@anthropic-ai/claude-code": "2.1.87",
      "@openai/codex": "https://example.com/releases/download/codex.tgz",
    });
  });

  it("applies overrides onto ide deps packages", () => {
    const deps: IdeDeps = {
      extensions: [],
      packages: {
        "@anthropic-ai/claude-code": "2.1.88",
        "@openai/codex": "0.118.0",
      },
    };

    expect(
      applyPackageOverrides(deps, {
        "@anthropic-ai/claude-code": "2.1.87",
      }),
    ).toBe(true);
    expect(deps.packages["@anthropic-ai/claude-code"]).toBe("2.1.87");
    expect(applyPackageOverrides(deps, {})).toBe(false);
  });

  it("formats install specs for versions and public tarball URLs", () => {
    expect(isRemotePackageSource("https://example.com/pkg.tgz")).toBe(true);
    expect(isRemotePackageSource("2.1.87")).toBe(false);
    expect(
      formatPackageInstallSpec("@anthropic-ai/claude-code", "2.1.87"),
    ).toBe("@anthropic-ai/claude-code@2.1.87");
    expect(
      formatPackageInstallSpec(
        "@anthropic-ai/claude-code",
        "https://example.com/releases/download/pkg.tgz",
      ),
    ).toBe("https://example.com/releases/download/pkg.tgz");
  });
});

describe("global package installer selection", () => {
  it("uses npm for Claude Code versions because bun fails extracting the 2.1.89 tarball", () => {
    expect(selectGlobalPackageInstaller("@anthropic-ai/claude-code", "2.1.89")).toBe(
      "npm",
    );
  });

  it("uses npm for remote tarball URLs and bun for other versioned packages", () => {
    expect(
      selectGlobalPackageInstaller(
        "@openai/codex",
        "https://example.com/releases/download/codex.tgz",
      ),
    ).toBe("npm");
    expect(selectGlobalPackageInstaller("@openai/codex", "0.147.0")).toBe("bun");
    expect(selectGlobalPackageInstaller("@sourcegraph/amp", "0.0.1")).toBe("bun");
  });

  it("formats installer|name|spec lines for the Docker/snapshot install loop", () => {
    const deps: IdeDeps = {
      extensions: [],
      packages: {
        "@openai/codex": "0.147.0",
        "@anthropic-ai/claude-code": "2.1.89",
        "@sourcegraph/amp": "https://example.com/amp.tgz",
      },
    };

    expect(formatGlobalPackageInstallLines(deps)).toBe(
      [
        "bun|@openai/codex|@openai/codex@0.147.0",
        "npm|@anthropic-ai/claude-code|@anthropic-ai/claude-code@2.1.89",
        "npm|@sourcegraph/amp|https://example.com/amp.tgz",
        "",
      ].join("\n"),
    );
  });
});
