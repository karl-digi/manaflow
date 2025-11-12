use anyhow::{Context, Result};
use hyper::server::conn::http2;
use hyper_util::client::legacy::{Client, connect::HttpConnector};
use hyper_util::rt::{TokioExecutor, TokioIo};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Notify;
use tracing::{error, info};

use super::handlers::handle_request;
use super::types::ProxyState;

/// Configuration for the proxy server
#[derive(Debug, Clone)]
pub struct ProxyConfig {
    pub port_start: u16,
    pub port_range: u16,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self {
            port_start: 39385,
            port_range: 50,
        }
    }
}

/// The proxy server instance
pub struct ProxyServer {
    port: u16,
    state: ProxyState,
    shutdown: Arc<Notify>,
}

impl ProxyServer {
    /// Start a new proxy server
    pub async fn start(config: ProxyConfig) -> Result<Self> {
        let state = ProxyState::new();
        let shutdown = Arc::new(Notify::new());

        // Try to bind to a port in the configured range
        let (listener, port) = Self::bind_port(config.port_start, config.port_range).await?;

        info!("Proxy server starting on port {}", port);

        let state_clone = state.clone();
        let shutdown_clone = shutdown.clone();

        // Spawn server task
        tokio::spawn(async move {
            Self::serve(listener, state_clone, shutdown_clone).await;
        });

        Ok(Self {
            port,
            state,
            shutdown,
        })
    }

    /// Try to bind to a port in the given range
    async fn bind_port(start: u16, range: u16) -> Result<(TcpListener, u16)> {
        for i in 0..range {
            let port = start + i;
            let addr = SocketAddr::from(([127, 0, 0, 1], port));
            match TcpListener::bind(addr).await {
                Ok(listener) => return Ok((listener, port)),
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => continue,
                Err(e) => return Err(e).context("Failed to bind to port"),
            }
        }
        anyhow::bail!(
            "Could not bind to any port in range {}-{}",
            start,
            start + range - 1
        )
    }

    /// Serve incoming connections
    async fn serve(listener: TcpListener, state: ProxyState, shutdown: Arc<Notify>) {
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, addr)) => {
                            let state = state.clone();
                            tokio::spawn(async move {
                                if let Err(e) = Self::handle_connection(stream, addr, state).await {
                                    error!(error = ?e, addr = %addr, "Connection error");
                                }
                            });
                        }
                        Err(e) => {
                            error!(error = ?e, "Failed to accept connection");
                        }
                    }
                }
                _ = shutdown.notified() => {
                    info!("Proxy server shutting down");
                    break;
                }
            }
        }
    }

    /// Handle a single connection with HTTP/2
    async fn handle_connection(
        stream: tokio::net::TcpStream,
        addr: SocketAddr,
        state: ProxyState,
    ) -> Result<()> {
        let io = TokioIo::new(stream);

        // Create HTTP client for forwarding requests
        let client = Client::builder(TokioExecutor::new())
            .pool_max_idle_per_host(8)
            .build(HttpConnector::new());

        // Serve HTTP/2 connection
        let service = hyper::service::service_fn(move |req| {
            let state = state.clone();
            let client = client.clone();
            async move { handle_request(req, state, client).await }
        });

        if let Err(e) = http2::Builder::new(TokioExecutor::new())
            .serve_connection(io, service)
            .await
        {
            error!(error = ?e, addr = %addr, "HTTP/2 connection error");
        }

        Ok(())
    }

    /// Get the port the server is listening on
    pub fn port(&self) -> u16 {
        self.port
    }

    /// Get a reference to the proxy state
    pub fn state(&self) -> &ProxyState {
        &self.state
    }

    /// Shutdown the server
    pub fn shutdown(&self) {
        self.shutdown.notify_waiters();
    }
}

impl Drop for ProxyServer {
    fn drop(&mut self) {
        self.shutdown();
    }
}
