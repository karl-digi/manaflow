import { describe, expect, it } from "vitest";
import {
  resolveBrowserPreviewUrl,
  resolveBrowserPreviewWebsocketUrl,
  toGenericVncUrl,
  toGenericVncWebsocketUrl,
  toMorphXtermBaseUrl,
  toMorphVncUrl,
  toVncViewerUrl,
  toVncWebsocketUrl,
} from "./toProxyWorkspaceUrl";

describe("toMorphVncUrl", () => {
  it("adds noVNC defaults for Morph workspaces", () => {
    const result = toMorphVncUrl(
      "https://port-39378-morphvm-abc123.http.cloud.morph.so/?foo=bar",
    );

    expect(result).toBe(
      "https://port-39380-morphvm-abc123.http.cloud.morph.so/vnc.html?autoconnect=1&resize=scale",
    );
  });
});

describe("toMorphXtermBaseUrl", () => {
  it("uses the direct Morph xterm host instead of legacy alias domains", () => {
    const result = toMorphXtermBaseUrl(
      "https://port-39378-morphvm-abc123.http.cloud.morph.so/?foo=bar",
    );

    expect(result).toBe(
      "https://port-39383-morphvm-abc123.http.cloud.morph.so/",
    );
  });
});

describe("toGenericVncUrl", () => {
  it("adds noVNC defaults for generic proxy workspaces", () => {
    const result = toGenericVncUrl(
      "https://port-39378-pvelxc-1cc7473f.alphasolves.com/?foo=bar",
    );

    expect(result).toBe(
      "https://port-39380-pvelxc-1cc7473f.alphasolves.com/vnc.html?autoconnect=1&resize=scale",
    );
  });
});

describe("toVncViewerUrl", () => {
  it("adds defaults when converting a base VNC URL", () => {
    const result = toVncViewerUrl(
      "https://vnc-201.example.com/?foo=bar",
    );

    expect(result).toBe(
      "https://vnc-201.example.com/vnc.html?foo=bar&autoconnect=1&resize=scale",
    );
  });

  it("forwards tkn onto the noVNC websockify path", () => {
    const result = toVncViewerUrl(
      "https://vnc-201.example.com/?tkn=secret-token",
    );

    expect(result).toBe(
      "https://vnc-201.example.com/vnc.html?tkn=secret-token&autoconnect=1&resize=scale&path=websockify%3Ftkn%3Dsecret-token",
    );
  });

  it("preserves explicit noVNC query params on an existing viewer URL", () => {
    const result = toVncViewerUrl(
      "https://vnc-201.example.com/vnc.html?autoconnect=0&resize=remote",
    );

    expect(result).toBe(
      "https://vnc-201.example.com/vnc.html?autoconnect=0&resize=remote",
    );
  });
});

describe("resolveBrowserPreviewUrl", () => {
  it("prefers vncUrl over workspaceUrl and applies defaults", () => {
    const result = resolveBrowserPreviewUrl({
      vncUrl: "https://vnc-201.example.com/",
      workspaceUrl:
        "https://port-39378-pvelxc-1cc7473f.alphasolves.com/?ignored=true",
    });

    expect(result).toBe(
      "https://vnc-201.example.com/vnc.html?autoconnect=1&resize=scale",
    );
  });
});

describe("toVncWebsocketUrl", () => {
  it("converts https to wss with /websockify path", () => {
    const result = toVncWebsocketUrl("https://vnc-201.example.com/");
    expect(result).toBe("wss://vnc-201.example.com/websockify");
  });

  it("converts http to ws", () => {
    const result = toVncWebsocketUrl("http://localhost:5900/");
    expect(result).toBe("ws://localhost:5900/websockify");
  });

  it("strips query params and hash", () => {
    const result = toVncWebsocketUrl(
      "https://vnc.example.com/vnc.html?foo=bar#hash"
    );
    expect(result).toBe("wss://vnc.example.com/websockify");
  });

  it("returns null for empty input", () => {
    expect(toVncWebsocketUrl("")).toBeNull();
  });
});

describe("toGenericVncWebsocketUrl", () => {
  it("converts Morph workspace URL to wss websocket URL", () => {
    const result = toGenericVncWebsocketUrl(
      "https://port-39378-morphvm-abc123.http.cloud.morph.so/"
    );
    expect(result).toBe(
      "wss://port-39380-morphvm-abc123.http.cloud.morph.so/websockify"
    );
  });

  it("converts PVE-LXC workspace URL to wss websocket URL", () => {
    const result = toGenericVncWebsocketUrl(
      "https://port-39378-pvelxc-1cc7473f.alphasolves.com/"
    );
    expect(result).toBe(
      "wss://port-39380-pvelxc-1cc7473f.alphasolves.com/websockify"
    );
  });

  it("returns null for non-port-based URLs", () => {
    expect(toGenericVncWebsocketUrl("https://example.com/")).toBeNull();
  });
});

describe("resolveBrowserPreviewWebsocketUrl", () => {
  it("converts bare VNC host to wss websocket URL", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      vncUrl: "https://vnc-201.example.com/",
    });
    expect(result).toBe("wss://vnc-201.example.com/websockify");
  });

  it("rewrites /vnc.html to websocket on same host/path", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      vncUrl: "https://vnc.example.com/vnc.html?autoconnect=1",
    });
    expect(result).toBe("wss://vnc.example.com/websockify");
  });

  it("extracts ?path= param as websocket pathname", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      vncUrl: "https://vnc.example.com/vnc/vnc.html?path=vnc/websockify",
    });
    expect(result).toBe("wss://vnc.example.com/vnc/websockify");
  });

  it("handles subpath routing with ?path= preserving exact path", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      vncUrl: "https://proxy.example.com/?path=/sandbox/123/websockify",
    });
    expect(result).toBe("wss://proxy.example.com/sandbox/123/websockify");
  });

  it("falls back to Morph workspace derivation", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      workspaceUrl: "https://port-39378-morphvm-xyz789.http.cloud.morph.so/",
    });
    expect(result).toBe(
      "wss://port-39380-morphvm-xyz789.http.cloud.morph.so/websockify"
    );
  });

  it("falls back to PVE-LXC workspace derivation", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      workspaceUrl: "https://port-39378-pvelxc-abc123.alphasolves.com/",
    });
    expect(result).toBe(
      "wss://port-39380-pvelxc-abc123.alphasolves.com/websockify"
    );
  });

  it("prefers vncUrl over workspaceUrl", () => {
    const result = resolveBrowserPreviewWebsocketUrl({
      vncUrl: "https://vnc-direct.example.com/",
      workspaceUrl: "https://port-39378-pvelxc-ignored.alphasolves.com/",
    });
    expect(result).toBe("wss://vnc-direct.example.com/websockify");
  });

  it("returns null when no URLs provided", () => {
    expect(resolveBrowserPreviewWebsocketUrl({})).toBeNull();
    expect(
      resolveBrowserPreviewWebsocketUrl({ vncUrl: null, workspaceUrl: null })
    ).toBeNull();
  });
});
