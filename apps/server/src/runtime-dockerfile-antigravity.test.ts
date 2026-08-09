import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dockerfilePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "Dockerfile",
);

describe("worker image Antigravity CLI installation", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  it("chains a downloaded installer so curl failure stops the layer under /bin/sh", () => {
    const installInstruction = dockerfile
      .match(
        /^RUN [^\n]*antigravity\.google\/cli\/install\.sh[^\n]*\\\n(?:[^\n]*\\\n)*[^\n]*$/m,
      )?.[0]
      .replace(/\\\n\s*/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    expect(
      installInstruction,
      "missing dash-compatible Antigravity CLI install instruction",
    ).toBe(
      "RUN curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh && bash /tmp/agy-install.sh && rm -f /tmp/agy-install.sh && /root/.local/bin/agy --version",
    );
  });
});
