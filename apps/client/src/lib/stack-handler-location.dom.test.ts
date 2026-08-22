/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from "vitest";
import { liftOAuthQueryToWindowSearch } from "./stack-handler-location";

describe("liftOAuthQueryToWindowSearch", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("copies hash-router OAuth params onto window.location.search", () => {
    window.history.replaceState(
      {},
      "",
      "/#/handler/oauth-callback?code=abc&state=xyz"
    );

    liftOAuthQueryToWindowSearch("?code=abc&state=xyz");

    expect(window.location.search).toBe("?code=abc&state=xyz");
    expect(window.location.hash).toBe("#/handler/oauth-callback");
  });

  it("does not overwrite an existing window search that already has the code", () => {
    window.history.replaceState(
      {},
      "",
      "/?code=keep&state=keep#/handler/oauth-callback"
    );

    liftOAuthQueryToWindowSearch("?code=other&state=other");

    expect(window.location.search).toBe("?code=keep&state=keep");
  });

  it("ignores router search without OAuth callback params", () => {
    window.history.replaceState({}, "", "/handler/sign-in");

    liftOAuthQueryToWindowSearch("?after_auth_return_to=%2Fteam-picker");

    expect(window.location.search).toBe("");
  });
});
