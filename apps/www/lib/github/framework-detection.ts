import { createGitHubClient } from "@/lib/github/octokit";
import { type FrameworkPreset } from "@/components/preview/preview-configure-client";

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type FrameworkRule = {
  preset: FrameworkPreset;
  packageNames?: string[];
  configFiles?: string[];
  scriptPatterns?: RegExp[];
  supersedes?: FrameworkPreset[];
};

type FrameworkMatch = {
  preset: FrameworkPreset;
  confidence: number;
  pathDepth: number;
  source: string;
};

type RepoTree = {
  paths: string[];
  truncated: boolean;
};

const FRAMEWORK_PRIORITY: FrameworkPreset[] = [
  "next",
  "remix",
  "nuxt",
  "sveltekit",
  "angular",
  "cra",
  "vue",
  "vite",
  "other",
];

const FRAMEWORK_RULES: FrameworkRule[] = [
  {
    preset: "next",
    packageNames: ["next"],
    configFiles: ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"],
    scriptPatterns: [/\bnext\b/i, /\bnext\s+(dev|start|build)/i],
  },
  {
    preset: "remix",
    packageNames: ["@remix-run/dev", "@remix-run/node", "@remix-run/serve", "remix"],
    configFiles: ["remix.config.js", "remix.config.ts", "remix.config.mjs"],
    scriptPatterns: [/\bremix\b/i],
    supersedes: ["vite"],
  },
  {
    preset: "nuxt",
    packageNames: ["nuxt", "nuxt3", "nuxt-edge", "nuxt-nightly"],
    configFiles: ["nuxt.config.js", "nuxt.config.ts", "nuxt.config.mjs", "nuxt.config.cjs"],
    scriptPatterns: [/\bnuxt\b/i],
    supersedes: ["vite"],
  },
  {
    preset: "sveltekit",
    packageNames: ["@sveltejs/kit"],
    configFiles: ["svelte.config.js", "svelte.config.ts", "svelte.config.cjs"],
    scriptPatterns: [/svelte-?kit/i, /\bsvelte\s*kit/i],
    supersedes: ["vite"],
  },
  {
    preset: "angular",
    packageNames: ["@angular/cli"],
    configFiles: ["angular.json"],
    scriptPatterns: [/\bng\s+(serve|build|test)/i],
  },
  {
    preset: "cra",
    packageNames: ["react-scripts", "react-dev-utils"],
    scriptPatterns: [/react-scripts/i],
  },
  {
    preset: "vue",
    packageNames: ["@vue/cli-service"],
    configFiles: ["vue.config.js", "vue.config.ts", "vue.config.cjs"],
    scriptPatterns: [/vue-cli-service/i],
  },
  {
    preset: "vite",
    packageNames: ["vite"],
    configFiles: ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs"],
    scriptPatterns: [/\bvite\b/i],
  },
];

const MAX_PACKAGE_JSON_CANDIDATES = 20;

function pathDepth(path: string): number {
  return path.split("/").length;
}

function combineDependencies(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
    ...(pkg.optionalDependencies ?? {}),
  };
}

function hasAnyDependency(pkg: PackageJson, names: string[]): boolean {
  const deps = combineDependencies(pkg);
  return names.some((name) => Boolean(deps[name]));
}

function scriptMatches(pkg: PackageJson, patterns: RegExp[]): boolean {
  const scriptValues = Object.values(pkg.scripts ?? {});
  return patterns.some((pattern) => scriptValues.some((value) => pattern.test(value)));
}

function packagePathScore(path: string): number {
  const depth = pathDepth(path);
  const lower = path.toLowerCase();
  let score = depth;

  if (path === "package.json") score -= 2;

  const preferred = ["apps/", "packages/", "examples/", "frontend", "client", "web", "site", "www", "app/"];
  preferred.forEach((token) => {
    if (lower.includes(token)) {
      score -= 0.2;
    }
  });

  const deprioritize = ["example", "sample", "fixture", "test", "demo", "playground"];
  deprioritize.forEach((token) => {
    if (lower.includes(token)) {
      score += 0.5;
    }
  });

  return score;
}

async function fetchRepoJson(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  path: string
): Promise<PackageJson | null> {
  try {
    const res = await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo: name,
      path,
    });
    const data = res.data as { content?: string };
    if (!("content" in data) || !data.content) {
      return null;
    }
    const raw = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(raw) as PackageJson;
  } catch (error) {
    console.error("Failed to read repo json", { owner, name, path, error });
    return null;
  }
}

async function repoHasFile(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  path: string
): Promise<boolean> {
  try {
    await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo: name,
      path,
    });
    return true;
  } catch {
    return false;
  }
}

async function fetchRepoTree(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string
): Promise<RepoTree | null> {
  try {
    const repo = await octokit.request("GET /repos/{owner}/{repo}", { owner, repo: name });
    const ref = repo.data.default_branch || "HEAD";
    const tree = await octokit.request("GET /repos/{owner}/{repo}/git/trees/{tree_sha}", {
      owner,
      repo: name,
      tree_sha: ref,
      recursive: "1",
    });

    const files = (tree.data.tree as Array<{ path: string; type: string }>).filter(
      (entry) => entry.type === "blob"
    );

    return { paths: files.map((file) => file.path), truncated: Boolean(tree.data.truncated) };
  } catch (error) {
    console.error("Failed to fetch repo tree", { owner, name, error });
    return null;
  }
}

function selectPackageJsonPaths(tree: RepoTree | null): string[] {
  if (!tree) return [];
  const candidates = tree.paths.filter((path) => {
    const lower = path.toLowerCase();
    if (!lower.endsWith("package.json")) return false;
    if (lower.includes("node_modules/") || lower.includes("vendor/") || lower.includes("dist/")) {
      return false;
    }
    return true;
  });

  return candidates.sort((a, b) => packagePathScore(a) - packagePathScore(b)).slice(0, MAX_PACKAGE_JSON_CANDIDATES);
}

function detectFromPackageJson(pkg: PackageJson, packagePath: string): FrameworkMatch | null {
  for (const rule of FRAMEWORK_RULES) {
    if (rule.packageNames && hasAnyDependency(pkg, rule.packageNames)) {
      return {
        preset: rule.preset,
        confidence: 3,
        pathDepth: pathDepth(packagePath),
        source: `package:${packagePath}`,
      };
    }
  }

  for (const rule of FRAMEWORK_RULES) {
    if (rule.scriptPatterns && scriptMatches(pkg, rule.scriptPatterns)) {
      return {
        preset: rule.preset,
        confidence: 1,
        pathDepth: pathDepth(packagePath),
        source: `scripts:${packagePath}`,
      };
    }
  }

  return null;
}

function detectFromFilePaths(paths: string[]): FrameworkMatch[] {
  const matches: FrameworkMatch[] = [];
  for (const rule of FRAMEWORK_RULES) {
    if (!rule.configFiles?.length) continue;

    const configMatch = paths.find((path) =>
      rule.configFiles?.some((fileName) => path.toLowerCase().endsWith(fileName.toLowerCase()))
    );

    if (configMatch) {
      matches.push({
        preset: rule.preset,
        confidence: 2,
        pathDepth: pathDepth(configMatch),
        source: `config:${configMatch}`,
      });
    }
  }

  return matches;
}

function applySupersedes(matches: FrameworkMatch[]): FrameworkMatch[] {
  return matches.filter((match) => {
    return !matches.some((other) => {
      if (other === match) return false;
      const supersedes = FRAMEWORK_RULES.find((rule) => rule.preset === other.preset)?.supersedes ?? [];
      const supersedesTarget = supersedes.includes(match.preset);
      const isHigherPriorityLocation = other.pathDepth <= match.pathDepth;
      return supersedesTarget && isHigherPriorityLocation;
    });
  });
}

function isBetterMatch(candidate: FrameworkMatch, current: FrameworkMatch): boolean {
  if (candidate.confidence !== current.confidence) {
    return candidate.confidence > current.confidence;
  }
  if (candidate.pathDepth !== current.pathDepth) {
    return candidate.pathDepth < current.pathDepth;
  }
  return FRAMEWORK_PRIORITY.indexOf(candidate.preset) < FRAMEWORK_PRIORITY.indexOf(current.preset);
}

function chooseBestMatch(matches: FrameworkMatch[]): FrameworkMatch | null {
  const deduped = new Map<FrameworkPreset, FrameworkMatch>();
  for (const match of matches) {
    const existing = deduped.get(match.preset);
    if (!existing || isBetterMatch(match, existing)) {
      deduped.set(match.preset, match);
    }
  }

  const candidates = applySupersedes(Array.from(deduped.values()));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) {
      return b.confidence - a.confidence;
    }
    if (a.pathDepth !== b.pathDepth) {
      return a.pathDepth - b.pathDepth;
    }
    return FRAMEWORK_PRIORITY.indexOf(a.preset) - FRAMEWORK_PRIORITY.indexOf(b.preset);
  })[0];
}

async function detectFromRepoPackages(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string,
  tree: RepoTree | null
): Promise<FrameworkMatch[]> {
  const packageJsonPaths = selectPackageJsonPaths(tree);
  const matches: FrameworkMatch[] = [];
  await Promise.all(
    packageJsonPaths.map(async (packagePath) => {
      const pkg = await fetchRepoJson(octokit, owner, name, packagePath);
      if (!pkg) return;

      const match = detectFromPackageJson(pkg, packagePath);
      if (match) {
        matches.push(match);
      }
    })
  );

  return matches;
}

async function detectFromRootFallback(
  octokit: ReturnType<typeof createGitHubClient>,
  owner: string,
  name: string
): Promise<FrameworkMatch[]> {
  const fallbackConfigs: Array<[FrameworkPreset, string[]]> = [
    ["next", ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]],
    ["nuxt", ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs", "nuxt.config.cjs"]],
    ["remix", ["remix.config.js", "remix.config.ts", "remix.config.mjs"]],
    ["sveltekit", ["svelte.config.js", "svelte.config.ts", "svelte.config.cjs"]],
    ["angular", ["angular.json"]],
    ["vite", ["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"]],
    ["vue", ["vue.config.js", "vue.config.ts", "vue.config.cjs"]],
  ];

  const matches: FrameworkMatch[] = [];
  await Promise.all(
    fallbackConfigs.map(async ([preset, paths]) => {
      const found = await paths.reduce<Promise<boolean>>(async (accPromise, candidate) => {
        const acc = await accPromise;
        if (acc) return true;
        return repoHasFile(octokit, owner, name, candidate);
      }, Promise.resolve(false));

      if (found) {
        matches.push({
          preset,
          confidence: 2,
          pathDepth: 1,
          source: "config:root",
        });
      }
    })
  );

  return matches;
}

export async function detectFrameworkPreset(repoFullName: string): Promise<FrameworkPreset> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return "other";
  }

  const octokit = createGitHubClient(undefined, { useTokenRotation: true });

  const repoTree = await fetchRepoTree(octokit, owner, name);
  const packageMatches = await detectFromRepoPackages(octokit, owner, name, repoTree);
  const fileMatches = repoTree ? detectFromFilePaths(repoTree.paths) : [];

  // If the tree call failed (or was truncated), fall back to checking the root.
  const fallbackMatches =
    repoTree && !repoTree.truncated ? [] : await detectFromRootFallback(octokit, owner, name);

  const matches: FrameworkMatch[] = [...packageMatches, ...fileMatches, ...fallbackMatches];

  // If nothing matched yet, still try the root package.json to mirror previous behavior.
  if (matches.length === 0) {
    const rootPackage = await fetchRepoJson(octokit, owner, name, "package.json");
    const match = rootPackage ? detectFromPackageJson(rootPackage, "package.json") : null;
    if (match) {
      matches.push(match);
    }
  }

  const bestMatch = chooseBestMatch(matches);
  return bestMatch?.preset ?? "other";
}
