import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectFrameworkPreset } from "./framework-detection";

const requestMock = vi.fn();

vi.mock("@/lib/github/octokit", () => ({
  createGitHubClient: vi.fn(() => ({ request: requestMock })),
}));

function encodePackageJson(pkg: object): string {
  return Buffer.from(JSON.stringify(pkg)).toString("base64");
}

function mockGitHubResponses(
  responders: Record<string, any | ((params: Record<string, string>) => any)>
): void {
  requestMock.mockImplementation(async (route: string, params: Record<string, string>) => {
    const responder = responders[route];
    if (!responder) {
      throw new Error(`Unexpected request: ${route}`);
    }
    return typeof responder === "function" ? responder(params) : responder;
  });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("detectFrameworkPreset", () => {
  it("detects Next.js from a root package.json dependency", async () => {
    mockGitHubResponses({
      "GET /repos/{owner}/{repo}": { data: { default_branch: "main" } },
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}": {
        data: { tree: [{ path: "package.json", type: "blob" }], truncated: false },
      },
      "GET /repos/{owner}/{repo}/contents/{path}": ({ path }) => {
        if (path === "package.json") {
          return { data: { content: encodePackageJson({ dependencies: { next: "14.0.0" } }) } };
        }
        throw new Error(`Unexpected content path ${path as string}`);
      },
    });

    const preset = await detectFrameworkPreset("acme/www");
    expect(preset).toBe("next");
  });

  it("detects SvelteKit inside a nested package.json", async () => {
    mockGitHubResponses({
      "GET /repos/{owner}/{repo}": { data: { default_branch: "main" } },
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}": {
        data: {
          tree: [
            { path: "package.json", type: "blob" },
            { path: "apps/web/package.json", type: "blob" },
          ],
          truncated: false,
        },
      },
      "GET /repos/{owner}/{repo}/contents/{path}": ({ path }) => {
        if (path === "package.json") {
          return { data: { content: encodePackageJson({}) } };
        }
        if (path === "apps/web/package.json") {
          return {
            data: { content: encodePackageJson({ devDependencies: { "@sveltejs/kit": "2.0.0" } }) },
          };
        }
        throw new Error(`Unexpected content path ${path as string}`);
      },
    });

    const preset = await detectFrameworkPreset("acme/monorepo");
    expect(preset).toBe("sveltekit");
  });

  it("prefers Remix over Vite when both are present", async () => {
    mockGitHubResponses({
      "GET /repos/{owner}/{repo}": { data: { default_branch: "main" } },
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}": {
        data: { tree: [{ path: "package.json", type: "blob" }], truncated: false },
      },
      "GET /repos/{owner}/{repo}/contents/{path}": ({ path }) => {
        if (path === "package.json") {
          return {
            data: {
              content: encodePackageJson({
                devDependencies: { "@remix-run/dev": "2.0.0", vite: "5.0.0" },
              }),
            },
          };
        }
        throw new Error(`Unexpected content path ${path as string}`);
      },
    });

    const preset = await detectFrameworkPreset("acme/remix-app");
    expect(preset).toBe("remix");
  });

  it("detects Nuxt from config files when no package.json is present", async () => {
    mockGitHubResponses({
      "GET /repos/{owner}/{repo}": { data: { default_branch: "main" } },
      "GET /repos/{owner}/{repo}/git/trees/{tree_sha}": {
        data: { tree: [{ path: "apps/site/nuxt.config.ts", type: "blob" }], truncated: false },
      },
    });

    const preset = await detectFrameworkPreset("acme/config-only");
    expect(preset).toBe("nuxt");
  });
});
