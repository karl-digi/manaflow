import { describe, it, expect, afterEach } from "vitest";
import {
  parseProxyHostname,
  buildProxyOrigin,
  deriveProxyServiceUrl,
} from "./deriveProxyServiceUrl";

describe("parseProxyHostname", () => {
  it("parses PVE LXC proxy hostnames", () => {
    const result = parseProxyHostname(
      "port-5173-pvelxc-30b1cc26.alphasolves.com",
    );
    expect(result).toEqual({
      currentPort: 5173,
      hostId: "pvelxc-30b1cc26",
      domain: "alphasolves.com",
    });
  });

  it("parses Morph proxy hostnames", () => {
    const result = parseProxyHostname(
      "port-5173-morphvm-abc123.http.cloud.morph.so",
    );
    expect(result).toEqual({
      currentPort: 5173,
      hostId: "morphvm-abc123",
      domain: "http.cloud.morph.so",
    });
  });

  it("parses different port numbers", () => {
    const result = parseProxyHostname(
      "port-9776-pvelxc-xyz123.alphasolves.com",
    );
    expect(result).toEqual({
      currentPort: 9776,
      hostId: "pvelxc-xyz123",
      domain: "alphasolves.com",
    });
  });

  it("returns null for localhost", () => {
    expect(parseProxyHostname("localhost")).toBeNull();
  });

  it("returns null for regular domains", () => {
    expect(parseProxyHostname("www.cmux.sh")).toBeNull();
  });

  it("returns null for IP addresses", () => {
    expect(parseProxyHostname("127.0.0.1")).toBeNull();
  });

  it("returns null for malformed proxy hostnames", () => {
    expect(
      parseProxyHostname("port-invalid-pvelxc-abc.alphasolves.com"),
    ).toBeNull();
    expect(parseProxyHostname("port--pvelxc-abc.alphasolves.com")).toBeNull();
  });
});

describe("buildProxyOrigin", () => {
  it("builds PVE LXC proxy origins", () => {
    const origin = buildProxyOrigin(
      { hostId: "pvelxc-30b1cc26", domain: "alphasolves.com" },
      9776,
    );
    expect(origin).toBe("https://port-9776-pvelxc-30b1cc26.alphasolves.com");
  });

  it("builds Morph proxy origins", () => {
    const origin = buildProxyOrigin(
      { hostId: "morphvm-abc123", domain: "http.cloud.morph.so" },
      9779,
    );
    expect(origin).toBe("https://port-9779-morphvm-abc123.http.cloud.morph.so");
  });
});

describe("deriveProxyServiceUrl", () => {
  const originalWindow =
    typeof globalThis.window !== "undefined" ? globalThis.window : undefined;

  afterEach(() => {
    if (originalWindow !== undefined) {
      (globalThis as Record<string, unknown>).window = originalWindow;
    } else {
      delete (globalThis as Record<string, unknown>).window;
    }
  });

  it("returns fallback URL when window is undefined (SSR)", () => {
    delete (globalThis as Record<string, unknown>).window;
    const result = deriveProxyServiceUrl(9776, "http://localhost:9776");
    expect(result).toBe("http://localhost:9776");
  });

  it("returns fallback URL when on localhost", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "localhost" },
    };
    const result = deriveProxyServiceUrl(9776, "http://localhost:9776");
    expect(result).toBe("http://localhost:9776");
  });

  it("returns fallback URL when on regular domain", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "www.cmux.sh" },
    };
    const result = deriveProxyServiceUrl(9776, "http://localhost:9776");
    expect(result).toBe("http://localhost:9776");
  });

  it("returns fallback URL when fallback is not localhost", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "port-5173-pvelxc-abc123.alphasolves.com" },
    };
    const result = deriveProxyServiceUrl(
      9776,
      "https://api.production.example.com",
    );
    expect(result).toBe("https://api.production.example.com");
  });

  it("returns malformed fallback URL as-is", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "port-5173-pvelxc-abc123.alphasolves.com" },
    };
    const result = deriveProxyServiceUrl(9776, "not-a-valid-url");
    expect(result).toBe("not-a-valid-url");
  });

  it("derives proxy URL when on PVE LXC proxy", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "port-5173-pvelxc-30b1cc26.alphasolves.com" },
    };
    const result = deriveProxyServiceUrl(9776, "http://localhost:9776");
    expect(result).toBe("https://port-9776-pvelxc-30b1cc26.alphasolves.com");
  });

  it("derives proxy URL when on Morph proxy", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "port-5173-morphvm-abc123.http.cloud.morph.so" },
    };
    const result = deriveProxyServiceUrl(9779, "http://localhost:9779");
    expect(result).toBe("https://port-9779-morphvm-abc123.http.cloud.morph.so");
  });

  it("handles 127.0.0.1 as localhost", () => {
    (globalThis as Record<string, unknown>).window = {
      location: { hostname: "port-5173-pvelxc-abc.alphasolves.com" },
    };
    const result = deriveProxyServiceUrl(9776, "http://127.0.0.1:9776");
    expect(result).toBe("https://port-9776-pvelxc-abc.alphasolves.com");
  });
});
