import { describe, expect, it } from "vitest";
import { getAuthToken, runWithAuthToken } from "./requestContext";

describe("requestContext", () => {
  it("propagates auth token via AsyncLocalStorage", () => {
    expect(getAuthToken()).toBeUndefined();
    const value = runWithAuthToken("abc123", () => getAuthToken());
    expect(value).toBe("abc123");
  });

  it("preserves token across async boundaries", async () => {
    await runWithAuthToken("async-token", async () => {
      await Promise.resolve();
      expect(getAuthToken()).toBe("async-token");
    });
  });

  it("isolates tokens across concurrent contexts", async () => {
    const tick = () => Promise.resolve();

    const results: Array<{ a?: string; b?: string }> = [];

    const taskA = runWithAuthToken("token-A", async () => {
      await tick();
      results.push({ a: getAuthToken() });
      await tick();
      results.push({ a: getAuthToken() });
    });

    const taskB = runWithAuthToken("token-B", async () => {
      results.push({ b: getAuthToken() });
      await tick();
      results.push({ b: getAuthToken() });
    });

    await Promise.all([taskA, taskB]);

    for (const r of results) {
      if (r.a !== undefined) expect(r.a).toBe("token-A");
      if (r.b !== undefined) expect(r.b).toBe("token-B");
    }

    expect(getAuthToken()).toBeUndefined();
  });

  it("restores parent token after nested context exits", async () => {
    await runWithAuthToken("parent-token", async () => {
      expect(getAuthToken()).toBe("parent-token");
      await runWithAuthToken("child-token", async () => {
        expect(getAuthToken()).toBe("child-token");
      });
      expect(getAuthToken()).toBe("parent-token");
    });
  });
});
