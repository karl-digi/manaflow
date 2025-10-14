use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
};

use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use portable_pty::PtySize;
use tokio::{sync::{broadcast, mpsc}, task::JoinHandle};
use uuid::Uuid;

use crate::pty::{Pty, PtyReader, PtyWriter};
use portable_pty::MasterPty;

#[derive(Clone)]
pub struct AppState {
    pub sessions: Arc<dashmap::DashMap<Uuid, Arc<Session>>>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self { sessions: Arc::new(dashmap::DashMap::new()) })
    }
}

pub struct Session {
    pub id: Uuid,
    writer: Arc<Mutex<PtyWriter>>, // sync write to pty
    reader_task: JoinHandle<()>,
    kill: Arc<dyn Fn() + Send + Sync>,
    master: Option<Arc<Mutex<Box<dyn MasterPty + Send>>>>, // for PTY resize
    tx: broadcast::Sender<Vec<u8>>, // output broadcast
}

#[derive(serde::Deserialize)]
struct ControlMsg {
    #[serde(rename = "type")]
    typ: String,
    cols: Option<u16>,
    rows: Option<u16>,
}

impl Session {
    pub fn spawn(cmd: Option<&str>, args: Vec<String>, cols: u16, rows: u16) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let backend = std::env::var("CMUX_BACKEND").unwrap_or_default();
        if backend == "pipe" {
            Self::spawn_pipe(cmd, args)
        } else {
            Self::spawn_pty(cmd, args, cols, rows)
        }
    }

    fn spawn_pty(cmd: Option<&str>, args: Vec<String>, cols: u16, rows: u16) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let id = Uuid::new_v4();
        let mut pty = Pty::open(cols, rows)?;
        let _child = pty.spawn_shell(cmd, args)?; // child dropped; dropping pty pair should close session

        // Extract master for IO and resizing
        let mut master = pty.pair.master;
        let reader: PtyReader = master.try_clone_reader()?;
        let writer: PtyWriter = master.take_writer()?;
        let (tx, _rx) = broadcast::channel::<Vec<u8>>(256);
        let tx_reader = tx.clone();
        let reader_task = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => { let _ = tx_reader.send(buf[..n].to_vec()); }
                    Err(_) => break,
                }
            }
        });

        let writer = Arc::new(Mutex::new(writer));
        let kill: Arc<dyn Fn() + Send + Sync> = Arc::new(|| {});
        let master = Arc::new(Mutex::new(master));
        let session = Arc::new(Session { id, writer, reader_task, kill, master: Some(master), tx });
        Ok((id, session))
    }

    fn spawn_pipe(cmd: Option<&str>, args: Vec<String>) -> anyhow::Result<(Uuid, Arc<Self>)> {
        let id = Uuid::new_v4();
        let command = cmd
            .map(|s| s.to_string())
            .unwrap_or_else(|| "/bin/cat".to_string());
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        let stdout = child.stdout.take().expect("stdout pipe");
        let stdin = child.stdin.take().expect("stdin pipe");

        // Convert to blocking std::io handles (already are std::process pipes)
        let reader: Box<dyn Read + Send> = Box::new(stdout);
        let writer: Box<dyn Write + Send> = Box::new(stdin);

        let (tx, _rx) = broadcast::channel::<Vec<u8>>(256);
        let tx_reader = tx.clone();
        // Keep child alive by moving into the reader task context
        let reader_task = tokio::task::spawn_blocking(move || {
            let mut reader = reader;
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => { let _ = tx_reader.send(buf[..n].to_vec()); }
                    Err(_) => break,
                }
            }
        });

        let child_arc = Arc::new(Mutex::new(Some(child)));
        let kill_child = child_arc.clone();
        let kill: Arc<dyn Fn() + Send + Sync> = Arc::new(move || {
            if let Some(mut c) = kill_child.lock().unwrap().take() {
                let _ = c.kill();
            }
        });

        let writer = Arc::new(Mutex::new(writer));
        let session = Arc::new(Session { id, writer, reader_task, kill, master: None, tx });
        Ok((id, session))
    }

    pub async fn terminate(&self) {
        (self.kill)();
        self.reader_task.abort();
    }

    pub async fn attach_socket(self: Arc<Self>, socket: WebSocket) {
        let mut rx = self.tx.subscribe();

        // Split socket for send/receive
        let (mut ws_tx, mut ws_rx) = socket.split();

        // Sender task: PTY -> WS
        let send_task = tokio::spawn(async move {
            while let Ok(data) = rx.recv().await {
                if ws_tx.send(Message::Text(String::from_utf8_lossy(&data).to_string())).await.is_err() {
                    break;
                }
            }
        });

        // Receiver loop: WS -> PTY
        while let Some(Ok(msg)) = ws_rx.next().await {
            match msg {
                Message::Text(text) => {
                    // Try parse control JSON first
                    if let Ok(ctrl) = serde_json::from_str::<ControlMsg>(&text) {
                        self.handle_control(ctrl).await;
                    } else {
                        let mut w = self.writer.lock().unwrap();
                        let _ = w.write_all(text.as_bytes());
                    }
                }
                Message::Binary(bin) => {
                    let mut w = self.writer.lock().unwrap();
                    let _ = w.write_all(&bin);
                }
                Message::Close(_) => break,
                Message::Ping(_) => {}
                Message::Pong(_) => {}
            }
        }

        let _ = send_task.abort();
    }

    async fn handle_control(&self, ctrl: ControlMsg) {
        match ctrl.typ.as_str() {
            "resize" => {
                if let (Some(cols), Some(rows)) = (ctrl.cols, ctrl.rows) {
                    let size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
                    if let Some(master) = &self.master {
                        // Try to resize via master pty if available
                        if let Ok(mut m) = master.lock() { let _ = m.resize(size); }
                    }
                }
            }
            _ => {}
        }
    }
}
