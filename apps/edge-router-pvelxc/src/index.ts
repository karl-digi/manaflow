// Edge Router for PVE-LXC sandboxes on alphasolves.com
// Based on apps/edge-router/src/index.ts but modified for PVE-LXC URL patterns

// Service worker content for PVE-LXC
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
    // Get the instance ID from the current page's subdomain
    const currentHost = self.location.hostname;
    const instanceMatch = currentHost.match(/port-\\d+-pvelxc-([^.]+)\\.alphasolves\\.com/);

    if (instanceMatch) {
      const instanceId = instanceMatch[1];
      // Redirect to port-PORT-pvelxc-[instanceId].alphasolves.com
      const redirectUrl = \`https://port-\${url.port}-pvelxc-\${instanceId}.alphasolves.com\${url.pathname}\${url.search}\`;

      // Create new headers, but let the browser handle Host header
      const headers = new Headers(event.request.headers);
      headers.delete('Host');
      headers.set('Host', 'alphasolves.com');
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
  isExternalFile: boolean = false,
): string {
  // Skip if it's our injected code
  if (code.includes("__CMUX_NO_REWRITE__")) {
    return code;
  }

  // For external files, we need to ensure __cmuxLocation exists first
  const prefix = isExternalFile
    ? `
// Injected by cmux proxy - ensure __cmuxLocation exists
(function() {
  if (typeof window === 'undefined') return;

  // If __cmuxLocation already exists, we're done
  if (window.__cmuxLocation && window.__cmuxLocation.href) return;

  // Create a temporary __cmuxLocation that uses real location
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
    .replace(/\bwindow\.location\b/g, "window.__cmuxLocation")
    .replace(/\bdocument\.location\b/g, "document.__cmuxLocation");

  if (!isExternalFile) {
    modified = modified.replace(/\blocation\b/g, (match, offset) => {
      const before = modified.substring(Math.max(0, offset - 20), offset);
      const after = modified.substring(
        offset + match.length,
        Math.min(modified.length, offset + match.length + 10),
      );

      if (/\b(const|let|var)\s+$/.test(before)) return match;
      if (/[{,]\s*$/.test(before) && /\s*[:},]/.test(after)) return match;
      if (/\(\s*$/.test(before) || /^\s*[,)]/.test(after)) return match;
      if (/\.\s*$/.test(before)) return match;
      if (/^\s*:/.test(after)) return match;
      if (/__cmux$/.test(before)) return match;

      return "__cmuxLocation";
    });
  }

  modified = modified
    .replace(/window\.__cmux__cmuxLocation/g, "window.__cmuxLocation")
    .replace(/document\.__cmux__cmuxLocation/g, "document.__cmuxLocation")
    .replace(/__cmux__cmuxLocation/g, "__cmuxLocation");

  return prefix + modified;
}

const REWRITTEN_RESPONSE_IGNORED_HEADERS = [
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "content-md5",
  "content-digest",
  "etag",
];

function sanitizeRewrittenResponseHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  for (const header of REWRITTEN_RESPONSE_IGNORED_HEADERS) {
    headers.delete(header);
  }
  return headers;
}

function stripCSPHeaders(source: Headers): Headers {
  const headers = new Headers(source);
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  return headers;
}

function addPermissiveCORS(headers: Headers, origin?: string | null): Headers {
  // Use the request origin if provided, otherwise use * (but * is incompatible with credentials)
  // When credentials mode is 'include', browsers require the exact origin, not *
  if (origin) {
    headers.set("access-control-allow-origin", origin);
  } else {
    headers.set("access-control-allow-origin", "*");
  }
  headers.set(
    "access-control-allow-methods",
    "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
  );
  headers.set(
    "access-control-allow-headers",
    "Authorization, Content-Type, X-Client-Version, X-Client-Type, X-Request-Id, Accept, Origin, Cache-Control",
  );
  headers.set("access-control-expose-headers", "*");
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-max-age", "86400");
  return headers;
}

function fixCORSForCredentials(headers: Headers, origin: string | null): Headers {
  // If request has Origin and response has allow-credentials=true but allow-origin=*,
  // browsers will reject it. Fix by replacing * with the actual origin.
  // Also always set credentials=true for cross-origin requests with Authorization headers.
  const allowOrigin = headers.get("access-control-allow-origin");
  
  if (origin && allowOrigin === "*") {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-credentials", "true");
  }
  
  return headers;
}

class ScriptRewriter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  element(_element: any) {
    // Currently no-op
  }
}

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
    // Config script with localhost interceptors for PVE-LXC
    element.prepend(
      `<script data-cmux-injected="true">
// __CMUX_NO_REWRITE__ - This marker prevents this script from being rewritten
window.cmuxConfig = {
  provider: "pvelxc"
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

// Function to replace loopback URLs with alphasolves.com proxy
function replaceLocalhostUrl(url) {
  try {
    const urlObj = new URL(url, __realLocation.href);
    if (isLoopbackHostname(urlObj.hostname) && urlObj.port) {
      const currentHost = __realLocation.hostname;
      const instanceMatch = currentHost.match(/port-\\d+-pvelxc-([^.]+)\\.alphasolves\\.com/);

      if (instanceMatch) {
        const instanceId = instanceMatch[1];
        urlObj.protocol = 'https:';
        urlObj.hostname = \`port-\${urlObj.port}-pvelxc-\${instanceId}.alphasolves.com\`;
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
    if (prop === Symbol.toStringTag) {
      return 'Location';
    }
    if (prop === Symbol.toPrimitive) {
      return function(hint) {
        return __realLocation.href;
      };
    }

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

    const locationProps = [
      'href', 'origin', 'protocol', 'host', 'hostname', 'port',
      'pathname', 'search', 'hash', 'username', 'password', 'searchParams'
    ];

    if (locationProps.includes(prop)) {
      return __realLocation[prop];
    }

    const value = __realLocation[prop];
    if (value !== undefined) {
      if (typeof value === 'function') {
        return value.bind(__realLocation);
      }
      return value;
    }

    return undefined;
  },
  set(target, prop, value) {
    if (prop === 'href') {
      const newUrl = replaceLocalhostUrl(value);
      __realLocation.href = newUrl;
      return true;
    }

    const settableProps = ['hash', 'search', 'pathname', 'port', 'hostname', 'host', 'protocol'];
    if (settableProps.includes(prop)) {
      __realLocation[prop] = value;
      return true;
    }

    return true;
  },
  has(target, prop) {
    return prop in __realLocation;
  },
  ownKeys(target) {
    return Object.keys(__realLocation);
  },
  getOwnPropertyDescriptor(target, prop) {
    return Object.getOwnPropertyDescriptor(__realLocation, prop);
  }
});

window.__cmuxLocation = __cmuxLocation;
window.__cmuxLocationProxy = __cmuxLocation;

try {
  Object.defineProperty(window, '__cmuxLocation', {
    value: __cmuxLocation,
    writable: false,
    configurable: true
  });
} catch (e) {
  // Already defined
}

try {
  if (window.parent && window.parent !== window) {
    window.parent.__cmuxLocation = __cmuxLocation;
  }
} catch (e) {
  // Cross-origin
}

try {
  if (window.top && window.top !== window) {
    window.top.__cmuxLocation = __cmuxLocation;
  }
} catch (e) {
  // Cross-origin
}

const originalGetElementById = document.getElementById;
if (originalGetElementById) {
  document.getElementById = function(id) {
    const element = originalGetElementById.call(this, id);
    if (element && element.tagName === 'IFRAME') {
      try {
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
  // Some browsers block document.location override - safe to ignore
}

document.__cmuxLocation = __cmuxLocation;

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

// Intercept WebSocket constructor to rewrite localhost URLs
var OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  var rawUrl = typeof url === 'string'
    ? url
    : (url && typeof url.toString === 'function' ? url.toString() : String(url));
  var newUrl = replaceLocalhostUrl(rawUrl);
  if (newUrl !== rawUrl) {
    // replaceLocalhostUrl sets protocol to https:, convert to wss: for WebSocket
    newUrl = newUrl.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  }
  return protocols !== undefined
    ? new OriginalWebSocket(newUrl, protocols)
    : new OriginalWebSocket(newUrl);
};
window.WebSocket.prototype = OriginalWebSocket.prototype;
window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
window.WebSocket.OPEN = OriginalWebSocket.OPEN;
window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

// Intercept EventSource constructor (for SSE like Vite HMR)
var OriginalEventSource = window.EventSource;
if (OriginalEventSource) {
  window.EventSource = function(url, init) {
    var rawUrl = typeof url === 'string'
      ? url
      : (url && typeof url.toString === 'function' ? url.toString() : String(url));
    var newUrl = replaceLocalhostUrl(rawUrl);
    return new OriginalEventSource(newUrl, init);
  };
  window.EventSource.prototype = OriginalEventSource.prototype;
  window.EventSource.CONNECTING = OriginalEventSource.CONNECTING;
  window.EventSource.OPEN = OriginalEventSource.OPEN;
  window.EventSource.CLOSED = OriginalEventSource.CLOSED;
}

function startMutationObserver() {
  if (!document.body) {
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
      { html: true },
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
        { html: true },
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
  buildProxyHost: (port: string) => string | null,
): Response {
  const location = response.headers.get("location");
  if (!location) {
    return response;
  }

  let parsed: URL;
  try {
    parsed = new URL(location);
  } catch {
    return response;
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
  parsed.port = "";

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

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    // Only process PVE-LXC preview URLs
    // Pattern: port-{PORT}-pvelxc-{INSTANCE}.alphasolves.com
    const pvelxcMatch = host.match(
      /^port-(\d+)-pvelxc-([^.]+)\.alphasolves\.com$/,
    );

    if (!pvelxcMatch) {
      // PASS-THROUGH: Not a PVE-LXC preview URL
      // CF Tunnel, Caddy, other services handle these
      return fetch(request);
    }

    const [, port, instanceId] = pvelxcMatch;

    // Serve the service worker file
    if (url.pathname === "/proxy-sw.js") {
      return new Response(SERVICE_WORKER_JS, {
        headers: {
          "content-type": "application/javascript",
          "cache-control": "no-cache",
        },
      });
    }

    // Handle OPTIONS preflight for all ports (CORS requires this)
    if (request.method === "OPTIONS") {
      const origin = request.headers.get("Origin");
      return new Response(null, {
        status: 204,
        headers: addPermissiveCORS(new Headers(), origin),
      });
    }

    // Prevent infinite loops
    const isAlreadyProxied = request.headers.get("X-Cmux-Proxied") === "true";
    if (isAlreadyProxied) {
      return new Response("Loop detected in proxy", { status: 508 });
    }

    // Forward to the same URL (CF Tunnel handles final routing)
    const target = new URL(url.pathname + url.search, `https://${host}`);

    const headers = new Headers(request.headers);
    headers.set("X-Cmux-Proxied", "true");

    const outbound = new Request(target, {
      method: request.method,
      headers: headers,
      body: request.body,
      redirect: "manual",
    });

    // WebSocket upgrades: proxy the connection through the Worker
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() === "websocket") {
      // Fetch the upstream WebSocket (use outbound which has X-Cmux-Proxied header)
      const upstreamResponse = await fetch(outbound);

      // Check if we got a WebSocket upgrade response
      if (upstreamResponse.webSocket) {
        // Create a WebSocketPair for the client
        const [client, server] = Object.values(new WebSocketPair());

        // Accept both WebSockets
        server.accept();
        upstreamResponse.webSocket.accept();

        // Pipe messages between client and upstream
        server.addEventListener("message", (event) => {
          try {
            upstreamResponse.webSocket!.send(event.data);
          } catch {
            // Connection closed
          }
        });

        upstreamResponse.webSocket.addEventListener("message", (event) => {
          try {
            server.send(event.data);
          } catch {
            // Connection closed
          }
        });

        // Handle close events
        server.addEventListener("close", () => {
          try {
            upstreamResponse.webSocket!.close();
          } catch {
            // Already closed
          }
        });

        upstreamResponse.webSocket.addEventListener("close", () => {
          try {
            server.close();
          } catch {
            // Already closed
          }
        });

        // Return the client WebSocket to the browser
        // Forward negotiated subprotocol if present
        const responseHeaders = new Headers();
        const subprotocol = upstreamResponse.headers.get(
          "Sec-WebSocket-Protocol",
        );
        if (subprotocol) {
          responseHeaders.set("Sec-WebSocket-Protocol", subprotocol);
        }
        return new Response(null, {
          status: 101,
          headers: responseHeaders,
          webSocket: client,
        });
      }

      // If no WebSocket in response, return the response as-is
      return upstreamResponse;
    }

    let response = await fetch(outbound);

    response = rewriteLoopbackRedirect(response, (redirectPort) => {
      if (!redirectPort || !/^\d+$/.test(redirectPort)) {
        return null;
      }
      return `port-${redirectPort}-pvelxc-${instanceId}.alphasolves.com`;
    });

    const contentType = response.headers.get("content-type") || "";
    const skipServiceWorker = port === "39378";
    const requestOrigin = request.headers.get("Origin");

    // Apply HTMLRewriter to HTML responses
    if (contentType.includes("text/html")) {
      let responseHeaders = stripCSPHeaders(response.headers);
      if (skipServiceWorker) {
        responseHeaders = addPermissiveCORS(responseHeaders, requestOrigin);
      }
      const rewriter = new HTMLRewriter()
        .on("head", new HeadRewriter(skipServiceWorker))
        .on("script", new ScriptRewriter());

      if (skipServiceWorker) {
        rewriter.on("meta", new MetaCSPRewriter());
      }

      return rewriter.transform(
        new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        }),
      );
    }

    // Rewrite JavaScript files
    if (contentType.includes("javascript") || url.pathname.endsWith(".js")) {
      const text = await response.text();
      const rewritten = rewriteJavaScript(text, true);
      let sanitizedHeaders = sanitizeRewrittenResponseHeaders(response.headers);
      sanitizedHeaders = stripCSPHeaders(sanitizedHeaders);
      if (skipServiceWorker) {
        sanitizedHeaders = addPermissiveCORS(sanitizedHeaders, requestOrigin);
      }
      return new Response(rewritten, {
        status: response.status,
        statusText: response.statusText,
        headers: sanitizedHeaders,
      });
    }

    let responseHeaders = stripCSPHeaders(response.headers);
    if (skipServiceWorker) {
      responseHeaders = addPermissiveCORS(responseHeaders, requestOrigin);
    } else {
      responseHeaders = fixCORSForCredentials(responseHeaders, requestOrigin);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },
};
