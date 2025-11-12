use std::{
  net::{Ipv4Addr, SocketAddr},
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
  },
};

use anyhow::{anyhow, Context as AnyhowContext, Result as AnyResult};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use dashmap::DashMap;
use futures_util::future;
use hyper::{
    body::Body,
    client::HttpConnector,
    header::{HeaderValue, CONNECTION, HOST, PROXY_AUTHENTICATE, PROXY_AUTHORIZATION, UPGRADE},
    server::conn::AddrStream,
    service::{make_service_fn, service_fn},
    Client, Method, Request, Response, Server, StatusCode, Uri,
};
use hyper_rustls::HttpsConnectorBuilder;
use napi::bindgen_prelude::*;
use once_cell::sync::OnceCell;
use napi_derive::napi;
use std::convert::Infallible;
use tokio::{
  io::{copy_bidirectional, AsyncWriteExt},
  net::TcpStream,
  task::JoinHandle,
};
use tokio_util::sync::CancellationToken;
use tracing::{error, warn};
use url::Url;

type StdResult<T, E> = std::result::Result<T, E>;

/// Configuration supplied from the JS side describing which remote route we should rewrite
/// loopback hosts into. This mirrors the TypeScript structure that used to live in
/// `task-run-preview-proxy.ts`.
#[derive(Clone, Debug)]
pub struct RouteConfig {
    pub morph_id: String,
    pub scope: String,
    pub domain_suffix: String,
}

#[napi(object)]
pub struct PreviewProxyRoute {
    pub morph_id: String,
    pub scope: String,
    pub domain_suffix: String,
}

impl From<PreviewProxyRoute> for RouteConfig {
    fn from(route: PreviewProxyRoute) -> Self {
        RouteConfig {
            morph_id: route.morph_id,
            scope: route.scope,
            domain_suffix: route.domain_suffix,
        }
    }
}

#[napi(object)]
pub struct PreviewProxyConfigureOptions {
    pub web_contents_id: i32,
    pub persist_key: Option<String>,
    pub route: Option<PreviewProxyRoute>,
}

#[napi(object)]
pub struct PreviewProxyContextInfo {
    pub username: String,
    pub password: String,
    pub port: u16,
}

#[napi(object)]
pub struct PreviewProxyCredentials {
    pub username: String,
    pub password: String,
}

#[derive(Clone, Debug)]
struct ProxyContext {
    username: String,
    password: String,
    web_contents_id: i32,
    persist_key: Option<String>,
    route: Option<RouteConfig>,
}

impl ProxyContext {
    fn new(web_contents_id: i32, persist_key: Option<String>, route: Option<RouteConfig>) -> Self {
        let username = format!("wc-{web_contents_id}-{}", random_hex(4));
        let password = random_hex(12);
        Self {
            username,
            password,
            web_contents_id,
            persist_key,
            route,
        }
    }
}

const REALM: &str = "Cmux Preview Proxy";

#[derive(Clone, Debug)]
struct ProxyTarget {
  url: Url,
  connect_port: u16,
}

#[derive(Default)]
struct SharedState {
    contexts_by_username: DashMap<String, Arc<ProxyContext>>,
    contexts_by_web_contents: DashMap<i32, String>,
    logging_enabled: AtomicBool,
}

impl SharedState {
    fn set_logging_enabled(&self, enabled: bool) {
        self.logging_enabled.store(enabled, Ordering::Relaxed);
    }

    fn logging_enabled(&self) -> bool {
        self.logging_enabled.load(Ordering::Relaxed)
    }

    fn register_context(&self, ctx: Arc<ProxyContext>) {
        self.contexts_by_web_contents
            .insert(ctx.web_contents_id, ctx.username.clone());
        self.contexts_by_username
            .insert(ctx.username.clone(), ctx.clone());
        self.log(
            "register-context",
            &[
                ("username", ctx.username.clone()),
                ("webContentsId", ctx.web_contents_id.to_string()),
                (
                    "persistKey",
                    ctx.persist_key
                        .clone()
                        .unwrap_or_else(|| "n/a".to_string()),
                ),
            ],
        );
    }

    fn release_by_web_contents(&self, id: i32) -> Option<Arc<ProxyContext>> {
        let (_, username) = self.contexts_by_web_contents.remove(&id)?;
        let (_, ctx) = self.contexts_by_username.remove(&username)?;
        self.log(
            "release-context",
            &[("webContentsId", id.to_string()), ("username", username)],
        );
        Some(ctx)
    }

    fn credentials_for_web_contents(&self, id: i32) -> Option<PreviewProxyCredentials> {
        let username = self.contexts_by_web_contents.get(&id)?;
        let ctx = self.contexts_by_username.get(username.value())?;
        Some(PreviewProxyCredentials {
            username: ctx.username.clone(),
            password: ctx.password.clone(),
        })
    }

    fn context_for_username(&self, username: &str) -> Option<Arc<ProxyContext>> {
        self.contexts_by_username
            .get(username)
            .map(|entry| entry.value().clone())
    }

    fn authenticate(&self, header: Option<&hyper::http::HeaderValue>) -> Option<Arc<ProxyContext>> {
        let raw = header?;
        let value = raw.to_str().ok()?;
        let prefix = "Basic ";
        if !value.starts_with(prefix) {
            return None;
        }
        let encoded = &value[prefix.len()..];
        let decoded = BASE64_STANDARD.decode(encoded).ok()?;
        let decoded_str = String::from_utf8(decoded).ok()?;
        let mut parts = decoded_str.splitn(2, ':');
        let username = parts.next()?.to_string();
        let password = parts.next()?.to_string();
        let ctx = self.context_for_username(&username)?;
        if ctx.password == password {
            Some(ctx)
        } else {
            None
        }
    }

    fn log(&self, event: &str, details: &[(&str, String)]) {
        if !self.logging_enabled() {
            return;
        }
        let mut message = format!("event={event}");
        for (key, value) in details {
            message.push(' ');
            message.push_str(key);
            message.push('=');
            message.push_str(value);
        }
        println!("[cmux-preview-proxy] {message}");
    }
}

struct ProxyEngine {
  shared: Arc<SharedState>,
  listen_port: u16,
  shutdown: CancellationToken,
  _task: JoinHandle<()>,
}

impl ProxyEngine {
    async fn start() -> AnyResult<Arc<Self>> {
        const START_PORT: u16 = 39_385;
        const MAX_ATTEMPTS: u16 = 50;

        let shared = Arc::new(SharedState::default());
        shared.set_logging_enabled(INITIAL_LOGGING.load(Ordering::Relaxed));
        let mut last_err: Option<anyhow::Error> = None;
        for offset in 0..MAX_ATTEMPTS {
            let port = START_PORT + offset;
            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            match Self::bind_on(addr, shared.clone()).await {
                Ok(engine) => return Ok(engine),
                Err(err) => {
                    if let Some(io_err) = err.downcast_ref::<std::io::Error>() {
                        if io_err.kind() == std::io::ErrorKind::AddrInUse {
                            last_err = Some(err);
                            continue;
                        }
                    }
                    return Err(err);
                }
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow!("unable to bind preview proxy port")))
    }

    async fn bind_on(addr: SocketAddr, shared: Arc<SharedState>) -> AnyResult<Arc<Self>> {
        let listener = std::net::TcpListener::bind(addr).with_context(|| "bind preview proxy")?;
        listener
            .set_nonblocking(true)
            .with_context(|| "set nonblocking")?;

    let https = HttpsConnectorBuilder::new()
      .with_webpki_roots()
      .https_or_http()
      .enable_http1()
      .build();
        let client: Client<_, Body> = Client::builder()
            .http2_adaptive_window(true)
            .pool_max_idle_per_host(16)
            .build(https);

        let server_state = Arc::new(ServerState {
            shared: shared.clone(),
            client,
        });
        let token = CancellationToken::new();
        let token_clone = token.clone();
        let make_svc = make_service_fn(move |conn: &AddrStream| {
            let remote_addr = conn.remote_addr();
            let state = server_state.clone();
            async move {
                Ok::<_, Infallible>(service_fn(move |req| {
                    handle_request(state.clone(), remote_addr, req)
                }))
            }
        });

        let server = Server::from_tcp(listener)
            .with_context(|| "construct preview proxy server")?
            .serve(make_svc);
        let graceful = server.with_graceful_shutdown(async move {
            token_clone.cancelled().await;
        });
        let task = tokio::spawn(async move {
            if let Err(err) = graceful.await {
                error!(%err, "preview proxy server error");
            }
        });

        Ok(Arc::new(Self {
            shared,
            listen_port: addr.port(),
            shutdown: token,
            _task: task,
        }))
    }

    fn port(&self) -> u16 {
        self.listen_port
    }

    fn shared(&self) -> Arc<SharedState> {
        self.shared.clone()
    }
}

impl Drop for ProxyEngine {
    fn drop(&mut self) {
        self.shutdown.cancel();
    }
}

struct ServerState {
    shared: Arc<SharedState>,
    client: Client<hyper_rustls::HttpsConnector<HttpConnector>, Body>,
}

static PREVIEW_PROXY: OnceCell<Arc<ProxyEngine>> = OnceCell::new();
static INITIAL_LOGGING: AtomicBool = AtomicBool::new(false);

async fn ensure_engine() -> AnyResult<Arc<ProxyEngine>> {
    if let Some(existing) = PREVIEW_PROXY.get() {
        return Ok(existing.clone());
    }
    let engine = ProxyEngine::start().await?;
    let _ = PREVIEW_PROXY.set(engine.clone());
    Ok(engine)
}

async fn handle_request(
  state: Arc<ServerState>,
  remote_addr: SocketAddr,
  req: Request<Body>,
) -> StdResult<Response<Body>, Infallible> {
  let ctx = match state
    .shared
    .authenticate(req.headers().get(PROXY_AUTHORIZATION))
    {
        Some(ctx) => ctx,
        None => return Ok(respond_proxy_auth_required()),
    };

    match *req.method() {
        Method::CONNECT => match handle_connect(state, ctx, req, remote_addr).await {
            Ok(resp) => Ok(resp),
            Err(resp) => Ok(resp),
        },
        _ => {
            if is_upgrade_request(&req) {
                match handle_upgrade(state, ctx, req).await {
                    Ok(resp) => Ok(resp),
                    Err(resp) => Ok(resp),
                }
            } else {
                match handle_http(state, ctx, req).await {
                    Ok(resp) => Ok(resp),
                    Err(resp) => Ok(resp),
                }
            }
        }
    }
}

async fn handle_http(
  state: Arc<ServerState>,
  ctx: Arc<ProxyContext>,
  mut req: Request<Body>,
) -> StdResult<Response<Body>, Response<Body>> {
  let target = parse_proxy_request_target(&req)?;
  let rewritten = rewrite_target(&target, &ctx)?;
  state.shared.log(
    "upgrade-request",
    &[
      ("username", ctx.username.clone()),
      (
        "host",
        rewritten
          .url
          .host_str()
          .unwrap_or("unknown")
          .to_string(),
      ),
      ("port", rewritten.connect_port.to_string()),
    ],
  );
  state.shared.log(
    "http-request",
    &[
      ("username", ctx.username.clone()),
      (
        "host",
        rewritten
          .url
          .host_str()
          .unwrap_or("unknown")
          .to_string(),
      ),
      ("port", rewritten.connect_port.to_string()),
    ],
  );
    let uri: Uri = rewritten
        .url
        .as_str()
        .parse()
        .map_err(|_| response_with(StatusCode::BAD_GATEWAY, "invalid upstream uri".into()))?;

    let body = std::mem::replace(req.body_mut(), Body::empty());
    let mut builder = Request::builder()
        .method(req.method())
        .uri(uri)
        .version(req.version());

    {
        let headers = builder.headers_mut().ok_or_else(|| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "headers unavailable".into(),
            )
        })?;
        for (name, value) in req.headers().iter() {
            if name == PROXY_AUTHORIZATION {
                continue;
            }
            headers.insert(name, value.clone());
        }
        headers.insert(
            HOST,
            host_header_value(&rewritten).map_err(|_| {
                response_with(
                    StatusCode::BAD_GATEWAY,
                    "failed to build host header for upstream".into(),
                )
            })?,
        );
        strip_hop_by_hop_headers(headers);
    }

    let upstream_req = builder.body(body).map_err(|_| {
        response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build request".into(),
        )
    })?;

    let upstream_resp = state.client.request(upstream_req).await.map_err(|err| {
        response_with(
            StatusCode::BAD_GATEWAY,
            format!("upstream request error: {err}"),
        )
    })?;

    let mut client_builder = Response::builder()
        .status(upstream_resp.status())
        .version(upstream_resp.version());
    {
        let headers = client_builder.headers_mut().ok_or_else(|| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "headers unavailable".into(),
            )
        })?;
        for (name, value) in upstream_resp.headers().iter() {
            headers.insert(name, value.clone());
        }
        strip_hop_by_hop_headers(headers);
    }
    client_builder.body(upstream_resp.into_body()).map_err(|_| {
        response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build response".into(),
        )
    })
}

async fn handle_upgrade(
  state: Arc<ServerState>,
  ctx: Arc<ProxyContext>,
  mut req: Request<Body>,
) -> StdResult<Response<Body>, Response<Body>> {
    let target = parse_proxy_request_target(&req)?;
    let rewritten = rewrite_target(&target, &ctx)?;
    let uri: Uri = rewritten
        .url
        .as_str()
        .parse()
        .map_err(|_| response_with(StatusCode::BAD_GATEWAY, "invalid upstream uri".into()))?;

    let body = std::mem::replace(req.body_mut(), Body::empty());
    let mut builder = Request::builder()
        .method(req.method())
        .uri(uri)
        .version(req.version());

    {
        let headers = builder.headers_mut().ok_or_else(|| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "headers unavailable".into(),
            )
        })?;
        for (name, value) in req.headers().iter() {
            if name == PROXY_AUTHORIZATION {
                continue;
            }
            headers.insert(name, value.clone());
        }
        headers.insert(
            HOST,
            host_header_value(&rewritten).map_err(|_| {
                response_with(
                    StatusCode::BAD_GATEWAY,
                    "failed to build host header for upstream".into(),
                )
            })?,
        );
        headers.remove("proxy-connection");
        headers.remove("keep-alive");
        headers.remove("te");
        headers.remove("transfer-encoding");
        headers.remove("trailers");
    }

    let proxied_req = builder.body(body).map_err(|_| {
        response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build upgrade request".into(),
        )
    })?;

    let upstream_resp = state.client.request(proxied_req).await.map_err(|err| {
        response_with(
            StatusCode::BAD_GATEWAY,
            format!("upstream upgrade error: {err}"),
        )
    })?;

    if upstream_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        let mut builder = Response::builder()
            .status(upstream_resp.status())
            .version(upstream_resp.version());
        {
            let headers = builder.headers_mut().ok_or_else(|| {
                response_with(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "headers unavailable".into(),
                )
            })?;
            for (k, v) in upstream_resp.headers().iter() {
                headers.insert(k, v.clone());
            }
        }
        return builder.body(upstream_resp.into_body()).map_err(|_| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build response".into(),
            )
        });
    }

    let mut client_builder = Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .version(upstream_resp.version());
    {
        let headers = client_builder.headers_mut().ok_or_else(|| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "headers unavailable".into(),
            )
        })?;
        for (k, v) in upstream_resp.headers().iter() {
            headers.insert(k, v.clone());
        }
        headers.insert(
            CONNECTION,
            hyper::header::HeaderValue::from_static("upgrade"),
        );
    }

    let client_resp = client_builder.body(Body::empty()).map_err(|_| {
        response_with(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build upgrade response".into(),
        )
    })?;

    let mut req_for_upgrade = req;
    tokio::spawn(async move {
        match future::try_join(
            hyper::upgrade::on(&mut req_for_upgrade),
            hyper::upgrade::on(upstream_resp),
        )
        .await
        {
            Ok((mut client_upgraded, mut upstream_upgraded)) => {
                if let Err(err) =
                    copy_bidirectional(&mut client_upgraded, &mut upstream_upgraded).await
                {
                    warn!(%err, "preview proxy upgrade tunnel error");
                }
                let _ = client_upgraded.shutdown().await;
                let _ = upstream_upgraded.shutdown().await;
            }
            Err(err) => {
                warn!("preview proxy upgrade error: {:?}", err);
            }
        }
    });

    Ok(client_resp)
}

async fn handle_connect(
  state: Arc<ServerState>,
  ctx: Arc<ProxyContext>,
  mut req: Request<Body>,
  remote_addr: SocketAddr,
) -> StdResult<Response<Body>, Response<Body>> {
    let authority = req
        .uri()
        .authority()
        .map(|a| a.as_str().to_string())
        .ok_or_else(|| {
            response_with(StatusCode::BAD_REQUEST, "CONNECT missing authority".into())
        })?;
    let target_url = Url::parse(&format!("https://{authority}")).map_err(|_| {
        response_with(
            StatusCode::BAD_REQUEST,
            "failed to parse CONNECT authority".into(),
        )
    })?;
  let rewritten = rewrite_target(&target_url, &ctx)?;
  let host = rewritten
    .url
    .host_str()
    .ok_or_else(|| response_with(StatusCode::BAD_GATEWAY, "missing upstream host".into()))?;
  let addr = format!("{host}:{}", rewritten.connect_port);
  state.shared.log(
    "connect-request",
    &[
      ("username", ctx.username.clone()),
      ("host", host.to_string()),
      ("port", rewritten.connect_port.to_string()),
    ],
  );

    let resp = Response::builder()
        .status(StatusCode::OK)
        .header(
            CONNECTION,
            hyper::header::HeaderValue::from_static("upgrade"),
        )
        .body(Body::empty())
        .map_err(|_| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build CONNECT response".into(),
            )
        })?;

    tokio::spawn(async move {
        match hyper::upgrade::on(&mut req).await {
            Ok(mut upgraded) => match TcpStream::connect(&addr).await {
                Ok(mut upstream) => {
                    if let Err(err) = copy_bidirectional(&mut upgraded, &mut upstream).await {
                        warn!(%err, %remote_addr, "preview proxy CONNECT tunnel error");
                    }
                    let _ = upgraded.shutdown().await;
                    let _ = upstream.shutdown().await;
                }
                Err(err) => {
                    warn!(%err, %remote_addr, "preview proxy failed to connect upstream for CONNECT");
                    let _ = upgraded
                        .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                        .await;
                    let _ = upgraded.shutdown().await;
                }
            },
            Err(err) => {
                warn!("preview proxy CONNECT upgrade error: {:?}", err);
            }
        }
    });

    Ok(resp)
}

fn is_upgrade_request(req: &Request<Body>) -> bool {
    let has_conn_upgrade = req
        .headers()
        .get(CONNECTION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase().contains("upgrade"))
        .unwrap_or(false);
    has_conn_upgrade && req.headers().contains_key(UPGRADE)
}

fn host_header_value(target: &ProxyTarget) -> StdResult<HeaderValue, ()> {
    let host = target.url.host_str().ok_or(())?;
    let mut value = host.to_string();
    if let Some(port) = target.url.port() {
        value.push(':');
        value.push_str(&port.to_string());
    }
    HeaderValue::from_str(&value).map_err(|_| ())
}

fn strip_hop_by_hop_headers(headers: &mut hyper::HeaderMap) {
    let connection_header = headers
        .get(CONNECTION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    const HOP_HEADERS: &[&str] = &[
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "proxy-connection",
        "x-cmux-port-internal",
        "x-cmux-workspace-internal",
    ];
    for name in HOP_HEADERS {
        headers.remove(*name);
    }
    if let Some(conn_val) = connection_header.as_deref() {
        for token in conn_val.split(',') {
            let trimmed = token.trim().to_ascii_lowercase();
            if !trimmed.is_empty() {
                headers.remove(trimmed);
            }
        }
    }
}

fn parse_proxy_request_target(req: &Request<Body>) -> StdResult<Url, Response<Body>> {
    if let Some(scheme) = req.uri().scheme_str() {
        if let Some(authority) = req.uri().authority() {
            let mut url = format!("{scheme}://{}", authority.as_str());
            url.push_str(req.uri().path());
            if let Some(query) = req.uri().query() {
                url.push('?');
                url.push_str(query);
            }
            return Url::parse(&url).map_err(|_| {
                response_with(
                    StatusCode::BAD_REQUEST,
                    "failed to parse proxy request target".into(),
                )
            });
        }
    }

    let host = req
        .headers()
        .get(HOST)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            response_with(
                StatusCode::BAD_REQUEST,
                "missing host header for proxy request".into(),
            )
        })?;
    let mut url = format!("http://{host}{}", req.uri().path());
    if let Some(query) = req.uri().query() {
        url.push('?');
        url.push_str(query);
    }
    Url::parse(&url).map_err(|_| {
        response_with(
            StatusCode::BAD_REQUEST,
            "failed to parse proxy request target".into(),
        )
    })
}

fn rewrite_target(target: &Url, ctx: &ProxyContext) -> StdResult<ProxyTarget, Response<Body>> {
    let mut rewritten = target.clone();
    let mut secure = rewritten.scheme() == "https" || rewritten.scheme() == "wss";
    if let Some(route) = &ctx.route {
        if let Some(host) = rewritten.host_str() {
            if is_loopback_hostname(host) {
                let requested_port = determine_requested_port(target)?;
                rewritten.set_scheme("https").map_err(|_| {
                    response_with(StatusCode::BAD_GATEWAY, "failed to set scheme".into())
                })?;
                let new_host = build_cmux_host(route, requested_port);
                rewritten.set_host(Some(&new_host)).map_err(|_| {
                    response_with(StatusCode::BAD_GATEWAY, "failed to set host".into())
                })?;
                rewritten.set_port(None).map_err(|_| {
                    response_with(
                        StatusCode::BAD_GATEWAY,
                        "failed to clear upstream port".into(),
                    )
                })?;
                secure = true;
            }
        }
    }

    let connect_port = rewritten
        .port()
        .or_else(|| if secure { Some(443) } else { Some(80) })
        .ok_or_else(|| {
            response_with(
                StatusCode::BAD_GATEWAY,
                "failed to determine upstream port".into(),
            )
        })?;

    Ok(ProxyTarget {
        url: rewritten,
        connect_port,
    })
}

fn determine_requested_port(url: &Url) -> StdResult<u16, Response<Body>> {
    if let Some(port) = url.port() {
        return Ok(port);
    }
    match url.scheme() {
        "https" | "wss" => Ok(443),
        "http" | "ws" => Ok(80),
        other => Err(response_with(
            StatusCode::BAD_REQUEST,
            format!("unsupported scheme {other}"),
        )),
    }
}

fn build_cmux_host(route: &RouteConfig, port: u16) -> String {
    format!(
        "cmux-{}-{}-{}.{}",
        route.morph_id, route.scope, port, route.domain_suffix
    )
}

fn is_loopback_hostname(host: &str) -> bool {
    let trimmed = host.trim().trim_matches(|c| c == '[' || c == ']');
    let lower = trimmed.to_ascii_lowercase();
    matches!(
        lower.as_str(),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "::1" | "::ffff:127.0.0.1"
    ) || lower.ends_with(".localhost")
        || lower
            .parse::<Ipv4Addr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

fn respond_proxy_auth_required() -> Response<Body> {
    Response::builder()
        .status(StatusCode::PROXY_AUTHENTICATION_REQUIRED)
        .header(PROXY_AUTHENTICATE, format!("Basic realm=\"{REALM}\""))
        .body(Body::from("Proxy Authentication Required"))
        .unwrap()
}

fn response_with(status: StatusCode, msg: String) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::from(msg))
        .unwrap()
}

fn random_hex(bytes: usize) -> String {
    use rand::RngCore;
    let mut buf = vec![0u8; bytes];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

fn napi_err(err: anyhow::Error) -> Error {
    Error::from_reason(format!("{err:#}"))
}

#[napi]
pub async fn preview_proxy_start() -> Result<u16> {
    let engine = ensure_engine().await.map_err(napi_err)?;
    Ok(engine.port())
}

#[napi]
pub async fn preview_proxy_configure(
    opts: PreviewProxyConfigureOptions,
) -> Result<PreviewProxyContextInfo> {
    let engine = ensure_engine().await.map_err(napi_err)?;
    let route = opts.route.map(RouteConfig::from);
    if opts.web_contents_id == 0 {
        return Err(Error::from_reason(
            "webContentsId must be a non-zero integer".to_string(),
        ));
    }
    let shared = engine.shared();
    shared.release_by_web_contents(opts.web_contents_id);

    let ctx = Arc::new(ProxyContext::new(
        opts.web_contents_id,
        opts.persist_key,
        route,
    ));
    let username = ctx.username.clone();
    let password = ctx.password.clone();
    shared.register_context(ctx);
    Ok(PreviewProxyContextInfo {
        username,
        password,
        port: engine.port(),
    })
}

#[napi]
pub fn preview_proxy_release(web_contents_id: i32) -> Result<()> {
    if let Some(engine) = PREVIEW_PROXY.get() {
        engine.shared().release_by_web_contents(web_contents_id);
    }
    Ok(())
}

#[napi]
pub fn preview_proxy_credentials_for_web_contents(
    web_contents_id: i32,
) -> Option<PreviewProxyCredentials> {
    PREVIEW_PROXY.get().and_then(|engine| {
        engine
            .shared()
            .credentials_for_web_contents(web_contents_id)
    })
}

#[napi]
pub fn preview_proxy_set_logging_enabled(enabled: bool) -> Result<()> {
    INITIAL_LOGGING.store(enabled, Ordering::Relaxed);
    if let Some(engine) = PREVIEW_PROXY.get() {
        engine.shared().set_logging_enabled(enabled);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrite_loopback_host_rewrites_to_cmux() {
        let route = RouteConfig {
            morph_id: "abc123".to_string(),
            scope: "base".to_string(),
            domain_suffix: "cmux.dev".to_string(),
        };
        let mut ctx = ProxyContext::new(1, None, Some(route));
        // Force deterministic username/password for assert clarity
        ctx.username = "wc-1-test".into();
        ctx.password = "secret".into();
        let url = Url::parse("http://127.0.0.1:39378/path").unwrap();
        let rewritten = rewrite_target(&url, &ctx).expect("rewrite");
        assert_eq!(
            rewritten.url.host_str(),
            Some("cmux-abc123-base-39378.cmux.dev")
        );
        assert_eq!(rewritten.url.scheme(), "https");
        assert_eq!(rewritten.connect_port, 443);
    }

    #[test]
    fn rewrite_non_loopback_preserves_host() {
        let ctx = ProxyContext::new(2, None, None);
        let url = Url::parse("https://example.com:8443/foo").unwrap();
        let rewritten = rewrite_target(&url, &ctx).expect("rewrite");
        assert_eq!(rewritten.url.as_str(), url.as_str());
        assert_eq!(rewritten.connect_port, 8443);
    }

    #[test]
    fn loopback_detection_covers_localhost_suffix() {
        assert!(is_loopback_hostname("test.localhost"));
        assert!(is_loopback_hostname("127.0.0.1"));
        assert!(!is_loopback_hostname("example.com"));
    }
}
