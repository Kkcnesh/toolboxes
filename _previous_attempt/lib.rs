use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub github_url: String,
    pub version: String,
    pub icon_color: String, // hex for the icon bg
    pub panel_type: String, // "file_in_text_out" | "url_in_file_out" | "file_in_files_out"
    pub exe_path: Option<String>,
    pub installed: bool,
    pub runs_offline: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RunRequest {
    pub tool_id: String,
    pub args: Vec<String>,
    pub input_file: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RunOutput {
    pub line: String,
    pub kind: String, // "stdout" | "stderr" | "done" | "error"
}

pub struct Db(pub Mutex<Connection>);

// ── Database setup ────────────────────────────────────────────────────────────

pub fn init_db(app: &AppHandle) -> anyhow::Result<Connection> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let db_path = data_dir.join("toolbox.db");
    let conn = Connection::open(db_path)?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS tools (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL,
            category    TEXT NOT NULL,
            github_url  TEXT NOT NULL,
            version     TEXT NOT NULL DEFAULT '0.0.0',
            icon_color  TEXT NOT NULL DEFAULT '#EAF3DE',
            panel_type  TEXT NOT NULL DEFAULT 'file_in_text_out',
            exe_path    TEXT,
            installed   INTEGER NOT NULL DEFAULT 0,
            runs_offline INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS build_jobs (
            id          TEXT PRIMARY KEY,
            tool_id     TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'queued',
            started_at  TEXT,
            finished_at TEXT,
            error_msg   TEXT
        );
    ")?;
    seed_marketplace(&conn)?;
    Ok(conn)
}

fn seed_marketplace(conn: &Connection) -> anyhow::Result<()> {
    let tools: Vec<(&str, &str, &str, &str, &str, &str, &str)> = vec![
        (
            "whisper",
            "Whisper",
            "Transcribe any audio or video to text — meetings, lectures, podcasts",
            "Audio",
            "https://github.com/openai/whisper",
            "#EAF3DE",
            "file_in_text_out",
        ),
        (
            "yt-dlp",
            "yt-dlp",
            "Download video and audio from YouTube, Twitter, Instagram and 1000+ sites",
            "Video",
            "https://github.com/yt-dlp/yt-dlp",
            "#E6F1FB",
            "url_in_file_out",
        ),
        (
            "demucs",
            "Demucs",
            "Separate any song into vocals, drums, bass, and other stems",
            "Audio",
            "https://github.com/facebookresearch/demucs",
            "#FAEEDA",
            "file_in_files_out",
        ),
    ];

    for (id, name, desc, cat, url, color, panel) in tools {
        conn.execute(
            "INSERT OR IGNORE INTO tools
             (id, name, description, category, github_url, icon_color, panel_type)
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![id, name, desc, cat, url, color, panel],
        )?;
    }
    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_tools(db: State<'_, Db>) -> Result<Vec<Tool>, String> {
    let conn = db.0.lock().await;
    let mut stmt = conn
        .prepare("SELECT id,name,description,category,github_url,version,icon_color,panel_type,exe_path,installed,runs_offline FROM tools ORDER BY installed DESC, name ASC")
        .map_err(|e| e.to_string())?;

    let tools = stmt
        .query_map([], |row| {
            Ok(Tool {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                category: row.get(3)?,
                github_url: row.get(4)?,
                version: row.get(5)?,
                icon_color: row.get(6)?,
                panel_type: row.get(7)?,
                exe_path: row.get(8)?,
                installed: row.get::<_, i32>(9)? == 1,
                runs_offline: row.get::<_, i32>(10)? == 1,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tools)
}

#[tauri::command]
pub async fn request_build(
    tool_id: String,
    github_url: String,
    db: State<'_, Db>,
    app: AppHandle,
) -> Result<String, String> {
    let job_id = Uuid::new_v4().to_string();
    {
        let conn = db.0.lock().await;
        conn.execute(
            "INSERT INTO build_jobs (id, tool_id, status) VALUES (?1, ?2, 'queued')",
            params![job_id, tool_id],
        )
        .map_err(|e| e.to_string())?;
    }

    // Fire off build request to cloud server (non-blocking)
    let job_id_clone = job_id.clone();
    let tool_id_clone = tool_id.clone();
    tokio::spawn(async move {
        poll_build_server(job_id_clone, tool_id_clone, github_url, app).await;
    });

    Ok(job_id)
}

async fn poll_build_server(job_id: String, tool_id: String, github_url: String, app: AppHandle) {
    let client = reqwest::Client::new();
    let api_base = std::env::var("TOOLBOX_API_URL")
        .unwrap_or_else(|_| "https://api.toolbox.app".to_string());

    // Submit build
    let res = client
        .post(format!("{}/builds", api_base))
        .json(&serde_json::json!({
            "github_url": github_url,
            "platform": "windows",
            "client_job_id": job_id,
        }))
        .send()
        .await;

    match res {
        Err(e) => {
            let _ = app.emit("build:error", serde_json::json!({
                "job_id": job_id,
                "error": e.to_string()
            }));
        }
        Ok(resp) => {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let server_job_id = body["job_id"].as_str().unwrap_or("").to_string();
                // Poll every 5s until done
                loop {
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                    let status_res = client
                        .get(format!("{}/builds/{}", api_base, server_job_id))
                        .send()
                        .await;

                    if let Ok(status_resp) = status_res {
                        if let Ok(status) = status_resp.json::<serde_json::Value>().await {
                            let s = status["status"].as_str().unwrap_or("");
                            let _ = app.emit("build:progress", serde_json::json!({
                                "job_id": job_id,
                                "status": s,
                                "step": status["current_step"],
                            }));

                            if s == "success" {
                                if let Some(dl_url) = status["download_url"].as_str() {
                                    download_and_install(
                                        dl_url.to_string(),
                                        tool_id.clone(),
                                        app.clone(),
                                    ).await;
                                }
                                break;
                            } else if s == "failed" {
                                let _ = app.emit("build:error", serde_json::json!({
                                    "job_id": job_id,
                                    "error": status["error_message"]
                                }));
                                break;
                            }
                        }
                    }
                }
            }
        }
    }
}

async fn download_and_install(download_url: String, tool_id: String, app: AppHandle) {
    let client = reqwest::Client::new();
    let data_dir = app.path().app_data_dir().unwrap();
    let tools_dir = data_dir.join("tools");
    std::fs::create_dir_all(&tools_dir).unwrap();
    let exe_path = tools_dir.join(format!("{}.exe", tool_id));

    let _ = app.emit("build:downloading", serde_json::json!({"tool_id": tool_id}));

    if let Ok(resp) = client.get(&download_url).send().await {
        if let Ok(bytes) = resp.bytes().await {
            if std::fs::write(&exe_path, bytes).is_ok() {
                let _ = app.emit("build:installed", serde_json::json!({
                    "tool_id": tool_id,
                    "exe_path": exe_path.to_str()
                }));
            }
        }
    }
}

#[tauri::command]
pub async fn run_tool(
    request: RunRequest,
    app: AppHandle,
    db: State<'_, Db>,
) -> Result<(), String> {
    // Look up exe path
    let exe_path: Option<String> = {
        let conn = db.0.lock().await;
        conn.query_row(
            "SELECT exe_path FROM tools WHERE id = ?1",
            params![request.tool_id],
            |row| row.get(0),
        )
        .ok()
        .flatten()
    };

    let exe = exe_path.ok_or("Tool not installed")?;
    let mut cmd = Command::new(&exe);
    cmd.args(&request.args);

    if let Some(input) = &request.input_file {
        cmd.arg(input);
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let tool_id = request.tool_id.clone();
    let app_clone = app.clone();

    // Stream stdout
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_clone.emit(
                "tool:output",
                serde_json::json!({
                    "tool_id": tool_id,
                    "line": line,
                    "kind": "stdout"
                }),
            );
        }
    });

    let tool_id2 = request.tool_id.clone();
    let app_clone2 = app.clone();

    // Stream stderr
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_clone2.emit(
                "tool:output",
                serde_json::json!({
                    "tool_id": tool_id2,
                    "line": line,
                    "kind": "stderr"
                }),
            );
        }
    });

    // Wait for completion
    let tool_id3 = request.tool_id.clone();
    tokio::spawn(async move {
        let status = child.wait().await;
        let kind = match status {
            Ok(s) if s.success() => "done",
            _ => "error",
        };
        let _ = app.emit(
            "tool:output",
            serde_json::json!({
                "tool_id": tool_id3,
                "line": "",
                "kind": kind
            }),
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn open_file_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let path = app
        .dialog()
        .file()
        .blocking_pick_file()
        .map(|p| p.to_string());
    Ok(path)
}

// ── App entry ─────────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let conn = init_db(app.handle()).expect("db init failed");
            app.manage(Db(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tools,
            request_build,
            run_tool,
            open_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error running toolbox");
}
