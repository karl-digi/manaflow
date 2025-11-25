pub mod acp_client;
pub mod api;
pub mod bubblewrap;
pub mod errors;
pub mod ip_pool;
pub mod models;
pub mod service;

pub use acp_client::{run_chat_tui, run_demo_tui};
pub use api::build_router;
pub use bubblewrap::BubblewrapService;

pub const DEFAULT_HTTP_PORT: u16 = 46831;
pub const DEFAULT_WS_PORT: u16 = 46832;
