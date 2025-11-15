import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import http2 from "node:http2";
import net, { type Socket } from "node:net";
import tls, { type TLSSocket } from "node:tls";
import { randomBytes, createHash } from "node:crypto";
import { URL } from "node:url";
import type { Session, WebContents } from "electron";
import { isLoopbackHostname } from "@cmux/shared";
import type { Logger } from "./chrome-camouflage";

type ProxyServer = http.Server;
type ClientHttp2Session = http2.ClientHttp2Session;
type ClientHttp2Stream = http2.ClientHttp2Stream;

const CMUX_PROXY_PORT = 39379;
const DEFAULT_MORPH_DOMAIN_SUFFIX = ".http.cloud.morph.so";
const HTTP2_CANCEL_CODE = http2.constants.NGHTTP2_CANCEL;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

const TASK_RUN_PREVIEW_PREFIX = "task-run-preview:";
const DEFAULT_PROXY_LOGGING_ENABLED = false;
const CMUX_DOMAINS = [
  "cmux.app",
  "cmux.sh",
  "cmux.dev",
  "cmux.local",
  "cmux.localhost",
  "autobuild.app",
] as const;

interface ProxyRoute {
  morphId: string;
  scope: string;
  domainSuffix: (typeof CMUX_DOMAINS)[number];
  cmuxProxyOrigin?: string;
}

interface ProxyContext {
  username: string;
  password: string;
  route: ProxyRoute | null;
  session: Session;
  webContentsId: number;
  persistKey?: string;
}

interface CmuxProxyMetadata {
  hostOverride: string;
  upstreamPort: number;
}

interface ProxyTarget {
  url: URL;
  secure: boolean;
  connectPort: number;
  cmuxProxy?: CmuxProxyMetadata;
}

interface ConfigureOptions {
  webContents: WebContents;
  initialUrl: string;
  persistKey?: string;
  logger: Logger;
}

let proxyServer: ProxyServer | null = null;
let proxyPort: number | null = null;
let proxyLogger: Logger | null = null;
let startingProxy: Promise<number> | null = null;
let proxyLoggingEnabled = DEFAULT_PROXY_LOGGING_ENABLED;
const http2Sessions = new Map<string, ClientHttp2Session>();
const pendingHttp2Sessions = new Map<string, Promise<ClientHttp2Session>>();

export function setPreviewProxyLoggingEnabled(enabled: boolean): void {
  proxyLoggingEnabled = Boolean(enabled);
}

const contextsByUsername = new Map<string, ProxyContext>();
const contextsByWebContentsId = new Map<number, ProxyContext>();

function proxyLog(event: string, data?: Record<string, unknown>): void {
  if (!proxyLoggingEnabled) {
    return;
  }
  try {
    proxyLogger?.log("Preview proxy", { event, ...(data ?? {}) });
  } catch (error) {
    console.error("Failed to log preview proxy", error);
  }
}

function proxyWarn(event: string, data?: Record<string, unknown>): void {
  if (!proxyLoggingEnabled) {
    return;
  }
  try {
    proxyLogger?.warn("Preview proxy", { event, ...(data ?? {}) });
  } catch (error) {
    console.error("Failed to log preview proxy", error);
  }
}

export function isTaskRunPreviewPersistKey(
  key: string | undefined
): key is string {
  return typeof key === "string" && key.startsWith(TASK_RUN_PREVIEW_PREFIX);
}

export function getPreviewPartitionForPersistKey(
  key: string | undefined
): string | null {
  if (!isTaskRunPreviewPersistKey(key)) {
    return null;
  }
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return `persist:cmux-preview-${hash}`;
}

export function getProxyCredentialsForWebContents(
  id: number
): { username: string; password: string } | null {
  const context = contextsByWebContentsId.get(id);
  if (!context) return null;
  return { username: context.username, password: context.password };
}

export function releasePreviewProxy(webContentsId: number): void {
  const context = contextsByWebContentsId.get(webContentsId);
  if (!context) return;
  contextsByWebContentsId.delete(webContentsId);
  contextsByUsername.delete(context.username);
  proxyLog("reset-session-proxy", {
    webContentsId,
    persistKey: context.persistKey,
  });
  void context.session.setProxy({ mode: "direct" }).catch((err) => {
    console.error("Failed to reset preview proxy", err);
  });
}

export async function configurePreviewProxyForView(
  options: ConfigureOptions
): Promise<() => void> {
  const { webContents, initialUrl, persistKey, logger } = options;
  const route = deriveRoute(initialUrl);
  if (!route) {
    logger.warn("Preview proxy skipped; unable to parse cmux host", {
      url: initialUrl,
      persistKey,
    });
    return () => {};
  }

  const port = await ensureProxyServer(logger);
  const username = `wc-${webContents.id}-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(12).toString("hex");

  const context: ProxyContext = {
    username,
    password,
    route,
    session: webContents.session,
    webContentsId: webContents.id,
    persistKey,
  };

  contextsByUsername.set(username, context);
  contextsByWebContentsId.set(webContents.id, context);

  try {
    await webContents.session.setProxy({
      proxyRules: `http=127.0.0.1:${port};https=127.0.0.1:${port}`,
      proxyBypassRules: "<-loopback>",
    });
  } catch (error) {
    contextsByUsername.delete(username);
    contextsByWebContentsId.delete(webContents.id);
    logger.warn("Failed to configure preview proxy", { error });
    throw error;
  }

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    releasePreviewProxy(webContents.id);
    proxyLog("released-context", {
      webContentsId: webContents.id,
      persistKey,
    });
  };

  webContents.once("destroyed", cleanup);
  proxyLog("configured-context", {
    webContentsId: webContents.id,
    persistKey,
    route,
  });
  return cleanup;
}

export function startPreviewProxy(logger: Logger): Promise<number> {
  return ensureProxyServer(logger);
}

async function ensureProxyServer(logger: Logger): Promise<number> {
  if (proxyPort && proxyServer) {
    return proxyPort;
  }
  if (startingProxy) {
    return startingProxy;
  }
  startingProxy = startProxyServer(logger);
  try {
    const port = await startingProxy;
    proxyPort = port;
    return port;
  } finally {
    startingProxy = null;
  }
}

async function startProxyServer(logger: Logger): Promise<number> {
  const startPort = 39385;
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidatePort = startPort + i;
    const server = http.createServer();
    attachServerHandlers(server);
    try {
      await listen(server, candidatePort);
      proxyServer = server;
      proxyLogger = logger;
      console.log(`[cmux-preview-proxy] listening on port ${candidatePort}`);
      logger.log("Preview proxy listening", { port: candidatePort });
      proxyLog("listening", { port: candidatePort });
      return candidatePort;
    } catch (error) {
      server.removeAllListeners();
      try {
        server.close();
      } catch (error) {
        console.error("Failed to close preview proxy server", error);
        // ignore close failure
      }
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Unable to bind preview proxy port");
}

function listen(server: ProxyServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, "127.0.0.1");
  });
}

function attachServerHandlers(server: ProxyServer) {
  server.on("request", handleHttpRequest);
  server.on("connect", handleConnect);
  server.on("upgrade", handleUpgrade);
  server.on("clientError", (error, socket) => {
    proxyLogger?.warn("Proxy client error", { error });
    socket.end();
  });
}

async function getHttp2SessionFor(target: ProxyTarget): Promise<ClientHttp2Session> {
  const originKey = target.url.origin;
  const existing = http2Sessions.get(originKey);
  if (existing && !existing.closed && !existing.destroyed) {
    return existing;
  }
  const pending = pendingHttp2Sessions.get(originKey);
  if (pending) {
    return pending;
  }

  const creating = createHttp2Session(target.url);
  pendingHttp2Sessions.set(originKey, creating);
  try {
    const session = await creating;
    http2Sessions.set(originKey, session);
    monitorHttp2Session(originKey, session);
    return session;
  } finally {
    pendingHttp2Sessions.delete(originKey);
  }
}

function createHttp2Session(url: URL): Promise<ClientHttp2Session> {
  return new Promise((resolve, reject) => {
    const session = http2.connect(url.origin);
    let settled = false;

    const handleConnect = () => {
      if (settled) {
        return;
      }
      settled = true;
      session.removeListener("error", handleError);
      resolve(session);
    };

    const handleError = (error: Error) => {
      if (settled) {
        proxyLogger?.warn("HTTP/2 session error", {
          origin: url.origin,
          error,
        });
        return;
      }
      settled = true;
      session.removeListener("connect", handleConnect);
      session.destroy();
      reject(error);
    };

    session.once("connect", handleConnect);
    session.once("error", handleError);
  });
}

function monitorHttp2Session(originKey: string, session: ClientHttp2Session) {
  const handleTeardown = () => {
    const existing = http2Sessions.get(originKey);
    if (existing === session) {
      http2Sessions.delete(originKey);
    }
  };

  session.on("close", handleTeardown);
  session.on("goaway", () => {
    handleTeardown();
    if (!session.closed && !session.destroyed) {
      session.close();
    }
  });
  session.on("error", (error) => {
    proxyLogger?.warn("HTTP/2 session runtime error", {
      origin: originKey,
      error,
    });
    handleTeardown();
  });
}

function handleHttpRequest(req: IncomingMessage, res: ServerResponse) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequired(res);
    return;
  }

  const target = parseProxyRequestTarget(req);
  if (!target) {
    proxyWarn("http-target-parse-failed", {
      url: req.url,
      host: req.headers.host,
    });
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  const rewritten = rewriteTarget(target, context);
  proxyLog("http-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  void forwardHttpRequest(req, res, rewritten, context).catch((error) => {
    proxyWarn("http-forward-error", {
      error,
      persistKey: context.persistKey,
    });
    if (!res.headersSent) {
      res.writeHead(502);
    }
    res.end("Bad Gateway");
  });
}

function handleConnect(req: IncomingMessage, socket: Socket, head: Buffer) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequiredSocket(socket);
    return;
  }

  const target = parseConnectTarget(req.url ?? "");
  if (!target) {
    proxyWarn("connect-target-parse-failed", {
      url: req.url,
    });
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.end();
    return;
  }

  const targetUrl = new URL(`https://${target.hostname}`);
  targetUrl.port = String(target.port);
  const rewritten = rewriteTarget(targetUrl, context);

  proxyLog("connect-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  if (rewritten.cmuxProxy) {
    establishCmuxProxyConnect(socket, head, rewritten);
    return;
  }
  const upstream = net.connect(rewritten.connectPort, rewritten.url.hostname, () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(socket);
    socket.pipe(upstream);
  });

  upstream.on("error", (error) => {
    proxyLogger?.warn("CONNECT upstream error", { error });
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
  });

  socket.on("error", () => {
    upstream.destroy();
  });
}

function handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer) {
  const context = authenticateRequest(req.headers);
  if (!context) {
    respondProxyAuthRequiredSocket(socket);
    return;
  }

  const target = parseProxyRequestTarget(req);
  if (!target) {
    proxyWarn("upgrade-target-parse-failed", {
      url: req.url,
      host: req.headers.host,
    });
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.end();
    return;
  }

  const rewritten = rewriteTarget(target, context);
  proxyLog("upgrade-request", {
    username: context.username,
    requestedHost: target.hostname,
    requestedPort: target.port,
    rewrittenHost: rewritten.url.hostname,
    rewrittenPort: rewritten.connectPort,
    persistKey: context.persistKey,
  });
  forwardUpgradeRequest(req, socket, head, rewritten);
}

function authenticateRequest(
  headers: IncomingHttpHeaders
): ProxyContext | null {
  const raw = headers["proxy-authorization"];
  if (typeof raw !== "string") {
    return null;
  }
  const match = raw.match(/^Basic\s+(.+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) return null;
  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  const context = contextsByUsername.get(username);
  if (!context || context.password !== password) {
    return null;
  }
  return context;
}

function respondProxyAuthRequired(res: ServerResponse) {
  res.writeHead(407, {
    "Proxy-Authenticate": 'Basic realm="Cmux Preview Proxy"',
  });
  res.end("Proxy Authentication Required");
}

function respondProxyAuthRequiredSocket(socket: Socket) {
  socket.write(
    'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Cmux Preview Proxy"\r\n\r\n'
  );
  socket.end();
}

function parseProxyRequestTarget(req: IncomingMessage): URL | null {
  try {
    if (req.url && /^[a-z]+:\/\//i.test(req.url)) {
      const normalized = req.url.replace(/^ws(s)?:\/\//i, (_match, secure) =>
        secure ? "https://" : "http://"
      );
      return new URL(normalized);
    }
    const host = req.headers.host;
    if (!host || !req.url) {
      return null;
    }
    return new URL(`http://${host}${req.url}`);
  } catch (error) {
    console.error("Failed to parse proxy request target", error);
    return null;
  }
}

function parseConnectTarget(
  input: string
): { hostname: string; port: number } | null {
  if (!input) return null;
  const [host, portString] = input.split(":");
  const port = Number.parseInt(portString ?? "", 10);
  if (!host || Number.isNaN(port)) {
    return null;
  }
  return { hostname: host, port };
}

function rewriteTarget(url: URL, context: ProxyContext): ProxyTarget {
  const requestedPort = determineRequestedPort(url);
  if (context.route && isLoopbackHostname(url.hostname)) {
    const proxyTarget = buildCmuxProxyTarget(url, requestedPort, context.route);
    if (proxyTarget) {
      return proxyTarget;
    }
    const rewritten = new URL(url.toString());
    rewritten.protocol = "https:";
    rewritten.hostname = buildCmuxHost(context.route, requestedPort);
    rewritten.port = "";
    return {
      url: rewritten,
      secure: true,
      connectPort: 443,
    };
  }

  const rewritten = new URL(url.toString());
  const secure = rewritten.protocol === "https:";
  const connectPort = Number.parseInt(rewritten.port, 10);
  const resolvedPort = Number.isNaN(connectPort)
    ? secure
      ? 443
      : 80
    : connectPort;

  return {
    url: rewritten,
    secure,
    connectPort: resolvedPort,
  };
}

function buildCmuxProxyTarget(
  original: URL,
  requestedPort: number,
  route: ProxyRoute
): ProxyTarget | null {
  if (!route.cmuxProxyOrigin) {
    return null;
  }
  try {
    const rewritten = new URL(route.cmuxProxyOrigin);
    rewritten.pathname = original.pathname;
    rewritten.search = original.search;
    rewritten.hash = "";
    const connectPort = Number.parseInt(rewritten.port, 10);
    const resolvedPort = Number.isNaN(connectPort)
      ? rewritten.protocol === "https:"
        ? 443
        : 80
      : connectPort;
    const hostOverride = formatHostOverride(original.hostname, requestedPort);
    return {
      url: rewritten,
      secure: rewritten.protocol === "https:",
      connectPort: resolvedPort,
      cmuxProxy: {
        hostOverride,
        upstreamPort: requestedPort,
      },
    };
  } catch (error) {
    console.error("Failed to build cmux proxy target", error);
    return null;
  }
}

function determineRequestedPort(url: URL): number {
  if (url.port) {
    const parsed = Number.parseInt(url.port, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  if (url.protocol === "https:" || url.protocol === "wss:") {
    return 443;
  }
  return 80;
}

function formatHostOverride(hostname: string, port: number): string {
  if (hostname.includes(":")) {
    if (hostname.startsWith("[") && hostname.endsWith("]")) {
      return `${hostname}:${port}`;
    }
    return `[${hostname}]:${port}`;
  }
  return `${hostname}:${port}`;
}

function buildCmuxHost(route: ProxyRoute, port: number): string {
  const safePort = Number.isFinite(port) && port > 0 ? Math.floor(port) : 80;
  return `cmux-${route.morphId}-${route.scope}-${safePort}.${route.domainSuffix}`;
}

async function forwardHttpRequest(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  context: ProxyContext
): Promise<void> {
  if (target.cmuxProxy) {
    try {
      await forwardHttpRequestViaHttp2(clientReq, clientRes, target);
      return;
    } catch (error) {
      proxyWarn("http2-forward-failed", {
        error,
        persistKey: context.persistKey,
        username: context.username,
      });
      if (clientRes.writableEnded) {
        return;
      }
    }
  }
  await forwardHttpRequestViaHttp1(clientReq, clientRes, target, context);
}

function forwardHttpRequestViaHttp1(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget,
  context: ProxyContext
): Promise<void> {
  return new Promise((resolve) => {
    const { url, secure, connectPort } = target;
    const requestHeaders = buildHttp1Headers(clientReq.headers, target);

    const requestOptions = {
      protocol: secure ? "https:" : "http:",
      hostname: url.hostname,
      port: connectPort,
      method: clientReq.method,
      path: url.pathname + url.search,
      headers: requestHeaders.headers,
      setHost: requestHeaders.setHost,
    };

    const httpModule = secure ? https : http;
    const proxyReq = httpModule.request(requestOptions, (proxyRes) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(
          proxyRes.statusCode ?? 500,
          proxyRes.statusMessage ?? "",
          proxyRes.headers
        );
      }
      proxyRes.pipe(clientRes);
      proxyRes.on("end", resolve);
    });

    proxyReq.on("error", (error) => {
      proxyWarn("http-upstream-error", {
        error,
        persistKey: context.persistKey,
        username: context.username,
        host: url.hostname,
      });
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
      }
      clientRes.end("Bad Gateway");
      resolve();
    });

    clientReq.pipe(proxyReq);
    clientReq.on("aborted", () => {
      proxyReq.destroy();
      resolve();
    });
  });
}

async function forwardHttpRequestViaHttp2(
  clientReq: IncomingMessage,
  clientRes: ServerResponse,
  target: ProxyTarget
): Promise<void> {
  const session = await getHttp2SessionFor(target);
  const headers = buildHttp2Headers(clientReq.headers, target);
  headers[":method"] = clientReq.method ?? "GET";
  headers[":path"] = `${target.url.pathname}${target.url.search}`;
  headers[":scheme"] = target.url.protocol.replace(":", "");
  headers[":authority"] = target.url.host;

  await new Promise<void>((resolve, reject) => {
    const upstreamReq: ClientHttp2Stream = session.request(headers);

    upstreamReq.on("response", (upstreamHeaders) => {
      const status = Number(upstreamHeaders[":status"] ?? 502);
      const responseHeaders: Record<string, string | string[]> = {};
      for (const [name, value] of Object.entries(upstreamHeaders)) {
        if (name.startsWith(":")) continue;
        if (Array.isArray(value)) {
          responseHeaders[name] = value.map((entry) => entry?.toString() ?? "");
        } else if (typeof value === "string") {
          responseHeaders[name] = value;
        } else if (typeof value === "number") {
          responseHeaders[name] = String(value);
        }
      }
      if (!clientRes.headersSent) {
        clientRes.writeHead(status, responseHeaders);
      }
    });

    upstreamReq.on("data", (chunk) => {
      if (!clientRes.writableEnded) {
        clientRes.write(chunk);
      }
    });

    upstreamReq.on("end", () => {
      if (!clientRes.writableEnded) {
        clientRes.end();
      }
      resolve();
    });

    upstreamReq.on("error", (error) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
        clientRes.end("Bad Gateway");
      } else if (!clientRes.writableEnded) {
        clientRes.end();
      }
      upstreamReq.close(HTTP2_CANCEL_CODE);
      reject(error);
    });

    clientReq.pipe(upstreamReq);
    clientReq.on("aborted", () => {
      upstreamReq.close(HTTP2_CANCEL_CODE);
    });
  });
}

function buildHttp2Headers(
  source: IncomingHttpHeaders,
  target: ProxyTarget
): http2.OutgoingHttpHeaders {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "proxy-authorization") continue;
    if (lowerKey === "host" && target.cmuxProxy) continue;
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
    if (Array.isArray(value)) {
      headers[lowerKey] = value.join(", ");
    } else {
      headers[lowerKey] = value;
    }
  }
  if (!target.cmuxProxy) {
    headers.host = target.url.host;
  }
  injectCmuxProxyHeaders(headers, target.cmuxProxy);
  return headers;
}

function buildHttp1Headers(
  source: IncomingHttpHeaders,
  target: ProxyTarget
): { headers: Record<string, string>; setHost?: boolean } {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!value) continue;
    const lowerKey = key.toLowerCase();
    if (lowerKey === "proxy-authorization") continue;
    if (lowerKey === "host" && target.cmuxProxy) continue;
    if (Array.isArray(value)) {
      headers[lowerKey] = value.join(", ");
    } else {
      headers[lowerKey] = value;
    }
  }
  if (!target.cmuxProxy) {
    headers.host = target.url.host;
  }
  injectCmuxProxyHeaders(headers, target.cmuxProxy);
  return { headers, setHost: target.cmuxProxy ? false : undefined };
}

function injectCmuxProxyHeaders(
  headers: Record<string, string>,
  metadata: CmuxProxyMetadata | undefined
) {
  delete headers["x-cmux-port-internal"];
  delete headers["x-cmux-host-override"];
  if (!metadata) {
    return;
  }
  headers["x-cmux-port-internal"] = String(metadata.upstreamPort);
  headers["x-cmux-host-override"] = metadata.hostOverride;
}

function forwardUpgradeRequest(
  clientReq: IncomingMessage,
  socket: Socket,
  head: Buffer,
  target: ProxyTarget
) {
  const { url } = target;
  const upstream = createUpstreamSocket(target);

  const handleConnected = () => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(clientReq.headers)) {
      if (!value) continue;
      const lowerKey = key.toLowerCase();
      if (lowerKey === "proxy-authorization") continue;
      if (lowerKey === "host" && target.cmuxProxy) continue;
      headers[lowerKey] = Array.isArray(value) ? value.join(", ") : value;
    }
    if (!target.cmuxProxy) {
      headers.host = url.host;
    }
    injectCmuxProxyHeaders(headers, target.cmuxProxy);

    const lines = [
      `${clientReq.method ?? "GET"} ${url.pathname}${url.search} HTTP/1.1`,
    ];
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("\r\n");
    upstream.write(lines.join("\r\n"));
    if (head.length > 0) {
      upstream.write(head);
    }

    upstream.pipe(socket);
    socket.pipe(upstream);
  };

  if (target.secure && upstream instanceof tls.TLSSocket) {
    upstream.once("secureConnect", handleConnected);
  } else {
    upstream.once("connect", handleConnected);
  }

  upstream.on("error", (error) => {
    proxyWarn("upgrade-upstream-error", {
      error,
      host: url.hostname,
      port: target.connectPort,
    });
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.end();
  });

  socket.on("error", () => {
    upstream.destroy();
  });
}

function createUpstreamSocket(target: ProxyTarget): Socket | TLSSocket {
  if (target.secure) {
    return tls.connect({
      host: target.url.hostname,
      port: target.connectPort,
      servername: target.url.hostname,
    });
  }
  return net.connect(target.connectPort, target.url.hostname);
}

function establishCmuxProxyConnect(
  clientSocket: Socket,
  head: Buffer,
  target: ProxyTarget
) {
  const upstream = createUpstreamSocket(target);
  const sendConnectRequest = () => {
    const headers: Record<string, string> = {};
    injectCmuxProxyHeaders(headers, target.cmuxProxy);
    const lines = [`CONNECT ${target.url.host} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("\r\n");
    upstream.write(lines.join("\r\n"));
  };

  const onError = (error: Error) => {
    proxyLogger?.warn("CONNECT cmux upstream error", { error });
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.end();
    upstream.destroy();
  };

  const chunks: Buffer[] = [];
  const handleData = (chunk: Buffer) => {
    chunks.push(chunk);
    const combined = Buffer.concat(chunks);
    const headerEnd = combined.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      return;
    }
    upstream.removeListener("data", handleData);
    const headerText = combined.slice(0, headerEnd).toString("utf8");
    if (!/^HTTP\/1\.1 200/.test(headerText)) {
      upstream.removeListener("data", handleData);
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.end();
      upstream.destroy();
      return;
    }
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    const remaining = combined.slice(headerEnd + 4);
    if (remaining.length > 0) {
      clientSocket.write(remaining);
    }
    if (head.length > 0) {
      upstream.write(head);
    }
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  };

  upstream.on("data", handleData);
  upstream.on("error", onError);
  clientSocket.on("error", () => {
    upstream.destroy();
  });

  if (target.secure && upstream instanceof tls.TLSSocket) {
    upstream.once("secureConnect", sendConnectRequest);
  } else {
    upstream.once("connect", sendConnectRequest);
  }
}

function deriveRoute(url: string): ProxyRoute | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const protocol = parsed.protocol === "http:" ? "http:" : "https:";
    const morphMatch = hostname.match(
      /^port-(\d+)-morphvm-([^.]+)(\..+)$/
    );
    if (morphMatch) {
      const morphId = morphMatch[2];
      if (morphId) {
        const morphSuffix = morphMatch[3];
        const cmuxProxyOrigin = `${protocol}//port-${CMUX_PROXY_PORT}-morphvm-${morphId}${morphSuffix}`;
        return {
          morphId,
          scope: "base",
          domainSuffix: "cmux.app",
          cmuxProxyOrigin,
        };
      }
    }
    for (const domain of CMUX_DOMAINS) {
      const suffix = `.${domain}`;
      if (!hostname.endsWith(suffix)) {
        continue;
      }
      const subdomain = hostname.slice(0, -suffix.length);
      if (!subdomain.startsWith("cmux-")) {
        continue;
      }
      const remainder = subdomain.slice("cmux-".length);
      const segments = remainder
        .split("-")
        .filter((segment) => segment.length > 0);
      if (segments.length < 3) {
        continue;
      }
      const portSegment = segments.pop();
      const scopeSegment = segments.pop();
      if (!portSegment || !scopeSegment) {
        continue;
      }
      if (!/^\d+$/.test(portSegment)) {
        continue;
      }
      const morphId = segments.join("-");
      if (!morphId) {
        continue;
      }
      return {
        morphId,
        scope: scopeSegment,
        domainSuffix: domain,
        cmuxProxyOrigin: `${protocol}//port-${CMUX_PROXY_PORT}-morphvm-${morphId}${DEFAULT_MORPH_DOMAIN_SUFFIX}`,
      };
    }
  } catch (error) {
    console.error("Failed to derive route", error);
    return null;
  }
  return null;
}
