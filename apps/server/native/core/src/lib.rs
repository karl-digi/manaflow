#![deny(clippy::all)]

mod types;
mod util;
mod repo;
mod diff;
mod merge_base;
mod branches;
mod proxy;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::Arc;
use tokio::sync::Mutex;
use types::{BranchInfo, DiffEntry, GitDiffOptions, GitListRemoteBranchesOptions};

// Global proxy server instance
static PROXY_SERVER: once_cell::sync::Lazy<Arc<Mutex<Option<proxy::ProxyServer>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

#[napi]
pub async fn get_time() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  #[cfg(debug_assertions)]
  println!("[cmux_native_core] get_time invoked");
  let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
  now.as_millis().to_string()
}

#[napi]
pub async fn git_diff(opts: GitDiffOptions) -> Result<Vec<DiffEntry>> {
  #[cfg(debug_assertions)]
  println!(
    "[cmux_native_git] git_diff headRef={} baseRef={:?} originPathOverride={:?} repoUrl={:?} repoFullName={:?} includeContents={:?} maxBytes={:?}",
    opts.headRef,
    opts.baseRef,
    opts.originPathOverride,
    opts.repoUrl,
    opts.repoFullName,
    opts.includeContents,
    opts.maxBytes
  );
  tokio::task::spawn_blocking(move || diff::refs::diff_refs(opts))
    .await
    .map_err(|e| Error::from_reason(format!("Join error: {e}")))?
    .map_err(|e| Error::from_reason(format!("{e:#}")))
}

#[napi]
pub async fn git_list_remote_branches(opts: GitListRemoteBranchesOptions) -> Result<Vec<BranchInfo>> {
  #[cfg(debug_assertions)]
  println!(
    "[cmux_native_git] git_list_remote_branches repoFullName={:?} repoUrl={:?} originPathOverride={:?}",
    opts.repoFullName,
    opts.repoUrl,
    opts.originPathOverride
  );
  tokio::task::spawn_blocking(move || branches::list_remote_branches(opts))
    .await
    .map_err(|e| Error::from_reason(format!("Join error: {e}")))?
    .map_err(|e| Error::from_reason(format!("{e:#}")))
}

// Proxy server NAPI bindings

#[napi(object)]
pub struct ProxyCredentials {
  pub username: String,
  pub password: String,
}

#[napi(object)]
pub struct ProxyContextConfig {
  pub username: String,
  pub password: String,
  pub initial_url: String,
  pub web_contents_id: u32,
  pub persist_key: Option<String>,
}

/// Start the preview proxy server
#[napi]
pub async fn start_preview_proxy() -> Result<u32> {
  let config = proxy::ProxyConfig::default();
  let server = proxy::ProxyServer::start(config)
    .await
    .map_err(|e| Error::from_reason(format!("Failed to start proxy: {}", e)))?;

  let port = server.port();
  let mut proxy_server = PROXY_SERVER.lock().await;
  *proxy_server = Some(server);

  Ok(port as u32)
}

/// Stop the preview proxy server
#[napi]
pub async fn stop_preview_proxy() -> Result<()> {
  let mut proxy_server = PROXY_SERVER.lock().await;
  if let Some(server) = proxy_server.take() {
    server.shutdown();
  }
  Ok(())
}

/// Configure a proxy context for a WebContents
#[napi]
pub async fn configure_preview_proxy_context(config: ProxyContextConfig) -> Result<bool> {
  let proxy_server = PROXY_SERVER.lock().await;
  let server = proxy_server.as_ref().ok_or_else(|| {
    Error::from_reason("Proxy server not started")
  })?;

  // Derive route from initial URL
  let route = proxy::rewrite::derive_route(&config.initial_url);

  let context = proxy::ProxyContext {
    username: config.username,
    password: config.password,
    route,
    web_contents_id: config.web_contents_id,
    persist_key: config.persist_key,
  };

  server.state().add_context(context).await;
  Ok(true)
}

/// Release a proxy context for a WebContents
#[napi]
pub async fn release_preview_proxy_context(web_contents_id: u32) -> Result<bool> {
  let proxy_server = PROXY_SERVER.lock().await;
  let server = proxy_server.as_ref().ok_or_else(|| {
    Error::from_reason("Proxy server not started")
  })?;

  let removed = server.state().remove_context(web_contents_id).await;
  Ok(removed.is_some())
}

/// Get proxy credentials for a WebContents
#[napi]
pub async fn get_proxy_credentials_for_web_contents(web_contents_id: u32) -> Result<Option<ProxyCredentials>> {
  let proxy_server = PROXY_SERVER.lock().await;
  let server = proxy_server.as_ref().ok_or_else(|| {
    Error::from_reason("Proxy server not started")
  })?;

  let context = server.state().get_context_by_web_contents_id(web_contents_id).await;
  Ok(context.map(|ctx| ProxyCredentials {
    username: ctx.username,
    password: ctx.password,
  }))
}

/// Set whether proxy logging is enabled
#[napi]
pub async fn set_preview_proxy_logging_enabled(enabled: bool) -> Result<()> {
  let proxy_server = PROXY_SERVER.lock().await;
  let server = proxy_server.as_ref().ok_or_else(|| {
    Error::from_reason("Proxy server not started")
  })?;

  server.state().set_logging_enabled(enabled).await;
  Ok(())
}

#[cfg(test)]
mod tests;
