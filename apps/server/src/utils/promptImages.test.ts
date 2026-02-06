import { describe, expect, it } from "vitest";

import {
  buildPromptImagePath,
  collapseRepeatedPromptImageRoots,
  replacePromptImageReference,
  sanitizePromptImageFileName,
} from "./promptImages";

describe("collapseRepeatedPromptImageRoots", () => {
  it("collapses duplicate /root/prompt/ prefixes", () => {
    expect(
      collapseRepeatedPromptImageRoots(
        "See /root/prompt//root/prompt/image.png.png"
      )
    ).toBe("See /root/prompt/image.png.png");
  });

  it("collapses multiple duplicate prefixes", () => {
    expect(
      collapseRepeatedPromptImageRoots(
        "/root/prompt//root/prompt//root/prompt/image.png"
      )
    ).toBe("/root/prompt/image.png");
  });

  it("leaves single prefix unchanged", () => {
    expect(collapseRepeatedPromptImageRoots("/root/prompt/image.png")).toBe(
      "/root/prompt/image.png"
    );
  });
});

describe("sanitizePromptImageFileName", () => {
  it("uses the basename of posix paths", () => {
    expect(
      sanitizePromptImageFileName("/root/prompt/image.png.png", "fallback.png")
    ).toBe("image.png.png");
  });

  it("uses the basename of windows paths", () => {
    expect(
      sanitizePromptImageFileName("C:\\\\fakepath\\\\image.png", "fallback.png")
    ).toBe("image.png");
  });

  it("replaces whitespace and non-ascii characters", () => {
    expect(sanitizePromptImageFileName("my file \u00a9.png", "fallback.png")).toBe(
      "my_file__.png"
    );
  });

  it("falls back when empty", () => {
    expect(sanitizePromptImageFileName("", "image_1.png")).toBe("image_1.png");
  });

  it("adds a default .png extension when missing", () => {
    expect(sanitizePromptImageFileName("screenshot", "fallback.png")).toBe(
      "screenshot.png"
    );
  });
});

describe("replacePromptImageReference", () => {
  it("replaces a bare filename with its /root/prompt path", () => {
    const safeFileName = "image.png.png";
    const imagePath = buildPromptImagePath(safeFileName);
    expect(
      replacePromptImageReference("Use image.png.png please", safeFileName, imagePath)
    ).toBe(`Use ${imagePath} please`);
  });

  it("does not replace when the reference is already part of a path", () => {
    const safeFileName = "image.png.png";
    const imagePath = buildPromptImagePath(safeFileName);
    const prompt = `Use ${imagePath} please`;
    expect(replacePromptImageReference(prompt, safeFileName, imagePath)).toBe(prompt);
  });
});

