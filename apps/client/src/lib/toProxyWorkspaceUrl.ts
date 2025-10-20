const MORPH_HOST_REGEX = /^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$/;

interface MorphUrlComponents {
  url: URL;
  morphId: string;
  port: number;
}

function parseMorphUrl(input: string): MorphUrlComponents | null {
  if (!input.includes("morph.so")) {
    return null;
  }

  try {
    const url = new URL(input);
    const match = url.hostname.match(MORPH_HOST_REGEX);

    if (!match) {
      return null;
    }

    const [, portString, morphId] = match;
    const port = Number.parseInt(portString, 10);

    if (Number.isNaN(port)) {
      return null;
    }

    return {
      url,
      morphId,
      port,
    };
  } catch {
    return null;
  }
}

export function toProxyWorkspaceUrl(workspaceUrl: string): string {
  const components = parseMorphUrl(workspaceUrl);

  if (!components) {
    return workspaceUrl;
  }

  const scope = "base"; // Default scope
  const proxiedUrl = new URL(components.url.toString());
  proxiedUrl.hostname = `cmux-${components.morphId}-${scope}-${components.port}.cmux.app`;
  return proxiedUrl.toString();
}

export function toMorphVncUrl(sourceUrl: string): string | null {
  const components = parseMorphUrl(sourceUrl);

  if (!components) {
    return null;
  }

  const vncUrl = new URL(components.url.toString());
  vncUrl.hostname = `port-39380-morphvm-${components.morphId}.http.cloud.morph.so`;
  vncUrl.pathname = "/vnc.html";

  const searchParams = new URLSearchParams();
  searchParams.set("autoconnect", "1");
  searchParams.set("resize", "scale");
  vncUrl.search = `?${searchParams.toString()}`;
  vncUrl.hash = "";

  return vncUrl.toString();
}

function createMorphScopedHostname(
  morphId: string,
  port: number,
  scope: string = "base"
): string {
  return `cmux-${morphId}-${scope}-${port}.cmux.app`;
}

export function toTerminalServiceBaseUrl(
  workspaceUrl: string,
  options: { port?: number; scope?: string } = {}
): string | null {
  const port = options.port ?? 39383;
  const scope = options.scope ?? "base";
  const components = parseMorphUrl(workspaceUrl);

  if (components) {
    const proxiedUrl = new URL(components.url.toString());
    proxiedUrl.hostname = createMorphScopedHostname(
      components.morphId,
      port,
      scope
    );
    proxiedUrl.port = "";
    proxiedUrl.pathname = "/";
    proxiedUrl.search = "";
    proxiedUrl.hash = "";
    return proxiedUrl.origin;
  }

  try {
    const url = new URL(workspaceUrl);
    url.port = String(port);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}
