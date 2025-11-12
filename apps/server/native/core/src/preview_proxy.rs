#![cfg_attr(test, allow(dead_code, non_snake_case))]

use std::{
    borrow::Cow,
    collections::HashSet,
    convert::Infallible,
    net::{IpAddr, SocketAddr},
    sync::Arc,
};

use anyhow::Context;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use dashmap::DashMap;
use futures_util::future;
use hyper::server::conn::AddrStream;
use hyper::{
    body::Body,
    client::HttpConnector,
    header::{HeaderMap, HeaderValue, CONNECTION, HOST, PROXY_AUTHORIZATION, UPGRADE},
    service::{make_service_fn, service_fn},
    Client, Method, Request, Response, StatusCode, Uri, Version,
};
use hyper_rustls::HttpsConnectorBuilder;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use rand::{distributions::Alphanumeric, rngs::OsRng, Rng};
use regex::Regex;
use tokio::{
    io::{copy_bidirectional, AsyncWriteExt},
    net::TcpStream,
    sync::oneshot,
    task::JoinHandle,
};
use tracing::{error, info, warn};
use url::Url;

const DEFAULT_START_PORT: u16 = 39_385;
const DEFAULT_MAX_ATTEMPTS: u16 = 50;
const PROXY_REALM: &str = "Cmux Preview Proxy";
const TASK_RUN_PREVIEW_PREFIX: &str = "task-run-preview:";
const CMUX_DOMAINS: &[&str] = &[
    "cmux.app",
    "cmux.sh",
    "cmux.dev",
    "cmux.local",
    "cmux.localhost",
    "autobuild.app",
];
const LOOPBACK_SUFFIX: &str = ".localhost";

type HttpClient = Client<hyper_rustls::HttpsConnector<HttpConnector>, Body>;

type StdResult<T, E> = std::result::Result<T, E>;

#[derive(Default)]
struct PreviewProxyShared {
    contexts_by_username: DashMap<String, Arc<ProxyContext>>,
    contexts_by_web_contents: DashMap<i32, String>,
    logging_enabled: std::sync::atomic::AtomicBool,
}

#[derive(Clone)]
struct ProxyRoute {
    morph_id: String,
    scope: String,
    domain_suffix: String,
}

#[derive(Clone)]
struct ProxyContext {
    username: String,
    password: String,
    route: ProxyRoute,
    persist_key: Option<String>,
    web_contents_id: i32,
}

struct PreviewProxyRuntime {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    task: JoinHandle<()>,
    shared: Arc<PreviewProxyShared>,
}

struct ProxyServerState {
    shared: Arc<PreviewProxyShared>,
    client: HttpClient,
}

static PREVIEW_PROXY_RUNTIME: Lazy<RwLock<Option<PreviewProxyRuntime>>> =
    Lazy::new(|| RwLock::new(None));

fn shared_state() -> Arc<PreviewProxyShared> {
    static SHARED: Lazy<Arc<PreviewProxyShared>> =
        Lazy::new(|| Arc::new(PreviewProxyShared::default()));
    SHARED.clone()
}

#[napi(object)]
pub struct PreviewProxyStartOptions {
    pub startPort: Option<u16>,
    pub maxAttempts: Option<u16>,
}

#[napi(object)]
#[derive(Default)]
pub struct PreviewProxyRegisterOptions {
    pub webContentsId: i32,
    pub initialUrl: String,
    pub persistKey: Option<String>,
}

#[napi(object)]
pub struct PreviewProxyCredentials {
    pub username: String,
    pub password: String,
}

#[napi]
pub async fn preview_proxy_start(options: Option<PreviewProxyStartOptions>) -> Result<u16> {
    let start_port = options
        .as_ref()
        .and_then(|o| o.startPort)
        .unwrap_or(DEFAULT_START_PORT);
    let max_attempts = options
        .as_ref()
        .and_then(|o| o.maxAttempts)
        .unwrap_or(DEFAULT_MAX_ATTEMPTS);

    {
        let guard = PREVIEW_PROXY_RUNTIME.read();
        if let Some(rt) = guard.as_ref() {
            return Ok(rt.port);
        }
    }

    let shared = shared_state();
    let mut guard = PREVIEW_PROXY_RUNTIME.write();
    if let Some(rt) = guard.as_ref() {
        return Ok(rt.port);
    }

    let mut last_err: Option<anyhow::Error> = None;
    for offset in 0..max_attempts {
        let port = start_port + offset;
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        match std::net::TcpListener::bind(addr) {
            Ok(listener) => {
                if let Err(err) = listener.set_nonblocking(true) {
                    return Err(Error::from_reason(format!(
                        "Failed to set preview proxy listener nonblocking: {err}"
                    )));
                }
                match spawn_proxy_runtime(listener, shared.clone()) {
                    Ok(runtime) => {
                        *guard = Some(runtime);
                        info!(port, "cmux preview proxy listening");
                        return Ok(port);
                    }
                    Err(err) => {
                        last_err = Some(err);
                        break;
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::AddrInUse => {
                last_err = Some(anyhow::anyhow!(err));
                continue;
            }
            Err(err) => {
                return Err(Error::from_reason(format!(
                    "Failed to bind preview proxy port {port}: {err}"
                )));
            }
        }
    }

    Err(Error::from_reason(format!(
        "Unable to bind preview proxy port: {}",
        last_err
            .map(|e| e.to_string())
            .unwrap_or_else(|| "unknown error".into())
    )))
}

#[napi]
pub fn preview_proxy_set_logging_enabled(enabled: bool) {
    shared_state()
        .logging_enabled
        .store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[napi]
pub fn preview_proxy_register_context(
    options: PreviewProxyRegisterOptions,
) -> Result<Option<PreviewProxyCredentials>> {
    if !is_task_run_preview(&options.persistKey) {
        return Ok(None);
    }

    let route = match derive_route(&options.initialUrl) {
        Some(route) => route,
        None => return Ok(None),
    };

    let username = format!(
        "wc-{}-{}",
        options.webContentsId,
        random_token(8).to_lowercase()
    );
    let password = random_token(24);

    let context = Arc::new(ProxyContext {
        username: username.clone(),
        password: password.clone(),
        route,
        persist_key: options.persistKey.clone(),
        web_contents_id: options.webContentsId,
    });
    let shared = shared_state();
    shared
        .contexts_by_username
        .insert(username.clone(), context.clone());
    shared
        .contexts_by_web_contents
        .insert(options.webContentsId, username.clone());
    proxy_log(
        &shared,
        "register-context",
        Some(&context),
        format_args!(
            "registered preview proxy context web_contents_id={} persist_key={:?}",
            options.webContentsId, options.persistKey
        ),
    );
    Ok(Some(PreviewProxyCredentials { username, password }))
}

#[napi]
pub fn preview_proxy_release_context(web_contents_id: i32) -> Result<bool> {
    let shared = shared_state();
    let username = match shared.contexts_by_web_contents.remove(&web_contents_id) {
        Some((_id, uname)) => uname,
        None => return Ok(false),
    };
    let removed = shared.contexts_by_username.remove(&username).map(|_| ());
    proxy_log(
        &shared,
        "release-context",
        None,
        format_args!("released preview proxy context web_contents_id={web_contents_id}"),
    );
    Ok(removed.is_some())
}

fn spawn_proxy_runtime(
    listener: std::net::TcpListener,
    shared: Arc<PreviewProxyShared>,
) -> anyhow::Result<PreviewProxyRuntime> {
    let local_addr = listener.local_addr().context("listener local addr")?;

    let https = HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_or_http()
        .enable_http1()
        .enable_http2()
        .build();
    let client: HttpClient = Client::builder()
        .http2_adaptive_window(true)
        .pool_max_idle_per_host(16)
        .build(https);

    let server_state = Arc::new(ProxyServerState {
        shared: shared.clone(),
        client,
    });

    let make_svc = make_service_fn(move |conn: &AddrStream| {
        let remote_addr = conn.remote_addr();
        let state = server_state.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle_request(state.clone(), remote_addr, req)
            }))
        }
    });

    let server = hyper::Server::from_tcp(listener)?
        .http2_adaptive_window(true)
        .serve(make_svc);
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let graceful = server.with_graceful_shutdown(async move {
        let _ = shutdown_rx.await;
    });
    let task = tokio::spawn(async move {
        if let Err(err) = graceful.await {
            error!(%err, "preview proxy server error");
        }
    });

    Ok(PreviewProxyRuntime {
        port: local_addr.port(),
        shutdown: Some(shutdown_tx),
        task,
        shared,
    })
}

async fn handle_request(
    state: Arc<ProxyServerState>,
    remote_addr: SocketAddr,
    mut req: Request<Body>,
) -> StdResult<Response<Body>, Infallible> {
    let context = match authenticate(&state.shared, req.headers()) {
        Ok(ctx) => ctx,
        Err(resp) => return Ok(resp),
    };

    if req.method() == Method::CONNECT {
        return Ok(handle_connect(state.shared.clone(), context, remote_addr, req).await);
    }

    if is_upgrade_request(&req) {
        return Ok(handle_upgrade(state.clone(), context, remote_addr, req).await);
    }

    match handle_http(state.clone(), context, remote_addr, &mut req).await {
        Ok(resp) => Ok(resp),
        Err(resp) => Ok(resp),
    }
}

fn authenticate(
    shared: &PreviewProxyShared,
    headers: &HeaderMap<HeaderValue>,
) -> StdResult<Arc<ProxyContext>, Response<Body>> {
    let raw = headers
        .get(PROXY_AUTHORIZATION)
        .ok_or_else(proxy_auth_required)?;
    let raw_str = raw
        .to_str()
        .map_err(|_| proxy_auth_required_with_reason("Invalid proxy auth header"))?;
    if !raw_str.starts_with("Basic ") {
        return Err(proxy_auth_required());
    }
    let encoded = raw_str[6..].trim();
    let decoded = BASE64_STANDARD
        .decode(encoded)
        .map_err(|_| proxy_auth_required_with_reason("Failed to decode proxy credentials"))?;
    let decoded_str = String::from_utf8(decoded)
        .map_err(|_| proxy_auth_required_with_reason("Invalid UTF-8 proxy credentials"))?;
    let mut parts = decoded_str.splitn(2, ':');
    let username = parts.next().unwrap_or_default();
    let password = parts.next().unwrap_or_default();
    if username.is_empty() || password.is_empty() {
        return Err(proxy_auth_required());
    }
    let guard = shared
        .contexts_by_username
        .get(username)
        .ok_or_else(proxy_auth_required)?;
    if guard.password != password {
        return Err(proxy_auth_required());
    }
    Ok(guard.clone())
}

fn proxy_auth_required() -> Response<Body> {
    proxy_auth_required_with_reason("Proxy authentication required")
}

fn proxy_auth_required_with_reason(reason: &str) -> Response<Body> {
    Response::builder()
        .status(StatusCode::PROXY_AUTHENTICATION_REQUIRED)
        .header(
            "Proxy-Authenticate",
            format!(r#"Basic realm="{PROXY_REALM}""#),
        )
        .body(Body::from(reason.to_string()))
        .unwrap_or_else(|_| Response::new(Body::from(reason.to_string())))
}

fn is_upgrade_request(req: &Request<Body>) -> bool {
    if req.method() == Method::CONNECT {
        return true;
    }
    let has_connection = req
        .headers()
        .get(CONNECTION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_ascii_lowercase().contains("upgrade"))
        .unwrap_or(false);
    let has_upgrade = req.headers().contains_key(UPGRADE);
    has_connection && has_upgrade
}

async fn handle_http(
    state: Arc<ProxyServerState>,
    context: Arc<ProxyContext>,
    remote_addr: SocketAddr,
    req: &mut Request<Body>,
) -> StdResult<Response<Body>, Response<Body>> {
    let target = parse_proxy_request_target(req)?;
    let rewritten = rewrite_target(&target, &context)?;

    proxy_log(
        &state.shared,
        "http-request",
        Some(&context),
        format_args!(
            "client={} host={} rewritten_host={} port={}",
            remote_addr,
            target.host().unwrap_or(""),
            rewritten.host_for_logging,
            rewritten.connect_port
        ),
    );

    let mut new_req = Request::builder()
        .method(req.method())
        .uri(&rewritten.uri)
        .body(std::mem::replace(req.body_mut(), Body::empty()))
        .map_err(|_| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build upstream request".into(),
            )
        })?;
    *new_req.version_mut() = Version::HTTP_11;

    copy_headers(req.headers(), new_req.headers_mut());
    new_req
        .headers_mut()
        .insert(HOST, HeaderValue::from_str(&rewritten.authority).unwrap());

    let resp = state.client.request(new_req).await.map_err(|err| {
        response_with(
            StatusCode::BAD_GATEWAY,
            format!("upstream request failed: {err}"),
        )
    })?;

    let mut client_resp = Response::builder().status(resp.status());
    let headers = client_resp.headers_mut().expect("headers available");
    for (name, value) in resp.headers().iter() {
        headers.insert(name, value.clone());
    }
    Ok(client_resp
        .body(resp.into_body())
        .unwrap_or_else(|_| Response::new(Body::empty())))
}

async fn handle_upgrade(
    state: Arc<ProxyServerState>,
    context: Arc<ProxyContext>,
    remote_addr: SocketAddr,
    mut req: Request<Body>,
) -> Response<Body> {
    let target = match parse_proxy_request_target(&req) {
        Ok(uri) => uri,
        Err(resp) => return resp,
    };
    let rewritten = match rewrite_target(&target, &context) {
        Ok(val) => val,
        Err(resp) => return resp,
    };

    proxy_log(
        &state.shared,
        "upgrade-request",
        Some(&context),
        format_args!(
            "client={} host={} rewritten_host={} port={}",
            remote_addr,
            target.host().unwrap_or(""),
            rewritten.host_for_logging,
            rewritten.connect_port
        ),
    );

    let mut proxied_req = Request::builder()
        .method(req.method())
        .uri(&rewritten.uri)
        .body(std::mem::replace(req.body_mut(), Body::empty()))
        .map_err(|_| {
            response_with(
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to build upgrade request".into(),
            )
        })
        .unwrap();
    *proxied_req.version_mut() = Version::HTTP_11;

    copy_headers(req.headers(), proxied_req.headers_mut());
    proxied_req
        .headers_mut()
        .insert(HOST, HeaderValue::from_str(&rewritten.authority).unwrap());

    let mut upstream_resp = match state.client.request(proxied_req).await {
        Ok(resp) => resp,
        Err(err) => {
            return response_with(
                StatusCode::BAD_GATEWAY,
                format!("upstream upgrade failed: {err}"),
            );
        }
    };

    if upstream_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        let mut builder = Response::builder().status(upstream_resp.status());
        let headers = builder.headers_mut().expect("headers");
        for (name, value) in upstream_resp.headers().iter() {
            headers.insert(name, value.clone());
        }
        let body = upstream_resp.into_body();
        return builder
            .body(body)
            .unwrap_or_else(|_| Response::new(Body::empty()));
    }

    let mut client_resp_builder = Response::builder().status(StatusCode::SWITCHING_PROTOCOLS);
    let headers = client_resp_builder.headers_mut().expect("headers");
    for (name, value) in upstream_resp.headers().iter() {
        headers.insert(name, value.clone());
    }
    headers.insert(CONNECTION, HeaderValue::from_static("upgrade"));

    let client_resp = client_resp_builder
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()));

    tokio::spawn(async move {
        match future::try_join(
            hyper::upgrade::on(&mut req),
            hyper::upgrade::on(&mut upstream_resp),
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
            Err(err) => warn!(%err, "preview proxy upgrade error"),
        }
    });

    client_resp
}

async fn handle_connect(
    shared: Arc<PreviewProxyShared>,
    context: Arc<ProxyContext>,
    remote_addr: SocketAddr,
    mut req: Request<Body>,
) -> Response<Body> {
    let (host, port) = match parse_connect_target(&req) {
        Some(tuple) => tuple,
        None => return response_with(StatusCode::BAD_REQUEST, "invalid CONNECT target".into()),
    };
    let authority = format!("{host}:{port}");
    let uri = match Uri::builder()
        .scheme("https")
        .authority(authority.as_str())
        .path_and_query("/")
        .build()
    {
        Ok(uri) => uri,
        Err(_) => return response_with(StatusCode::BAD_REQUEST, "invalid CONNECT uri".into()),
    };
    let rewritten = match rewrite_target(&uri, &context) {
        Ok(r) => r,
        Err(resp) => return resp,
    };

    proxy_log(
        &shared,
        "connect-request",
        Some(&context),
        format_args!(
            "client={} target={}:{} rewritten_host={} port={}",
            remote_addr, host, port, rewritten.host_for_logging, rewritten.connect_port
        ),
    );

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONNECTION, HeaderValue::from_static("upgrade"))
        .body(Body::empty())
        .unwrap_or_else(|_| Response::new(Body::empty()));

    tokio::spawn(async move {
        match hyper::upgrade::on(&mut req).await {
            Ok(mut upgraded) => {
                match TcpStream::connect((rewritten.hostname.as_str(), rewritten.connect_port))
                    .await
                {
                    Ok(mut upstream) => {
                        if let Err(err) = copy_bidirectional(&mut upgraded, &mut upstream).await {
                            warn!(%err, "preview proxy CONNECT tunnel error");
                        }
                        let _ = upgraded.shutdown().await;
                        let _ = upstream.shutdown().await;
                    }
                    Err(err) => {
                        warn!(%err, "preview proxy failed to connect upstream for CONNECT");
                        let _ = upgraded
                            .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                            .await;
                        let _ = upgraded.shutdown().await;
                    }
                }
            }
            Err(err) => warn!(%err, "preview proxy CONNECT upgrade error"),
        }
    });

    response
}

fn copy_headers(src: &HeaderMap<HeaderValue>, dest: &mut HeaderMap<HeaderValue>) {
    dest.clear();
    for (name, value) in src.iter() {
        if name == PROXY_AUTHORIZATION {
            continue;
        }
        dest.insert(name, value.clone());
    }
}

fn parse_proxy_request_target(req: &Request<Body>) -> StdResult<Uri, Response<Body>> {
    if req.uri().scheme().is_some() && req.uri().authority().is_some() {
        return normalize_ws_uri(req.uri().to_string().as_str());
    }
    let host = req
        .headers()
        .get(HOST)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| response_with(StatusCode::BAD_REQUEST, "missing host header".into()))?;
    let path = if req.uri().path_and_query().is_some() {
        req.uri().path_and_query().unwrap().as_str()
    } else {
        "/"
    };
    let url = format!("http://{}{}", host, path);
    normalize_ws_uri(&url)
}

fn normalize_ws_uri(input: &str) -> StdResult<Uri, Response<Body>> {
    let normalized = if input.to_ascii_lowercase().starts_with("ws://") {
        Cow::Owned(format!("http://{}", &input[5..]))
    } else if input.to_ascii_lowercase().starts_with("wss://") {
        Cow::Owned(format!("https://{}", &input[6..]))
    } else {
        Cow::Borrowed(input)
    };
    normalized
        .parse::<Uri>()
        .map_err(|_| response_with(StatusCode::BAD_REQUEST, "invalid request target".into()))
}

fn parse_connect_target(req: &Request<Body>) -> Option<(String, u16)> {
    if let Some(authority) = req.uri().authority() {
        let host = authority.host().to_string();
        let port = authority.port_u16().unwrap_or(443);
        return Some((host, port));
    }
    let raw = req.uri().to_string();
    if raw.is_empty() {
        return None;
    }
    let (host, port_str) = raw.split_once(':')?;
    let port: u16 = port_str.parse().ok()?;
    Some((host.to_string(), port))
}

struct RewrittenTarget {
    uri: Uri,
    hostname: String,
    authority: String,
    connect_port: u16,
    host_for_logging: String,
}

fn rewrite_target(uri: &Uri, context: &ProxyContext) -> StdResult<RewrittenTarget, Response<Body>> {
    let host = uri
        .host()
        .ok_or_else(|| response_with(StatusCode::BAD_REQUEST, "missing host".into()))?;
    let mut scheme = uri.scheme_str().unwrap_or("http");
    let mut hostname = host.to_string();
    let mut port = uri.port_u16();
    let mut secure = matches!(scheme, "https");

    if is_loopback_hostname(host) {
        let requested_port = determine_requested_port(scheme, port);
        hostname = build_cmux_host(&context.route, requested_port);
        secure = true;
        scheme = "https";
        port = None;
    }

    let authority = if let Some(p) = port {
        format!("{hostname}:{p}")
    } else {
        hostname.clone()
    };
    let host_for_log = hostname.clone();
    let path = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let new_uri = format!("{scheme}://{authority}{path}")
        .parse::<Uri>()
        .map_err(|_| response_with(StatusCode::BAD_REQUEST, "invalid rewritten uri".into()))?;
    let connect_port = port.unwrap_or_else(|| if secure { 443 } else { 80 });

    Ok(RewrittenTarget {
        uri: new_uri,
        hostname,
        authority,
        connect_port,
        host_for_logging: host_for_log,
    })
}

fn determine_requested_port(scheme: &str, port: Option<u16>) -> u16 {
    if let Some(port) = port {
        return port;
    }
    match scheme {
        "https" | "wss" => 443,
        _ => 80,
    }
}

fn is_loopback_hostname(hostname: &str) -> bool {
    let lower = hostname.to_ascii_lowercase();
    static STATIC_HOSTS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
        HashSet::from([
            "localhost",
            "127.0.0.1",
            "0.0.0.0",
            "::1",
            "[::1]",
            "::ffff:127.0.0.1",
            "[::ffff:127.0.0.1]",
        ])
    });
    if STATIC_HOSTS.contains(lower.as_str()) {
        return true;
    }
    if lower.ends_with(LOOPBACK_SUFFIX) {
        return true;
    }
    if let Ok(addr) = lower.parse::<IpAddr>() {
        return match addr {
            IpAddr::V4(v4) => v4.octets()[0] == 127,
            IpAddr::V6(v6) => v6.is_loopback(),
        };
    }
    false
}

fn build_cmux_host(route: &ProxyRoute, port: u16) -> String {
    format!(
        "cmux-{}-{}-{}.{}",
        route.morph_id, route.scope, port, route.domain_suffix
    )
}

fn derive_route(initial_url: &str) -> Option<ProxyRoute> {
    let parsed = Url::parse(initial_url).ok()?;
    let hostname = parsed.host_str()?.to_ascii_lowercase();
    if let Some(captures) = morph_domain_regex().captures(&hostname) {
        let morph_id = captures.get(2)?.as_str().to_string();
        if morph_id.is_empty() {
            return None;
        }
        return Some(ProxyRoute {
            morph_id,
            scope: "base".into(),
            domain_suffix: "cmux.app".into(),
        });
    }
    for domain in CMUX_DOMAINS {
        let suffix = format!(".{domain}");
        if !hostname.ends_with(&suffix) {
            continue;
        }
        let subdomain = hostname.trim_end_matches(&suffix);
        if !subdomain.starts_with("cmux-") {
            continue;
        }
        let remainder = &subdomain[5..];
        let mut segments: Vec<&str> = remainder.split('-').filter(|s| !s.is_empty()).collect();
        if segments.len() < 3 {
            continue;
        }
        let port_segment = segments.pop().unwrap();
        let scope_segment = segments.pop().unwrap();
        if port_segment.parse::<u16>().is_err() {
            continue;
        }
        let morph_id = segments.join("-");
        if morph_id.is_empty() {
            continue;
        }
        return Some(ProxyRoute {
            morph_id,
            scope: scope_segment.to_string(),
            domain_suffix: domain.to_string(),
        });
    }
    None
}

fn morph_domain_regex() -> &'static Regex {
    static REGEX: Lazy<Regex> =
        Lazy::new(|| Regex::new(r"^port-(\d+)-morphvm-([^.]+)\.http\.cloud\.morph\.so$").unwrap());
    &REGEX
}

fn response_with(status: StatusCode, msg: String) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::from(msg))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn proxy_log(
    shared: &PreviewProxyShared,
    event: &str,
    context: Option<&ProxyContext>,
    message: std::fmt::Arguments<'_>,
) {
    if !shared
        .logging_enabled
        .load(std::sync::atomic::Ordering::Relaxed)
    {
        return;
    }
    if let Some(ctx) = context {
        info!(
          target: "preview-proxy",
          event = event,
          web_contents_id = ctx.web_contents_id,
          persist_key = ctx.persist_key.as_deref().unwrap_or(""),
          message = %message
        );
    } else {
        info!(target: "preview-proxy", event = event, message = %message);
    }
}

fn random_token(len: usize) -> String {
    OsRng
        .sample_iter(&Alphanumeric)
        .take(len)
        .map(char::from)
        .collect()
}

fn is_task_run_preview(persist_key: &Option<String>) -> bool {
    persist_key
        .as_ref()
        .map(|value| value.starts_with(TASK_RUN_PREVIEW_PREFIX))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_loopback_hostname() {
        assert!(is_loopback_hostname("localhost"));
        assert!(is_loopback_hostname("127.0.0.1"));
        assert!(is_loopback_hostname("LOCALHOST"));
        assert!(is_loopback_hostname("foo.localhost"));
        assert!(!is_loopback_hostname("example.com"));
    }

    #[test]
    fn test_derive_route_from_cmux_domain() {
        let route = derive_route("https://cmux-abc-base-3000.cmux.app").unwrap();
        assert_eq!(route.morph_id, "abc");
        assert_eq!(route.scope, "base");
        assert_eq!(route.domain_suffix, "cmux.app");
    }

    #[test]
    fn test_derive_route_from_morph_domain() {
        let route =
            derive_route("https://port-3000-morphvm-quick-frog.http.cloud.morph.so").unwrap();
        assert_eq!(route.morph_id, "quick-frog");
        assert_eq!(route.scope, "base");
    }

    #[test]
    fn test_build_cmux_host() {
        let route = ProxyRoute {
            morph_id: "abc".into(),
            scope: "base".into(),
            domain_suffix: "cmux.dev".into(),
        };
        assert_eq!(build_cmux_host(&route, 8080), "cmux-abc-base-8080.cmux.dev");
    }
}
