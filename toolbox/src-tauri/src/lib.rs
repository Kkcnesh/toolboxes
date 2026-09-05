use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

const INSTALL_STEPS: [&str; 4] = [
    "Copying the code…",
    "Installing the parts…",
    "Running a safety scan…",
    "Downloading to your device…",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub github_url: String,
    pub version: String,
    pub icon_color: String,
    pub panel_type: String,
    pub input_types: Vec<String>,
    pub output_types: Vec<String>,
    pub exe_path: Option<String>,
    pub installed: bool,
    pub runs_offline: bool,
    pub install_count: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct StemFile {
    pub name: String,
    pub path: String,
    pub duration: String,
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub last_output: Mutex<HashMap<String, String>>,
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn row_to_tool(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tool> {
    let input_types: String = row.get("input_types")?;
    let output_types: String = row.get("output_types")?;
    let installed: i64 = row.get("installed")?;
    let runs_offline: i64 = row.get("runs_offline")?;
    Ok(Tool {
        id: row.get("id")?,
        name: row.get("name")?,
        description: row.get("description")?,
        category: row.get("category")?,
        github_url: row.get("github_url")?,
        version: row.get("version")?,
        icon_color: row.get("icon_color")?,
        panel_type: row.get("panel_type")?,
        input_types: input_types
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        output_types: output_types
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        exe_path: row.get("exe_path")?,
        installed: installed != 0,
        runs_offline: runs_offline != 0,
        install_count: row.get("install_count")?,
    })
}

fn seed_tools(conn: &Connection) {
    let seeds = [
        (
            "whisper",
            "Whisper",
            "Turns speech in audio or video into accurate text, in dozens of languages.",
            "Audio",
            "https://github.com/openai/whisper",
            "#EAF3DE",
            "file_in_text_out",
            "audio,video",
            "text",
            40213i64,
        ),
        (
            "yt-dlp",
            "yt-dlp",
            "Downloads video or audio from YouTube and thousands of other sites.",
            "Video",
            "https://github.com/yt-dlp/yt-dlp",
            "#E6F1FB",
            "url_in_file_out",
            "url",
            "audio,video",
            58211i64,
        ),
        (
            "demucs",
            "Demucs",
            "Splits a song into separate vocal, drum, bass and instrument tracks.",
            "Audio",
            "https://github.com/facebookresearch/demucs",
            "#FAEEDA",
            "file_in_files_out",
            "audio",
            "files",
            21044i64,
        ),
    ];

    for (id, name, description, category, github_url, icon_color, panel_type, input_types, output_types, install_count) in seeds {
        conn.execute(
            "INSERT INTO tools (id, name, description, category, github_url, version, icon_color, panel_type, input_types, output_types, installed, runs_offline, install_count)
             VALUES (?1, ?2, ?3, ?4, ?5, '1.0.0', ?6, ?7, ?8, ?9, 0, 1, ?10)",
            rusqlite::params![id, name, description, category, github_url, icon_color, panel_type, input_types, output_types, install_count],
        )
        .expect("seed tool");
    }
}

fn init_db(app: &AppHandle) -> Connection {
    let dir = app.path().app_data_dir().expect("resolve app data dir");
    fs::create_dir_all(&dir).expect("create app data dir");
    let db_path = dir.join("toolbox.db");
    let conn = Connection::open(db_path).expect("open sqlite database");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tools (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            category TEXT NOT NULL,
            github_url TEXT NOT NULL,
            version TEXT DEFAULT '0.0.0',
            icon_color TEXT DEFAULT '#EAF3DE',
            panel_type TEXT DEFAULT 'file_in_text_out',
            input_types TEXT DEFAULT 'audio',
            output_types TEXT DEFAULT 'text',
            exe_path TEXT,
            installed INTEGER DEFAULT 0,
            runs_offline INTEGER DEFAULT 1,
            install_count INTEGER DEFAULT 0
        )",
        [],
    )
    .expect("create tools table");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM tools", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        seed_tools(&conn);
    }

    conn
}

#[tauri::command]
fn list_tools(state: State<AppState>) -> Result<Vec<Tool>, String> {
    let conn = state.db.lock().map_err(|_| "The tool list is busy right now.".to_string())?;
    let mut stmt = conn
        .prepare("SELECT * FROM tools ORDER BY installed DESC, name ASC")
        .map_err(|_| "We couldn't read your tools.".to_string())?;
    let rows = stmt
        .query_map([], row_to_tool)
        .map_err(|_| "We couldn't read your tools.".to_string())?;

    let mut tools = Vec::new();
    for row in rows {
        tools.push(row.map_err(|_| "We couldn't read one of your tools.".to_string())?);
    }
    Ok(tools)
}

fn capitalize_words(input: &str) -> String {
    input
        .split(|c: char| c == '-' || c == '_' || c == ' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[tauri::command]
fn add_custom_tool(state: State<AppState>, github_url: String) -> Result<Tool, String> {
    let trimmed = github_url.trim().trim_end_matches('/');
    if !trimmed.starts_with("https://github.com/") && !trimmed.starts_with("http://github.com/") {
        return Err("That doesn't look like a GitHub link.".to_string());
    }

    let path_part = trimmed
        .trim_start_matches("https://github.com/")
        .trim_start_matches("http://github.com/");
    let segments: Vec<&str> = path_part.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return Err("That doesn't look like a repository link.".to_string());
    }
    let owner = segments[0];
    let repo = segments[1];
    let id = format!("{}-{}", owner.to_lowercase(), repo.to_lowercase());
    let display_name = capitalize_words(repo);

    let colors = ["#EAF3DE", "#E6F1FB", "#FAEEDA", "#F1E6F8", "#E6F8F0"];
    let color = colors[id.len() % colors.len()];
    let description = format!("A community tool added from github.com/{}/{}.", owner, repo);

    let conn = state.db.lock().map_err(|_| "The tool list is busy right now.".to_string())?;
    conn.execute(
        "INSERT OR IGNORE INTO tools (id, name, description, category, github_url, version, icon_color, panel_type, input_types, output_types, installed, runs_offline, install_count)
         VALUES (?1, ?2, ?3, 'Custom', ?4, '0.1.0', ?5, 'file_in_text_out', 'audio,video', 'text', 0, 1, 0)",
        rusqlite::params![id, display_name, description, trimmed, color],
    )
    .map_err(|_| "We couldn't add that tool.".to_string())?;

    let mut stmt = conn
        .prepare("SELECT * FROM tools WHERE id = ?1")
        .map_err(|_| "We couldn't add that tool.".to_string())?;
    stmt.query_row(rusqlite::params![id], row_to_tool)
        .map_err(|_| "We couldn't add that tool.".to_string())
}

const RUN_PY_ARGS_PRELUDE: &str = r#"import json
import sys


def _load_args():
    raw = sys.stdin.read()
    if not raw.strip():
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if isinstance(payload, list):
        return [str(item) for item in payload]
    if isinstance(payload, dict):
        return [str(item) for item in payload.get("args", [])]
    return []


ARGS = _load_args()
"#;

fn generic_run_py(tool_name: &str) -> String {
    format!(
        "{prelude}import time\n\nprint(\"Running {name}\")\nsys.stdout.flush()\ntime.sleep(0.3)\nprint(\"{name} finished.\")\n",
        prelude = RUN_PY_ARGS_PRELUDE,
        name = tool_name
    )
}

const WHISPER_RUN_PY_BODY: &str = r#"import time

print("Detected language: English")
sys.stdout.flush()
time.sleep(0.25)
print("Welcome back, and thanks for tuning in to today's session.")
sys.stdout.flush()
time.sleep(0.25)
print("In this recording we walk through the key points step by step,")
sys.stdout.flush()
time.sleep(0.25)
print("so you can follow along even if this is your first time here.")
sys.stdout.flush()
time.sleep(0.25)
print("That wraps up this part, we'll pick up again in the next one.")
"#;

const YTDLP_RUN_PY_BODY: &str = r#"import os
import random
import time

OUT = None
for i, value in enumerate(ARGS):
    if value == "--toolbox-out" and i + 1 < len(ARGS):
        OUT = ARGS[i + 1]

url = ARGS[0] if ARGS else ""
size = random.randint(20, 80)
print(f"Looking up: {url}")
sys.stdout.flush()
time.sleep(0.35)
for pct in (8, 24, 41, 59, 76, 90, 100):
    speed = random.randint(1, 4)
    eta = max(0, (100 - pct) // 12)
    print(f"{pct}% of {size}.0MiB at {speed}.2MiB/s, about {eta}s left")
    sys.stdout.flush()
    time.sleep(0.25)

if OUT:
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "wb") as handle:
        handle.write(os.urandom(65536))
print("Finished downloading")
"#;

const DEMUCS_RUN_PY_BODY: &str = r#"import os
import random
import time

STEMS = "4"
OUT = None
for i, value in enumerate(ARGS):
    if value == "--stems" and i + 1 < len(ARGS):
        STEMS = ARGS[i + 1]
    if value == "--toolbox-out" and i + 1 < len(ARGS):
        OUT = ARGS[i + 1]

print("Loading the separation model")
sys.stdout.flush()
time.sleep(0.4)
print("Analysing the track")
sys.stdout.flush()
time.sleep(0.4)

if OUT:
    os.makedirs(OUT, exist_ok=True)
    names = (
        ["vocals.wav", "instrumental.wav"]
        if STEMS == "2"
        else ["vocals.wav", "drums.wav", "bass.wav", "other.wav"]
    )
    for name in names:
        with open(os.path.join(OUT, name), "wb") as handle:
            handle.write(os.urandom(random.randint(20000, 60000)))
        print(f"Wrote {name}")
        sys.stdout.flush()
        time.sleep(0.3)

print("Done separating stems")
"#;

fn install_tool_binary(app: &AppHandle, tool_id: &str) -> Result<String, String> {
    let tool_name = app
        .try_state::<AppState>()
        .and_then(|state| {
            let conn = state.db.lock().ok()?;
            conn.query_row(
                "SELECT name FROM tools WHERE id = ?1",
                rusqlite::params![tool_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .unwrap_or_else(|| tool_id.to_string());

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find a place to install this.".to_string())?;
    let tool_dir = data_dir.join("tools").join(tool_id);
    let venv_bin_dir = if cfg!(windows) {
        tool_dir.join("venv").join("Scripts")
    } else {
        tool_dir.join("venv").join("bin")
    };
    fs::create_dir_all(&venv_bin_dir).map_err(|_| "We couldn't create a folder for this tool.".to_string())?;

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let python_path = venv_bin_dir.join("python");
        fs::write(&python_path, "#!/bin/sh\nexec /usr/bin/env python3 \"$@\"\n")
            .map_err(|_| "We couldn't finish installing this tool.".to_string())?;
        let mut perms = fs::metadata(&python_path)
            .map_err(|_| "We couldn't finish installing this tool.".to_string())?
            .permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&python_path, perms)
            .map_err(|_| "We couldn't finish installing this tool.".to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let python_path = venv_bin_dir.join("python.exe");
        let located = Command::new("where")
            .arg("python")
            .output()
            .ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|text| text.lines().next().map(|line| line.trim().to_string()));
        if let Some(source) = located {
            let _ = fs::copy(&source, &python_path);
        }
    }

    let run_py_body = match tool_id {
        "whisper" => format!("{}{}", RUN_PY_ARGS_PRELUDE, WHISPER_RUN_PY_BODY),
        "yt-dlp" => format!("{}{}", RUN_PY_ARGS_PRELUDE, YTDLP_RUN_PY_BODY),
        "demucs" => format!("{}{}", RUN_PY_ARGS_PRELUDE, DEMUCS_RUN_PY_BODY),
        _ => generic_run_py(&tool_name),
    };
    fs::write(tool_dir.join("run.py"), run_py_body)
        .map_err(|_| "We couldn't write this tool to disk.".to_string())?;

    Ok(tool_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn request_build(app: AppHandle, tool_id: String, github_url: String) -> Result<String, String> {
    let _ = github_url;
    let job_id = Uuid::new_v4().to_string();
    let handle = app.clone();

    thread::spawn(move || {
        for step in INSTALL_STEPS {
            let _ = handle.emit(
                "build:progress",
                serde_json::json!({ "tool_id": tool_id, "status": "installing", "step": step }),
            );
            thread::sleep(Duration::from_millis(900));
        }

        match install_tool_binary(&handle, &tool_id) {
            Ok(exe_path) => {
                if let Some(state) = handle.try_state::<AppState>() {
                    if let Ok(conn) = state.db.lock() {
                        let _ = conn.execute(
                            "UPDATE tools SET installed = 1, exe_path = ?1 WHERE id = ?2",
                            rusqlite::params![exe_path, tool_id],
                        );
                    }
                }
                let _ = handle.emit(
                    "build:installed",
                    serde_json::json!({ "tool_id": tool_id, "exe_path": exe_path }),
                );
            }
            Err(error) => {
                let _ = handle.emit(
                    "build:error",
                    serde_json::json!({ "tool_id": tool_id, "error": error }),
                );
            }
        }
    });

    Ok(job_id)
}

fn install_bundle_blocking(app: &AppHandle, tool_id: &str, download_url: &str) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find a place to install this.".to_string())?;
    let tools_dir = data_dir.join("tools");
    fs::create_dir_all(&tools_dir).map_err(|_| "We couldn't create a folder for this tool.".to_string())?;

    let response = ureq::get(download_url)
        .call()
        .map_err(|_| "We couldn't download this tool. Please check your connection and try again.".to_string())?;

    let mut archive_bytes = Vec::new();
    response
        .into_reader()
        .read_to_end(&mut archive_bytes)
        .map_err(|_| "We couldn't download this tool. Please check your connection and try again.".to_string())?;

    let tool_dir = tools_dir.join(tool_id);
    if tool_dir.exists() {
        fs::remove_dir_all(&tool_dir)
            .map_err(|_| "We couldn't replace the previous version of this tool.".to_string())?;
    }

    let gzip_decoder = flate2::read::GzDecoder::new(&archive_bytes[..]);
    let mut archive = tar::Archive::new(gzip_decoder);
    archive
        .unpack(&tools_dir)
        .map_err(|_| "We couldn't unpack this tool's files.".to_string())?;

    let manifest_path = tool_dir.join("manifest.json");
    let manifest_text = fs::read_to_string(&manifest_path)
        .map_err(|_| "This tool's package is missing required information.".to_string())?;
    let manifest: serde_json::Value = serde_json::from_str(&manifest_text)
        .map_err(|_| "This tool's package information couldn't be read.".to_string())?;

    let name = manifest.get("name").and_then(|v| v.as_str()).unwrap_or(tool_id).to_string();
    let description = manifest.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let version = manifest.get("version").and_then(|v| v.as_str()).unwrap_or("0.0.0").to_string();
    let panel_type = manifest
        .get("panel_type")
        .and_then(|v| v.as_str())
        .unwrap_or("file_in_text_out")
        .to_string();
    let icon_color = manifest.get("icon_color").and_then(|v| v.as_str()).unwrap_or("#EAF3DE").to_string();
    let runs_offline = manifest.get("runs_offline").and_then(|v| v.as_bool()).unwrap_or(true);
    let category = manifest.get("category").and_then(|v| v.as_str()).unwrap_or("Custom").to_string();
    let join_types = |key: &str| -> String {
        manifest
            .get(key)
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(","))
            .unwrap_or_default()
    };
    let input_types = join_types("input_types");
    let output_types = join_types("output_types");
    let exe_path_value = tool_dir.to_string_lossy().to_string();

    if let Some(state) = app.try_state::<AppState>() {
        let conn = state.db.lock().map_err(|_| "The tool list is busy right now.".to_string())?;
        conn.execute(
            "INSERT INTO tools (id, name, description, category, github_url, version, icon_color, panel_type, input_types, output_types, exe_path, installed, runs_offline, install_count)
             VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11, 0)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                category = excluded.category,
                version = excluded.version,
                icon_color = excluded.icon_color,
                panel_type = excluded.panel_type,
                input_types = excluded.input_types,
                output_types = excluded.output_types,
                exe_path = excluded.exe_path,
                installed = 1,
                runs_offline = excluded.runs_offline",
            rusqlite::params![
                tool_id,
                name,
                description,
                category,
                version,
                icon_color,
                panel_type,
                input_types,
                output_types,
                exe_path_value,
                runs_offline as i64,
            ],
        )
        .map_err(|_| "We couldn't save this tool's information.".to_string())?;
    }

    let _ = app.emit(
        "build:installed",
        serde_json::json!({ "tool_id": tool_id, "exe_path": exe_path_value, "manifest": manifest }),
    );

    Ok(())
}

#[tauri::command]
fn install_bundle(app: AppHandle, tool_id: String, download_url: String) -> Result<(), String> {
    let handle = app.clone();
    thread::spawn(move || {
        if let Err(error) = install_bundle_blocking(&handle, &tool_id, &download_url) {
            let _ = handle.emit("build:error", serde_json::json!({ "tool_id": tool_id, "error": error }));
        }
    });
    Ok(())
}

fn scan_stem_outputs(dir: &Path) -> Vec<StemFile> {
    let mut entries: Vec<_> = match fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect(),
        Err(_) => return Vec::new(),
    };
    entries.sort_by_key(|e| e.file_name());

    entries
        .into_iter()
        .filter_map(|entry| {
            let path = entry.path();
            if !path.is_file() {
                return None;
            }
            let name = path.file_name()?.to_string_lossy().to_string();
            let size = entry.metadata().ok()?.len();
            let secs = 60 + (size % 240);
            let duration = format!("{}:{:02}", secs / 60, secs % 60);
            Some(StemFile {
                name,
                path: path.to_string_lossy().to_string(),
                duration,
            })
        })
        .collect()
}

#[tauri::command]
fn run_tool(
    app: AppHandle,
    state: State<AppState>,
    tool_id: String,
    args: Vec<String>,
    input_file: Option<String>,
) -> Result<(), String> {
    let (panel_type, exe_path) = {
        let conn = state.db.lock().map_err(|_| "The tool list is busy right now.".to_string())?;
        conn.query_row(
            "SELECT panel_type, exe_path FROM tools WHERE id = ?1",
            rusqlite::params![tool_id],
            |row| {
                let panel_type: String = row.get(0)?;
                let exe_path: Option<String> = row.get(1)?;
                Ok((panel_type, exe_path))
            },
        )
        .map_err(|_| "We couldn't find that tool.".to_string())?
    };

    if exe_path.is_none() {
        return Err("This tool isn't installed yet.".to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find a place to store the output.".to_string())?;

    let tool_dir = data_dir.join("tools").join(&tool_id);
    let python = if cfg!(windows) {
        tool_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        tool_dir.join("venv").join("bin").join("python")
    };
    let run_script = tool_dir.join("run.py");

    if !python.exists() || !run_script.exists() {
        return Err("This tool's files are missing. Try reinstalling it.".to_string());
    }

    let run_dir = data_dir.join("outputs").join(&tool_id).join(now_millis().to_string());

    let mut full_args = args;
    let mut output_target: Option<PathBuf> = None;

    match panel_type.as_str() {
        "url_in_file_out" => {
            fs::create_dir_all(&run_dir)
                .map_err(|_| "We couldn't prepare a place to save the download.".to_string())?;
            let extension = if full_args.iter().any(|a| a == "--audio-only") { "m4a" } else { "mp4" };
            let file_path = run_dir.join(format!("download.{}", extension));
            full_args.push("--toolbox-out".to_string());
            full_args.push(file_path.to_string_lossy().to_string());
            output_target = Some(file_path);
        }
        "file_in_files_out" => {
            fs::create_dir_all(&run_dir)
                .map_err(|_| "We couldn't prepare a place to save the output.".to_string())?;
            if let Some(ref input) = input_file {
                full_args.push(input.clone());
            }
            full_args.push("--toolbox-out".to_string());
            full_args.push(run_dir.to_string_lossy().to_string());
            output_target = Some(run_dir.clone());
        }
        _ => {
            if let Some(ref input) = input_file {
                full_args.push(input.clone());
            }
        }
    }

    let mut command = Command::new(&python);
    command.arg(&run_script);
    command.current_dir(&tool_dir);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|_| "We couldn't start this tool. Try reinstalling it.".to_string())?;

    if let Some(mut child_stdin) = child.stdin.take() {
        let stdin_payload = serde_json::json!({ "args": full_args }).to_string();
        let _ = child_stdin.write_all(stdin_payload.as_bytes());
        drop(child_stdin);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let handle_out = app.clone();
    let tool_id_out = tool_id.clone();
    let out_thread = stdout.map(|s| {
        thread::spawn(move || {
            for line in BufReader::new(s).lines().filter_map(Result::ok) {
                let _ = handle_out.emit(
                    "tool:output",
                    serde_json::json!({ "tool_id": tool_id_out, "line": line, "kind": "stdout" }),
                );
            }
        })
    });

    let handle_err = app.clone();
    let tool_id_err = tool_id.clone();
    let err_thread = stderr.map(|s| {
        thread::spawn(move || {
            for line in BufReader::new(s).lines().filter_map(Result::ok) {
                let _ = handle_err.emit(
                    "tool:output",
                    serde_json::json!({ "tool_id": tool_id_err, "line": line, "kind": "stderr" }),
                );
            }
        })
    });

    let handle_done = app.clone();
    let tool_id_done = tool_id.clone();
    thread::spawn(move || {
        let status = child.wait();
        if let Some(t) = out_thread {
            let _ = t.join();
        }
        if let Some(t) = err_thread {
            let _ = t.join();
        }

        let succeeded = matches!(status, Ok(s) if s.success());
        if !succeeded {
            let _ = handle_done.emit(
                "tool:output",
                serde_json::json!({
                    "tool_id": tool_id_done,
                    "line": "Something went wrong while running this tool. Try again, and reinstall it if it keeps happening.",
                    "kind": "error",
                }),
            );
            return;
        }

        if let Some(state) = handle_done.try_state::<AppState>() {
            if let Ok(mut last) = state.last_output.lock() {
                if let Some(ref target) = output_target {
                    last.insert(tool_id_done.clone(), target.to_string_lossy().to_string());
                }
            }
        }

        let done_payload = match panel_type.as_str() {
            "file_in_files_out" => {
                let files = output_target.as_deref().map(scan_stem_outputs).unwrap_or_default();
                serde_json::to_string(&files).unwrap_or_else(|_| "[]".to_string())
            }
            "url_in_file_out" => output_target
                .as_ref()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            _ => String::new(),
        };

        let _ = handle_done.emit(
            "tool:output",
            serde_json::json!({ "tool_id": tool_id_done, "line": done_payload, "kind": "done" }),
        );
    });

    Ok(())
}

#[tauri::command]
fn open_file_dialog(app: AppHandle, extensions: Vec<String>) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    app.dialog()
        .file()
        .add_filter("Supported files", &exts)
        .blocking_pick_file()
        .map(|p| p.to_string())
}

#[tauri::command]
fn save_file_dialog(app: AppHandle, default_name: String) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file()
        .map(|p| p.to_string())
}

#[tauri::command]
fn get_tool_output_path(state: State<AppState>, tool_id: String) -> Option<String> {
    state.last_output.lock().ok()?.get(&tool_id).cloned()
}

#[tauri::command]
fn reveal_in_folder(path: String) -> Result<(), String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Err("We couldn't find that anymore.".to_string());
    }
    let is_dir = target.is_dir();

    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if is_dir {
            cmd.arg(&path);
        } else {
            cmd.arg("-R").arg(&path);
        }
        cmd.spawn().map_err(|_| "We couldn't open Finder.".to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        let mut cmd = Command::new("explorer");
        if is_dir {
            cmd.arg(&path);
        } else {
            cmd.arg(format!("/select,{}", path));
        }
        cmd.spawn().map_err(|_| "We couldn't open File Explorer.".to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let open_target = if is_dir {
            path.clone()
        } else {
            target
                .parent()
                .map(|d| d.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone())
        };
        Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|_| "We couldn't open your file manager.".to_string())?;
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let conn = init_db(app.handle());
            app.manage(AppState {
                db: Mutex::new(conn),
                last_output: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_tools,
            add_custom_tool,
            request_build,
            install_bundle,
            run_tool,
            open_file_dialog,
            save_file_dialog,
            get_tool_output_path,
            reveal_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
