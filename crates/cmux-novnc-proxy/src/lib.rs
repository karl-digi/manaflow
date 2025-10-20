use std::convert::Infallible;
use std::future::Future;
use std::net::SocketAddr;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use hyper::header::HeaderValue;
use hyper::server::conn::AddrStream;
use hyper::service::{make_service_fn, service_fn};
use hyper::upgrade::Upgraded;
use hyper::{Body, Method, Request, Response, StatusCode};
use percent_encoding::percent_decode_str;
use sha1::{Digest, Sha1};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{Mutex, Notify};
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::Role;
use tokio_tungstenite::WebSocketStream;
use tracing::{error, info, warn};

const DEFAULT_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Debug)]
pub struct ProxyConfig {
    pub listen: SocketAddr,
    pub target_host: String,
    pub target_port: u16,
    pub web_root: Option<PathBuf>,
    pub connect_timeout: Duration,
}

impl ProxyConfig {
    pub fn new(listen: SocketAddr, target_host: String, target_port: u16) -> Self {
        Self {
            listen,
            target_host,
            target_port,
            web_root: None,
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
        }
    }
}

struct AppState {
    target_host: String,
    target_port: u16,
    web_root: Option<PathBuf>,
    connect_timeout: Duration,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum DataEncoding {
    Unknown,
    Binary,
    Base64,
}

impl Default for DataEncoding {
    fn default() -> Self {
        DataEncoding::Unknown
    }
}

/// Start a proxy bound to a single address.
pub fn spawn_proxy<S>(
    cfg: ProxyConfig,
    shutdown: S,
) -> Result<(SocketAddr, JoinHandle<()>), hyper::Error>
where
    S: Future<Output = ()> + Send + 'static,
{
    let ProxyConfig {
        listen,
        target_host,
        target_port,
        web_root,
        connect_timeout,
    } = cfg;

    let state = Arc::new(AppState {
        target_host: target_host.clone(),
        target_port,
        web_root: web_root.clone(),
        connect_timeout,
    });

    let make_svc_state = state.clone();
    let make_svc = make_service_fn(move |conn: &AddrStream| {
        let remote = conn.remote_addr();
        let state = make_svc_state.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                let state = state.clone();
                handle_request(state, remote, req)
            }))
        }
    });

    let server = hyper::Server::try_bind(&listen)?.serve(make_svc);
    let local_addr = server.local_addr();
    let graceful = server.with_graceful_shutdown(shutdown);

    let handle = tokio::spawn(async move {
        if let Err(err) = graceful.await {
            error!(%err, "proxy server error");
        }
    });

    info!(listen = %local_addr, target = %format!("{}:{}", target_host, target_port), "noVNC proxy listening");

    Ok((local_addr, handle))
}

/// Start proxy listening on multiple addresses.
pub fn spawn_proxy_multi<S>(
    listens: Vec<SocketAddr>,
    target_host: String,
    target_port: u16,
    web_root: Option<PathBuf>,
    shutdown: S,
) -> Result<(Vec<SocketAddr>, JoinHandle<()>), hyper::Error>
where
    S: Future<Output = ()> + Send + 'static,
{
    let notify = Arc::new(Notify::new());
    let mut join_set = JoinSet::new();
    join_set.spawn({
        let notify = notify.clone();
        async move {
            shutdown.await;
            notify.notify_waiters();
        }
    });
    let mut bound = Vec::new();

    for listen in listens {
        let notify = notify.clone();
        let cfg = ProxyConfig {
            listen,
            target_host: target_host.clone(),
            target_port,
            web_root: web_root.clone(),
            connect_timeout: DEFAULT_CONNECT_TIMEOUT,
        };
        let (addr, handle) = spawn_proxy(cfg, async move {
            notify.notified().await;
        })?;
        bound.push(addr);
        join_set.spawn(async move {
            if let Err(err) = handle.await {
                error!(%err, "proxy task join error");
            }
        });
    }

    let handle = tokio::spawn(async move {
        while let Some(res) = join_set.join_next().await {
            if let Err(err) = res {
                error!(%err, "proxy join set task error");
            }
        }
    });

    Ok((bound, handle))
}

async fn handle_request(
    state: Arc<AppState>,
    remote_addr: SocketAddr,
    req: Request<Body>,
) -> Result<Response<Body>, Infallible> {
    if is_websocket_upgrade(&req) {
        match build_upgrade_response(&req) {
            Ok(response) => {
                let state_for_task = state.clone();
                let mut upgrade_req = req;
                tokio::spawn(async move {
                    match hyper::upgrade::on(&mut upgrade_req).await {
                        Ok(upgraded) => {
                            let ws_stream =
                                WebSocketStream::from_raw_socket(upgraded, Role::Server, None)
                                    .await;
                            if let Err(err) =
                                handle_ws(state_for_task, remote_addr, ws_stream).await
                            {
                                warn!(%err, "websocket session ended with error");
                            }
                        }
                        Err(err) => {
                            warn!(%err, "websocket upgrade error");
                        }
                    }
                });
                Ok(response)
            }
            Err(resp) => Ok(resp),
        }
    } else {
        match serve_static(&state, req).await {
            Ok(resp) => Ok(resp),
            Err(resp) => Ok(resp),
        }
    }
}

async fn handle_ws(
    state: Arc<AppState>,
    remote_addr: SocketAddr,
    ws_stream: WebSocketStream<Upgraded>,
) -> Result<(), ProxyError> {
    let target = format!("{}:{}", state.target_host, state.target_port);

    info!(%remote_addr, target = %target, "accepted websocket session");

    let connect_fut = TcpStream::connect((state.target_host.as_str(), state.target_port));
    let tcp = timeout(state.connect_timeout, connect_fut)
        .await
        .map_err(|_| {
            ProxyError::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "timed out connecting to target",
            ))
        })?
        .map_err(ProxyError::Io)?;

    let (tcp_reader, tcp_writer) = tokio::io::split(tcp);

    let (ws_sink, mut ws_stream_reader) = ws_stream.split();
    let ws_sink = Arc::new(Mutex::new(ws_sink));
    let encoding = Arc::new(AtomicU8::new(DataEncoding::Unknown as u8));

    let ws_to_tcp = {
        let ws_sink = ws_sink.clone();
        let encoding = encoding.clone();
        let mut tcp_writer = tcp_writer;
        async move {
            while let Some(msg) = ws_stream_reader.next().await {
                let msg = msg.map_err(ProxyError::Ws)?;
                match msg {
                    tungstenite::Message::Binary(data) => {
                        encoding.store(DataEncoding::Binary as u8, Ordering::Relaxed);
                        tcp_writer.write_all(&data).await.map_err(ProxyError::Io)?;
                    }
                    tungstenite::Message::Text(text) => {
                        encoding.store(DataEncoding::Base64 as u8, Ordering::Relaxed);
                        let decoded = BASE64.decode(text.trim()).map_err(|err| {
                            ProxyError::Protocol(format!(
                                "failed to decode base64 text frame: {err}"
                            ))
                        })?;
                        tcp_writer
                            .write_all(&decoded)
                            .await
                            .map_err(ProxyError::Io)?;
                    }
                    tungstenite::Message::Ping(payload) => {
                        let mut sink = ws_sink.lock().await;
                        sink.send(tungstenite::Message::Pong(payload))
                            .await
                            .map_err(ProxyError::Ws)?;
                    }
                    tungstenite::Message::Pong(_) => {}
                    tungstenite::Message::Close(_) => {
                        break;
                    }
                    tungstenite::Message::Frame(_) => {}
                }
            }
            Ok::<_, ProxyError>(())
        }
    };

    let tcp_to_ws = {
        let ws_sink = ws_sink.clone();
        let encoding = encoding.clone();
        let mut tcp_reader = tcp_reader;
        async move {
            let mut buf = [0u8; 8192];
            loop {
                let n = tcp_reader.read(&mut buf).await.map_err(ProxyError::Io)?;
                if n == 0 {
                    break;
                }
                let bytes = &buf[..n];
                let current_encoding = match encoding.load(Ordering::Relaxed) {
                    x if x == DataEncoding::Base64 as u8 => DataEncoding::Base64,
                    x if x == DataEncoding::Binary as u8 => DataEncoding::Binary,
                    _ => DataEncoding::Binary,
                };
                let mut sink = ws_sink.lock().await;
                match current_encoding {
                    DataEncoding::Base64 => {
                        let encoded = BASE64.encode(bytes);
                        sink.send(tungstenite::Message::Text(encoded))
                            .await
                            .map_err(ProxyError::Ws)?;
                    }
                    _ => {
                        sink.send(tungstenite::Message::Binary(bytes.to_vec()))
                            .await
                            .map_err(ProxyError::Ws)?;
                    }
                }
            }
            Ok::<_, ProxyError>(())
        }
    };

    let (res_a, res_b) = tokio::join!(ws_to_tcp, tcp_to_ws);
    res_a?;
    res_b?;

    info!(%remote_addr, target = %target, "websocket session closed");
    Ok(())
}

fn is_websocket_upgrade(req: &Request<Body>) -> bool {
    if req.method() != Method::GET {
        return false;
    }

    let has_upgrade = req
        .headers()
        .get("Upgrade")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.eq_ignore_ascii_case("websocket"))
        .unwrap_or(false);
    let has_connection = header_contains_token(req.headers().get("Connection"), "upgrade");

    has_upgrade && has_connection
}

fn build_upgrade_response(req: &Request<Body>) -> Result<Response<Body>, Response<Body>> {
    let version_ok = req
        .headers()
        .get("Sec-WebSocket-Version")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.trim() == "13")
        .unwrap_or(false);
    if !version_ok {
        return Err(error_response(
            StatusCode::BAD_REQUEST,
            "unsupported websocket version",
        ));
    }

    let key_str = req
        .headers()
        .get("Sec-WebSocket-Key")
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "missing Sec-WebSocket-Key header"))?
        .to_str()
        .map_err(|_| error_response(StatusCode::BAD_REQUEST, "invalid Sec-WebSocket-Key header"))?;

    let mut sha1 = Sha1::new();
    sha1.update(key_str.as_bytes());
    sha1.update(b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11");
    let accept = BASE64.encode(sha1.finalize());

    let mut builder = Response::builder()
        .status(StatusCode::SWITCHING_PROTOCOLS)
        .header("Upgrade", "websocket")
        .header("Connection", "Upgrade")
        .header("Sec-WebSocket-Accept", accept);

    if let Some(protocol) = req.headers().get("Sec-WebSocket-Protocol") {
        builder = builder.header("Sec-WebSocket-Protocol", protocol.clone());
    }

    builder.body(Body::empty()).map_err(|_| {
        error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "failed to build upgrade response",
        )
    })
}

fn header_contains_token(value: Option<&HeaderValue>, token: &str) -> bool {
    value
        .and_then(|v| v.to_str().ok())
        .map(|s| {
            s.split(',')
                .any(|part| part.trim().eq_ignore_ascii_case(token))
        })
        .unwrap_or(false)
}

async fn serve_static(
    state: &AppState,
    req: Request<Body>,
) -> Result<Response<Body>, Response<Body>> {
    let web_root = match &state.web_root {
        Some(root) => root,
        None => {
            return Err(error_response(
                StatusCode::NOT_FOUND,
                "static content disabled",
            ))
        }
    };

    let method = req.method().clone();
    if method != Method::GET && method != Method::HEAD {
        return Err(error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "method not allowed",
        ));
    }

    let path = req.uri().path();
    let safe_path = match map_uri_to_path(path) {
        Some(p) => p,
        None => {
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "invalid request path",
            ))
        }
    };

    let fs_path = web_root.join(&safe_path);
    let fs_path = if fs_path.is_dir() {
        fs_path.join("index.html")
    } else {
        fs_path
    };

    match tokio::fs::metadata(&fs_path).await {
        Ok(meta) if meta.is_file() => {
            let content_type = detect_content_type(&fs_path);
            if method == Method::HEAD {
                let body = Body::empty();
                let response = Response::builder()
                    .status(StatusCode::OK)
                    .header("content-type", content_type)
                    .header("content-length", meta.len().to_string())
                    .body(body)
                    .unwrap();
                Ok(response)
            } else {
                match tokio::fs::read(&fs_path).await {
                    Ok(bytes) => {
                        let response = Response::builder()
                            .status(StatusCode::OK)
                            .header("content-type", content_type)
                            .body(Body::from(bytes))
                            .unwrap();
                        Ok(response)
                    }
                    Err(err) => {
                        warn!(path = %fs_path.display(), %err, "failed to read static file");
                        Err(error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "failed to read file",
                        ))
                    }
                }
            }
        }
        Ok(_) => Err(error_response(StatusCode::NOT_FOUND, "not found")),
        Err(err) => {
            if err.kind() == std::io::ErrorKind::NotFound {
                Err(error_response(StatusCode::NOT_FOUND, "not found"))
            } else {
                warn!(path = %fs_path.display(), %err, "failed to stat static file");
                Err(error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "filesystem error",
                ))
            }
        }
    }
}

fn map_uri_to_path(path: &str) -> Option<PathBuf> {
    let decoded = percent_decode_str(path).decode_utf8().ok()?;
    let trimmed = decoded.trim_start_matches('/');
    if trimmed.is_empty() {
        return Some(PathBuf::from("vnc.html"));
    }

    let mut safe = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(seg) => safe.push(seg),
            Component::ParentDir | Component::Prefix(_) | Component::RootDir => return None,
            Component::CurDir => {}
        }
    }

    if decoded.ends_with('/') || trimmed.ends_with('/') {
        safe.push("index.html");
    }

    Some(safe)
}

fn detect_content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|ext| ext.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "htm" => "text/html; charset=utf-8",
        "js" => "application/javascript",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "svg" => "image/svg+xml",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, msg: &str) -> Response<Body> {
    Response::builder()
        .status(status)
        .header("content-type", "text/plain; charset=utf-8")
        .body(Body::from(msg.to_string()))
        .unwrap()
}

#[derive(Debug)]
enum ProxyError {
    Io(std::io::Error),
    Ws(tungstenite::Error),
    Protocol(String),
}

impl std::fmt::Display for ProxyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProxyError::Io(err) => write!(f, "io error: {err}"),
            ProxyError::Ws(err) => write!(f, "websocket error: {err}"),
            ProxyError::Protocol(msg) => write!(f, "protocol error: {msg}"),
        }
    }
}

impl std::error::Error for ProxyError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ProxyError::Io(err) => Some(err),
            ProxyError::Ws(err) => Some(err),
            ProxyError::Protocol(_) => None,
        }
    }
}

impl From<std::io::Error> for ProxyError {
    fn from(value: std::io::Error) -> Self {
        ProxyError::Io(value)
    }
}

impl From<tungstenite::Error> for ProxyError {
    fn from(value: tungstenite::Error) -> Self {
        ProxyError::Ws(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_paths() {
        assert_eq!(
            map_uri_to_path("/vnc.html").unwrap(),
            PathBuf::from("vnc.html")
        );
        assert_eq!(
            map_uri_to_path("/subdir/app.js").unwrap(),
            PathBuf::from("subdir/app.js")
        );
        assert_eq!(map_uri_to_path("/").unwrap(), PathBuf::from("vnc.html"));
        assert!(map_uri_to_path("/../secret").is_none());
    }
}
