import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const dockerfilePath = join(repoRoot, "Dockerfile");

describe("worker image global CLI installer plan", () => {
  const dockerfile = readFileSync(dockerfilePath, "utf8");

  it("builds installer|name|spec lines after IDE dep bump/overrides", () => {
    expect(dockerfile).toContain(
      "COPY scripts/print-ide-deps-package-installs.ts ./scripts/print-ide-deps-package-installs.ts",
    );
    expect(dockerfile).toContain(
      "RUN bun run ./scripts/print-ide-deps-package-installs.ts > /cmux/configs/ide-deps-installs.txt",
    );
    expect(dockerfile).toContain(
      "COPY --from=builder /cmux/configs/ide-deps-installs.txt /tmp/ide-deps-installs.txt",
    );
  });

  it("installs from the plan file instead of bun add -g for every versioned package", () => {
    expect(dockerfile).toContain('if [ "${installer}" = "npm" ]; then');
    expect(dockerfile).toContain('npm install -g "${install_spec}"');
    expect(dockerfile).toContain('bun add -g "${install_spec}"');
    expect(dockerfile).not.toContain(
      'bun add -g "${package_name}@${install_value}"',
    );
  });
});
