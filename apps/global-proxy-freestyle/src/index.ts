/**
 * Global Proxy for Freestyle Deployment
 *
 * This is a TypeScript port of the Rust global-proxy, designed to run on Freestyle's
 * edge deployment platform with custom domain support.
 *
 * Routing patterns:
 * - cmux-{morph_id}-{scope}-{port}.f.cmux.app -> port-39379-morphvm-{morph_id}.http.cloud.morph.so
 * - cmuf-{vm_id}-base-{port}.f.cmux.app -> {vm_id}.vm.freestyle.sh
 * - port-{port}-{morph_id}.f.cmux.app -> port-{port}-morphvm-{morph_id}.http.cloud.morph.so
 */

const MORPH_DOMAIN_SUFFIX = ".http.cloud.morph.so";
const FREESTYLE_DOMAIN_SUFFIX = ".vm.freestyle.sh";

interface ParsedRoute {
  type: "cmux" | "cmuf" | "port" | "workspace" | "invalid" | "root";
  target?: string;
  error?: string;
  port?: number;
  skipServiceWorker?: boolean;
  addCors?: boolean;
}

function parseHost(host: string): { subdomain: string | null; domain: string } | null {
  const normalized = host.toLowerCase().replace(/:\d+$/, "");

  // f.cmux.sh domain (Freestyle-hosted proxy)
  if (normalized === "f.cmux.sh") {
    return { subdomain: null, domain: "f.cmux.sh" };
  }
  if (normalized.endsWith(".f.cmux.sh")) {
    const prefix = normalized.slice(0, -".f.cmux.sh".length);
    return { subdomain: prefix || null, domain: "f.cmux.sh" };
  }

  // cmux.sh domain
  if (normalized === "cmux.sh") {
    return { subdomain: null, domain: "cmux.sh" };
  }
  if (normalized.endsWith(".cmux.sh")) {
    const prefix = normalized.slice(0, -".cmux.sh".length);
    return { subdomain: prefix || null, domain: "cmux.sh" };
  }

  return null;
}

function parseRoute(subdomain: string): ParsedRoute {
  // port-{port}-{morph_id} pattern
  if (subdomain.startsWith("port-")) {
    const rest = subdomain.slice("port-".length);
    const segments = rest.split("-");
    if (segments.length < 2) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const port = parseInt(segments[0], 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const morphId = segments.slice(1).join("-");
    if (!morphId) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const target = `https://port-${port}-morphvm-${morphId}${MORPH_DOMAIN_SUFFIX}`;
    return {
      type: "port",
      target,
      port,
      skipServiceWorker: port === 39378,
    };
  }

  // cmux-{morph_id}-{scope}-{port} pattern
  if (subdomain.startsWith("cmux-")) {
    const rest = subdomain.slice("cmux-".length);
    const segments = rest.split("-");
    if (segments.length < 2) {
      return { type: "invalid", error: "Invalid cmux proxy subdomain" };
    }

    const morphId = segments[0];
    if (!morphId) {
      return { type: "invalid", error: "Missing morph id in cmux proxy subdomain" };
    }

    const portSegment = segments[segments.length - 1];
    const port = parseInt(portSegment, 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid port in cmux proxy subdomain" };
    }

    // Route to port-39379 for cmux routes (the workspace proxy)
    const target = `https://port-39379-morphvm-${morphId}${MORPH_DOMAIN_SUFFIX}`;
    return {
      type: "cmux",
      target,
      port,
      skipServiceWorker: true,
      addCors: port !== 39378,
    };
  }

  // cmuf-{vm_id}-base-{port} pattern (Freestyle VMs)
  if (subdomain.startsWith("cmuf-")) {
    const rest = subdomain.slice("cmuf-".length);
    const segments = rest.split("-");
    if (segments.length < 3) {
      return { type: "invalid", error: "Invalid cmuf proxy subdomain" };
    }

    const vmId = segments[0];
    if (!vmId) {
      return { type: "invalid", error: "Missing vm id in cmuf proxy subdomain" };
    }

    const portSegment = segments[segments.length - 1];
    const port = parseInt(portSegment, 10);
    if (isNaN(port)) {
      return { type: "invalid", error: "Invalid port in cmuf proxy subdomain" };
    }

    const target = `https://${vmId}${FREESTYLE_DOMAIN_SUFFIX}`;
    return {
      type: "cmuf",
      target,
      port,
      skipServiceWorker: true,
      addCors: true,
    };
  }

  // workspace pattern: {workspace}-{port}-{vm_slug}
  const parts = subdomain.split("-");
  if (parts.length >= 3) {
    const portSegment = parts[parts.length - 2];
    const vmSlug = parts[parts.length - 1];
    const workspaceParts = parts.slice(0, -2);

    if (workspaceParts.length > 0 && vmSlug) {
      const port = parseInt(portSegment, 10);
      if (!isNaN(port)) {
        const target = `https://${vmSlug}${FREESTYLE_DOMAIN_SUFFIX}`;
        return {
          type: "workspace",
          target,
          port,
        };
      }
    }
  }

  return { type: "invalid", error: "Invalid cmux subdomain" };
}

function addCorsHeaders(headers: Headers): void {
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD");
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-expose-headers", "*");
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-max-age", "86400");
}

async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Health check
  if (url.pathname === "/health") {
    return Response.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  }

  // Get host from X-Forwarded-Host or Host header
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";

  // Version endpoint
  if (url.pathname === "/version") {
    const parsed = parseHost(host);
    if (!parsed || !parsed.subdomain) {
      return Response.json({
        version: "0.0.1",
        runtime: "freestyle",
      });
    }
  }

  const parsed = parseHost(host);
  if (!parsed) {
    return new Response("Not a cmux domain", { status: 502 });
  }

  if (!parsed.subdomain) {
    return new Response("cmux!", { status: 200 });
  }

  const route = parseRoute(parsed.subdomain);

  if (route.type === "invalid") {
    return new Response(route.error ?? "Invalid route", { status: 400 });
  }

  if (!route.target) {
    return new Response("No target for route", { status: 500 });
  }

  // Handle OPTIONS preflight
  if (request.method === "OPTIONS") {
    if (route.addCors) {
      const headers = new Headers();
      addCorsHeaders(headers);
      return new Response(null, { status: 204, headers });
    }
    return new Response(null, { status: 204 });
  }

  // Proxy the request
  const targetUrl = new URL(url.pathname + url.search, route.target);

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.set("host", new URL(route.target).host);
  proxyHeaders.set("x-cmux-proxied", "true");
  if (route.port) {
    proxyHeaders.set("x-cmux-port-internal", route.port.toString());
  }
  // Remove headers that shouldn't be forwarded
  proxyHeaders.delete("x-forwarded-host");

  try {
    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers: proxyHeaders,
      body: request.body,
      // @ts-expect-error duplex is required for streaming body in Node/Bun but not in DOM types
      duplex: "half",
    });

    const responseHeaders = new Headers(response.headers);

    // Add CORS headers if needed
    if (route.addCors) {
      addCorsHeaders(responseHeaders);
    }

    // Strip CSP headers
    responseHeaders.delete("content-security-policy");
    responseHeaders.delete("content-security-policy-report-only");
    responseHeaders.delete("x-frame-options");
    responseHeaders.delete("frame-options");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error);
    return new Response("Upstream fetch failed", { status: 502 });
  }
}

// Export for Freestyle
export default {
  fetch: handleRequest,
};
