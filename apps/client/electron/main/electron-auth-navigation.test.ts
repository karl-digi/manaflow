import { describe, expect, it } from "vitest";
import {
  buildSpaOrigins,
  classifyAuthWindowNavigation,
  classifyMainWindowNavigation,
  isOAuthProviderUrl,
  isSpaAuthCallback,
  isSpaOrigin,
  rewriteHandlerPathToHash,
} from "./electron-auth-navigation";

const SPA = ["http://localhost:5173", "https://cmux.local"] as const;

describe("rewriteHandlerPathToHash", () => {
  it("rewrites path-style Stack handler to hash path with query on search", () => {
    expect(
      rewriteHandlerPathToHash(
        "http://localhost:5173/handler/oauth-callback?code=abc&state=xyz"
      )
    ).toBe(
      "http://localhost:5173/?code=abc&state=xyz#/handler/oauth-callback"
    );
  });

  it("lifts query out of an already hash-routed callback", () => {
    expect(
      rewriteHandlerPathToHash(
        "http://localhost:5173/#/handler/oauth-callback?code=1"
      )
    ).toBe("http://localhost:5173/?code=1#/handler/oauth-callback");
  });

  it("returns null when query is already on search and path is in hash", () => {
    expect(
      rewriteHandlerPathToHash(
        "http://localhost:5173/?code=1#/handler/oauth-callback"
      )
    ).toBeNull();
  });

  it("returns null for non-handler SPA paths", () => {
    expect(
      rewriteHandlerPathToHash("http://localhost:5173/sign-in")
    ).toBeNull();
  });
});

describe("isOAuthProviderUrl", () => {
  it("detects Stack and GitHub hosts", () => {
    expect(
      isOAuthProviderUrl(
        "https://api.stack-auth.com/api/v1/auth/oauth/authorize/github"
      )
    ).toBe(true);
    expect(isOAuthProviderUrl("https://github.com/login/oauth/authorize")).toBe(
      true
    );
    expect(isOAuthProviderUrl("https://api.stack-auth.com/session")).toBe(true);
  });

  it("rejects SPA and unrelated hosts", () => {
    expect(isOAuthProviderUrl("http://localhost:5173/")).toBe(false);
    expect(isOAuthProviderUrl("https://example.com")).toBe(false);
  });
});

describe("classifyMainWindowNavigation", () => {
  it("allows SPA navigations", () => {
    expect(
      classifyMainWindowNavigation("http://localhost:5173/#/sign-in", {
        spaOrigins: SPA,
      })
    ).toEqual({ action: "allow" });
  });

  it("rewrites SPA /handler path callbacks", () => {
    expect(
      classifyMainWindowNavigation(
        "http://localhost:5173/handler/oauth-callback?code=1",
        { spaOrigins: SPA }
      )
    ).toEqual({
      action: "rewrite-hash",
      url: "http://localhost:5173/?code=1#/handler/oauth-callback",
    });
  });

  it("leaves path-style handler callbacks alone without a hash router", () => {
    expect(
      classifyMainWindowNavigation(
        "http://localhost:5173/handler/oauth-callback?code=1",
        { spaOrigins: SPA, hashRouter: false }
      )
    ).toEqual({ action: "allow" });
  });

  it("routes OAuth hosts to auth-window", () => {
    expect(
      classifyMainWindowNavigation(
        "https://api.stack-auth.com/api/v1/auth/oauth/authorize/github?x=1",
        { spaOrigins: SPA }
      )
    ).toEqual({
      action: "auth-window",
      url: "https://api.stack-auth.com/api/v1/auth/oauth/authorize/github?x=1",
    });
  });

  it("opens other http(s) externally", () => {
    expect(
      classifyMainWindowNavigation("https://docs.example.com/guide", {
        spaOrigins: SPA,
      })
    ).toEqual({
      action: "external",
      url: "https://docs.example.com/guide",
    });
    // Non-allow decisions reaching applyAuthNavDecision must be external/auth-window/rewrite-hash
    // (the main setWindowOpenHandler denies popups on a null/destroyed mainWindow per TS18047).
    expect(
      classifyMainWindowNavigation("https://example.com/path?q=2", {
        spaOrigins: SPA,
      })
    ).toEqual({
      action: "external",
      url: "https://example.com/path?q=2",
    });
  });

  it("allows non-http schemes", () => {
    expect(
      classifyMainWindowNavigation("devtools://devtools/bundled/index.html", {
        spaOrigins: SPA,
      })
    ).toEqual({ action: "allow" });
  });
});

describe("classifyAuthWindowNavigation", () => {
  it("allows OAuth inside auth window", () => {
    expect(
      classifyAuthWindowNavigation("https://api.stack-auth.com/session", {
        spaOrigins: SPA,
      })
    ).toEqual({ action: "allow" });
  });

  it("rewrites SPA handler callback for handoff to main", () => {
    expect(
      classifyAuthWindowNavigation(
        "http://localhost:5173/handler/oauth-callback?code=z",
        { spaOrigins: SPA }
      )
    ).toEqual({
      action: "rewrite-hash",
      url: "http://localhost:5173/?code=z#/handler/oauth-callback",
    });
  });

  it("hands off path-style callbacks without rewriting when hashRouter is false", () => {
    expect(
      classifyAuthWindowNavigation(
        "http://localhost:5173/handler/oauth-callback?code=z",
        { spaOrigins: SPA, hashRouter: false }
      )
    ).toEqual({ action: "allow" });
  });
});

describe("isSpaAuthCallback", () => {
  it("detects path and hash handler URLs on SPA", () => {
    expect(
      isSpaAuthCallback("http://localhost:5173/handler/oauth-callback", SPA)
    ).toBe(true);
    expect(
      isSpaAuthCallback(
        "http://localhost:5173/#/handler/oauth-callback?code=1",
        SPA
      )
    ).toBe(true);
    expect(isSpaAuthCallback("http://localhost:5173/#/sign-in", SPA)).toBe(
      false
    );
  });
});

describe("buildSpaOrigins / isSpaOrigin", () => {
  it("includes app host and renderer origin", () => {
    const origins = buildSpaOrigins({
      appHost: "cmux.local",
      electronRendererUrl: "http://localhost:5173/",
    });
    expect(origins).toContain("https://cmux.local");
    expect(origins).toContain("http://localhost:5173");
    expect(isSpaOrigin("http://localhost:5173/foo", origins)).toBe(true);
    expect(isSpaOrigin("https://cmux.local/index-electron.html", origins)).toBe(
      true
    );
  });
});
