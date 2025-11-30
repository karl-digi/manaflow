import { createGitHubClient } from "@/lib/github/octokit";
import { type FrameworkPreset } from "@/components/preview/preview-configure-client";

export type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

function hasStandaloneViteScript(values: string[]): boolean {
  return values.some((value) => /\bvite(?=$|\s)/.test(value));
}

export function chooseFrameworkFromPackageJson(pkg: PackageJson): FrameworkPreset | null {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const hasAny = (...keys: string[]) => keys.some((key) => deps[key]);

  if (hasAny("next")) return "next";
  if (hasAny("nuxt")) return "nuxt";
  if (hasAny("@remix-run/node", "@remix-run/serve", "remix")) return "remix";
  if (hasAny("astro")) return "astro";
  if (hasAny("@sveltejs/kit")) return "sveltekit";
  if (hasAny("@angular/core")) return "angular";
  if (hasAny("react-scripts")) return "cra";
  if (hasAny("vue", "@vue/cli-service")) return "vue";
  if (hasAny("vite")) return "vite";

  const scripts = pkg.scripts ?? {};
  const scriptValues = Object.values(scripts).map((val) => val.toLowerCase());
  const includesScript = (needle: string) =>
    scriptValues.some((val) => val.includes(needle));

  if (includesScript("next")) return "next";
  if (includesScript("nuxt")) return "nuxt";
  if (includesScript("remix")) return "remix";
  if (includesScript("astro")) return "astro";
  if (includesScript("svelte")) return "sveltekit";
  if (scriptValues.some((val) => /(?:^|\s)ng(?:\s|$)/.test(val))) return "angular";
  if (includesScript("react-scripts")) return "cra";
  if (includesScript("vue")) return "vue";
  if (hasStandaloneViteScript(scriptValues)) return "vite";
  return null;
}

async function fetchRepoJson(owner: string, name: string, path: string): Promise<PackageJson | null> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
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

async function repoHasFile(owner: string, name: string, path: string): Promise<boolean> {
  const octokit = createGitHubClient(undefined, { useTokenRotation: true });
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

export async function detectFrameworkPreset(repoFullName: string): Promise<FrameworkPreset> {
  const [owner, name] = repoFullName.split("/");
  if (!owner || !name) {
    return "other";
  }

  const pkg = await fetchRepoJson(owner, name, "package.json");
  const pkgGuess = pkg ? chooseFrameworkFromPackageJson(pkg) : null;
  if (pkgGuess) {
    return pkgGuess;
  }

  const fileGuesses: Array<[FrameworkPreset, string[]]> = [
    ["next", ["next.config.js", "next.config.ts", "next.config.mjs"]],
    ["nuxt", ["nuxt.config.ts", "nuxt.config.js", "nuxt.config.mjs"]],
    ["remix", ["remix.config.js", "remix.config.ts"]],
    ["astro", ["astro.config.mjs", "astro.config.ts", "astro.config.js"]],
    ["sveltekit", ["svelte.config.js", "svelte.config.ts"]],
    ["angular", ["angular.json"]],
    ["vite", ["vite.config.ts", "vite.config.js", "vite.config.mjs"]],
    ["vue", ["vue.config.js", "vue.config.ts"]],
  ];

  for (const [preset, paths] of fileGuesses) {
    const found = await paths.reduce<Promise<boolean>>(async (accPromise, candidate) => {
      const acc = await accPromise;
      if (acc) return true;
      return repoHasFile(owner, name, candidate);
    }, Promise.resolve(false));
    if (found) {
      return preset;
    }
  }

  return "other";
}
