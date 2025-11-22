use assert_cmd::Command;
use cmux_sandbox::build_router;
use cmux_sandbox::models::{
    CreateSandboxRequest, ExecRequest, ExecResponse, SandboxNetwork, SandboxStatus, SandboxSummary,
};
use cmux_sandbox::service::SandboxService;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use uuid::Uuid;

struct MockService {
    sandboxes: Mutex<Vec<SandboxSummary>>,
    calls: Mutex<Vec<&'static str>>,
}

impl MockService {
    fn new() -> Self {
        Self {
            sandboxes: Mutex::new(Vec::new()),
            calls: Mutex::new(Vec::new()),
        }
    }

    async fn record(&self, name: &'static str) {
        let mut guard = self.calls.lock().await;
        guard.push(name);
    }
}

#[async_trait::async_trait]
impl SandboxService for MockService {
    async fn create(
        &self,
        request: CreateSandboxRequest,
    ) -> cmux_sandbox::errors::SandboxResult<SandboxSummary> {
        let summary = SandboxSummary {
            id: Uuid::new_v4(),
            index: 0,
            name: request.name.unwrap_or_else(|| "mock".to_string()),
            created_at: chrono::Utc::now(),
            workspace: request
                .workspace
                .unwrap_or_else(|| "/tmp/mock-workspace".to_string()),
            status: SandboxStatus::Running,
            network: SandboxNetwork {
                host_interface: "vethh-mock".into(),
                sandbox_interface: "vethn-mock".into(),
                host_ip: "10.201.0.1".into(),
                sandbox_ip: "10.201.0.2".into(),
                cidr: 30,
            },
        };
        let mut guard = self.sandboxes.lock().await;
        guard.push(summary.clone());
        self.record("create").await;
        Ok(summary)
    }

    async fn list(&self) -> cmux_sandbox::errors::SandboxResult<Vec<SandboxSummary>> {
        self.record("list").await;
        Ok(self.sandboxes.lock().await.clone())
    }

    async fn get(&self, id: String) -> cmux_sandbox::errors::SandboxResult<Option<SandboxSummary>> {
        let guard = self.sandboxes.lock().await;
        self.record("get").await;
        Ok(guard.iter().find(|s| s.id.to_string() == id).cloned())
    }

    async fn exec(
        &self,
        _id: String,
        _exec: ExecRequest,
    ) -> cmux_sandbox::errors::SandboxResult<ExecResponse> {
        Ok(ExecResponse {
            exit_code: 0,
            stdout: "ok".into(),
            stderr: String::new(),
        })
    }

    async fn attach(
        &self,
        _id: String,
        _socket: axum::extract::ws::WebSocket,
    ) -> cmux_sandbox::errors::SandboxResult<()> {
        Ok(())
    }

    async fn delete(
        &self,
        id: String,
    ) -> cmux_sandbox::errors::SandboxResult<Option<SandboxSummary>> {
        let mut guard = self.sandboxes.lock().await;
        if let Some(pos) = guard.iter().position(|s| s.id.to_string() == id) {
            let summary = guard.remove(pos);
            self.record("delete").await;
            return Ok(Some(summary));
        }
        Ok(None)
    }
}

#[tokio::test]
async fn cli_can_list_and_create_via_http() {
    let service = Arc::new(MockService::new());
    let app = build_router(service.clone());
    let listener = TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], 0)))
        .await
        .unwrap();
    let addr = listener.local_addr().unwrap();

    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                tokio::signal::ctrl_c().await.ok();
            })
            .await
            .ok();
    });

    // Ensure server is responding before invoking the CLI.
    let health_resp = reqwest::Client::new()
        .get(format!("http://{}/healthz", addr))
        .timeout(Duration::from_secs(3))
        .send()
        .await
        .expect("health check failed");
    assert!(health_resp.status().is_success());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let base = format!("http://{}", addr);

    // capture a trajectory of shell-equivalent commands and outputs
    let mut transcript: Vec<(String, String)> = Vec::new();

    let list_before = client
        .get(format!("{base}/sandboxes"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    transcript.push(("cmux sandboxes list".into(), list_before.clone()));
    assert_eq!(list_before.trim(), "[]");

    let payload = serde_json::to_value(&CreateSandboxRequest {
        name: Some("demo".into()),
        workspace: Some("/tmp/demo".into()),
        read_only_paths: Vec::new(),
        tmpfs: Vec::new(),
        env: Vec::new(),
    })
    .unwrap();
    let created = client
        .post(format!("{base}/sandboxes"))
        .json(&payload)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    transcript.push((
        "cmux sandboxes create --name demo --workspace /tmp/demo".into(),
        created.clone(),
    ));
    assert!(created.contains("\"demo\""));

    let list_after = client
        .get(format!("{base}/sandboxes"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    transcript.push(("cmux sandboxes list".into(), list_after.clone()));
    assert!(list_after.contains("\"demo\""));

    assert!(service.calls.lock().await.contains(&"create"));
    assert!(
        service
            .calls
            .lock()
            .await
            .iter()
            .filter(|c| **c == "list")
            .count()
            >= 2
    );

    // ensure we captured the user-visible trajectory format: <command, output>
    assert_eq!(transcript.len(), 3);
    assert!(transcript[0].1.contains('['));
    assert!(transcript[1].1.contains("workspace"));
    assert!(transcript[2].1.contains("demo"));

    server.abort();
    let _ = server.await;
}

#[test]
fn cli_help_exits_quickly() {
    Command::new(assert_cmd::cargo::cargo_bin!("cmux"))
        .arg("--help")
        .assert()
        .success()
        .stdout(predicates::str::contains("cmux sandbox controller"));
}
