//! Internal API proxy for forwarding coding CLI requests to real API providers.
//!
//! Instead of passing API keys directly to CLI processes, we run a local proxy
//! that holds the API keys and forwards authenticated requests. CLIs are configured
//! to use the proxy via base URL environment variables like ANTHROPIC_BASE_URL.
//!
//! Architecture:
//! ```
//! CLI (no API key) → http://127.0.0.1:39385/v1/messages
//!                          ↓
//!                   API Proxy (has API key)
//!                          ↓
//!              https://api.anthropic.com/v1/messages
//! ```

use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use axum::Router;
use reqwest::Client;
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tracing::{debug, error, info};

/// API provider configuration.
#[derive(Clone)]
pub struct ProviderConfig {
    /// The real API base URL (e.g., "https://api.anthropic.com")
    pub upstream_url: String,
    /// API key to add to requests
    pub api_key: String,
    /// Header name for the API key (e.g., "x-api-key" for Anthropic, "Authorization" for OpenAI)
    pub auth_header: String,
    /// Auth header value format (e.g., "Bearer {key}" for OpenAI, just "{key}" for Anthropic)
    pub auth_format: AuthFormat,
}

/// Format for the auth header value.
#[derive(Clone)]
pub enum AuthFormat {
    /// Just the key: "sk-ant-..."
    Plain,
    /// Bearer token: "Bearer sk-..."
    Bearer,
}

impl ProviderConfig {
    /// Create Anthropic provider config.
    pub fn anthropic(api_key: String) -> Self {
        Self {
            upstream_url: "https://api.anthropic.com".to_string(),
            api_key,
            auth_header: "x-api-key".to_string(),
            auth_format: AuthFormat::Plain,
        }
    }

    /// Create OpenAI provider config.
    pub fn openai(api_key: String) -> Self {
        Self {
            upstream_url: "https://api.openai.com".to_string(),
            api_key,
            auth_header: "authorization".to_string(),
            auth_format: AuthFormat::Bearer,
        }
    }

    /// Create Google AI provider config.
    pub fn google(api_key: String) -> Self {
        Self {
            upstream_url: "https://generativelanguage.googleapis.com".to_string(),
            api_key,
            auth_header: "x-goog-api-key".to_string(),
            auth_format: AuthFormat::Plain,
        }
    }

    /// Get the formatted auth header value.
    fn auth_value(&self) -> String {
        match self.auth_format {
            AuthFormat::Plain => self.api_key.clone(),
            AuthFormat::Bearer => format!("Bearer {}", self.api_key),
        }
    }
}

/// State for the API proxy.
#[derive(Clone)]
pub struct ApiProxyState {
    /// HTTP client for forwarding requests
    client: Client,
    /// Provider configuration
    config: ProviderConfig,
}

impl ApiProxyState {
    /// Create a new proxy state.
    pub fn new(config: ProviderConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

/// Handle all requests by proxying to upstream.
async fn proxy_handler(
    State(state): State<ApiProxyState>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Body,
) -> impl IntoResponse {
    // Build upstream URL
    let path_and_query = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("/");
    let upstream_url = format!("{}{}", state.config.upstream_url, path_and_query);

    debug!(
        method = %method,
        path = %path_and_query,
        upstream = %upstream_url,
        "Proxying request"
    );

    // Build request to upstream
    let mut request_builder = state.client.request(method.clone(), &upstream_url);

    // Copy headers, excluding host and content-length (will be recalculated)
    for (name, value) in headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers and headers we'll set ourselves
        if name_str == "host"
            || name_str == "content-length"
            || name_str == "transfer-encoding"
            || name_str == "connection"
            || name_str == state.config.auth_header.to_lowercase()
        {
            continue;
        }
        if let Ok(header_value) = value.to_str() {
            request_builder = request_builder.header(name.as_str(), header_value);
        }
    }

    // Add the API key header
    request_builder = request_builder.header(&state.config.auth_header, state.config.auth_value());

    // Get body bytes
    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read request body");
            return Response::builder()
                .status(StatusCode::BAD_REQUEST)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };

    // Send request
    let response = match request_builder.body(body_bytes).send().await {
        Ok(resp) => resp,
        Err(e) => {
            error!(error = %e, upstream = %upstream_url, "Upstream request failed");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(format!("Upstream request failed: {}", e)))
                .unwrap();
        }
    };

    // Build response
    let status = response.status();
    let response_headers = response.headers().clone();

    // Get response body as stream for streaming responses
    let response_bytes = match response.bytes().await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!(error = %e, "Failed to read upstream response");
            return Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from("Failed to read upstream response"))
                .unwrap();
        }
    };

    // Build axum response
    let mut builder = Response::builder().status(status);

    // Copy response headers
    for (name, value) in response_headers.iter() {
        let name_str = name.as_str().to_lowercase();
        // Skip hop-by-hop headers
        if name_str == "transfer-encoding" || name_str == "connection" {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_bytes());
    }

    builder.body(Body::from(response_bytes)).unwrap()
}

/// API proxy server handle.
pub struct ApiProxy {
    /// Address the proxy is listening on
    pub addr: SocketAddr,
    /// Shutdown signal sender
    shutdown_tx: Option<tokio::sync::oneshot::Sender<()>>,
}

impl ApiProxy {
    /// Start a new API proxy server.
    pub async fn start(config: ProviderConfig, port: u16) -> anyhow::Result<Self> {
        let state = ApiProxyState::new(config);

        let app = Router::new()
            .route("/{*path}", any(proxy_handler))
            .route("/", any(proxy_handler))
            .with_state(state);

        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let listener = TcpListener::bind(addr).await?;
        let actual_addr = listener.local_addr()?;

        info!(addr = %actual_addr, "API proxy started");

        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel();

        // Spawn server task
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .ok();
        });

        Ok(Self {
            addr: actual_addr,
            shutdown_tx: Some(shutdown_tx),
        })
    }

    /// Get the base URL for this proxy.
    pub fn base_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Stop the proxy server.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for ApiProxy {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Collection of API proxies for different providers.
pub struct ApiProxies {
    pub anthropic: Option<ApiProxy>,
    pub openai: Option<ApiProxy>,
    pub google: Option<ApiProxy>,
}

impl ApiProxies {
    /// Start proxies for the given API keys.
    pub async fn start(
        anthropic_key: Option<String>,
        openai_key: Option<String>,
        google_key: Option<String>,
    ) -> anyhow::Result<Self> {
        let anthropic = if let Some(key) = anthropic_key {
            Some(ApiProxy::start(ProviderConfig::anthropic(key), 0).await?)
        } else {
            None
        };

        let openai = if let Some(key) = openai_key {
            Some(ApiProxy::start(ProviderConfig::openai(key), 0).await?)
        } else {
            None
        };

        let google = if let Some(key) = google_key {
            Some(ApiProxy::start(ProviderConfig::google(key), 0).await?)
        } else {
            None
        };

        Ok(Self {
            anthropic,
            openai,
            google,
        })
    }

    /// Get environment variables to set for CLI processes.
    pub fn env_vars(&self) -> Vec<(String, String)> {
        let mut vars = Vec::new();

        if let Some(ref proxy) = self.anthropic {
            vars.push(("ANTHROPIC_BASE_URL".to_string(), proxy.base_url()));
        }

        if let Some(ref proxy) = self.openai {
            vars.push(("OPENAI_BASE_URL".to_string(), proxy.base_url()));
        }

        // Google doesn't have a simple base URL env var, skip for now
        // if let Some(ref proxy) = self.google {
        //     vars.push(("GOOGLE_AI_BASE_URL".to_string(), proxy.base_url()));
        // }

        vars
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_format() {
        let anthropic = ProviderConfig::anthropic("sk-ant-test".to_string());
        assert_eq!(anthropic.auth_value(), "sk-ant-test");

        let openai = ProviderConfig::openai("sk-test".to_string());
        assert_eq!(openai.auth_value(), "Bearer sk-test");
    }
}
