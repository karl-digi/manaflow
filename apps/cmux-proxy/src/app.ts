// TODO: eslint mistakenly catches regex errors in the multiline string
/* eslint-disable no-useless-escape */

import { Hono } from "hono";
import { HTMLRewriter } from "htmlrewriter";

// Service worker content
const SERVICE_WORKER_JS = `

function isLoopbackHostname(hostname) {
  if (!hostname) {
    return false;
  }

  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    return true;
  }

  if (hostname === '::1' || hostname === '[::1]' || hostname === '::') {
    return true;
  }

  return /^127(?:\\.\\d{1,3}){3}$/.test(hostname);
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if request is to localhost or a loopback IP with a port
  if (isLoopbackHostname(url.hostname) && url.port) {
    // Get the morph ID from the current page's subdomain
    const currentHost = self.location.hostname;
    const morphIdMatch = currentHost.match(/port-\\\\d+-(.*)\\\\.(?:cmux\\\\.sh|cmux\\\\.app|autobuild\\\\.app)/);

    if (morphIdMatch) {
      const morphId = morphIdMatch[1];
      // Redirect to port-PORT-[morphid] on the same domain
      const domain = currentHost.match(/\\\\.(cmux\\\\.sh|cmux\\\\.app|autobuild\\\\.app)$/)?.[1] || 'cmux.app';
      const redirectUrl = \`https://port-\${url.port}-\${morphId}.\${domain}\${url.pathname}\${url.search}\`;

      // Create new headers, but let the browser handle Host header
      const headers = new Headers(event.request.headers);
      // Remove headers that might cause issues with proxying
      headers.delete('Host'); // Browser will set this correctly
      headers.set('Host', 'cmux.app');
      headers.delete('X-Forwarded-Host');
      headers.delete('X-Forwarded-For');
      headers.delete('X-Real-IP');

      // Create a completely new request to avoid any caching or DNS issues
      const newRequest = new Request(redirectUrl, {
        method: event.request.method,
        headers: headers,
        body: event.request.method !== 'GET' && event.request.method !== 'HEAD'
          ? event.request.body
          : undefined,
        mode: 'cors',
        credentials: event.request.credentials,
        redirect: 'follow',
      });

      event.respondWith(fetch(newRequest));
      return;
    }
  }

  // For all other requests, proceed normally
});`;

// Function to rewrite JavaScript code
function rewriteJavaScript(
  code: string,
  isExternalFile: boolean = false
): string {
  // Skip if it's our injected code
  if (code.includes("__CMUX_NO_REWRITE__")) {
    return code;
  }

  // For external files, we need to ensure __cmuxLocation exists first
  // since they might load before our injected script
  const prefix = isExternalFile
    ? `
// Injected by cmux proxy - ensure __cmuxLocation exists
(function() {
  if (typeof window === 'undefined') return;

  // If __cmuxLocation already exists, we're done
  if (window.__cmuxLocation && window.__cmuxLocation.href) return;

  // Create a temporary __cmuxLocation that uses real location
  // This will be replaced by our proxy once it loads
  if (!window.__cmuxLocation) {
    window.__cmuxLocation = window.location;
  }

  // Also ensure document.__cmuxLocation exists
  if (typeof document !== 'undefined' && !document.__cmuxLocation) {
    Object.defineProperty(document, '__cmuxLocation', {
      get: function() {
        return window.__cmuxLocation || window.location;
      },
      configurable: true
    });
  }
})();
`
    : "";

  // Replace various patterns of location access
  let modified = code
    // Replace window.location
    .replace(/\bwindow\.location\b/g, "window.__cmuxLocation")
    // Replace document.location
    .replace(/\bdocument\.location\b/g, "document.__cmuxLocation");

  // For external files, DON'T replace bare 'location' at all
  // It's too risky since we can't distinguish local variables from the global
  // The prefix we add ensures __cmuxLocation exists as a fallback anyway
  if (!isExternalFile) {
    // For inline scripts (in HTML), we can be more aggressive since we control them
    // But still be careful about obvious local variables
    modified = modified.replace(/\blocation\b/g, (match, offset) => {
      const before = modified.substring(Math.max(0, offset - 20), offset);
      const after = modified.substring(
        offset + match.length,
        Math.min(modified.length, offset + match.length + 10)
      );

      // Don't replace if it's a variable declaration
      if (/\b(const|let|var)\s+$/.test(before)) return match;

      // Don't replace if it's a destructuring pattern
      if (/[{,]\s*$/.test(before) && /\s*[:},]/.test(after)) return match;

      // Don't replace if it's a function parameter
      if (/\(\s*$/.test(before) || /^\s*[,)]/.test(after)) return match;

      // Don't replace if it's a property access (preceded by .)
      if (/\.\s*$/.test(before)) return match;

      // Don't replace if it's an object property key
      if (/^\s*:/.test(after)) return match;

      // Don't replace if it's preceded by __cmux (to avoid double replacement)
      if (/__cmux$/.test(before)) return match;

      return "__cmuxLocation";
    });
  }

  // Fix any accidental double replacements
  modified = modified
    .replace(/window\.__cmux__cmuxLocation/g, "window.__cmuxLocation")
    .replace(/document\.__cmux__cmuxLocation/g, "document.__cmuxLocation")
    .replace(/__cmux__cmuxLocation/g, "__cmuxLocation");

  return prefix + modified;
}

// Strip headers that no longer match the rewritten body contents.
const REWRITTEN_RESPONSE_IGNORED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-md5",
  "content-digest",
  "etag",
];

// Also strip transfer-encoding from HTML responses to avoid duplicates
const HTML_RESPONSE_IGNORED_HEADERS = [...REWRITTEN_RESPONSE_IGNORED_HEADERS];

function sanitizeRewrittenResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);

  for (const header of REWRITTEN_RESPONSE_IGNORED_HEADERS) {
    headers.delete(header);
  }

  return headers;
}

function sanitizeHTMLResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);

  for (const header of HTML_RESPONSE_IGNORED_HEADERS) {
    headers.delete(header);
  }

  return headers;
}

// Strip CSP and frame-blocking headers that might block proxied content or iframe embedding
function stripCSPHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.delete("x-frame-options"); // Prevents iframe embedding restrictions
  headers.delete("frame-options"); // Legacy variant
  return headers;
}

// Add permissive CORS headers
function addPermissiveCORS(headers: Headers): Headers {
  headers.set("access-control-allow-origin", "*");
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD"
  );
  headers.set("access-control-allow-headers", "*");
  headers.set("access-control-expose-headers", "*");
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-max-age", "86400");
  return headers;
}

// HTMLRewriter for script tags (currently unused, but kept for potential future use)
class ScriptRewriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  element(_element: any) {
    // Currently no-op
  }
}

// HTMLRewriter to remove CSP meta tags
class MetaCSPRewriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  element(element: any) {
    const httpEquiv = element.getAttribute("http-equiv");
    if (httpEquiv?.toLowerCase() === "content-security-policy") {
      element.remove();
    }
  }
}

class HeadRewriter {
  private skipServiceWorker: boolean;

  constructor(skipServiceWorker: boolean = false) {
    this.skipServiceWorker = skipServiceWorker;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  element(element: any) {
    // Config script with localhost interceptors
    element.prepend(
      `<script data-cmux-injected="true">
// __CMUX_NO_REWRITE__ - This marker prevents this script from being rewritten
window.cmuxConfig = {
  taskRunId: "foo"
};

// Store the real location object (before any rewriting happens)
const __realLocation = window.location;

// Determine if a hostname should be treated as loopback/local
function isLoopbackHostname(hostname) {
  if (!hostname) {
    return false;
  }

  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    return true;
  }

  if (hostname === '::1' || hostname === '[::1]' || hostname === '::') {
    return true;
  }

  return /^127(?:\\.\\d{1,3}){3}$/.test(hostname);
}

// Function to replace loopback URLs with cmux.app proxy
function replaceLocalhostUrl(url) {
  try {
    const urlObj = new URL(url, __realLocation.href);
    if (isLoopbackHostname(urlObj.hostname) && urlObj.port) {
      const currentHost = __realLocation.hostname;
      const morphIdMatch = currentHost.match(/port-\\\\d+-(.*)\\\\.(?:cmux\\\\.sh|cmux\\\\.app|autobuild\\\\.app)/);

      if (morphIdMatch) {
        const morphId = morphIdMatch[1];
        const domain = currentHost.match(/\\\\.(cmux\\\\.sh|cmux\\\\.app|autobuild\\\\.app)$/)?.[1] || 'cmux.app';
        urlObj.protocol = 'https:';
        urlObj.hostname = \`port-\${urlObj.port}-\${morphId}.\${domain}\`;
        urlObj.port = '';
        return urlObj.toString();
      }
    }
    return url;
  } catch {
    return url;
  }
}

// Create our proxy location object that intercepts everything
const __cmuxLocation = new Proxy({}, {
  get(target, prop) {
    // Special handling for Symbol properties
    if (prop === Symbol.toStringTag) {
      return 'Location';
    }
    if (prop === Symbol.toPrimitive) {
      return function(hint) {
        return __realLocation.href;
      };
    }

    // Handle methods that need URL rewriting
    if (prop === 'assign') {
      return function(url) {
        const newUrl = replaceLocalhostUrl(url);
        return __realLocation.assign(newUrl);
      };
    }
    if (prop === 'replace') {
      return function(url) {
        const newUrl = replaceLocalhostUrl(url);
        return __realLocation.replace(newUrl);
      };
    }
    if (prop === 'reload') {
      return function() {
        return __realLocation.reload.apply(__realLocation, arguments);
      };
    }

    // Handle toString specially
    if (prop === 'toString') {
      return function() {
        return __realLocation.toString();
      };
    }
    if (prop === 'valueOf') {
      return function() {
        return __realLocation.valueOf();
      };
    }

    // Handle all location properties - make sure they exist!
    // These are all the standard Location properties
    const locationProps = [
      'href', 'origin', 'protocol', 'host', 'hostname', 'port',
      'pathname', 'search', 'hash', 'username', 'password', 'searchParams'
    ];

    if (locationProps.includes(prop)) {
      return __realLocation[prop];
    }

    // Handle any other property access
    const value = __realLocation[prop];
    if (value !== undefined) {
      if (typeof value === 'function') {
        return value.bind(__realLocation);
      }
      return value;
    }

    // Return undefined for unknown properties
    return undefined;
  },
  set(target, prop, value) {
    if (prop === 'href') {
      const newUrl = replaceLocalhostUrl(value);
      __realLocation.href = newUrl;
      return true;
    }

    // Allow setting other properties that are settable
    const settableProps = ['hash', 'search', 'pathname', 'port', 'hostname', 'host', 'protocol'];
    if (settableProps.includes(prop)) {
      // For these, we might want to check if they result in localhost URLs
      __realLocation[prop] = value;
      return true;
    }

    // Ignore attempts to set read-only properties
    return true;
  },
  has(target, prop) {
    // Report that we have all the properties that location has
    return prop in __realLocation;
  },
  ownKeys(target) {
    // Return all keys from real location for spread operator support
    return Object.keys(__realLocation);
  },
  getOwnPropertyDescriptor(target, prop) {
    // Return descriptor from real location
    return Object.getOwnPropertyDescriptor(__realLocation, prop);
  }
});

// Create global alias for debugging and iframe access
window.__cmuxLocation = __cmuxLocation;
window.__cmuxLocationProxy = __cmuxLocation; // Store the actual proxy separately
// Don't assign window.location directly as it might cause issues

// Create a global __cmuxLocation variable for bare references
try {
  Object.defineProperty(window, '__cmuxLocation', {
    value: __cmuxLocation,
    writable: false,
    configurable: true
  });
} catch (e) {
  // Already defined, that's fine
}

// Also set on parent and top for iframe access
try {
  if (window.parent && window.parent !== window) {
    window.parent.__cmuxLocation = __cmuxLocation;
  }
} catch (e) {
  // Cross-origin, can't access
}

try {
  if (window.top && window.top !== window) {
    window.top.__cmuxLocation = __cmuxLocation;
  }
} catch (e) {
  // Cross-origin, can't access
}

// Setup for future iframes
const originalGetElementById = document.getElementById;
if (originalGetElementById) {
  document.getElementById = function(id) {
    const element = originalGetElementById.call(this, id);
    if (element && element.tagName === 'IFRAME') {
      try {
        // Try to set __cmuxLocation on the iframe's contentWindow
        if (element.contentWindow) {
          element.contentWindow.__cmuxLocation = __cmuxLocation;
        }
      } catch (e) {
        // Cross-origin or not ready
      }
    }
    return element;
  };
}

// Override document.location too
try {
  Object.defineProperty(document, 'location', {
    get() { return __cmuxLocation; },
    set(value) {
      const newUrl = replaceLocalhostUrl(value);
      __realLocation.href = newUrl;
    },
    configurable: true
  });
} catch (e) {
}

// Also set document.__cmuxLocation for compatibility
document.__cmuxLocation = __cmuxLocation;

// Try to override window.location (this often fails but worth trying)
try {
  Object.defineProperty(window, 'location', {
    get() { return __cmuxLocation; },
    set(value) {
      if (typeof value === 'string') {
        const newUrl = replaceLocalhostUrl(value);
        __realLocation.href = newUrl;
      } else {
        __realLocation = value;
      }
    },
    configurable: true
  });
} catch (e) {
  // Expected to fail in most browsers
}

// Intercept window.open
const originalOpen = window.open;
window.open = function(url, ...args) {
  const newUrl = replaceLocalhostUrl(url);
  return originalOpen.call(this, newUrl, ...args);
};

// Intercept anchor tag clicks
document.addEventListener('click', function(e) {
  const target = e.target.closest('a');
  if (target && target.href) {
    const originalHref = target.getAttribute('href');
    const newUrl = replaceLocalhostUrl(target.href);
    if (newUrl !== target.href) {
      e.preventDefault();
      window.location.href = newUrl;
    }
  }
}, true);

// Intercept form submissions
document.addEventListener('submit', function(e) {
  const form = e.target;
  if (form && form.action) {
    const newAction = replaceLocalhostUrl(form.action);
    if (newAction !== form.action) {
      form.action = newAction;
    }
  }
}, true);

// Intercept history.pushState and history.replaceState
const originalPushState = history.pushState;
history.pushState = function(state, title, url) {
  if (url) {
    const newUrl = replaceLocalhostUrl(url);
    return originalPushState.call(this, state, title, newUrl);
  }
  return originalPushState.apply(this, arguments);
};

const originalReplaceState = history.replaceState;
history.replaceState = function(state, title, url) {
  if (url) {
    const newUrl = replaceLocalhostUrl(url);
    return originalReplaceState.call(this, state, title, newUrl);
  }
  return originalReplaceState.apply(this, arguments);
};


// Monitor for dynamically added elements with onclick handlers (wait for body to exist)
function startMutationObserver() {
  if (!document.body) {
    // If body doesn't exist yet, wait and try again
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startMutationObserver);
    }
    return;
  }

  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'onclick') {
        const element = mutation.target;
        const onclickStr = element.getAttribute('onclick');
        if (onclickStr && onclickStr.includes('localhost')) {
          console.warn('Detected onclick with localhost:', onclickStr);
          // Note: We can't easily intercept inline onclick, but the location interceptors above should catch it
        }
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['onclick'],
    subtree: true,
    childList: true
  });
}

startMutationObserver();
</script>`,
      { html: true }
    );

    // Service worker registration script (conditional)
    if (!this.skipServiceWorker) {
      element.prepend(
        `<script data-cmux-injected="true">
// __CMUX_NO_REWRITE__ - This marker prevents this script from being rewritten
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/proxy-sw.js', { scope: '/' }).catch(console.error);
}
</script>`,
        { html: true }
      );
    }
  }
}

const LOOPBACK_V4_REGEX = /^127(?:\.\d{1,3}){3}$/;

function isLoopbackHostnameValue(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }

  const normalized = hostname.toLowerCase();

  if (normalized === "localhost" || normalized === "0.0.0.0") {
    return true;
  }

  if (normalized === "::1" || normalized === "[::1]" || normalized === "::") {
    return true;
  }

  return LOOPBACK_V4_REGEX.test(normalized);
}

function rewriteLoopbackRedirect(
  response: Response,
  buildProxyHost: (port: string) => string | null
): Response {
  const location = response.headers.get("location");
  if (!location) {
    return response;
  }

  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return response; // relative URL or invalid — nothing to rewrite
  }

  if (!isLoopbackHostnameValue(parsed.hostname)) {
    return response;
  }

  const port = parsed.port;
  const proxyHost = buildProxyHost(port);
  if (!proxyHost) {
    return response;
  }

  parsed.protocol = "https:";
  parsed.hostname = proxyHost;
  parsed.port = ""; // ensure host has no explicit port

  const rewritten = parsed.toString();
  if (rewritten === location) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("location", rewritten);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Helper to transform Response body with HTMLRewriter
async function transformHTML(
  response: Response,
  rewriter: typeof HTMLRewriter.prototype,
  customHeaders?: Headers
): Promise<Response> {
  console.log(`[transformHTML] Starting transformation...`);
  // Transform the response directly with HTMLRewriter
  const transformedResponse = rewriter.transform(response);
  console.log(`[transformHTML] Rewriter.transform() complete, reading body...`);

  // Return the transformed response with custom headers if provided
  const body = await transformedResponse.arrayBuffer();
  console.log(`[transformHTML] Body read, size: ${body.byteLength} bytes`);

  // Use custom headers or response headers, and set Content-Length to avoid chunked encoding
  const headers = customHeaders || new Headers(response.headers);
  const hadTransferEncoding = headers.has("transfer-encoding");
  headers.set("Content-Length", body.byteLength.toString());
  console.log(
    `[transformHTML] Set Content-Length=${body.byteLength}, had transfer-encoding before: ${hadTransferEncoding}, has transfer-encoding now: ${headers.has("transfer-encoding")}`
  );

  const result = new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers,
  });
  console.log(
    `[transformHTML] Created new Response, checking final headers...`
  );
  console.log(
    `[transformHTML] Final response has transfer-encoding: ${result.headers.has("transfer-encoding")}, has content-length: ${result.headers.has("content-length")}`
  );

  return result;
}

// Helper to detect domain and extract subdomain
function parseCmuxDomain(
  host: string
): { subdomain: string; domain: string } | null {
  const normalized = host.toLowerCase();

  // Check for cmux.sh
  if (normalized === "cmux.sh") {
    return { subdomain: "", domain: "cmux.sh" };
  }
  if (normalized.endsWith(".cmux.sh")) {
    return {
      subdomain: normalized.slice(0, -".cmux.sh".length),
      domain: "cmux.sh",
    };
  }

  // Check for cmux.app
  if (normalized === "cmux.app") {
    return { subdomain: "", domain: "cmux.app" };
  }
  if (normalized.endsWith(".cmux.app")) {
    return {
      subdomain: normalized.slice(0, -".cmux.app".length),
      domain: "cmux.app",
    };
  }

  // Check for autobuild.app
  if (normalized === "autobuild.app") {
    return { subdomain: "", domain: "autobuild.app" };
  }
  if (normalized.endsWith(".autobuild.app")) {
    return {
      subdomain: normalized.slice(0, -".autobuild.app".length),
      domain: "autobuild.app",
    };
  }

  return null;
}

export function createApp() {
  const app = new Hono();

  app.get("/health", (c) => {
    return c.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  app.all("*", async (c) => {
    const request = c.req.raw;
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    const parsed = parseCmuxDomain(host);

    // Root apex: reply with greeting
    if (parsed && !parsed.subdomain) {
      return c.text("cmux!", 200);
    }

    if (parsed) {
      const sub = parsed.subdomain;
      const domain = parsed.domain;

      // Serve the service worker file
      if (url.pathname === "/proxy-sw.js") {
        return new Response(SERVICE_WORKER_JS, {
          headers: {
            "content-type": "application/javascript",
            "cache-control": "no-cache",
          },
        });
      }

      // Check if subdomain starts with "port-" (hacky heuristic for Morph routing)
      if (sub.startsWith("port-")) {
        // Handle OPTIONS preflight for port-39378
        if (sub.startsWith("port-39378") && request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: addPermissiveCORS(new Headers()),
          });
        }

        // Prevent infinite loops - check if we're already proxying
        const isAlreadyProxied =
          request.headers.get("X-Cmux-Proxied") === "true";
        if (isAlreadyProxied) {
          return c.text("Loop detected in proxy", 508);
        }

        // Format: port-<port>-<vmSlug> -> port-<port>-morphvm-<vmSlug>
        // Example: port-8101-j2z9smmu.cmux.sh -> port-8101-morphvm-j2z9smmu.http.cloud.morph.so
        const parts = sub.split("-");
        if (parts.length >= 3) {
          // Insert "morphvm" after the port number
          const morphId = parts.slice(2).join("-");
          const morphSubdomain = `${parts[0]}-${parts[1]}-morphvm-${morphId}`;
          const target = new URL(
            url.pathname + url.search,
            `https://${morphSubdomain}.http.cloud.morph.so`
          );

          // Add header to prevent loops
          const headers = new Headers(request.headers);
          headers.set("X-Cmux-Proxied", "true");

          const outbound = new Request(target, {
            method: request.method,
            headers: headers,
            body: request.body,
            redirect: "manual",
          });

          // WebSocket upgrades must be returned directly without modification
          const upgradeHeader = request.headers.get("Upgrade");
          if (upgradeHeader?.toLowerCase() === "websocket") {
            return fetch(outbound);
          }

          let response = await fetch(outbound);

          response = rewriteLoopbackRedirect(response, (redirectPort) => {
            if (!redirectPort || !/^\d+$/.test(redirectPort)) {
              return null;
            }
            return `port-${redirectPort}-${morphId}.${domain}`;
          });

          const contentType = response.headers.get("content-type") || "";
          const skipServiceWorker = sub.startsWith("port-39378");

          // Apply HTMLRewriter to HTML responses
          if (contentType.includes("text/html")) {
            let responseHeaders = sanitizeHTMLResponseHeaders(response.headers);
            responseHeaders = stripCSPHeaders(responseHeaders);
            if (skipServiceWorker) {
              responseHeaders = addPermissiveCORS(responseHeaders);
            }
            const rewriter = new HTMLRewriter()
              .on("head", new HeadRewriter(skipServiceWorker))
              .on("script", new ScriptRewriter());

            // Remove CSP meta tags for port-39378
            if (skipServiceWorker) {
              rewriter.on("meta", new MetaCSPRewriter());
            }

            return await transformHTML(response, rewriter, responseHeaders);
          }

          // Rewrite JavaScript files
          if (
            contentType.includes("javascript") ||
            url.pathname.endsWith(".js")
          ) {
            const text = await response.text();
            const rewritten = rewriteJavaScript(text, true); // external files
            let sanitizedHeaders = sanitizeRewrittenResponseHeaders(
              response.headers
            );
            sanitizedHeaders = stripCSPHeaders(sanitizedHeaders);
            if (skipServiceWorker) {
              sanitizedHeaders = addPermissiveCORS(sanitizedHeaders);
            }
            return new Response(rewritten, {
              status: response.status,
              statusText: response.statusText,
              headers: sanitizedHeaders,
            });
          }

          // For all other content types (images, CSS, etc.)
          const bodyBytes = await response.arrayBuffer();
          let responseHeaders = sanitizeRewrittenResponseHeaders(
            response.headers
          );
          responseHeaders = stripCSPHeaders(responseHeaders);
          if (skipServiceWorker) {
            responseHeaders = addPermissiveCORS(responseHeaders);
          }
          responseHeaders.set(
            "Content-Length",
            bodyBytes.byteLength.toString()
          );
          return new Response(bodyBytes, {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
          });
        }
      }

      if (sub.startsWith("cmux-")) {
        // Handle OPTIONS preflight for CORS
        if (request.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: addPermissiveCORS(new Headers()),
          });
        }

        const isAlreadyProxied =
          request.headers.get("X-Cmux-Proxied") === "true";
        if (isAlreadyProxied) {
          return c.text("Loop detected in proxy", 508);
        }

        const remainder = sub.slice("cmux-".length);
        const segments = remainder.split("-");
        if (segments.length < 2) {
          return c.text("Invalid cmux proxy subdomain", 400);
        }

        const portSegment = segments[segments.length - 1];
        if (!/^\d+$/.test(portSegment)) {
          return c.text("Invalid port in cmux proxy subdomain", 400);
        }

        const morphId = segments[0];
        if (!morphId) {
          return c.text("Missing morph id in cmux proxy subdomain", 400);
        }

        const scopeSegments = segments.slice(1, -1);
        const hasExplicitScope = scopeSegments.length > 0;
        const scopeRaw = hasExplicitScope ? scopeSegments.join("-") : "base";
        const isBaseScope =
          !hasExplicitScope ||
          (scopeSegments.length === 1 &&
            scopeSegments[0].toLowerCase() === "base");

        // Port 39379 is the cmux backend router that dispatches to internal ports
        // based on the X-Cmux-Port-Internal header
        const targetUrl = `https://port-39379-morphvm-${morphId}.http.cloud.morph.so${url.pathname}${url.search}`;
        console.log(`[cmux-proxy] Proxying cmux- request to: ${targetUrl}`);
        console.log(
          `[cmux-proxy] Headers: X-Cmux-Port-Internal=${portSegment}, X-Cmux-Workspace-Internal=${isBaseScope ? "(none)" : scopeRaw}`
        );

        const target = new URL(targetUrl);

        const headers = new Headers(request.headers);
        headers.set("X-Cmux-Proxied", "true");
        headers.set("X-Cmux-Port-Internal", portSegment);
        headers.delete("X-Cmux-Workspace-Internal");
        if (!isBaseScope) {
          headers.set("X-Cmux-Workspace-Internal", scopeRaw);
        }
        // Set the correct Host header for the backend
        headers.set("Host", target.hostname);

        const outbound = new Request(target, {
          method: request.method,
          headers,
          body: request.body,
          redirect: "manual",
        });

        // Check if this is a WebSocket request
        // VS Code WebSocket URLs match pattern: /stable-{hash} (with optional query string, but no additional path segments)
        const isVSCodeWebSocket = url.pathname.match(/^\/stable-[a-f0-9]+$/);
        const upgradeHeader = request.headers.get("Upgrade");
        const connectionHeader = request.headers.get("Connection");

        // Log all headers for WebSocket paths to debug
        if (isVSCodeWebSocket) {
          console.log(
            `[cmux-proxy] VS Code WebSocket path detected: ${url.pathname}`
          );
          const headerObj: Record<string, string> = {};
          request.headers.forEach((value, key) => {
            headerObj[key] = value;
          });
          console.log(
            `[cmux-proxy] Request headers:`,
            JSON.stringify(headerObj)
          );
        }

        console.log(
          `[cmux-proxy] Path: ${url.pathname}, isVSCodeWebSocket: ${!!isVSCodeWebSocket}, Upgrade: ${upgradeHeader}, Connection: ${connectionHeader}`
        );

        // WebSocket upgrades must be returned directly without modification
        if (upgradeHeader?.toLowerCase() === "websocket") {
          console.log(
            `[cmux-proxy] Detected WebSocket upgrade header, passing through...`
          );
          return fetch(outbound);
        }

        console.log(`[cmux-proxy] Fetching from backend...`);
        const fetchStart = Date.now();
        let response;
        try {
          response = await fetch(outbound);
          const fetchDuration = Date.now() - fetchStart;
          console.log(
            `[cmux-proxy] Backend response: status=${response.status}, content-type=${response.headers.get("content-type")}, duration=${fetchDuration}ms`
          );
        } catch (error) {
          const fetchDuration = Date.now() - fetchStart;
          console.error(
            `[cmux-proxy] Backend fetch error after ${fetchDuration}ms:`,
            error
          );
          throw error;
        }

        response = rewriteLoopbackRedirect(response, (redirectPort) => {
          if (!redirectPort || !/^\d+$/.test(redirectPort)) {
            return null;
          }
          const scopeLabel = isBaseScope ? "base" : scopeRaw;
          return `cmux-${morphId}-${scopeLabel}-${redirectPort}.${domain}`;
        });

        const contentType = response.headers.get("content-type") || "";
        const skipServiceWorker = true; // Always add permissive CORS for cmux- routes

        if (contentType.includes("text/html")) {
          console.log(`[cmux-proxy] Preparing HTML transformation...`);

          let responseHeaders = sanitizeHTMLResponseHeaders(response.headers);
          responseHeaders = stripCSPHeaders(responseHeaders);
          responseHeaders = addPermissiveCORS(responseHeaders); // Always add CORS
          console.log(
            `[cmux-proxy] Headers after sanitization - has transfer-encoding: ${responseHeaders.has("transfer-encoding")}`
          );

          const rewriter = new HTMLRewriter()
            .on("head", new HeadRewriter(skipServiceWorker))
            .on("script", new ScriptRewriter());

          if (skipServiceWorker) {
            rewriter.on("meta", new MetaCSPRewriter());
          }

          console.log(`[cmux-proxy] Starting HTML transformation...`);
          const result = await transformHTML(
            response,
            rewriter,
            responseHeaders
          );
          console.log(`[cmux-proxy] HTML transformation complete`);
          return result;
        }

        if (
          contentType.includes("javascript") ||
          url.pathname.endsWith(".js")
        ) {
          const text = await response.text();
          const rewritten = rewriteJavaScript(text, true);
          let sanitizedHeaders = sanitizeRewrittenResponseHeaders(
            response.headers
          );
          sanitizedHeaders = stripCSPHeaders(sanitizedHeaders);
          sanitizedHeaders = addPermissiveCORS(sanitizedHeaders); // Always add CORS
          return new Response(rewritten, {
            status: response.status,
            statusText: response.statusText,
            headers: sanitizedHeaders,
          });
        }

        // For all other content types (images, CSS, etc.)
        console.log(
          `[cmux-proxy] Handling non-HTML/JS content type: ${contentType}`
        );
        const bodyBytes = await response.arrayBuffer();
        let responseHeaders = sanitizeRewrittenResponseHeaders(
          response.headers
        );
        responseHeaders = stripCSPHeaders(responseHeaders);
        responseHeaders = addPermissiveCORS(responseHeaders); // Always add CORS
        responseHeaders.set("Content-Length", bodyBytes.byteLength.toString());
        console.log(
          `[cmux-proxy] Returning response with ${bodyBytes.byteLength} bytes`
        );
        return new Response(bodyBytes, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }

      // Original routing logic for non-Morph subdomains
      const parts = sub.split("-").filter(Boolean);

      // Expect: <workspace...>-<port>-<vmSlug>
      if (parts.length < 3) {
        return c.text("Invalid cmux subdomain", 400);
      }

      // Prevent infinite loops
      const isAlreadyProxied = request.headers.get("X-Cmux-Proxied") === "true";
      if (isAlreadyProxied) {
        return c.text("Loop detected in proxy", 508);
      }

      const vmSlug = parts[parts.length - 1];
      const port = parts[parts.length - 2];
      const workspace = parts.slice(0, -2).join("-");

      if (!workspace) {
        return c.text("Missing workspace in subdomain", 400);
      }
      if (!/^\d+$/.test(port)) {
        return c.text("Invalid port in subdomain", 400);
      }

      const target = new URL(
        url.pathname + url.search,
        `https://${vmSlug}.vm.freestyle.sh`
      );

      // Copy headers and inject cmux internals, avoid mutating the original
      const headers = new Headers(request.headers);
      headers.set("X-Cmux-Workspace-Internal", workspace);
      headers.set("X-Cmux-Port-Internal", port);
      headers.set("X-Cmux-Proxied", "true"); // Prevent loops

      const outbound = new Request(target, {
        method: request.method,
        headers,
        body: request.body,
        redirect: "manual",
      });

      // WebSocket upgrades must be returned directly without modification
      const upgradeHeader = request.headers.get("Upgrade");
      if (upgradeHeader?.toLowerCase() === "websocket") {
        return fetch(outbound);
      }

      let response = await fetch(outbound);

      response = rewriteLoopbackRedirect(response, (redirectPort) => {
        if (!redirectPort || !/^\d+$/.test(redirectPort)) {
          return null;
        }

        return `${workspace}-${redirectPort}-${vmSlug}.${domain}`;
      });

      const contentType = response.headers.get("content-type") || "";
      const skipServiceWorker = sub.startsWith("port-39378");

      // Apply HTMLRewriter to HTML responses
      if (contentType.includes("text/html")) {
        let responseHeaders = sanitizeHTMLResponseHeaders(response.headers);
        responseHeaders = stripCSPHeaders(responseHeaders);
        if (skipServiceWorker) {
          responseHeaders = addPermissiveCORS(responseHeaders);
        }
        const rewriter = new HTMLRewriter()
          .on("head", new HeadRewriter(skipServiceWorker))
          .on("script", new ScriptRewriter());

        // Remove CSP meta tags for port-39378
        if (skipServiceWorker) {
          rewriter.on("meta", new MetaCSPRewriter());
        }

        return await transformHTML(response, rewriter, responseHeaders);
      }

      // Rewrite JavaScript files
      if (contentType.includes("javascript") || url.pathname.endsWith(".js")) {
        const text = await response.text();
        const rewritten = rewriteJavaScript(text, true); // external files
        let sanitizedHeaders = sanitizeRewrittenResponseHeaders(
          response.headers
        );
        sanitizedHeaders = stripCSPHeaders(sanitizedHeaders);
        if (skipServiceWorker) {
          sanitizedHeaders = addPermissiveCORS(sanitizedHeaders);
        }
        return new Response(rewritten, {
          status: response.status,
          statusText: response.statusText,
          headers: sanitizedHeaders,
        });
      }

      // For all other content types (images, CSS, etc.)
      const bodyBytes = await response.arrayBuffer();
      let responseHeaders = sanitizeRewrittenResponseHeaders(response.headers);
      responseHeaders = stripCSPHeaders(responseHeaders);
      if (skipServiceWorker) {
        responseHeaders = addPermissiveCORS(responseHeaders);
      }
      responseHeaders.set("Content-Length", bodyBytes.byteLength.toString());
      return new Response(bodyBytes, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    }

    // Not our domain — pass-through or block; pass-through by default
    return fetch(request);
  });

  return app;
}
