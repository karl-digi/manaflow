use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::PathBuf;

use clap::Parser;
use tracing::info;

#[derive(Parser, Debug, Clone)]
#[command(author, version, about = "noVNC websocket proxy written in Rust")]
struct Args {
    /// Listen address(es). Accepts multiple entries or comma-separated values.
    #[arg(
        long,
        env = "CMUX_NOVNC_LISTEN",
        value_delimiter = ',',
        num_args = 1..,
        default_value = "0.0.0.0:39380"
    )]
    listen: Vec<SocketAddr>,

    /// Host to connect for the VNC backend.
    #[arg(long, env = "CMUX_NOVNC_TARGET_HOST", default_value = "127.0.0.1")]
    target_host: String,

    /// Port to connect for the VNC backend.
    #[arg(long, env = "CMUX_NOVNC_TARGET_PORT", default_value_t = 5901)]
    target_port: u16,

    /// Directory containing the noVNC static assets.
    #[arg(long, env = "CMUX_NOVNC_WEB_ROOT", default_value = "/usr/share/novnc")]
    web_root: PathBuf,

    /// Disable serving static assets (websocket bridge only).
    #[arg(long, env = "CMUX_NOVNC_DISABLE_STATIC", default_value_t = false)]
    disable_static: bool,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "cmux_novnc_proxy=info,hyper=warn".into()),
        )
        .compact()
        .init();

    let listens = dedupe_listens(args.listen);

    let web_root = if args.disable_static {
        info!("Static file serving disabled");
        None
    } else {
        Some(args.web_root)
    };

    if listens.is_empty() {
        eprintln!("no listen addresses configured");
        std::process::exit(2);
    }

    if listens.len() == 1 {
        let shutdown = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        let mut cfg = cmux_novnc_proxy::ProxyConfig::new(
            listens[0],
            args.target_host.clone(),
            args.target_port,
        );
        cfg.web_root = web_root.clone();
        match cmux_novnc_proxy::spawn_proxy(cfg, shutdown) {
            Ok((_bound, handle)) => {
                if let Err(err) = handle.await {
                    eprintln!("server task failed: {err}");
                    std::process::exit(1);
                }
            }
            Err(err) => {
                eprintln!("failed to start proxy: {err}");
                std::process::exit(1);
            }
        }
    } else {
        let shutdown = async {
            let _ = tokio::signal::ctrl_c().await;
        };
        match cmux_novnc_proxy::spawn_proxy_multi(
            listens,
            args.target_host.clone(),
            args.target_port,
            web_root,
            shutdown,
        ) {
            Ok((_bound, handle)) => {
                if let Err(err) = handle.await {
                    eprintln!("proxy task group failed: {err}");
                    std::process::exit(1);
                }
            }
            Err(err) => {
                eprintln!("failed to start proxy: {err}");
                std::process::exit(1);
            }
        }
    }
}

fn dedupe_listens(mut listens: Vec<SocketAddr>) -> Vec<SocketAddr> {
    listens.sort_by(|a, b| {
        a.port()
            .cmp(&b.port())
            .then(a.ip().to_string().cmp(&b.ip().to_string()))
    });
    listens.dedup();

    let mut result = Vec::new();
    for addr in listens.into_iter() {
        match addr.ip() {
            IpAddr::V4(ip) if ip == Ipv4Addr::UNSPECIFIED => {
                result.retain(|existing: &SocketAddr| {
                    !(matches!(existing.ip(), IpAddr::V4(_)) && existing.port() == addr.port())
                });
                result.push(addr);
            }
            _ => {
                if !result.iter().any(|existing: &SocketAddr| {
                    existing.port() == addr.port()
                        && matches!(existing.ip(), IpAddr::V4(ip) if ip == Ipv4Addr::UNSPECIFIED)
                }) {
                    result.push(addr);
                }
            }
        }
    }
    result
}
