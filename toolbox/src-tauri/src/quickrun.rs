//! QuickRun daemon client (Phase 1).
//!
//! Talks to the QuickRun localhost daemon (default `127.0.0.1:9876`) over its
//! extension-style HTTP API. QuickRun authorizes a request when the `Origin`
//! header is *absent* (a local program) or belongs to a browser extension, so
//! this client simply never sends an `Origin` header.
//!
//! The flow is two-phase by design and nothing runs until `confirm` is called:
//!   prepare -> (supply inputs) -> confirm -> stream_events -> stop
//!
//! Wire shapes mirror QuickRun's `RunRegistry` / `Runner` JSON (camelCase,
//! string-enums). See:
//!   src/QuickRun.App/Daemon/DaemonHost.cs
//!   src/QuickRun.App/Daemon/RunRegistry.cs
//!   src/QuickRun.Core/Run/Runner.cs

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use tauri::Manager;

use serde::{Deserialize, Serialize};

pub const DEFAULT_PORT: u16 = 9876;

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/// Body of `POST /api/run` (QuickRun `RunRequest`).
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunRequest {
    pub repo: Option<String>,
    #[serde(rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    pub pr: Option<i32>,
    pub subdir: Option<String>,
    pub config: Option<String>,
    pub inputs: Option<HashMap<String, Option<String>>>,
}

/// One command in an execution plan.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedCommand {
    pub phase: String,
    pub name: String,
    pub command: String,
    pub cwd: Option<String>,
}

/// The form field a config declares (subset needed by the UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDef {
    pub id: String,
    pub label: Option<String>,
    #[serde(rename = "type")]
    pub input_type: String,
    pub description: Option<String>,
    pub default: Option<String>,
    pub required: bool,
    pub pattern: Option<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    #[serde(default)]
    pub options: Option<serde_json::Value>,
    pub env: Option<String>,
    pub persist: bool,
}

/// Status of one task of a run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTaskStatus {
    pub name: String,
    pub state: String,
    pub url: Option<String>,
    pub pid: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunPhase {
    Checkout,
    Setup,
    Tasks,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunProgress {
    pub phase: RunPhase,
    pub percent: i32,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunState {
    AwaitingInput,
    AwaitingConfirmation,
    Running,
    Stopping,
    Succeeded,
    Failed,
    Cancelled,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunEventKind {
    Info,
    Output,
    Error,
    TaskStarted,
    TaskReady,
    TaskExited,
    Progress,
    Failed,
    Finished,
    Cancelled,
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LogSeverity {
    Info,
    Warn,
    Error,
    Fatal,
    #[serde(other)]
    Unknown,
}

/// A `RunSummary` as returned by the daemon (camelCase JSON).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub repo: String,
    #[serde(rename = "ref", default)]
    pub reference: String,
    pub commit: Option<String>,
    pub display_name: String,
    pub state: RunState,
    #[serde(default)]
    pub commands: Vec<PlannedCommand>,
    #[serde(default)]
    pub fingerprint: String,
    pub progress: Option<RunProgress>,
    pub error: Option<String>,
    pub workspace: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub live_tasks: i64,
    pub description: Option<String>,
    pub inputs: Option<Vec<InputDef>>,
    pub values: Option<HashMap<String, Option<String>>>,
    pub tasks: Option<Vec<RunTaskStatus>>,
    #[serde(default)]
    pub leftovers: i64,
    #[serde(default)]
    pub origin: String,
    pub origin_detail: Option<String>,
    pub config_text: Option<String>,
    pub provisions: Option<Vec<String>>,
}

/// A single streamed run event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvent {
    pub kind: RunEventKind,
    pub task: Option<String>,
    pub text: String,
    pub progress: Option<RunProgress>,
    pub severity: Option<LogSeverity>,
}

/// Response of `GET /api/ping`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Ping {
    pub product: String,
    pub version: String,
    pub busy: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

pub type Result<T> = std::result::Result<T, String>;

fn base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// Extracts the `{ "error": "..." }` field from a non-2xx JSON body.
fn error_from_body(status: u16, body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(str::to_owned))
        .unwrap_or_else(|| format!("HTTP {status}: {body}"))
}

// ---------------------------------------------------------------------------
// Raw HTTP calls (no Tauri dependency, so they are unit/integration testable)
// ---------------------------------------------------------------------------

pub fn ping(port: u16) -> Result<Ping> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(format!("{}/api/ping", base_url(port)))
        .timeout(Duration::from_secs(5))
        .send()
        .map_err(|e| format!("could not reach QuickRun daemon: {e}"))?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(error_from_body(status.as_u16(), &body));
    }
    serde_json::from_str::<Ping>(&body).map_err(|e| format!("bad /api/ping response: {e}"))
}

/// `POST /api/run` — prepares a plan; nothing executes.
pub fn prepare(port: u16, req: &RunRequest) -> Result<RunSummary> {
    post_summary(port, "/api/run", req, None)
}

/// `POST /api/local` — prepares a plan for a folder on this machine.
pub fn local_prepare(port: u16, path: &str, copy: bool) -> Result<RunSummary> {
    let body = serde_json::json!({ "path": path, "copy": copy });
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{}/api/local", base_url(port)))
        .json(&body)
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(error_from_body(status.as_u16(), &text));
    }
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("bad /api/local response: {e}"))?;
    value
        .get("run")
        .and_then(|r| serde_json::from_value::<RunSummary>(r.clone()).ok())
        .ok_or_else(|| format!("no run summary in /api/local response: {text}"))
}

/// `POST /api/runs/{id}/inputs` — re-plan with the supplied values.
pub fn supply_inputs(port: u16, id: &str, inputs: &HashMap<String, String>) -> Result<RunSummary> {
    let body = serde_json::json!({ "inputs": inputs });
    post_summary(port, &format!("/api/runs/{id}/inputs"), &body, None)
}

/// `POST /api/runs/{id}/confirm` — starts the run.
pub fn confirm(port: u16, id: &str) -> Result<RunSummary> {
    post_summary(port, &format!("/api/runs/{id}/confirm"), &serde_json::json!({}), None)
}

/// `POST /api/runs/{id}/stop` — cancels a pending run, stops a running one.
pub fn stop(port: u16, id: &str) -> Result<()> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .post(format!("{}/api/runs/{id}/stop", base_url(port)))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(error_from_body(resp.status().as_u16(), &resp.text().unwrap_or_default()));
    }
    Ok(())
}

/// `GET /api/runs/{id}` — current state (used to resync after an SSE drop).
pub fn run_state(port: u16, id: &str) -> Result<RunSummary> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(format!("{}/api/runs/{id}", base_url(port)))
        .send()
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let body = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(error_from_body(status.as_u16(), &body));
    }
    serde_json::from_str::<RunSummary>(&body).map_err(|e| format!("bad run summary: {e}"))
}

/// Shared POST helper that expects a `RunSummary` body, or `{ error, run }`.
fn post_summary(
    port: u16,
    path: &str,
    body: &impl serde::Serialize,
    timeout: Option<Duration>,
) -> Result<RunSummary> {
    let client = reqwest::blocking::Client::new();
    let mut builder = client.post(format!("{}{}", base_url(port), path)).json(body);
    if let Some(t) = timeout {
        builder = builder.timeout(t);
    }
    let resp = builder.send().map_err(|e| e.to_string())?;
    let status = resp.status();
    let text = resp.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(error_from_body(status.as_u16(), &text));
    }
    serde_json::from_str::<RunSummary>(&text).map_err(|e| format!("bad run summary: {e}"))
}

/// `GET /api/runs/{id}/events` — blocks, invoking `on_event` per SSE `data:` frame.
///
/// The stream is long-lived; run this on a dedicated thread. On connection
/// loss the caller should re-`state()` and re-subscribe.
pub fn stream_events(port: u16, id: &str, mut on_event: impl FnMut(RunEvent)) -> Result<()> {
    let client = reqwest::blocking::Client::new();
    let resp = client
        .get(format!("{}/api/runs/{id}/events", base_url(port)))
        .send()
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(error_from_body(resp.status().as_u16(), &resp.text().unwrap_or_default()));
    }

    let reader = BufReader::new(resp);
    for line in reader.lines() {
        let line = line.map_err(|e| format!("sse read error: {e}"))?;
        let data = match line.strip_prefix("data: ") {
            Some(d) => d,
            None => continue, // ignores ": keepalive" comments and blank separators
        };
        if let Ok(event) = serde_json::from_str::<RunEvent>(data) {
            let terminal = matches!(
                event.kind,
                RunEventKind::Finished | RunEventKind::Failed | RunEventKind::Cancelled
            );
            on_event(event);
            if terminal {
                break; // the run ended; stop reading (closes the connection)
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Daemon lifecycle
// ---------------------------------------------------------------------------

/// Handle to a daemon GitRun started, so it can be stopped on exit — and only
/// then. A daemon GitRun did not start is never killed.
pub struct DaemonHandle {
    pub owned: bool,
    child: Option<Child>,
}

impl DaemonHandle {
    pub fn stop_if_owned(&mut self) {
        if !self.owned {
            return;
        }
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for DaemonHandle {
    fn drop(&mut self) {
        self.stop_if_owned();
    }
}

/// Finds an existing QuickRun daemon on `port`, or starts one from `bin`.
/// Returns `owned = false` when an existing daemon was detected.
pub fn ensure_daemon(bin: &str, port: u16) -> Result<DaemonHandle> {
    match ping(port) {
        Ok(p) if p.product == "QuickRun" => {
            return Ok(DaemonHandle { owned: false, child: None });
        }
        _ => {}
    }

    let child = Command::new(bin)
        .args(["daemon", "--port", &port.to_string(), "--no-update"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("could not start QuickRun ({bin}): {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match ping(port) {
            Ok(p) if p.product == "QuickRun" => {
                return Ok(DaemonHandle { owned: true, child: Some(child) });
            }
            _ if Instant::now() > deadline => {
                let mut child = child;
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("QuickRun daemon did not answer on port {port} within 15s"));
            }
            _ => thread::sleep(Duration::from_millis(250)),
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri command layer
// ---------------------------------------------------------------------------

use std::sync::Mutex;

/// Managed state: the daemon GitRun owns, if any. Kept so it can be stopped on
/// exit — and only a daemon GitRun started is ever stopped.
pub struct DaemonState(pub Mutex<Option<DaemonHandle>>);

impl Default for DaemonState {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

/// Cancellation for the automatic run loop: set by `quickrun_stop`, checked
/// before every confirm/repair so a stop cannot be followed by a new run.
pub struct AutorunState {
    pub cancel: Arc<AtomicBool>,
}

impl Default for AutorunState {
    fn default() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// Where the `quickrun` binary lives: `QUICKRUN_BIN`, else `quickrun` on PATH.
pub fn resolve_bin() -> String {
    std::env::var("QUICKRUN_BIN").unwrap_or_else(|_| "quickrun".to_owned())
}

/// Ensures a daemon is answering on `port`, starting one if necessary.
fn ensure(port: u16, state: &DaemonState) -> Result<()> {
    let mut guard = state.0.lock().map_err(|_| "daemon state busy")?;
    if guard.is_none() {
        *guard = Some(ensure_daemon(&resolve_bin(), port)?);
    }
    Ok(())
}

#[tauri::command]
pub fn quickrun_ping(port: Option<u16>) -> Result<Ping> {
    ping(port.unwrap_or(DEFAULT_PORT))
}

#[tauri::command]
pub fn quickrun_prepare(
    state: tauri::State<'_, DaemonState>,
    repo: String,
    port: Option<u16>,
) -> Result<RunSummary> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;
    prepare(
        port,
        &RunRequest {
            repo: Some(repo),
            ..Default::default()
        },
    )
}

#[tauri::command]
pub fn quickrun_local_prepare(
    state: tauri::State<'_, DaemonState>,
    path: String,
    copy: Option<bool>,
    port: Option<u16>,
) -> Result<RunSummary> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;
    local_prepare(port, &path, copy.unwrap_or(false))
}

#[tauri::command]
pub fn quickrun_confirm(
    state: tauri::State<'_, DaemonState>,
    id: String,
    port: Option<u16>,
) -> Result<RunSummary> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;
    confirm(port, &id)
}

#[tauri::command]
pub fn quickrun_supply_inputs(
    state: tauri::State<'_, DaemonState>,
    id: String,
    inputs: HashMap<String, String>,
    port: Option<u16>,
) -> Result<RunSummary> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;
    supply_inputs(port, &id, &inputs)
}

#[tauri::command]
pub fn quickrun_stop(
    app: tauri::AppHandle,
    state: tauri::State<'_, DaemonState>,
    id: String,
    port: Option<u16>,
) -> Result<()> {
    if let Some(autorun) = app.try_state::<AutorunState>() {
        autorun.cancel.store(true, Ordering::SeqCst);
    }
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;

    // Capture the task process ids before stopping. The daemon stops its own
    // tree, but npm-script children (run-p, live-server) can outlive it.
    let pids: Vec<i32> = run_state(port, &id)
        .ok()
        .and_then(|summary| summary.tasks)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|task| task.pid)
        .filter(|pid| *pid > 0)
        .collect();

    stop(port, &id)?;

    if !pids.is_empty() {
        thread::sleep(Duration::from_millis(800));
        for pid in pids {
            kill_tree(pid);
        }
    }

    Ok(())
}

/// Kills a process and all of its descendants (children first).
fn kill_tree(pid: i32) {
    if pid <= 1 {
        return;
    }

    if let Ok(output) = Command::new("pgrep").arg("-P").arg(pid.to_string()).output() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(child) = line.trim().parse::<i32>() {
                kill_tree(child);
            }
        }
    }

    let _ = Command::new("kill").arg("-9").arg(pid.to_string()).status();
}

#[tauri::command]
pub fn quickrun_state(
    state: tauri::State<'_, DaemonState>,
    id: String,
    port: Option<u16>,
) -> Result<RunSummary> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;
    run_state(port, &id)
}

/// Opens the run's event stream on a worker thread and forwards each event to
/// the frontend as a `quickrun:event` Tauri event.
#[tauri::command]
pub fn quickrun_stream_events(
    app: tauri::AppHandle,
    id: String,
    port: Option<u16>,
) -> Result<()> {
    use tauri::Emitter;
    let port = port.unwrap_or(DEFAULT_PORT);
    thread::spawn(move || {
        let _ = stream_events(port, &id, |event| {
            let _ = app.emit("quickrun:event", &event);
        });
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// AI config override + automatic run (Phase 3)
// ---------------------------------------------------------------------------

/// QuickRun's store root: `QUICKRUN_HOME`, else the macOS app-data directory.
pub fn quickrun_root() -> PathBuf {
    if let Ok(home) = std::env::var("QUICKRUN_HOME") {
        if !home.trim().is_empty() {
            return PathBuf::from(home);
        }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("QuickRun")
}

/// Mirrors QuickRun's `ConfigOverrides.IdFor`: the last two path segments plus
/// a six-hex SHA-256 prefix of the lowercased URL.
pub fn id_for(repo: &str) -> String {
    let mut trimmed = repo.trim().trim_end_matches('/').to_string();
    if trimmed.to_lowercase().ends_with(".git") {
        trimmed.truncate(trimmed.len() - 4);
    }

    let parts: Vec<&str> = trimmed
        .split(['/', '\\', ':'])
        .filter(|part| !part.is_empty())
        .collect();
    let last_two: Vec<&str> = parts.iter().rev().take(2).rev().cloned().collect();
    let joined: String = last_two.iter().map(|part| format!("{part}_")).collect();
    let sanitized: String = joined
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let readable: String = sanitized
        .trim_matches(|c| c == '_' || c == '-')
        .chars()
        .take(60)
        .collect();

    let mut hasher = Sha256::new();
    hasher.update(trimmed.to_lowercase().as_bytes());
    let digest = hasher.finalize();
    let hash: String = digest.iter().take(3).map(|byte| format!("{byte:02x}")).collect();

    if readable.is_empty() {
        hash
    } else {
        format!("{readable}-{hash}")
    }
}

pub fn override_path(repo: &str) -> PathBuf {
    quickrun_root()
        .join("configs")
        .join(id_for(repo))
        .join("__auto_quickrun.config.yml")
}

pub fn write_override(repo: &str, yaml: &str) -> Result<()> {
    let path = override_path(repo);
    let dir = path.parent().ok_or("bad override path")?;
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let _ = std::fs::write(dir.join("repo.txt"), repo);
    std::fs::write(&path, yaml).map_err(|e| e.to_string())
}

pub fn clear_override(repo: &str) {
    let path = override_path(repo);
    if path.exists() {
        let _ = std::fs::remove_file(path);
    }
}

/// Validates a YAML string with QuickRun's own validator (`quickrun validate`).
pub fn validate_config(bin: &str, yaml: &str) -> Result<()> {
    let path = std::env::temp_dir().join(format!("gitrun-quickrun-{}.yml", std::process::id()));
    std::fs::write(&path, yaml).map_err(|e| e.to_string())?;
    let result = Command::new(bin).arg("validate").arg(&path).output();
    let _ = std::fs::remove_file(&path);
    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            Err(text.trim().to_string())
        }
        Err(e) => Err(format!("could not run `{bin} validate`: {e}")),
    }
}

/// Puts an access token into an https repository URL so QuickRun's git clone
/// can authenticate. The token is never sent to the AI or TinyFish.
fn embed_token(repo: &str, token: &str) -> String {
    let trimmed = repo.trim();

    if let Some(rest) = trimmed.strip_prefix("https://") {
        if rest.contains('@') {
            return trimmed.to_string();
        }
        return format!("https://{token}@{rest}");
    }
    if let Some(rest) = trimmed.strip_prefix("http://") {
        if rest.contains('@') {
            return trimmed.to_string();
        }
        return format!("http://{token}@{rest}");
    }

    let shorthand = trimmed.trim_end_matches('/');
    if shorthand.split('/').filter(|part| !part.is_empty()).count() == 2 {
        return format!("https://{token}@github.com/{shorthand}");
    }

    trimmed.to_string()
}

fn redact_text(text: &str, token: Option<&str>) -> String {
    match token {
        Some(secret) if !secret.is_empty() => text.replace(secret, "***"),
        _ => text.to_string(),
    }
}

/// One click: read the repo, build/repair a config with AI, then run it.
/// Runs on a worker thread; progress arrives as `quickrun:status`,
/// `quickrun:summary` and `quickrun:event`.
#[tauri::command]
pub fn quickrun_autorun(
    app: tauri::AppHandle,
    state: tauri::State<'_, DaemonState>,
    repo: String,
    token: Option<String>,
    rebuild: Option<bool>,
    port: Option<u16>,
) -> Result<()> {
    let port = port.unwrap_or(DEFAULT_PORT);
    ensure(port, &state)?;

    if let Some(autorun) = app.try_state::<AutorunState>() {
        autorun.cancel.store(false, Ordering::SeqCst);
    }

    let rebuild = rebuild.unwrap_or(false);
    let app = app.clone();
    thread::spawn(move || {
        if let Err(error) = autorun(&app, &repo, token.as_deref(), rebuild, port) {
            emit_status(&app, "error", &error);
        }
    });

    Ok(())
}

fn autorun(
    app: &tauri::AppHandle,
    repo: &str,
    token: Option<&str>,
    rebuild: bool,
    port: u16,
) -> Result<()> {
    // Reuse the saved plan when there is one, unless a rebuild was asked for.
    let saved = if rebuild {
        None
    } else {
        crate::repos::find(app, repo).and_then(|entry| entry.yaml)
    };

    // The checkout URL is the only place the token appears; everything the user
    // sees, and everything sent to the AI/TinyFish, uses the clean `repo`.
    let checkout = match token {
        Some(secret) if !secret.is_empty() => embed_token(repo, secret),
        _ => repo.to_string(),
    };

    let mut summary;

    if let Some(yaml) = saved {
        emit_status(app, "analyzing", "Reusing the saved plan…");
        write_override(&checkout, &yaml)?;
        summary = prepare(
            port,
            &RunRequest {
                repo: Some(checkout.clone()),
                ..Default::default()
            },
        )?;
        emit_summary(app, &summary, token);
    } else {
        // Fresh: detect, then let the AI build the config.
        clear_override(&checkout);

        emit_status(app, "analyzing", "Reading the repository…");
        summary = prepare(
        port,
        &RunRequest {
            repo: Some(checkout.clone()),
            ..Default::default()
        },
    )?;
    emit_summary(app, &summary, token);

        let research = if let Ok(key) = crate::tinyfish::resolve_key(app) {
            emit_status(app, "researching", "TinyFish is researching the repository…");
            match crate::tinyfish::research_repo(&key, repo) {
                Ok(found) => {
                    emit_status(
                        app,
                        "analyzing",
                        &format!(
                            "TinyFish: {}",
                            if found.summary.is_empty() {
                                "found setup notes"
                            } else {
                                found.summary.as_str()
                            }
                        ),
                    );
                    Some(found)
                }
                Err(error) => {
                    emit_status(app, "analyzing", &format!("TinyFish unavailable ({error})"));
                    None
                }
            }
        } else {
            None
        };

    emit_brief(app, research.as_ref());

    if let Ok(provider) = crate::ai::resolve_provider(app) {
        let workspace = summary.workspace.clone().unwrap_or_default();
        let detected = summary.config_text.clone().unwrap_or_default();

        match crate::ai::generate(&provider, repo, &workspace, &detected, research.as_ref()) {
            Ok(proposal) if proposal.confidence >= 0.15 && !proposal.yaml.trim().is_empty() => {
                emit_status(app, "analyzing", &format!("AI: {}", proposal.diagnosis));
                match validate_config(&resolve_bin(), &proposal.yaml) {
                    Ok(()) => {
                        crate::ai::commit(&checkout, &proposal.yaml)?;
                        summary = prepare(
                            port,
                            &RunRequest {
                                repo: Some(checkout.clone()),
                                ..Default::default()
                            },
                        )?;
                        emit_summary(app, &summary, token);
                    }
                    Err(error) => emit_status(
                        app,
                        "analyzing",
                        &format!("AI config did not validate; using detection ({error})"),
                    ),
                }
            }
            Ok(proposal) => emit_status(
                app,
                "analyzing",
                &format!("AI declined: {}", proposal.diagnosis),
            ),
            Err(error) => emit_status(
                app,
                "analyzing",
                &format!("AI unavailable; using detection ({error})"),
            ),
        }
    } else {
        emit_status(
            app,
            "analyzing",
            "No OpenRouter or DeepSeek key set; using QuickRun detection.",
        );
    }
    }

    // Last resort: the engine found nothing, so build a plain Python recipe
    // from requirements.txt and a root .py entry, then retry.
    if summary.state == RunState::Failed
        && summary
            .error
            .as_deref()
            .map_or(false, |error| error.contains("nothing detectable"))
    {
        if let Some(workspace) = summary.workspace.clone() {
            if let Some(yaml) = python_fallback(&workspace, repo) {
                if validate_config(&resolve_bin(), &yaml).is_ok() {
                    crate::ai::commit(&checkout, &yaml)?;
                    if let Ok(next) = prepare(
                        port,
                        &RunRequest {
                            repo: Some(checkout.clone()),
                            ..Default::default()
                        },
                    ) {
                        if next.state != RunState::Failed {
                            summary = next;
                            emit_summary(app, &summary, token);
                            emit_status(app, "analyzing", "Using a plain Python recipe.");
                        }
                    }
                }
            }
        }
    }

    remember(app, repo, &summary);

    let mut repairs = 0;
    loop {
        if is_cancelled(app) {
            emit_status(app, "done", "Stopped.");
            return Ok(());
        }

        // If the plan needs values the user must type, pause here and let the
        // UI collect them; the run starts once the UI supplies and confirms.
        let mut started_by_user = false;
        if summary.state == RunState::AwaitingInput {
            emit_summary(app, &summary, token);
            emit_status(
                app,
                "review",
                "This project needs a few details — fill them in, then run it.",
            );

            let mut waited = 0u32;
            loop {
                if is_cancelled(app) {
                    emit_status(app, "done", "Stopped.");
                    return Ok(());
                }
                if waited >= 1_800 {
                    emit_status(app, "failed", "Timed out waiting for the details.");
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(500));
                waited += 1;

                match run_state(port, &summary.id) {
                    Ok(current) if current.state == RunState::Running => {
                        started_by_user = true;
                        break;
                    }
                    Ok(current)
                        if current.state == RunState::AwaitingInput
                            || current.state == RunState::AwaitingConfirmation =>
                    {
                        // still waiting for the form
                    }
                    Ok(_) => {
                        emit_status(app, "done", "Stopped.");
                        return Ok(());
                    }
                    Err(_) => { /* keep waiting briefly */ }
                }
            }
        }

        let started = if started_by_user {
            run_state(port, &summary.id)?
        } else {
            emit_status(app, "starting", "Starting the application…");
            confirm(port, &summary.id)?
        };
        emit_summary(app, &started, token);
        emit_status(app, "running", "Running…");

        let mut events: Vec<RunEvent> = Vec::new();
        let _ = stream_events(port, &started.id, |mut event| {
            event.text = redact_text(&event.text, token);
            emit_event(app, &event);
            events.push(event);
        });

        let final_state = run_state(port, &started.id).ok();
        let state = final_state
            .as_ref()
            .map(|summary| summary.state)
            .unwrap_or(RunState::Unknown);

        // The run is over: close the embedded app window, if one was opened.
        if let Some(url) = final_state
            .as_ref()
            .and_then(|summary| summary.url.as_deref())
        {
            crate::appwindow::close_app_window_for(app, url);
        }

        if state == RunState::Unknown {
            emit_status(app, "error", "Lost contact with QuickRun.");
            return Ok(());
        }

        if state != RunState::Failed {
            let message = match state {
                RunState::Succeeded => "Ready.",
                RunState::Cancelled => "Stopped.",
                _ => "Finished.",
            };
            emit_status(app, "done", message);
            return Ok(());
        }

        repairs += 1;
        if repairs > 2 {
            emit_status(app, "failed", "Automatic repair failed twice; stopping.");
            return Ok(());
        }
        if is_cancelled(app) {
            emit_status(app, "done", "Stopped.");
            return Ok(());
        }

        emit_status(
            app,
            "repairing",
            &format!("Run failed — AI is diagnosing and fixing ({repairs}/2)…"),
        );

        let provider = crate::ai::resolve_provider(app)
            .map_err(|e| format!("AI key unavailable to repair: {e}"))?;
        let failure = failure_text(&events);
        let recent = recent_text(&events, 40);
        let workspace = summary.workspace.clone().unwrap_or_default();
        let failed_config = summary.config_text.clone().unwrap_or_default();

        let fix_research = if let Ok(key) = crate::tinyfish::resolve_key(app) {
            emit_status(app, "researching", "TinyFish is searching for the fix…");
            crate::tinyfish::research_fix(&key, repo, &failure).ok()
        } else {
            None
        };

        let proposal = crate::ai::repair(
            &provider,
            repo,
            &workspace,
            &failed_config,
            &failure,
            &recent,
            fix_research.as_ref(),
        )
        .map_err(|e| format!("AI repair failed: {e}"))?;
        validate_config(&resolve_bin(), &proposal.yaml)
            .map_err(|e| format!("AI repair config did not validate: {e}"))?;
        crate::ai::commit(&checkout, &proposal.yaml)?;

        summary = prepare(
            port,
            &RunRequest {
                repo: Some(checkout.clone()),
                ..Default::default()
            },
        )?;
        emit_summary(app, &summary, token);
        remember(app, repo, &summary);
    }
}

fn remember(app: &tauri::AppHandle, repo: &str, summary: &RunSummary) {
    if let Some(yaml) = summary.config_text.clone() {
        if !yaml.trim().is_empty() {
            crate::repos::upsert(
                app,
                crate::repos::SavedRepo {
                    repo: repo.to_string(),
                    name: summary.display_name.clone(),
                    yaml: Some(yaml),
                    last_run: Some(crate::repos::now_millis()),
                },
            );
        }
    }
}

fn is_cancelled(app: &tauri::AppHandle) -> bool {
    app.try_state::<AutorunState>()
        .map(|state| state.cancel.load(Ordering::SeqCst))
        .unwrap_or(false)
}





/// Builds a plain Python recipe when QuickRun's detector found nothing:
/// a `requirements.txt` (or `pyproject.toml`) plus a root `.py` entry is
/// enough to try. Framework hints (gradio, streamlit, flask, ...) pick the
/// command and the port.
fn python_fallback(workspace: &str, repo: &str) -> Option<String> {
    let root = std::path::Path::new(workspace);
    let requirements = std::fs::read_to_string(root.join("requirements.txt")).ok();
    let pyproject = std::fs::read_to_string(root.join("pyproject.toml")).ok();
    if requirements.is_none() && pyproject.is_none() {
        return None;
    }

    let deps = format!(
        "{}\n{}",
        requirements.clone().unwrap_or_default(),
        pyproject.clone().unwrap_or_default()
    )
    .to_lowercase();

    let entry = std::fs::read_dir(root)
        .ok()?
        .filter_map(|item| item.ok())
        .filter(|item| item.file_type().map(|kind| kind.is_file()).unwrap_or(false))
        .map(|item| item.file_name().to_string_lossy().to_string())
        .filter(|name| name.ends_with(".py"))
        .filter(|name| !matches!(name.as_str(), "setup.py" | "conftest.py"))
        .filter(|name| !name.starts_with("test_"))
        .max_by_key(|name| python_entry_score(name))?;

    let mut hints = std::fs::read_to_string(root.join(&entry)).unwrap_or_default();
    for extra in ["config.py", "configs/config.py", "settings.py", "app/config.py"] {
        if let Ok(text) = std::fs::read_to_string(root.join(extra)) {
            hints.push('\n');
            hints.push_str(&text);
        }
    }

    let (command, port) = python_invocation(&deps, &entry, &hints);
    let display = repo_name(repo);

    let mut yaml = String::new();
    yaml.push_str("version: 1\n");
    yaml.push_str(&format!("name: \"{display}\"\n"));
    yaml.push_str("requires:\n");
    yaml.push_str("  - tool: python\n");
    yaml.push_str("    version: \">=3.10\"\n");
    yaml.push_str("    install: \"https://www.python.org/downloads/\"\n");
    yaml.push_str("setup:\n");
    yaml.push_str("  - run: \"python3 -m venv .venv\"\n");
    if requirements.is_some() {
        yaml.push_str("  - run: \".venv/bin/pip install -r requirements.txt\"\n");
    } else {
        yaml.push_str("  - run: \".venv/bin/pip install .\"\n");
    }
    yaml.push_str("tasks:\n");
    yaml.push_str("  - name: app\n");
    yaml.push_str(&format!("    run: \"{command}\"\n"));
    if let Some(port) = port {
        yaml.push_str("    open: true\n");
        yaml.push_str("    readyWhen:\n");
        yaml.push_str(&format!("      port: {port}\n"));
    }

    Some(yaml)
}

fn repo_name(repo: &str) -> String {
    repo.trim_end_matches('/')
        .split('/')
        .last()
        .unwrap_or("app")
        .trim_end_matches(".git")
        .to_string()
}

fn python_entry_score(name: &str) -> i32 {
    let lower = name.to_lowercase();
    let mut score = 0;
    for (needle, points) in [
        ("web", 40),
        ("app", 30),
        ("server", 30),
        ("main", 30),
        ("ui", 25),
        ("infer", 25),
        ("gradio", 25),
        ("streamlit", 25),
        ("launch", 20),
        ("run", 15),
    ] {
        if lower.contains(needle) {
            score += points;
        }
    }
    if lower == "main.py" {
        score += 50;
    }
    score
}

fn python_invocation(deps: &str, entry: &str, hints: &str) -> (String, Option<u16>) {
    if deps.contains("streamlit") {
        return (format!(".venv/bin/python -m streamlit run {entry}"), Some(8501));
    }
    if deps.contains("gradio") {
        return (
            format!(".venv/bin/python {entry}"),
            Some(port_hint(hints).unwrap_or(7860)),
        );
    }
    if deps.contains("flask") {
        return (
            format!(".venv/bin/python {entry}"),
            Some(port_hint(hints).unwrap_or(5000)),
        );
    }
    if deps.contains("django") {
        return (
            format!(".venv/bin/python {entry}"),
            Some(port_hint(hints).unwrap_or(8000)),
        );
    }
    if deps.contains("uvicorn") || deps.contains("fastapi") {
        return (
            format!(".venv/bin/python {entry}"),
            Some(port_hint(hints).unwrap_or(8000)),
        );
    }
    (format!(".venv/bin/python {entry}"), port_hint(hints))
}

fn port_hint(text: &str) -> Option<u16> {
    for line in text.lines() {
        let lower = line.to_lowercase();
        let mut start = 0;

        while let Some(found) = lower[start..].find("port") {
            let index = start + found;
            let boundary = index == 0 || !lower.as_bytes()[index - 1].is_ascii_alphanumeric();

            if boundary {
                let rest = line[index + 4..].trim_start();
                if rest.starts_with('=') || rest.starts_with(':') {
                    let digits: String = rest
                        .chars()
                        .skip_while(|c| !c.is_ascii_digit())
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    if let Ok(port) = digits.parse::<u16>() {
                        if (1024..=65535).contains(&port) {
                            return Some(port);
                        }
                    }
                }
            }

            start = index + 4;
        }
    }
    None
}

fn emit_status(app: &tauri::AppHandle, state: &str, message: &str) {
    use tauri::Emitter;
    let _ = app.emit(
        "quickrun:status",
        serde_json::json!({ "state": state, "message": message }),
    );
}

fn emit_summary(app: &tauri::AppHandle, summary: &RunSummary, token: Option<&str>) {
    use tauri::Emitter;
    let mut summary = summary.clone();
    summary.repo = redact_text(&summary.repo, token);
    let _ = app.emit("quickrun:summary", &summary);
}

#[tauri::command]
pub fn quickrun_runbook(app: tauri::AppHandle, repo: String) -> Result<crate::tinyfish::Runbook> {
    let key = crate::tinyfish::resolve_key(&app)?;
    crate::tinyfish::research_runbook(&key, &repo)
}

#[tauri::command]
pub fn quickrun_discover_tools(
    app: tauri::AppHandle,
    url: String,
) -> Result<Vec<crate::tinyfish::DiscoveredTool>> {
    let key = crate::tinyfish::resolve_key(&app)?;
    crate::tinyfish::discover_tools(&key, &url)
}

fn emit_brief(app: &tauri::AppHandle, research: Option<&crate::tinyfish::Research>) {
    use tauri::Emitter;
    if let Some(found) = research {
        let _ = app.emit(
            "quickrun:brief",
            serde_json::json!({ "summary": found.summary, "sources": found.sources }),
        );
    }
}

fn emit_event(app: &tauri::AppHandle, event: &RunEvent) {
    use tauri::Emitter;
    let _ = app.emit("quickrun:event", event);
}

fn failure_text(events: &[RunEvent]) -> String {
    let mut lines = Vec::new();
    for event in events.iter().rev().take(80).rev() {
        if event.kind == RunEventKind::Failed
            || matches!(
                event.severity,
                Some(LogSeverity::Error) | Some(LogSeverity::Fatal)
            )
        {
            lines.push(format_line(event));
        }
    }
    if lines.is_empty() {
        for event in events.iter().rev().take(20).rev() {
            lines.push(format_line(event));
        }
    }
    lines.join("\n")
}

fn recent_text(events: &[RunEvent], count: usize) -> String {
    events
        .iter()
        .rev()
        .take(count)
        .rev()
        .map(format_line)
        .collect::<Vec<_>>()
        .join("\n")
}

fn format_line(event: &RunEvent) -> String {
    let prefix = event
        .task
        .as_deref()
        .map(|task| format!("[{task}] "))
        .unwrap_or_default();
    format!("{prefix}{}", event.text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embeds_a_token_into_the_checkout_url() {
        assert_eq!(
            embed_token("https://github.com/owner/repo", "abc123"),
            "https://abc123@github.com/owner/repo"
        );
        assert_eq!(
            embed_token("owner/repo", "abc123"),
            "https://abc123@github.com/owner/repo"
        );
        assert_eq!(
            embed_token("https://abc123@github.com/owner/repo", "abc123"),
            "https://abc123@github.com/owner/repo"
        );
    }

    #[test]
    fn finds_a_port_hint() {
        assert_eq!(port_hint("server_port = 7865"), Some(7865));
        assert_eq!(port_hint("webui_port: 7865"), Some(7865));
        assert_eq!(port_hint("import os\nsupport = 1"), None);
        assert!(python_entry_score("infer-web.py") > python_entry_score("utils.py"));
    }

    #[test]
    #[ignore]
    fn reqwest_reaches_the_internet() {
        let client = reqwest::blocking::Client::new();
        match client
            .get("https://agent.tinyfish.ai")
            .timeout(Duration::from_secs(20))
            .send()
        {
            Ok(response) => println!("HTTP {}", response.status()),
            Err(error) => println!("HTTP ERROR: {error:?}"),
        }
    }

    #[test]
    #[ignore]
    fn tinyfish_then_jspaint() {
        let repo = std::env::var("GITRUN_TEST_REPO")
            .unwrap_or_else(|_| "https://github.com/1j01/jspaint".to_string());

        let key = match std::env::var("TINYFISH_API_KEY") {
            Ok(key) if !key.trim().is_empty() => key,
            _ => {
                println!("NO TINYFISH KEY (set TINYFISH_API_KEY)");
                return;
            }
        };

        let research = match crate::tinyfish::research_repo(&key, &repo) {
            Ok(found) => {
                println!("TINYFISH summary: {}", found.summary);
                println!("TINYFISH sources: {:?}", found.sources);
                Some(found)
            }
            Err(error) => {
                println!("TINYFISH failed: {error}");
                None
            }
        };

        let prepared = match prepare(
            9876,
            &RunRequest {
                repo: Some(repo.clone()),
                ..Default::default()
            },
        ) {
            Ok(summary) => summary,
            Err(error) => {
                println!("PREPARE failed: {error}");
                return;
            }
        };
        println!(
            "PREPARE state={:?} error={:?} workspace={:?}",
            prepared.state, prepared.error, prepared.workspace
        );

        let provider = if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            if key.trim().is_empty() {
                println!("NO AI KEY");
                return;
            }
            crate::ai::Provider {
                key,
                base: "https://openrouter.ai/api/v1".to_string(),
                model: "deepseek/deepseek-chat".to_string(),
                openrouter: true,
            }
        } else if let Ok(key) = std::env::var("DEEPSEEK_API_KEY") {
            crate::ai::Provider {
                key,
                base: "https://api.deepseek.com".to_string(),
                model: "deepseek-chat".to_string(),
                openrouter: false,
            }
        } else {
            println!("NO AI KEY");
            return;
        };

        let workspace = prepared.workspace.clone().unwrap_or_default();
        let detected = prepared.config_text.clone().unwrap_or_default();

        match crate::ai::generate(&provider, &repo, &workspace, &detected, research.as_ref()) {
            Ok(proposal) => {
                println!("AI confidence={} diagnosis={}", proposal.confidence, proposal.diagnosis);
                println!("AI yaml:\n{}", proposal.yaml);

                if proposal.confidence >= 0.15 && !proposal.yaml.trim().is_empty() {
                    match validate_config(&resolve_bin(), &proposal.yaml) {
                        Ok(()) => {
                            let _ = crate::ai::commit(&repo, &proposal.yaml);
                            match prepare(
                                9876,
                                &RunRequest {
                                    repo: Some(repo.clone()),
                                    ..Default::default()
                                },
                            ) {
                                Ok(next) => {
                                    println!(
                                        "RE-PREPARE state={:?} error={:?}",
                                        next.state, next.error
                                    );
                                    if next.state != RunState::Failed {
                                        match confirm(9876, &next.id) {
                                            Ok(started) => {
                                                println!(
                                                    "STARTED state={:?} url={:?}",
                                                    started.state, started.url
                                                );
                                                for step in 0..30 {
                                                    thread::sleep(Duration::from_secs(2));
                                                    if let Ok(current) = run_state(9876, &started.id) {
                                                        println!(
                                                            "T+{}s state={:?} url={:?} progress={:?}",
                                                            (step + 1) * 2,
                                                            current.state,
                                                            current.url,
                                                            current.progress.as_ref().map(|p| p.percent)
                                                        );
                                                        if current.state == RunState::Running
                                                            && current.url.is_some()
                                                        {
                                                            break;
                                                        }
                                                        if matches!(
                                                            current.state,
                                                            RunState::Failed | RunState::Cancelled
                                                        ) {
                                                            println!(
                                                                "ERROR: {:?}",
                                                                current.error
                                                            );
                                                            break;
                                                        }
                                                    }
                                                }
                                                let _ = stop(9876, &started.id);
                                            }
                                            Err(error) => println!("CONFIRM failed: {error}"),
                                        }
                                    }
                                }
                                Err(error) => println!("RE-PREPARE failed: {error}"),
                            }
                        }
                        Err(error) => println!("VALIDATE failed: {error}"),
                    }
                }
            }
            Err(error) => println!("AI failed: {error}"),
        }
    }

    #[test]
    fn kill_tree_stops_a_child() {
        let mut child = Command::new("sleep").arg("60").spawn().expect("spawn sleep");
        let pid = child.id() as i32;

        kill_tree(pid);
        thread::sleep(Duration::from_millis(300));

        assert!(
            child.try_wait().expect("wait").is_some(),
            "child should be gone"
        );
    }

    #[test]
    fn python_fallback_builds_a_recipe_for_an_rvc_shaped_repo() {
        let dir = std::env::temp_dir().join(format!("gitrun-py-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("requirements.txt"), "gradio\ntorch\nfaiss-cpu\n").unwrap();
        std::fs::write(dir.join("infer-web.py"), "server_port = 7865\nprint('hi')\n").unwrap();
        std::fs::write(dir.join("utils.py"), "x = 1\n").unwrap();

        let yaml = python_fallback(
            dir.to_str().unwrap(),
            "https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI",
        )
        .expect("a python recipe");

        assert!(yaml.contains("infer-web.py"), "{yaml}");
        assert!(yaml.contains("port: 7865"), "{yaml}");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn redacts_the_token_from_text() {
        assert_eq!(
            redact_text("failed https://abc123@github.com/o/r", Some("abc123")),
            "failed https://***@github.com/o/r"
        );
        assert_eq!(redact_text("plain text", None), "plain text");
    }

    /// Live integration test: requires a QuickRun daemon on `127.0.0.1:9876`
    /// and the fixture at `/tmp/gr-phase1/hello-server`. Run explicitly with:
    ///   cargo test --lib quickrun -- --ignored --nocapture
    #[test]
    #[ignore]
    fn full_local_workflow() {
        let port = 9876;
        let p = ping(port).expect("daemon must be running");
        assert_eq!(p.product, "QuickRun");

        // 1. prepare a local folder (nothing executes yet)
        let summary = local_prepare(port, "/tmp/gr-phase1/hello-server", false)
            .expect("prepare should succeed");
        eprintln!("state after prepare: {:?}", summary.state);
        assert!(matches!(summary.state, RunState::AwaitingConfirmation));
        assert!(!summary.commands.is_empty(), "plan must list commands");

        // 2. confirm -> execute
        let started = confirm(port, &summary.id).expect("confirm should succeed");
        eprintln!("state after confirm: {:?}", started.state);

        // 3. stream events until ready / failed / finished
        let deadline = Instant::now() + Duration::from_secs(60);
        let mut saw_open = false;
        loop {
            if Instant::now() > deadline {
                break;
            }
            if let Ok(s) = run_state(port, &summary.id) {
                if s.url.is_some() {
                    saw_open = true;
                    break; // ready: a long-running server never reaches a terminal state
                }
                match s.state {
                    RunState::Succeeded | RunState::Failed | RunState::Cancelled => break,
                    _ => {}
                }
            }
            thread::sleep(Duration::from_millis(300));
        }
        assert!(saw_open, "a URL should have been reported when ready");

        // 4. stop
        stop(port, &summary.id).expect("stop should succeed");
    }

    /// Live integration test: proves the override seam the AI writes through.
    /// Requires a QuickRun daemon and the fixture at `/tmp/gr-phase1/pnpm-demo`.
    #[test]
    #[ignore]
    fn override_seam_is_picked_up() {
        let port = 9876;
        let repo = "/tmp/gr-phase1/pnpm-demo";
        let yaml = "version: 1\nname: override test\ntasks:\n  - name: x\n    run: echo hi\n";

        write_override(repo, yaml).expect("write override");
        let summary = local_prepare(port, repo, false).expect("prepare should succeed");
        clear_override(repo);

        assert_eq!(summary.origin, "local", "override must win over detection");
        assert!(
            summary.config_text.as_deref().unwrap_or("").contains("override test"),
            "the override's config text must be the one used"
        );
    }
}
