//! PVE LXC Sandbox Provider
//!
//! This module implements a sandbox provider using Proxmox VE (PVE) LXC containers.
//! It communicates with the Proxmox API to create, manage, and destroy LXC containers
//! that serve as isolated execution environments for coding agents.

use crate::errors::{SandboxError, SandboxResult};
use crate::models::{
    AwaitReadyRequest, AwaitReadyResponse, CreateSandboxRequest, EnvVar, ExecRequest, ExecResponse,
    PruneRequest, PruneResponse, SandboxNetwork, SandboxStatus, SandboxSummary, ServiceReadiness,
};
use crate::service::{GhAuthCache, GhResponseRegistry, HostEventReceiver, SandboxService};
use async_trait::async_trait;
use axum::body::Body;
use axum::extract::ws::WebSocket;
use chrono::{DateTime, Utc};
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::sync::Mutex;
use tracing::{error, info, warn};
use uuid::Uuid;

// =============================================================================
// PVE API Client Types
// =============================================================================

/// Configuration for connecting to a Proxmox VE server.
///
/// Only 2 environment variables are required:
/// - `PVE_API_URL`: Base URL (e.g., "https://pve.example.com:8006")
/// - `PVE_API_TOKEN`: Full API token in format "USER@REALM!TOKENID=SECRET"
///
/// All other settings are auto-detected or have sensible defaults.
#[derive(Clone, Debug)]
pub struct PveConfig {
    /// Base URL of the PVE API (e.g., "https://pve.example.com:8006")
    pub api_url: String,
    /// API token ID (e.g., "user@pam!token-name")
    pub token_id: String,
    /// API token secret (UUID)
    pub token_secret: String,
    /// Node name where LXC containers will be created (auto-detected if not set)
    pub node: Option<String>,
    /// Template VMID to clone from (CT template)
    pub template_vmid: Option<u32>,
    /// Storage pool for container rootfs (auto-detected if not set)
    pub storage: Option<String>,
    /// Bridge interface for networking (default: "vmbr0")
    pub bridge: String,
    /// IP pool CIDR for container networking (default: "10.100.0.0/24")
    pub ip_pool_cidr: String,
    /// Gateway IP for containers (auto-detected from bridge if not set)
    pub gateway: Option<String>,
    /// Whether to verify TLS certificates (default: false for self-signed certs)
    pub verify_tls: bool,
}

impl PveConfig {
    /// Create configuration from environment variables.
    ///
    /// Required:
    /// - `PVE_API_URL`: Base URL (e.g., "https://pve.example.com:8006")
    /// - `PVE_API_TOKEN`: Full API token in format "USER@REALM!TOKENID=SECRET"
    ///
    /// Optional (auto-detected or defaults):
    /// - `PVE_NODE`: Node name (auto-detected from cluster)
    /// - `PVE_TEMPLATE_VMID`: Template to clone containers from
    /// - `PVE_STORAGE`: Storage pool (auto-detected)
    /// - `PVE_BRIDGE`: Network bridge (default: "vmbr0")
    /// - `PVE_IP_POOL_CIDR`: IP range for containers (default: "10.100.0.0/24")
    /// - `PVE_GATEWAY`: Gateway IP (auto-detected from bridge)
    /// - `PVE_VERIFY_TLS`: Verify TLS certs (default: false)
    pub fn from_env() -> SandboxResult<Self> {
        let api_url = std::env::var("PVE_API_URL")
            .map_err(|_| SandboxError::InvalidRequest("PVE_API_URL not set".to_string()))?;

        // Parse combined token format: "USER@REALM!TOKENID=SECRET"
        let api_token = std::env::var("PVE_API_TOKEN")
            .map_err(|_| SandboxError::InvalidRequest("PVE_API_TOKEN not set".to_string()))?;

        let (token_id, token_secret) = parse_api_token(&api_token)?;

        let node = std::env::var("PVE_NODE").ok();
        let template_vmid = std::env::var("PVE_TEMPLATE_VMID")
            .ok()
            .and_then(|v| v.parse().ok());
        let storage = std::env::var("PVE_STORAGE").ok();
        let bridge = std::env::var("PVE_BRIDGE").unwrap_or_else(|_| "vmbr0".to_string());
        let ip_pool_cidr =
            std::env::var("PVE_IP_POOL_CIDR").unwrap_or_else(|_| "10.100.0.0/24".to_string());
        let gateway = std::env::var("PVE_GATEWAY").ok();
        // Default to false since most PVE setups use self-signed certs
        let verify_tls = std::env::var("PVE_VERIFY_TLS")
            .map(|v| v == "1" || v.to_lowercase() == "true")
            .unwrap_or(false);

        Ok(Self {
            api_url,
            token_id,
            token_secret,
            node,
            template_vmid,
            storage,
            bridge,
            ip_pool_cidr,
            verify_tls,
            gateway,
        })
    }
}

/// Parse PVE API token in format "USER@REALM!TOKENID=SECRET"
/// Returns (token_id, token_secret)
fn parse_api_token(token: &str) -> SandboxResult<(String, String)> {
    // Format: USER@REALM!TOKENID=SECRET
    // Example: root@pam!mytoken=12345678-1234-1234-1234-1234567890ab
    if let Some(eq_pos) = token.rfind('=') {
        let token_id = token[..eq_pos].to_string();
        let token_secret = token[eq_pos + 1..].to_string();

        // Validate token_id format (should contain @ and !)
        if !token_id.contains('@') || !token_id.contains('!') {
            return Err(SandboxError::InvalidRequest(
                "PVE_API_TOKEN must be in format 'USER@REALM!TOKENID=SECRET'".to_string(),
            ));
        }

        Ok((token_id, token_secret))
    } else {
        Err(SandboxError::InvalidRequest(
            "PVE_API_TOKEN must be in format 'USER@REALM!TOKENID=SECRET'".to_string(),
        ))
    }
}

/// Response from PVE API for task status
#[derive(Debug, Deserialize)]
struct PveTaskStatus {
    status: String,
    exitstatus: Option<String>,
}

/// Response wrapper for PVE API
#[derive(Debug, Deserialize)]
struct PveResponse<T> {
    data: T,
}

/// LXC container status from PVE
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PveLxcStatus {
    vmid: u32,
    status: String,
    name: Option<String>,
    #[serde(default)]
    maxmem: u64,
    #[serde(default)]
    maxdisk: u64,
    #[serde(default)]
    cpus: u32,
}

/// LXC container config (partial)
#[derive(Debug, Deserialize)]
struct PveLxcConfig {
    net0: Option<String>,
}

/// Request body for creating an LXC container
#[derive(Debug, Serialize)]
struct CreateLxcRequest {
    vmid: u32,
    hostname: String,
    ostemplate: Option<String>,
    storage: String,
    rootfs: String,
    cores: u32,
    memory: u32,
    swap: u32,
    net0: String,
    start: u8,
    unprivileged: u8,
    features: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ssh_public_keys: Option<String>,
}

/// Request body for cloning an LXC container
#[derive(Debug, Serialize)]
struct CloneLxcRequest {
    newid: u32,
    hostname: String,
    full: u8,
    storage: Option<String>,
}

/// Node info from PVE cluster
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PveNodeInfo {
    node: String,
    status: String,
    #[serde(default)]
    maxcpu: u32,
    #[serde(default)]
    maxmem: u64,
}

/// Storage info from PVE
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PveStorageInfo {
    storage: String,
    #[serde(default)]
    content: String,
    #[serde(rename = "type")]
    storage_type: Option<String>,
    #[serde(default)]
    avail: u64,
    #[serde(default)]
    total: u64,
}

/// Network interface info from PVE
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PveNetworkInfo {
    iface: String,
    #[serde(rename = "type")]
    iface_type: Option<String>,
    #[serde(default)]
    address: Option<String>,
    #[serde(default)]
    gateway: Option<String>,
    #[serde(default)]
    cidr: Option<String>,
}

/// Resolved configuration with auto-detected values
#[derive(Clone, Debug)]
pub struct ResolvedPveConfig {
    pub api_url: String,
    pub token_id: String,
    pub token_secret: String,
    pub node: String,
    pub template_vmid: Option<u32>,
    pub storage: String,
    pub bridge: String,
    pub ip_pool_cidr: String,
    pub gateway: String,
    pub verify_tls: bool,
}

// =============================================================================
// PVE API Client
// =============================================================================

/// HTTP client for communicating with Proxmox VE API
#[derive(Clone)]
pub struct PveClient {
    client: Client,
    config: ResolvedPveConfig,
}

impl PveClient {
    /// Create a new PVE API client with auto-detection of missing config values
    pub async fn new(config: PveConfig) -> SandboxResult<Self> {
        let client = Client::builder()
            .danger_accept_invalid_certs(!config.verify_tls)
            .build()
            .map_err(|e| SandboxError::Internal(format!("Failed to create HTTP client: {e}")))?;

        // Create temporary client for auto-detection
        let temp_client = Self {
            client: client.clone(),
            config: ResolvedPveConfig {
                api_url: config.api_url.clone(),
                token_id: config.token_id.clone(),
                token_secret: config.token_secret.clone(),
                node: String::new(), // Will be detected
                template_vmid: config.template_vmid,
                storage: String::new(), // Will be detected
                bridge: config.bridge.clone(),
                ip_pool_cidr: config.ip_pool_cidr.clone(),
                gateway: String::new(), // Will be detected
                verify_tls: config.verify_tls,
            },
        };

        // Auto-detect node if not specified
        let node = match config.node {
            Some(n) => n,
            None => temp_client.detect_node().await?,
        };

        // Auto-detect storage if not specified
        let storage = match config.storage {
            Some(s) => s,
            None => temp_client.detect_storage(&node).await?,
        };

        // Auto-detect gateway if not specified
        let gateway = match config.gateway {
            Some(g) => g,
            None => temp_client
                .detect_gateway(&node, &config.bridge)
                .await
                .unwrap_or_else(|_| {
                    // Fallback: derive gateway from IP pool (assume .1)
                    derive_gateway_from_cidr(&config.ip_pool_cidr)
                }),
        };

        let resolved = ResolvedPveConfig {
            api_url: config.api_url,
            token_id: config.token_id,
            token_secret: config.token_secret,
            node,
            template_vmid: config.template_vmid,
            storage,
            bridge: config.bridge,
            ip_pool_cidr: config.ip_pool_cidr,
            gateway,
            verify_tls: config.verify_tls,
        };

        info!(
            "PVE client configured: node={}, storage={}, gateway={}",
            resolved.node, resolved.storage, resolved.gateway
        );

        Ok(Self {
            client,
            config: resolved,
        })
    }

    /// Get the resolved configuration
    pub fn resolved_config(&self) -> &ResolvedPveConfig {
        &self.config
    }

    /// Get authorization header value
    fn auth_header(&self) -> String {
        format!(
            "PVEAPIToken={}={}",
            self.config.token_id, self.config.token_secret
        )
    }

    /// Auto-detect the best node to use
    async fn detect_node(&self) -> SandboxResult<String> {
        let nodes: Vec<PveNodeInfo> = self.get_raw("/nodes").await?;

        // Find the first online node, preferring ones with more resources
        let node = nodes
            .into_iter()
            .filter(|n| n.status == "online")
            .max_by_key(|n| n.maxmem)
            .map(|n| n.node)
            .ok_or_else(|| SandboxError::Internal("No online PVE nodes found".to_string()))?;

        info!("Auto-detected PVE node: {}", node);
        Ok(node)
    }

    /// Auto-detect the best storage for containers
    async fn detect_storage(&self, node: &str) -> SandboxResult<String> {
        let path = format!("/nodes/{}/storage", node);
        let storages: Vec<PveStorageInfo> = self.get_raw(&path).await?;

        // Find storage that supports "rootdir" (for containers) with most available space
        let storage = storages
            .into_iter()
            .filter(|s| s.content.contains("rootdir") || s.content.contains("images"))
            .max_by_key(|s| s.avail)
            .map(|s| s.storage)
            .unwrap_or_else(|| "local-lvm".to_string());

        info!("Auto-detected PVE storage: {}", storage);
        Ok(storage)
    }

    /// Auto-detect gateway from bridge interface
    async fn detect_gateway(&self, node: &str, bridge: &str) -> SandboxResult<String> {
        let path = format!("/nodes/{}/network", node);
        let networks: Vec<PveNetworkInfo> = self.get_raw(&path).await?;

        // Find the bridge and get its gateway
        for net in networks {
            if net.iface == bridge {
                if let Some(gw) = net.gateway {
                    info!("Auto-detected gateway from bridge {}: {}", bridge, gw);
                    return Ok(gw);
                }
                // If no gateway, try to use the bridge's IP as gateway hint
                if let Some(addr) = net.address {
                    info!("Using bridge {} address as gateway: {}", bridge, addr);
                    return Ok(addr);
                }
            }
        }

        Err(SandboxError::Internal(format!(
            "Could not detect gateway from bridge {}",
            bridge
        )))
    }

    /// Make a GET request to the PVE API (raw, without node prefix)
    async fn get_raw<T: for<'de> Deserialize<'de>>(&self, path: &str) -> SandboxResult<T> {
        let url = format!("{}/api2/json{}", self.config.api_url, path);
        let response = self
            .client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SandboxError::Internal(format!("PVE API request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "PVE API error {status}: {body}"
            )));
        }

        let wrapper: PveResponse<T> = response
            .json()
            .await
            .map_err(|e| SandboxError::Internal(format!("Failed to parse PVE response: {e}")))?;

        Ok(wrapper.data)
    }

    /// Make a GET request to the PVE API
    async fn get<T: for<'de> Deserialize<'de>>(&self, path: &str) -> SandboxResult<T> {
        let url = format!("{}/api2/json{}", self.config.api_url, path);
        let response = self
            .client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SandboxError::Internal(format!("PVE API request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "PVE API error {status}: {body}"
            )));
        }

        let wrapper: PveResponse<T> = response
            .json()
            .await
            .map_err(|e| SandboxError::Internal(format!("Failed to parse PVE response: {e}")))?;

        Ok(wrapper.data)
    }

    /// Make a POST request to the PVE API
    async fn post<T: Serialize>(&self, path: &str, body: &T) -> SandboxResult<String> {
        let url = format!("{}/api2/json{}", self.config.api_url, path);
        let response = self
            .client
            .post(&url)
            .header("Authorization", self.auth_header())
            .form(body)
            .send()
            .await
            .map_err(|e| SandboxError::Internal(format!("PVE API request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "PVE API error {status}: {body}"
            )));
        }

        // Extract task UPID from response for async operations
        let text = response.text().await.unwrap_or_default();
        Ok(text)
    }

    /// Make a DELETE request to the PVE API
    async fn delete(&self, path: &str) -> SandboxResult<String> {
        let url = format!("{}/api2/json{}", self.config.api_url, path);
        let response = self
            .client
            .delete(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .map_err(|e| SandboxError::Internal(format!("PVE API request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "PVE API error {status}: {body}"
            )));
        }

        let text = response.text().await.unwrap_or_default();
        Ok(text)
    }

    /// Wait for a PVE task to complete
    async fn wait_for_task(&self, upid: &str) -> SandboxResult<()> {
        let encoded_upid = urlencoding::encode(upid);
        let path = format!("/nodes/{}/tasks/{}/status", self.config.node, encoded_upid);

        for _ in 0..120 {
            // Wait up to 2 minutes
            let status: PveTaskStatus = self.get(&path).await?;

            match status.status.as_str() {
                "stopped" => {
                    if let Some(exit) = status.exitstatus {
                        if exit == "OK" {
                            return Ok(());
                        } else {
                            return Err(SandboxError::Internal(format!("PVE task failed: {exit}")));
                        }
                    }
                    return Ok(());
                }
                "running" => {
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                }
                other => {
                    return Err(SandboxError::Internal(format!(
                        "Unknown PVE task status: {other}"
                    )));
                }
            }
        }

        Err(SandboxError::Internal("PVE task timed out".to_string()))
    }

    /// List all LXC containers on the node
    async fn list_lxc(&self) -> SandboxResult<Vec<PveLxcStatus>> {
        let path = format!("/nodes/{}/lxc", self.config.node);
        self.get(&path).await
    }

    /// Get config for a specific LXC container
    async fn get_lxc_config(&self, vmid: u32) -> SandboxResult<PveLxcConfig> {
        let path = format!("/nodes/{}/lxc/{}/config", self.config.node, vmid);
        self.get(&path).await
    }

    /// Get status of a specific LXC container
    #[allow(dead_code)]
    async fn get_lxc_status(&self, vmid: u32) -> SandboxResult<PveLxcStatus> {
        let path = format!("/nodes/{}/lxc/{}/status/current", self.config.node, vmid);
        self.get(&path).await
    }

    /// Create a new LXC container from template
    #[allow(dead_code)]
    async fn create_lxc(&self, request: CreateLxcRequest) -> SandboxResult<()> {
        let path = format!("/nodes/{}/lxc", self.config.node);
        let response = self.post(&path, &request).await?;

        // Parse UPID from response and wait for task
        if let Some(upid) = extract_upid(&response) {
            self.wait_for_task(&upid).await?;
        }

        Ok(())
    }

    /// Clone an existing LXC container
    async fn clone_lxc(&self, source_vmid: u32, request: CloneLxcRequest) -> SandboxResult<()> {
        let path = format!("/nodes/{}/lxc/{}/clone", self.config.node, source_vmid);
        let response = self.post(&path, &request).await?;

        // Parse UPID from response and wait for task
        if let Some(upid) = extract_upid(&response) {
            self.wait_for_task(&upid).await?;
        }

        Ok(())
    }

    /// Start an LXC container
    async fn start_lxc(&self, vmid: u32) -> SandboxResult<()> {
        let path = format!("/nodes/{}/lxc/{}/status/start", self.config.node, vmid);
        let response = self.post(&path, &()).await?;

        if let Some(upid) = extract_upid(&response) {
            self.wait_for_task(&upid).await?;
        }

        Ok(())
    }

    /// Stop an LXC container
    async fn stop_lxc(&self, vmid: u32) -> SandboxResult<()> {
        let path = format!("/nodes/{}/lxc/{}/status/stop", self.config.node, vmid);
        let response = self.post(&path, &()).await?;

        if let Some(upid) = extract_upid(&response) {
            self.wait_for_task(&upid).await?;
        }

        Ok(())
    }

    /// Delete an LXC container
    async fn delete_lxc(&self, vmid: u32) -> SandboxResult<()> {
        let path = format!("/nodes/{}/lxc/{}", self.config.node, vmid);
        let response = self.delete(&path).await?;

        if let Some(upid) = extract_upid(&response) {
            self.wait_for_task(&upid).await?;
        }

        Ok(())
    }

    /// Execute a command in an LXC container via HTTP exec daemon (cmux-execd).
    /// The cmux-execd service runs on port 39375 inside the container.
    async fn exec_lxc(
        &self,
        ip: std::net::Ipv4Addr,
        command: &[String],
        timeout_ms: Option<u64>,
    ) -> SandboxResult<ExecResponse> {
        let cmd_str = command.join(" ");
        let exec_url = format!("http://{}:39375/exec", ip);
        let timeout = timeout_ms.unwrap_or(30000);

        let body = serde_json::json!({
            "command": format!("bash -lc {}", serde_json::to_string(&cmd_str).unwrap_or_else(|_| format!("'{}'", cmd_str))),
            "timeout_ms": timeout,
        });

        let response = self
            .client
            .post(&exec_url)
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .timeout(std::time::Duration::from_millis(timeout + 5000))
            .send()
            .await
            .map_err(|e| {
                SandboxError::Internal(format!(
                    "HTTP exec request failed for container at {}: {}",
                    ip, e
                ))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "HTTP exec failed with status {}: {}",
                status, text
            )));
        }

        // Parse streaming JSON lines response
        let text = response
            .text()
            .await
            .map_err(|e| SandboxError::Internal(format!("Failed to read exec response: {}", e)))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code: i32 = 0;

        for line in text.lines().filter(|l| !l.is_empty()) {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
                match event.get("type").and_then(|t| t.as_str()) {
                    Some("stdout") => {
                        if let Some(data) = event.get("data").and_then(|d| d.as_str()) {
                            if !stdout.is_empty() {
                                stdout.push('\n');
                            }
                            stdout.push_str(data);
                        }
                    }
                    Some("stderr") => {
                        if let Some(data) = event.get("data").and_then(|d| d.as_str()) {
                            if !stderr.is_empty() {
                                stderr.push('\n');
                            }
                            stderr.push_str(data);
                        }
                    }
                    Some("exit") => {
                        if let Some(code) = event.get("code").and_then(|c| c.as_i64()) {
                            exit_code = code as i32;
                        }
                    }
                    Some("error") => {
                        if let Some(msg) = event.get("message").and_then(|m| m.as_str()) {
                            if !stderr.is_empty() {
                                stderr.push('\n');
                            }
                            stderr.push_str(msg);
                        }
                    }
                    _ => {}
                }
            }
        }

        Ok(ExecResponse {
            exit_code,
            stdout,
            stderr,
        })
    }
}

/// Extract UPID from PVE API response
fn extract_upid(response: &str) -> Option<String> {
    // PVE returns JSON like {"data": "UPID:node:..."}
    serde_json::from_str::<PveResponse<String>>(response)
        .ok()
        .map(|r| r.data)
}

/// Derive gateway IP from CIDR (assumes gateway is .1 in the subnet)
fn derive_gateway_from_cidr(cidr: &str) -> String {
    if let Some(slash_pos) = cidr.find('/') {
        let ip_part = &cidr[..slash_pos];
        if let Ok(ip) = ip_part.parse::<std::net::Ipv4Addr>() {
            let octets = ip.octets();
            // Set last octet to 1 for gateway
            return format!("{}.{}.{}.1", octets[0], octets[1], octets[2]);
        }
    }
    // Fallback
    "10.100.0.1".to_string()
}

// =============================================================================
// IP Pool for LXC Containers
// =============================================================================

fn extract_ip_from_net_config(net0: &str) -> Option<std::net::Ipv4Addr> {
    for part in net0.split(',') {
        let value = part.trim();
        if let Some(ip_part) = value.strip_prefix("ip=") {
            if ip_part.eq_ignore_ascii_case("dhcp") || ip_part.eq_ignore_ascii_case("auto") {
                return None;
            }
            let raw_ip = ip_part.split('/').next().unwrap_or(ip_part);
            if let Ok(ip) = raw_ip.parse::<std::net::Ipv4Addr>() {
                return Some(ip);
            }
        }
    }
    None
}

/// Simple IP pool allocator for LXC containers
struct LxcIpPool {
    base: std::net::Ipv4Addr,
    prefix_len: u8,
    allocated: std::collections::HashSet<std::net::Ipv4Addr>,
    next_offset: u32,
}

impl LxcIpPool {
    fn new(cidr: &str) -> SandboxResult<Self> {
        let parts: Vec<&str> = cidr.split('/').collect();
        if parts.len() != 2 {
            return Err(SandboxError::InvalidRequest(format!(
                "Invalid CIDR: {cidr}"
            )));
        }

        let base: std::net::Ipv4Addr = parts[0]
            .parse()
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid IP: {}", parts[0])))?;
        let prefix_len: u8 = parts[1]
            .parse()
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid prefix: {}", parts[1])))?;

        Ok(Self {
            base,
            prefix_len,
            allocated: std::collections::HashSet::new(),
            next_offset: 10, // Start at .10 to avoid common reserved IPs
        })
    }

    fn contains(&self, ip: std::net::Ipv4Addr) -> bool {
        let base_u32 = u32::from_be_bytes(self.base.octets());
        let ip_u32 = u32::from_be_bytes(ip.octets());
        let mask = if self.prefix_len == 0 {
            0
        } else {
            u32::MAX << (32 - self.prefix_len as u32)
        };
        (base_u32 & mask) == (ip_u32 & mask)
    }

    fn reserve(&mut self, ip: std::net::Ipv4Addr) {
        if self.contains(ip) {
            self.allocated.insert(ip);
        }
    }

    fn allocate(&mut self) -> SandboxResult<std::net::Ipv4Addr> {
        let max_hosts = 2u32.pow(32 - self.prefix_len as u32) - 2; // -2 for network and broadcast

        for _ in 0..max_hosts {
            let octets = self.base.octets();
            let base_u32 = u32::from_be_bytes(octets);
            let ip_u32 = base_u32 + self.next_offset;
            let ip = std::net::Ipv4Addr::from(ip_u32);

            self.next_offset = (self.next_offset + 1) % max_hosts;
            if self.next_offset == 0 {
                self.next_offset = 10;
            }

            if !self.allocated.contains(&ip) {
                self.allocated.insert(ip);
                return Ok(ip);
            }
        }

        Err(SandboxError::IpPoolExhausted)
    }

    fn release(&mut self, ip: std::net::Ipv4Addr) {
        self.allocated.remove(&ip);
    }
}

// =============================================================================
// LXC Sandbox Entry
// =============================================================================

/// Represents an active LXC sandbox
#[derive(Clone, Debug)]
struct LxcSandboxEntry {
    id: Uuid,
    index: usize,
    vmid: u32,
    name: String,
    ip: std::net::Ipv4Addr,
    created_at: DateTime<Utc>,
    status: SandboxStatus,
    correlation_id: Option<String>,
    #[allow(dead_code)]
    env: Vec<EnvVar>,
}

impl LxcSandboxEntry {
    fn to_summary(&self, config: &ResolvedPveConfig) -> SandboxSummary {
        SandboxSummary {
            id: self.id,
            index: self.index,
            name: self.name.clone(),
            created_at: self.created_at,
            workspace: "/root/workspace".to_string(), // PVE-LXC uses root user
            status: self.status.clone(),
            network: SandboxNetwork {
                host_interface: config.bridge.clone(),
                sandbox_interface: "eth0".to_string(),
                host_ip: config.gateway.clone(),
                sandbox_ip: self.ip.to_string(),
                cidr: 24, // Assuming /24 for now
            },
            display: None, // PVE LXC uses external VNC via Cloudflare Tunnel
            correlation_id: self.correlation_id.clone(),
        }
    }
}

// =============================================================================
// PVE LXC Sandbox Service
// =============================================================================

/// Sandbox service implementation using Proxmox VE LXC containers
pub struct PveLxcService {
    client: PveClient,
    sandboxes: Mutex<HashMap<Uuid, LxcSandboxEntry>>,
    vmid_to_uuid: Mutex<HashMap<u32, Uuid>>,
    ip_pool: Mutex<LxcIpPool>,
    next_index: AtomicUsize,
    next_vmid: Mutex<u32>,
}

impl PveLxcService {
    /// Create a new PVE LXC sandbox service
    pub async fn new(config: PveConfig) -> SandboxResult<Self> {
        // Create client with auto-detection
        let client = PveClient::new(config.clone()).await?;
        let resolved = client.resolved_config();

        // Find the highest VMID in use to avoid conflicts
        let containers = client.list_lxc().await.unwrap_or_default();
        let mut ip_pool = LxcIpPool::new(&resolved.ip_pool_cidr)?;
        for container in &containers {
            if let Ok(config) = client.get_lxc_config(container.vmid).await {
                if let Some(net0) = config.net0.as_deref() {
                    if let Some(ip) = extract_ip_from_net_config(net0) {
                        ip_pool.reserve(ip);
                    }
                }
            }
        }
        let max_vmid = containers.iter().map(|c| c.vmid).max().unwrap_or(100);

        // Start VMIDs at max + 1000 to leave room for manual containers
        let start_vmid = ((max_vmid / 1000) + 1) * 1000 + 1000;

        info!(
            "PVE LXC service initialized with node={}, starting VMID={}",
            resolved.node, start_vmid
        );

        Ok(Self {
            client,
            sandboxes: Mutex::new(HashMap::new()),
            vmid_to_uuid: Mutex::new(HashMap::new()),
            ip_pool: Mutex::new(ip_pool),
            next_index: AtomicUsize::new(0),
            next_vmid: Mutex::new(start_vmid),
        })
    }

    /// Get the resolved configuration
    fn config(&self) -> &ResolvedPveConfig {
        self.client.resolved_config()
    }

    /// Allocate the next VMID
    async fn allocate_vmid(&self) -> u32 {
        let mut vmid = self.next_vmid.lock().await;
        let allocated = *vmid;
        *vmid += 1;
        allocated
    }

    /// Build the network configuration string for LXC
    #[allow(dead_code)]
    fn build_net_config(&self, ip: std::net::Ipv4Addr) -> String {
        let config = self.config();
        format!(
            "name=eth0,bridge={},ip={}/24,gw={}",
            config.bridge, ip, config.gateway
        )
    }
}

#[async_trait]
impl SandboxService for PveLxcService {
    async fn create(&self, request: CreateSandboxRequest) -> SandboxResult<SandboxSummary> {
        let id = Uuid::new_v4();
        let index = self.next_index.fetch_add(1, Ordering::SeqCst);
        let vmid = self.allocate_vmid().await;
        let name = request
            .name
            .unwrap_or_else(|| format!("cmux-sandbox-{}", &id.to_string()[..8]));

        // Allocate IP address
        let ip = {
            let mut pool = self.ip_pool.lock().await;
            pool.allocate()?
        };

        info!(
            "Creating PVE LXC sandbox: id={}, vmid={}, name={}, ip={}",
            id, vmid, name, ip
        );

        let config = self.config();

        // Create or clone the container
        if let Some(template_vmid) = config.template_vmid {
            // Clone from template
            let clone_request = CloneLxcRequest {
                newid: vmid,
                hostname: name.clone(),
                full: 1,
                storage: Some(config.storage.clone()),
            };
            self.client.clone_lxc(template_vmid, clone_request).await?;
        } else {
            // Create from scratch (requires ostemplate)
            return Err(SandboxError::InvalidRequest(
                "PVE_TEMPLATE_VMID is required for creating containers".to_string(),
            ));
        }

        // Start the container
        self.client.start_lxc(vmid).await?;

        let entry = LxcSandboxEntry {
            id,
            index,
            vmid,
            name: name.clone(),
            ip,
            created_at: Utc::now(),
            status: SandboxStatus::Running,
            correlation_id: request.tab_id,
            env: request.env,
        };

        let summary = entry.to_summary(config);

        // Store the sandbox entry
        {
            let mut sandboxes = self.sandboxes.lock().await;
            let mut vmid_map = self.vmid_to_uuid.lock().await;
            sandboxes.insert(id, entry);
            vmid_map.insert(vmid, id);
        }

        info!(
            "PVE LXC sandbox created successfully: id={}, vmid={}",
            id, vmid
        );
        Ok(summary)
    }

    async fn list(&self) -> SandboxResult<Vec<SandboxSummary>> {
        let config = self.config();
        let sandboxes = self.sandboxes.lock().await;
        let summaries: Vec<SandboxSummary> = sandboxes
            .values()
            .map(|entry| entry.to_summary(config))
            .collect();
        Ok(summaries)
    }

    async fn get(&self, id: String) -> SandboxResult<Option<SandboxSummary>> {
        let uuid = Uuid::parse_str(&id)
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid UUID: {id}")))?;

        let config = self.config();
        let sandboxes = self.sandboxes.lock().await;
        Ok(sandboxes.get(&uuid).map(|entry| entry.to_summary(config)))
    }

    async fn exec(&self, id: String, exec: ExecRequest) -> SandboxResult<ExecResponse> {
        let uuid = Uuid::parse_str(&id)
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid UUID: {id}")))?;

        let sandboxes = self.sandboxes.lock().await;
        let entry = sandboxes.get(&uuid).ok_or(SandboxError::NotFound(uuid))?;

        // Execute command via HTTP exec daemon (cmux-execd) running in the container
        self.client
            .exec_lxc(entry.ip, &exec.command, exec.timeout_ms)
            .await
    }

    async fn attach(
        &self,
        _id: String,
        _socket: WebSocket,
        _initial_size: Option<(u16, u16)>,
        _command: Option<Vec<String>>,
        _tty: bool,
    ) -> SandboxResult<()> {
        // Attach to container terminal via PVE VNC/terminal proxy
        // This requires implementing the PVE terminal/VNC websocket protocol
        Err(SandboxError::Internal(
            "PVE LXC attach not yet implemented - requires PVE terminal proxy".to_string(),
        ))
    }

    async fn mux_attach(
        &self,
        _socket: WebSocket,
        _host_event_rx: HostEventReceiver,
        _gh_responses: GhResponseRegistry,
        _gh_auth_cache: GhAuthCache,
    ) -> SandboxResult<()> {
        // Multiplexed attach for multiple PTY sessions
        Err(SandboxError::Internal(
            "PVE LXC mux_attach not yet implemented".to_string(),
        ))
    }

    async fn proxy(&self, _id: String, _port: u16, _socket: WebSocket) -> SandboxResult<()> {
        // Proxy TCP connections to the container
        // This would connect to the container's IP:port and relay traffic
        Err(SandboxError::Internal(
            "PVE LXC proxy not yet implemented".to_string(),
        ))
    }

    async fn upload_archive(&self, id: String, archive: Body) -> SandboxResult<()> {
        let uuid = Uuid::parse_str(&id)
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid UUID: {id}")))?;

        let entry = {
            let sandboxes = self.sandboxes.lock().await;
            sandboxes.get(&uuid).cloned()
        }
        .ok_or(SandboxError::NotFound(uuid))?;

        // Stream the tar archive to cmux-execd's /files endpoint
        let files_url = format!("http://{}:39375/files", entry.ip);

        info!(
            "Uploading archive to PVE LXC container: id={}, vmid={}, url={}",
            uuid, entry.vmid, files_url
        );

        // Convert the axum Body stream to a reqwest Body
        let stream = archive.into_data_stream();
        let body_stream =
            stream.map(|result| result.map_err(|e| std::io::Error::other(e.to_string())));
        let reqwest_body = reqwest::Body::wrap_stream(body_stream);

        // Send the archive to the container's /files endpoint
        // Note: We can't retry with streaming body, so we do a single attempt
        // The cmux-execd service should be ready by the time we start uploading
        let response = self
            .client
            .client
            .post(&files_url)
            .body(reqwest_body)
            .timeout(std::time::Duration::from_secs(300))
            .send()
            .await
            .map_err(|e| {
                SandboxError::Internal(format!(
                    "Failed to upload archive to container {}: {}",
                    entry.ip, e
                ))
            })?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(SandboxError::Internal(format!(
                "Failed to upload archive: {} - {}",
                status, body
            )));
        }

        info!(
            "Archive uploaded successfully to container {}: id={}, vmid={}",
            entry.ip, uuid, entry.vmid
        );
        Ok(())
    }

    async fn delete(&self, id: String) -> SandboxResult<Option<SandboxSummary>> {
        let uuid = Uuid::parse_str(&id)
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid UUID: {id}")))?;

        let entry = {
            let mut sandboxes = self.sandboxes.lock().await;
            let mut vmid_map = self.vmid_to_uuid.lock().await;
            if let Some(entry) = sandboxes.remove(&uuid) {
                vmid_map.remove(&entry.vmid);
                Some(entry)
            } else {
                None
            }
        };

        if let Some(entry) = entry {
            info!("Deleting PVE LXC sandbox: id={}, vmid={}", uuid, entry.vmid);

            // Release IP address
            {
                let mut pool = self.ip_pool.lock().await;
                pool.release(entry.ip);
            }

            // Stop and delete the container
            if let Err(e) = self.client.stop_lxc(entry.vmid).await {
                warn!("Failed to stop container {}: {}", entry.vmid, e);
            }

            if let Err(e) = self.client.delete_lxc(entry.vmid).await {
                error!("Failed to delete container {}: {}", entry.vmid, e);
                return Err(e);
            }

            let summary = entry.to_summary(self.config());
            Ok(Some(summary))
        } else {
            Ok(None)
        }
    }

    async fn prune_orphaned(&self, request: PruneRequest) -> SandboxResult<PruneResponse> {
        // Prune orphaned containers not tracked in our state
        // For safety, we could compare PVE container list with our tracked containers
        Ok(PruneResponse {
            deleted_count: 0,
            failed_count: 0,
            items: vec![],
            dry_run: request.dry_run,
            bytes_freed: 0,
        })
    }

    async fn await_services_ready(
        &self,
        id: String,
        _request: AwaitReadyRequest,
    ) -> SandboxResult<AwaitReadyResponse> {
        // For PVE LXC, services are considered ready once the container is running
        // and accessible via Cloudflare Tunnel. We don't have internal readiness
        // tracking like bubblewrap does.
        let uuid = Uuid::parse_str(&id)
            .map_err(|_| SandboxError::InvalidRequest(format!("Invalid UUID: {id}")))?;

        let sandboxes = self.sandboxes.lock().await;
        if sandboxes.contains_key(&uuid) {
            // Container exists, assume services are ready
            // In the future, we could probe the actual services
            Ok(AwaitReadyResponse {
                ready: true,
                services: ServiceReadiness {
                    vnc: true,
                    vscode: true,
                    pty: true,
                },
                timed_out: vec![],
            })
        } else {
            Err(SandboxError::NotFound(uuid))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ip_pool_allocation() {
        let mut pool = LxcIpPool::new("10.100.0.0/24").unwrap();

        // First allocation should be .10
        let ip1 = pool.allocate().unwrap();
        assert_eq!(ip1, std::net::Ipv4Addr::new(10, 100, 0, 10));

        // Second should be .11
        let ip2 = pool.allocate().unwrap();
        assert_eq!(ip2, std::net::Ipv4Addr::new(10, 100, 0, 11));

        // Release first IP
        pool.release(ip1);

        // Next allocation cycles, but .10 is now available
        let _ip3 = pool.allocate().unwrap();
    }

    #[test]
    fn test_pve_config_from_env() {
        // Clear any pre-existing env vars to ensure clean test environment
        std::env::remove_var("PVE_NODE");
        std::env::remove_var("PVE_TEMPLATE_VMID");
        std::env::remove_var("PVE_STORAGE");
        std::env::remove_var("PVE_BRIDGE");
        std::env::remove_var("PVE_IP_POOL_CIDR");
        std::env::remove_var("PVE_GATEWAY");
        std::env::remove_var("PVE_VERIFY_TLS");

        // Test that config works with only 2 required env vars
        std::env::set_var("PVE_API_URL", "https://pve.test:8006");
        std::env::set_var(
            "PVE_API_TOKEN",
            "root@pam!mytoken=12345678-1234-1234-1234-1234567890ab",
        );

        let config = PveConfig::from_env().unwrap();
        assert_eq!(config.api_url, "https://pve.test:8006");
        assert_eq!(config.token_id, "root@pam!mytoken");
        assert_eq!(config.token_secret, "12345678-1234-1234-1234-1234567890ab");
        assert!(config.node.is_none()); // Auto-detect
        assert!(config.storage.is_none()); // Auto-detect
        assert_eq!(config.bridge, "vmbr0"); // Default
        assert_eq!(config.ip_pool_cidr, "10.100.0.0/24"); // Default
        assert!(!config.verify_tls); // Default false for self-signed

        // Clean up
        std::env::remove_var("PVE_API_URL");
        std::env::remove_var("PVE_API_TOKEN");
    }

    #[test]
    fn test_parse_api_token() {
        // Valid token
        let (id, secret) =
            parse_api_token("root@pam!mytoken=12345678-1234-1234-1234-1234567890ab").unwrap();
        assert_eq!(id, "root@pam!mytoken");
        assert_eq!(secret, "12345678-1234-1234-1234-1234567890ab");

        // Invalid - no equals sign
        assert!(parse_api_token("invalid-token").is_err());

        // Invalid - no @ in user
        assert!(parse_api_token("rootpam!token=secret").is_err());

        // Invalid - no ! in token ID
        assert!(parse_api_token("root@pamtoken=secret").is_err());
    }

    #[test]
    fn test_derive_gateway_from_cidr() {
        assert_eq!(derive_gateway_from_cidr("10.100.0.0/24"), "10.100.0.1");
        assert_eq!(derive_gateway_from_cidr("192.168.1.0/24"), "192.168.1.1");
        assert_eq!(derive_gateway_from_cidr("172.16.0.0/16"), "172.16.0.1");
        // Fallback for invalid CIDR
        assert_eq!(derive_gateway_from_cidr("invalid"), "10.100.0.1");
    }
}
