#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: run this script inside a git repository." >&2
  exit 1
fi

node <<'NODE'
const { execSync } = require("child_process");
const { readFileSync } = require("fs");

const files = execSync('rg --files -g "**/package.json"', {
  encoding: "utf8",
})
  .trim()
  .split(/\n+/)
  .filter(Boolean)
  .sort();

const rows = [];
const parseErrors = [];

for (const file of files) {
  try {
    const json = JSON.parse(readFileSync(file, "utf8"));
    const repo =
      typeof json.repository === "string"
        ? json.repository
        : json.repository && typeof json.repository.url === "string"
          ? json.repository.url
          : "";

    if (!repo) continue;

    const normalized = repo.replace(/^git\+/, "").replace(/\/$/, "");

    let category = "other";
    if (/^https:\/\/github\.com\/karlorz\/cmux(?:\.git)?$/i.test(normalized)) {
      category = "fork-monorepo";
    } else if (
      /^https:\/\/github\.com\/karlorz\/devsh(?:\.git)?$/i.test(normalized)
    ) {
      category = "fork-devsh-package";
    } else if (
      /^https:\/\/github\.com\/manaflow-ai\/manaflow(?:\.git)?$/i.test(
        normalized,
      )
    ) {
      category = "upstream-monorepo";
    } else if (
      /^https:\/\/github\.com\/manaflow-ai\/cmux(?:\.git)?$/i.test(normalized)
    ) {
      category = "upstream-cmux-package";
    } else if (
      /^https:\/\/github\.com\/lawrencecchen\/cmux(?:\.git)?$/i.test(normalized)
    ) {
      category = "legacy-cmux-package";
    }

    rows.push({
      file,
      category,
      repo,
      normalized,
    });
  } catch (error) {
    parseErrors.push(`${file}: ${error.message}`);
  }
}

if (parseErrors.length > 0) {
  console.error("ERROR: failed to parse package.json files:");
  for (const err of parseErrors) console.error(`- ${err}`);
  process.exit(1);
}

if (rows.length === 0) {
  console.log("No package.json files with repository metadata found.");
  process.exit(0);
}

const fileWidth = Math.max(
  "FILE".length,
  ...rows.map((r) => r.file.length),
);
const categoryWidth = Math.max(
  "CATEGORY".length,
  ...rows.map((r) => r.category.length),
);

console.log(
  `${"FILE".padEnd(fileWidth)}  ${"CATEGORY".padEnd(categoryWidth)}  URL`,
);
for (const row of rows) {
  console.log(
    `${row.file.padEnd(fileWidth)}  ${row.category.padEnd(categoryWidth)}  ${row.repo}`,
  );
}

const upstreamMonorepoRows = rows.filter(
  (r) => r.category === "upstream-monorepo",
);

if (upstreamMonorepoRows.length > 0) {
  console.error(
    "\nERROR: found upstream monorepo repository URLs. Keep fork-owned package metadata on https://github.com/karlorz/cmux.git.",
  );
  for (const row of upstreamMonorepoRows) {
    console.error(`- ${row.file}: ${row.repo}`);
  }
  process.exit(2);
}

console.log("\nPackage repository URL audit passed.");
NODE
