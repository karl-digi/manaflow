use base64::prelude::*;
use hyper::header::PROXY_AUTHORIZATION;
use hyper::{HeaderMap, Response, StatusCode};
use http_body_util::Full;
use bytes::Bytes;

use super::types::{ProxyContext, ProxyState};

/// Authenticate a request using Proxy-Authorization header
pub async fn authenticate_request(
    headers: &HeaderMap,
    state: &ProxyState,
) -> Option<ProxyContext> {
    let auth_header = headers.get(PROXY_AUTHORIZATION)?;
    let auth_str = auth_header.to_str().ok()?;

    // Parse "Basic <base64>" format
    let parts: Vec<&str> = auth_str.split_whitespace().collect();
    if parts.len() != 2 || !parts[0].eq_ignore_ascii_case("basic") {
        return None;
    }

    let decoded = BASE64_STANDARD.decode(parts[1]).ok()?;
    let decoded_str = String::from_utf8(decoded).ok()?;

    let separator_index = decoded_str.find(':')?;
    let username = &decoded_str[..separator_index];
    let password = &decoded_str[separator_index + 1..];

    let context = state.get_context_by_username(username).await?;
    if context.password != password {
        return None;
    }

    Some(context)
}

/// Create a 407 Proxy Authentication Required response
pub fn proxy_auth_required_response() -> Response<Full<Bytes>> {
    Response::builder()
        .status(StatusCode::PROXY_AUTHENTICATION_REQUIRED)
        .header("Proxy-Authenticate", r#"Basic realm="Cmux Preview Proxy""#)
        .body(Full::new(Bytes::from("Proxy Authentication Required")))
        .unwrap()
}

#[allow(dead_code)]
pub fn proxy_auth_required_bytes() -> Vec<u8> {
    b"HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"Cmux Preview Proxy\"\r\n\r\n".to_vec()
}
