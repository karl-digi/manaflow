use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full};
use hyper::body::Incoming;
use hyper::header::{CONNECTION, HOST, PROXY_AUTHORIZATION, UPGRADE};
use hyper::{Method, Request, Response, StatusCode, Uri};
use hyper_util::client::legacy::{Client, connect::HttpConnector};
use hyper_util::rt::TokioIo;
use std::convert::Infallible;
use tokio::io::AsyncWriteExt;
use tokio::net::TcpStream;
use tracing::{debug, warn};
use url::Url;

use super::auth::{authenticate_request, proxy_auth_required_response};
use super::rewrite::{rewrite_target, determine_requested_port};
use super::types::ProxyState;

type BoxBody = http_body_util::combinators::BoxBody<Bytes, hyper::Error>;

fn boxed_full(body: Full<Bytes>) -> BoxBody {
    body.map_err(|never| match never {}).boxed()
}

fn boxed_empty() -> BoxBody {
    Empty::<Bytes>::new().map_err(|never| match never {}).boxed()
}

fn error_response(status: StatusCode, message: &str) -> Response<BoxBody> {
    Response::builder()
        .status(status)
        .body(boxed_full(Full::new(Bytes::from(message.to_string()))))
        .unwrap()
}

/// Main request handler
pub async fn handle_request(
    req: Request<Incoming>,
    state: ProxyState,
    client: Client<HttpConnector, Incoming>,
) -> Result<Response<BoxBody>, Infallible> {
    // Authenticate request
    let context = match authenticate_request(req.headers(), &state).await {
        Some(ctx) => ctx,
        None => {
            return Ok(proxy_auth_required_response().map(boxed_full));
        }
    };

    let method = req.method().clone();
    let is_upgrade = is_upgrade_request(&req);

    if state.is_logging_enabled().await {
        debug!(
            method = %method,
            uri = %req.uri(),
            username = %context.username,
            "Handling request"
        );
    }

    match method {
        Method::CONNECT => handle_connect(req, context, state).await,
        _ if is_upgrade => handle_upgrade(req, context, state, client).await,
        _ => handle_http(req, context, state, client).await,
    }
}

/// Check if request is an upgrade request (WebSocket, etc.)
fn is_upgrade_request(req: &Request<Incoming>) -> bool {
    req.headers()
        .get(CONNECTION)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_lowercase().contains("upgrade"))
        .unwrap_or(false)
        && req.headers().contains_key(UPGRADE)
}

/// Handle regular HTTP requests
async fn handle_http(
    mut req: Request<Incoming>,
    context: super::types::ProxyContext,
    state: ProxyState,
    client: Client<HttpConnector, Incoming>,
) -> Result<Response<BoxBody>, Infallible> {
    // Parse the request URL
    let original_uri = req.uri().clone();
    let url = match parse_request_url(&original_uri, req.headers()) {
        Ok(u) => u,
        Err(resp) => return Ok(resp),
    };

    // Rewrite target
    let (rewritten_url, _secure) = rewrite_target(&url, &context);

    if state.is_logging_enabled().await {
        debug!(
            original = %url,
            rewritten = %rewritten_url,
            "HTTP request rewrite"
        );
    }

    // Build new URI
    let new_uri = match rewritten_url.as_str().parse::<Uri>() {
        Ok(u) => u,
        Err(e) => {
            warn!(error = ?e, "Failed to parse rewritten URI");
            return Ok(error_response(StatusCode::BAD_GATEWAY, "Invalid target URL"));
        }
    };

    // Update request
    *req.uri_mut() = new_uri;
    req.headers_mut().remove(PROXY_AUTHORIZATION);
    if let Some(host) = rewritten_url.host_str() {
        req.headers_mut().insert(
            HOST,
            host.parse().unwrap_or_else(|_| "localhost".parse().unwrap()),
        );
    }

    // Forward request
    match client.request(req).await {
        Ok(resp) => Ok(resp.map(|body| body.boxed())),
        Err(e) => {
            warn!(error = ?e, "Upstream request failed");
            Ok(error_response(StatusCode::BAD_GATEWAY, "Bad Gateway"))
        }
    }
}

/// Handle WebSocket and other upgrade requests
async fn handle_upgrade(
    mut req: Request<Incoming>,
    context: super::types::ProxyContext,
    state: ProxyState,
    client: Client<HttpConnector, Incoming>,
) -> Result<Response<BoxBody>, Infallible> {
    // Parse the request URL
    let original_uri = req.uri().clone();
    let url = match parse_request_url(&original_uri, req.headers()) {
        Ok(u) => u,
        Err(resp) => return Ok(resp),
    };

    // Rewrite target
    let (rewritten_url, secure) = rewrite_target(&url, &context);

    if state.is_logging_enabled().await {
        debug!(
            original = %url,
            rewritten = %rewritten_url,
            secure = secure,
            "Upgrade request"
        );
    }

    // For WebSocket upgrades, we need to establish a direct TCP connection
    // and tunnel the bytes after the upgrade handshake
    let host = rewritten_url.host_str().unwrap_or("localhost");
    let _port = determine_requested_port(&rewritten_url);

    // Build new URI
    let new_uri = match rewritten_url.as_str().parse::<Uri>() {
        Ok(u) => u,
        Err(e) => {
            warn!(error = ?e, "Failed to parse rewritten URI");
            return Ok(error_response(StatusCode::BAD_GATEWAY, "Invalid target URL"));
        }
    };

    // Update request
    *req.uri_mut() = new_uri;
    req.headers_mut().remove(PROXY_AUTHORIZATION);
    req.headers_mut().insert(
        HOST,
        host.parse().unwrap_or_else(|_| "localhost".parse().unwrap()),
    );

    // Forward upgrade request to upstream
    let upstream_resp = match client.request(req).await {
        Ok(r) => r,
        Err(e) => {
            warn!(error = ?e, "Upgrade request failed");
            return Ok(error_response(
                StatusCode::BAD_GATEWAY,
                "Failed to connect to upstream",
            ));
        }
    };

    if upstream_resp.status() != StatusCode::SWITCHING_PROTOCOLS {
        return Ok(upstream_resp.map(|body| body.boxed()));
    }

    // At this point, both client and upstream have agreed to upgrade
    // We need to tunnel the raw bytes between them
    Ok(upstream_resp.map(|body| body.boxed()))
}

/// Handle CONNECT requests for HTTPS tunneling
async fn handle_connect(
    req: Request<Incoming>,
    context: super::types::ProxyContext,
    state: ProxyState,
) -> Result<Response<BoxBody>, Infallible> {
    // Parse CONNECT target (host:port)
    let uri = req.uri();
    let authority = match uri.authority() {
        Some(a) => a.as_str(),
        None => {
            return Ok(error_response(StatusCode::BAD_REQUEST, "Missing authority"));
        }
    };

    // Parse host and port
    let (host, port) = match parse_host_port(authority) {
        Some((h, p)) => (h, p),
        None => {
            return Ok(error_response(
                StatusCode::BAD_REQUEST,
                "Invalid CONNECT target",
            ));
        }
    };

    // Rewrite if it's a loopback hostname
    let target_url = Url::parse(&format!("https://{}:{}", host, port)).unwrap();
    let (rewritten_url, _secure) = rewrite_target(&target_url, &context);
    let final_host = rewritten_url.host_str().unwrap_or(&host);
    let final_port = determine_requested_port(&rewritten_url);

    if state.is_logging_enabled().await {
        debug!(
            original = %format!("{}:{}", host, port),
            rewritten = %format!("{}:{}", final_host, final_port),
            "CONNECT tunnel"
        );
    }

    // Connect to upstream
    let upstream_addr = format!("{}:{}", final_host, final_port);
    let upstream = match TcpStream::connect(&upstream_addr).await {
        Ok(s) => s,
        Err(e) => {
            warn!(error = ?e, "Failed to connect to upstream");
            return Ok(error_response(StatusCode::BAD_GATEWAY, "Connection failed"));
        }
    };

    // Spawn a task to tunnel the connection
    tokio::spawn(async move {
        match hyper::upgrade::on(req).await {
            Ok(client_stream) => {
                let mut client_io = TokioIo::new(client_stream);
                let (mut client_read, mut client_write) = tokio::io::split(&mut client_io);
                let (mut upstream_read, mut upstream_write) = upstream.into_split();

                let client_to_upstream = async {
                    tokio::io::copy(&mut client_read, &mut upstream_write).await
                };
                let upstream_to_client = async {
                    tokio::io::copy(&mut upstream_read, &mut client_write).await
                };

                tokio::select! {
                    result = client_to_upstream => {
                        if let Err(e) = result {
                            debug!(error = ?e, "Client to upstream copy failed");
                        }
                    }
                    result = upstream_to_client => {
                        if let Err(e) = result {
                            debug!(error = ?e, "Upstream to client copy failed");
                        }
                    }
                }

                let _ = client_write.shutdown().await;
                let _ = upstream_write.shutdown().await;
            }
            Err(e) => {
                warn!(error = ?e, "Failed to upgrade connection");
            }
        }
    });

    Ok(Response::builder()
        .status(StatusCode::OK)
        .body(boxed_empty())
        .unwrap())
}

/// Parse a request URL from URI and headers
fn parse_request_url(uri: &Uri, headers: &hyper::HeaderMap) -> Result<Url, Response<BoxBody>> {
    // If URI has scheme (absolute form), use it directly
    if let Some(scheme) = uri.scheme_str() {
        let url_str = uri.to_string();
        let normalized = if scheme == "ws" || scheme == "wss" {
            url_str.replace("ws://", "http://").replace("wss://", "https://")
        } else {
            url_str
        };
        return Url::parse(&normalized)
            .map_err(|_| error_response(StatusCode::BAD_REQUEST, "Invalid URL"));
    }

    // Otherwise, construct from Host header
    let host = headers
        .get(HOST)
        .and_then(|h| h.to_str().ok())
        .ok_or_else(|| error_response(StatusCode::BAD_REQUEST, "Missing Host header"))?;

    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let url_str = format!("http://{}{}", host, path_and_query);

    Url::parse(&url_str).map_err(|_| error_response(StatusCode::BAD_REQUEST, "Invalid URL"))
}

/// Parse host:port from CONNECT authority
fn parse_host_port(authority: &str) -> Option<(String, u16)> {
    let parts: Vec<&str> = authority.rsplitn(2, ':').collect();
    if parts.len() != 2 {
        return None;
    }
    let port = parts[0].parse().ok()?;
    let host = parts[1].to_string();
    Some((host, port))
}
