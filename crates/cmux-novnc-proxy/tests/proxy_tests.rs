use std::net::SocketAddr;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use cmux_novnc_proxy::{spawn_proxy, ProxyConfig};
use futures_util::{SinkExt, StreamExt};
use tempfile::tempdir;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio_tungstenite::tungstenite::Message;

async fn start_echo_server() -> (SocketAddr, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let handle = tokio::spawn(async move {
        if let Ok((mut stream, _)) = listener.accept().await {
            let mut buf = [0u8; 4096];
            loop {
                let n = match stream.read(&mut buf).await {
                    Ok(n) => n,
                    Err(_) => break,
                };
                if n == 0 {
                    break;
                }
                if stream.write_all(&buf[..n]).await.is_err() {
                    break;
                }
            }
        }
    });
    (addr, handle)
}

async fn start_proxy(
    target_addr: SocketAddr,
    web_root: Option<std::path::PathBuf>,
) -> (SocketAddr, oneshot::Sender<()>, tokio::task::JoinHandle<()>) {
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let mut cfg = ProxyConfig::new(
        SocketAddr::from(([127, 0, 0, 1], 0)),
        target_addr.ip().to_string(),
        target_addr.port(),
    );
    cfg.web_root = web_root;
    let (bound, handle) = spawn_proxy(cfg, async move {
        let _ = shutdown_rx.await;
    })
    .expect("spawn proxy");
    (bound, shutdown_tx, handle)
}

#[tokio::test]
async fn forwards_binary_frames() {
    let (backend_addr, backend_handle) = start_echo_server().await;
    let (proxy_addr, shutdown_tx, proxy_handle) = start_proxy(backend_addr, None).await;

    let url = url::Url::parse(&format!("ws://{}/", proxy_addr)).unwrap();
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    ws.send(Message::Binary(b"hello".to_vec())).await.unwrap();
    let response = ws
        .next()
        .await
        .expect("message expected")
        .expect("valid frame");
    assert_eq!(response.into_data(), b"hello");
    ws.close(None).await.unwrap();

    shutdown_tx.send(()).ok();
    proxy_handle.await.expect("proxy join");
    backend_handle.abort();
}

#[tokio::test]
async fn forwards_base64_frames() {
    let (backend_addr, backend_handle) = start_echo_server().await;
    let (proxy_addr, shutdown_tx, proxy_handle) = start_proxy(backend_addr, None).await;

    let url = url::Url::parse(&format!("ws://{}/", proxy_addr)).unwrap();
    let (mut ws, _) = tokio_tungstenite::connect_async(url).await.unwrap();

    let payload = b"ping";
    let encoded = BASE64.encode(payload);
    ws.send(Message::Text(encoded)).await.unwrap();
    let response = ws
        .next()
        .await
        .expect("message expected")
        .expect("valid frame");
    match response {
        Message::Text(text) => {
            let decoded = BASE64.decode(text).unwrap();
            assert_eq!(decoded, payload);
        }
        other => panic!("unexpected message: {other:?}"),
    }
    ws.close(None).await.unwrap();

    shutdown_tx.send(()).ok();
    proxy_handle.await.expect("proxy join");
    backend_handle.abort();
}

#[tokio::test]
async fn serves_static_assets() {
    let tmp = tempdir().unwrap();
    let root = tmp.path();
    std::fs::write(root.join("vnc.html"), "<html><body>ok</body></html>").unwrap();
    std::fs::create_dir_all(root.join("sub")).unwrap();
    std::fs::write(root.join("sub").join("app.js"), "console.log('ok');").unwrap();

    let dummy_backend = SocketAddr::from(([127, 0, 0, 1], 5999));
    let (proxy_addr, shutdown_tx, proxy_handle) =
        start_proxy(dummy_backend, Some(root.to_path_buf())).await;

    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://{}/vnc.html", proxy_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), reqwest::StatusCode::OK);
    let text = resp.text().await.unwrap();
    assert!(text.contains("ok"));

    let js = client
        .get(format!("http://{}/sub/app.js", proxy_addr))
        .send()
        .await
        .unwrap();
    assert_eq!(js.status(), reqwest::StatusCode::OK);
    let js_body = js.text().await.unwrap();
    assert!(js_body.contains("console.log"));

    shutdown_tx.send(()).ok();
    proxy_handle.await.expect("proxy join");
}
