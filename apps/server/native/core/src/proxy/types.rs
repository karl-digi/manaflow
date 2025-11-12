use std::sync::Arc;
use tokio::sync::RwLock;
use std::collections::HashMap;

/// CMUX domain suffixes
pub const CMUX_DOMAINS: &[&str] = &[
    "cmux.app",
    "cmux.sh",
    "cmux.dev",
    "cmux.local",
    "cmux.localhost",
    "autobuild.app",
];

/// Route information extracted from URL
#[derive(Debug, Clone)]
pub struct ProxyRoute {
    pub morph_id: String,
    pub scope: String,
    pub domain_suffix: String,
}

/// Context for each WebContents session
#[derive(Debug, Clone)]
pub struct ProxyContext {
    pub username: String,
    pub password: String,
    pub route: Option<ProxyRoute>,
    pub web_contents_id: u32,
    pub persist_key: Option<String>,
}

/// Shared state for the proxy server
#[derive(Clone)]
pub struct ProxyState {
    pub contexts_by_username: Arc<RwLock<HashMap<String, ProxyContext>>>,
    pub contexts_by_web_contents_id: Arc<RwLock<HashMap<u32, ProxyContext>>>,
    pub logging_enabled: Arc<RwLock<bool>>,
}

impl Default for ProxyState {
    fn default() -> Self {
        Self::new()
    }
}

impl ProxyState {
    pub fn new() -> Self {
        Self {
            contexts_by_username: Arc::new(RwLock::new(HashMap::new())),
            contexts_by_web_contents_id: Arc::new(RwLock::new(HashMap::new())),
            logging_enabled: Arc::new(RwLock::new(false)),
        }
    }

    pub async fn add_context(&self, context: ProxyContext) {
        let mut by_username = self.contexts_by_username.write().await;
        let mut by_id = self.contexts_by_web_contents_id.write().await;
        by_username.insert(context.username.clone(), context.clone());
        by_id.insert(context.web_contents_id, context);
    }

    pub async fn remove_context(&self, web_contents_id: u32) -> Option<ProxyContext> {
        let mut by_id = self.contexts_by_web_contents_id.write().await;
        if let Some(context) = by_id.remove(&web_contents_id) {
            let mut by_username = self.contexts_by_username.write().await;
            by_username.remove(&context.username);
            Some(context)
        } else {
            None
        }
    }

    pub async fn get_context_by_username(&self, username: &str) -> Option<ProxyContext> {
        let by_username = self.contexts_by_username.read().await;
        by_username.get(username).cloned()
    }

    pub async fn get_context_by_web_contents_id(&self, id: u32) -> Option<ProxyContext> {
        let by_id = self.contexts_by_web_contents_id.read().await;
        by_id.get(&id).cloned()
    }

    pub async fn set_logging_enabled(&self, enabled: bool) {
        let mut logging = self.logging_enabled.write().await;
        *logging = enabled;
    }

    pub async fn is_logging_enabled(&self) -> bool {
        let logging = self.logging_enabled.read().await;
        *logging
    }
}
