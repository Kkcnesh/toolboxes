use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_README_MODEL: &str = "qwen/qwen3.7-flash";
const OPENROUTER_FIX_MODEL: &str = "qwen/qwen3-coder-30b-a3b-instruct";
const PYTHON_VERSION_TAG: &str = "3.11.9+20240726";

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    pub entry_point: String,
    pub panel_type: String,
    pub input_types: Vec<String>,
    pub output_types: Vec<String>,
    pub installed_at: String,
    pub github_url: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct AppConfig {
    #[serde(default)]
    openrouter_api_key: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ReadmeAnalysis {
    entry_point: Option<String>,
    requirements: Option<String>,
    run_command: Option<String>,
    description: String,
}

#[derive(Debug, Clone, Default)]
struct FixSuggestion {
    fix_type: String,
    fix_payload: serde_json::Value,
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

// ---------------------------------------------------------------------------
// Bundled Python runtime
// ---------------------------------------------------------------------------

fn python_download_url() -> Result<String, String> {
    let base = format!(
        "https://github.com/indygreg/python-build-standalone/releases/latest/download/cpython-{}",
        PYTHON_VERSION_TAG
    );
    if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            Ok(format!("{base}-aarch64-apple-darwin-install_only.tar.gz"))
        } else if cfg!(target_arch = "x86_64") {
            Ok(format!("{base}-x86_64-apple-darwin-install_only.tar.gz"))
        } else {
            Err("Toolbox doesn't support this Mac's processor yet.".to_string())
        }
    } else if cfg!(target_os = "windows") {
        Ok(format!("{base}-x86_64-pc-windows-msvc-install_only.tar.gz"))
    } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
        Ok(format!("{base}-x86_64-unknown-linux-gnu-install_only.tar.gz"))
    } else {
        Err("Toolbox doesn't support this operating system yet.".to_string())
    }
}

fn runtime_python_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find Toolbox's data folder.".to_string())?;
    let path = if cfg!(target_os = "windows") {
        data_dir.join("runtime").join("python").join("python.exe")
    } else {
        data_dir.join("runtime").join("python").join("bin").join("python3.11")
    };
    Ok(path)
}

#[tauri::command]
fn check_runtime(app: AppHandle) -> bool {
    runtime_python_path(&app).map(|p| p.exists()).unwrap_or(false)
}

#[tauri::command]
fn check_git_installed() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn emit_runtime_progress(app: &AppHandle, step: &str, percent: f64, message: &str) {
    let _ = app.emit(
        "runtime:progress",
        serde_json::json!({ "step": step, "percent": percent, "message": message }),
    );
}

fn download_runtime_blocking(app: &AppHandle) -> Result<(), String> {
    let url = python_download_url()?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find a place to install Toolbox.".to_string())?;
    let runtime_dir = data_dir.join("runtime");
    if runtime_dir.exists() {
        let _ = fs::remove_dir_all(&runtime_dir);
    }
    fs::create_dir_all(&runtime_dir).map_err(|_| "We couldn't create a folder for setup.".to_string())?;

    emit_runtime_progress(app, "downloading", 0.0, "Downloading Python…");

    let mut response = reqwest::blocking::get(&url)
        .map_err(|_| "We couldn't download the Python runtime. Check your connection and try again.".to_string())?;
    if !response.status().is_success() {
        return Err("We couldn't download the Python runtime. Please try again.".to_string());
    }
    let total_len = response.content_length();

    let mut buffer: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 65536];
    let mut downloaded: u64 = 0;
    loop {
        let n = response
            .read(&mut chunk)
            .map_err(|_| "We couldn't download the Python runtime. Check your connection and try again.".to_string())?;
        if n == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..n]);
        downloaded += n as u64;
        if let Some(total) = total_len {
            if total > 0 {
                let percent = (downloaded as f64 / total as f64) * 90.0;
                emit_runtime_progress(app, "downloading", percent, "Downloading Python…");
            }
        }
    }

    emit_runtime_progress(app, "extracting", 92.0, "Setting things up…");

    let gzip_decoder = flate2::read::GzDecoder::new(&buffer[..]);
    let mut archive = tar::Archive::new(gzip_decoder);
    archive
        .unpack(&runtime_dir)
        .map_err(|_| "We couldn't finish setting up Python.".to_string())?;

    let python_bin = runtime_python_path(app)?;
    if !python_bin.exists() {
        return Err("Something went wrong while setting up Python.".to_string());
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = fs::metadata(&python_bin) {
            let mut perms = metadata.permissions();
            perms.set_mode(0o755);
            let _ = fs::set_permissions(&python_bin, perms);
        }
    }

    emit_runtime_progress(app, "done", 100.0, "Ready");
    Ok(())
}

#[tauri::command]
fn download_runtime(app: AppHandle) -> Result<(), String> {
    let handle = app.clone();
    thread::spawn(move || {
        if let Err(error) = download_runtime_blocking(&handle) {
            emit_runtime_progress(&handle, "error", 0.0, &error);
        }
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// OpenRouter config + calls
// ---------------------------------------------------------------------------

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find Toolbox's data folder.".to_string())?;
    Ok(data_dir.join("config.json"))
}

fn load_config(app: &AppHandle) -> AppConfig {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "We couldn't save Toolbox's settings.".to_string())?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|_| "We couldn't save Toolbox's settings.".to_string())?;
    fs::write(path, text).map_err(|_| "We couldn't save Toolbox's settings.".to_string())
}

fn resolve_openrouter_api_key(app: &AppHandle) -> Result<String, String> {
    if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            let mut config = load_config(app);
            if config.openrouter_api_key.as_deref() != Some(trimmed) {
                config.openrouter_api_key = Some(trimmed.to_string());
                let _ = save_config(app, &config);
            }
            return Ok(trimmed.to_string());
        }
    }

    load_config(app)
        .openrouter_api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| {
            "OpenRouter isn't set up yet. Set the OPENROUTER_API_KEY environment variable and restart Toolbox.".to_string()
        })
}

fn extract_json_object(text: &str) -> Option<serde_json::Value> {
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        return Some(value);
    }
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(&text[start..=end]).ok()
}

fn call_openrouter(api_key: &str, model: &str, prompt: &str) -> Result<String, String> {
    let client = reqwest::blocking::Client::new();
    let body = serde_json::json!({
        "model": model,
        "messages": [{ "role": "user", "content": prompt }],
    });

    let response = client
        .post(OPENROUTER_URL)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("HTTP-Referer", "https://toolbox.app")
        .header("X-Title", "Toolbox")
        .json(&body)
        .send()
        .map_err(|_| "We couldn't reach OpenRouter. Check your connection and try again.".to_string())?;

    if !response.status().is_success() {
        return Err(format!("OpenRouter returned an error (status {}).", response.status()));
    }

    let data: serde_json::Value = response
        .json()
        .map_err(|_| "We couldn't understand OpenRouter's response.".to_string())?;

    data.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "OpenRouter returned an empty response.".to_string())
}

fn parse_readme_via_llm(api_key: &str, readme_text: &str) -> ReadmeAnalysis {
    let truncated: String = readme_text.chars().take(8000).collect();
    let prompt = format!(
        "You are analyzing the README of a Python project so it can be installed locally on someone's \
computer. Read the README below and respond with ONLY a JSON object (no prose, no markdown fences) \
with exactly these keys:\n\
  \"entry_point\": the relative path to the main Python file to run, e.g. \"app.py\", or null if unclear\n\
  \"requirements\": a newline-separated list of pip package names this project needs, or null if unknown\n\
  \"run_command\": the shell command used to run the program, e.g. \"python app.py\"\n\
  \"description\": one short sentence, in plain English, describing what the program does\n\n\
README:\n{truncated}"
    );

    let raw = match call_openrouter(api_key, OPENROUTER_README_MODEL, &prompt) {
        Ok(text) => text,
        Err(_) => return ReadmeAnalysis::default(),
    };

    let Some(json) = extract_json_object(&raw) else {
        return ReadmeAnalysis::default();
    };

    ReadmeAnalysis {
        entry_point: json.get("entry_point").and_then(|v| v.as_str()).map(|s| s.to_string()),
        requirements: json.get("requirements").and_then(|v| v.as_str()).map(|s| s.to_string()),
        run_command: json.get("run_command").and_then(|v| v.as_str()).map(|s| s.to_string()),
        description: json.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
    }
}

fn suggest_fix_via_llm(api_key: &str, error_log: &str) -> FixSuggestion {
    let tail: String = error_log.chars().rev().take(4000).collect::<Vec<_>>().into_iter().rev().collect();
    let prompt = format!(
        "Installing a Python project into a virtual environment just failed. Suggest ONE concrete fix. \
Respond with ONLY a JSON object (no prose) with exactly these keys:\n\
  \"fix_type\": one of \"pip_flag\", \"edit_requirements\", \"retry\"\n\
  \"fix_payload\": a JSON object with whatever fields the fix needs, e.g. {{\"flag\": \"--pre\"}} or \
{{\"remove\": [\"pkgname\"], \"add\": [\"pkgname==1.2.3\"]}}\n\n\
Error log (last portion):\n{tail}"
    );

    let raw = match call_openrouter(api_key, OPENROUTER_FIX_MODEL, &prompt) {
        Ok(text) => text,
        Err(_) => return FixSuggestion { fix_type: "retry".to_string(), fix_payload: serde_json::json!({}) },
    };

    match extract_json_object(&raw) {
        Some(json) => FixSuggestion {
            fix_type: json.get("fix_type").and_then(|v| v.as_str()).unwrap_or("retry").to_string(),
            fix_payload: json.get("fix_payload").cloned().unwrap_or_else(|| serde_json::json!({})),
        },
        None => FixSuggestion { fix_type: "retry".to_string(), fix_payload: serde_json::json!({}) },
    }
}

fn apply_fix(fix: &FixSuggestion, extra_flags: &mut Vec<String>, repo_dir: &Path) {
    match fix.fix_type.as_str() {
        "pip_flag" => {
            if let Some(flag) = fix.fix_payload.get("flag").and_then(|v| v.as_str()) {
                if !extra_flags.iter().any(|f| f == flag) {
                    extra_flags.push(flag.to_string());
                }
            }
            if let Some(flags) = fix.fix_payload.get("flags").and_then(|v| v.as_array()) {
                for f in flags {
                    if let Some(s) = f.as_str() {
                        if !extra_flags.iter().any(|existing| existing == s) {
                            extra_flags.push(s.to_string());
                        }
                    }
                }
            }
        }
        "edit_requirements" => {
            let req_path = repo_dir.join("requirements.txt");
            let mut lines: Vec<String> = if req_path.is_file() {
                fs::read_to_string(&req_path)
                    .unwrap_or_default()
                    .lines()
                    .map(|s| s.to_string())
                    .collect()
            } else {
                Vec::new()
            };

            if let Some(remove) = fix.fix_payload.get("remove").and_then(|v| v.as_array()) {
                let remove_names: Vec<String> = remove
                    .iter()
                    .filter_map(|v| v.as_str())
                    .map(|s| normalize_requirement_name(s).to_lowercase())
                    .collect();
                lines.retain(|line| !remove_names.contains(&normalize_requirement_name(line).to_lowercase()));
            }
            if let Some(add) = fix.fix_payload.get("add").and_then(|v| v.as_array()) {
                for a in add {
                    if let Some(s) = a.as_str() {
                        lines.push(s.to_string());
                    }
                }
            }

            let _ = fs::write(&req_path, lines.join("\n") + "\n");
        }
        _ => {}
    }
}

fn normalize_requirement_name(line: &str) -> String {
    line.trim()
        .split(|c: char| "<>=!~[; ".contains(c))
        .next()
        .unwrap_or("")
        .trim()
        .to_string()
}

// ---------------------------------------------------------------------------
// Tool installation
// ---------------------------------------------------------------------------

fn emit_tool_progress(app: &AppHandle, tool_id: &str, step: &str, message: &str) {
    let _ = app.emit(
        "tool:progress",
        serde_json::json!({ "tool_id": tool_id, "step": step, "message": message }),
    );
}

fn read_readme_text(repo_dir: &Path) -> String {
    for name in ["README.md", "readme.md", "README.rst", "README.txt", "README"] {
        let candidate = repo_dir.join(name);
        if candidate.is_file() {
            if let Ok(text) = fs::read_to_string(&candidate) {
                return text;
            }
        }
    }
    String::new()
}

fn resolve_entry_point(repo_dir: &Path, analysis: &ReadmeAnalysis) -> Option<String> {
    if let Some(ep) = &analysis.entry_point {
        let candidate = repo_dir.join(ep);
        if candidate.is_file() {
            return Some(ep.clone());
        }
    }

    for name in ["main.py", "app.py", "__main__.py", "run.py"] {
        if repo_dir.join(name).is_file() {
            return Some(name.to_string());
        }
    }

    if let Some(cmd) = &analysis.run_command {
        for part in cmd.split_whitespace() {
            if part.ends_with(".py") && repo_dir.join(part).is_file() {
                return Some(part.to_string());
            }
        }
    }

    if let Ok(entries) = fs::read_dir(repo_dir) {
        let py_files: Vec<String> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let path = e.path();
                if path.extension().map(|ext| ext == "py").unwrap_or(false) {
                    path.file_name().map(|n| n.to_string_lossy().to_string())
                } else {
                    None
                }
            })
            .collect();
        if py_files.len() == 1 {
            return Some(py_files[0].clone());
        }
    }

    None
}

fn run_pip(pip_bin: &Path, cwd: &Path, args: &[String]) -> (bool, String) {
    match Command::new(pip_bin).args(args).current_dir(cwd).output() {
        Ok(out) => {
            let mut log = String::new();
            log.push_str(&String::from_utf8_lossy(&out.stdout));
            log.push_str(&String::from_utf8_lossy(&out.stderr));
            (out.status.success(), log)
        }
        Err(exc) => (false, format!("Could not run pip: {exc}")),
    }
}

fn attempt_pip_install(pip_bin: &Path, repo_dir: &Path, extra_flags: &[String]) -> (bool, String) {
    let mut attempts: Vec<Vec<String>> = Vec::new();

    if repo_dir.join("requirements.txt").is_file() {
        let mut a = vec!["install".to_string()];
        a.extend(extra_flags.iter().cloned());
        a.push("-r".to_string());
        a.push("requirements.txt".to_string());
        attempts.push(a);
    }
    if repo_dir.join("pyproject.toml").is_file() || repo_dir.join("setup.py").is_file() {
        let mut a = vec!["install".to_string()];
        a.extend(extra_flags.iter().cloned());
        a.push("-e".to_string());
        a.push(".".to_string());
        attempts.push(a);
    }
    {
        let mut a = vec!["install".to_string()];
        a.extend(extra_flags.iter().cloned());
        a.push(".".to_string());
        attempts.push(a);
    }

    let mut last_log = String::new();
    for args in attempts {
        let (ok, log) = run_pip(pip_bin, repo_dir, &args);
        if ok {
            return (true, log);
        }
        last_log = log;
    }
    (false, last_log)
}

fn humanize_pip_error(log: &str) -> String {
    let lower = log.to_lowercase();
    let patterns: &[(&str, &str)] = &[
        ("no matching distribution", "One of this tool's dependencies isn't available for this system."),
        ("could not find a version", "This tool needs a library version we couldn't find."),
        ("microsoft visual c++", "This tool needs Windows build tools we don't have."),
        ("permission denied", "We hit a permissions issue while installing this tool."),
        ("no space left on device", "Your device is out of storage space."),
        ("could not find requirements.txt", "This tool doesn't have a clear list of dependencies we could install."),
        ("connection", "We had trouble downloading something this tool needs. Please check your connection."),
        ("timed out", "The installation took too long and was cancelled."),
    ];
    for (needle, message) in patterns {
        if lower.contains(needle) {
            return message.to_string();
        }
    }
    "We couldn't finish installing this tool's dependencies.".to_string()
}

fn infer_panel_metadata(description: &str) -> (&'static str, Vec<&'static str>, Vec<&'static str>) {
    let text = description.to_lowercase();
    if ["download", "youtube", "yt-dlp"].iter().any(|w| text.contains(w)) {
        ("url_in_file_out", vec!["url"], vec!["audio", "video"])
    } else if ["transcri", "speech to text", "speech-to-text"].iter().any(|w| text.contains(w)) {
        ("file_in_text_out", vec!["audio", "video"], vec!["text"])
    } else if ["separat", "stem", "split"].iter().any(|w| text.contains(w)) {
        ("file_in_files_out", vec!["audio"], vec!["files"])
    } else {
        ("file_in_text_out", vec!["audio", "video"], vec!["text"])
    }
}

fn existing_tool_name(app: &AppHandle, tool_id: &str) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let conn = state.db.lock().ok()?;
    conn.query_row(
        "SELECT name FROM tools WHERE id = ?1",
        rusqlite::params![tool_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
}

fn install_tool_blocking(app: &AppHandle, tool_id: &str, github_url: &str) -> Result<(), String> {
    if !check_git_installed() {
        return Err("Please install Git from git-scm.com to use Toolbox.".to_string());
    }

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find a place to install this.".to_string())?;
    let tool_dir = data_dir.join("tools").join(tool_id);
    if tool_dir.exists() {
        fs::remove_dir_all(&tool_dir).map_err(|_| "We couldn't replace the previous version of this tool.".to_string())?;
    }
    fs::create_dir_all(&tool_dir).map_err(|_| "We couldn't create a folder for this tool.".to_string())?;

    emit_tool_progress(app, tool_id, "cloning", "Downloading the code");
    let repo_dir = tool_dir.join("repo");
    let clone_output = Command::new("git")
        .args(["clone", "--depth", "1", github_url])
        .arg(&repo_dir)
        .output()
        .map_err(|_| "We couldn't start git. Make sure it's installed.".to_string())?;
    if !clone_output.status.success() {
        return Err("We couldn't access that repository. Please check the link and try again.".to_string());
    }

    emit_tool_progress(app, tool_id, "reading", "Reading how it works");
    let readme_text = read_readme_text(&repo_dir);
    let api_key = resolve_openrouter_api_key(app)?;
    let analysis = parse_readme_via_llm(&api_key, &readme_text);

    let entry_point = resolve_entry_point(&repo_dir, &analysis)
        .ok_or_else(|| "We couldn't find a clear starting point for this program.".to_string())?;

    if !repo_dir.join("requirements.txt").is_file() {
        if let Some(reqs) = &analysis.requirements {
            let _ = fs::write(repo_dir.join("requirements.txt"), reqs);
        }
    }

    emit_tool_progress(app, tool_id, "installing", "Installing the parts");
    let python_bin = runtime_python_path(app)?;
    if !python_bin.exists() {
        return Err("Toolbox's Python runtime isn't set up yet. Please restart Toolbox.".to_string());
    }

    let venv_dir = tool_dir.join("venv");
    let venv_output = Command::new(&python_bin)
        .args(["-m", "venv"])
        .arg(&venv_dir)
        .output()
        .map_err(|_| "We couldn't set up this tool's environment.".to_string())?;
    if !venv_output.status.success() {
        return Err("We couldn't set up this tool's environment.".to_string());
    }

    let pip_bin = if cfg!(target_os = "windows") {
        venv_dir.join("Scripts").join("pip.exe")
    } else {
        venv_dir.join("bin").join("pip")
    };

    let mut extra_flags: Vec<String> = Vec::new();
    let mut installed_ok = false;
    let mut last_log = String::new();
    const MAX_ATTEMPTS: u32 = 3;

    for attempt in 1..=MAX_ATTEMPTS {
        let (ok, log) = attempt_pip_install(&pip_bin, &repo_dir, &extra_flags);
        if ok {
            installed_ok = true;
            break;
        }
        last_log = log;
        if attempt == MAX_ATTEMPTS {
            break;
        }
        let fix = suggest_fix_via_llm(&api_key, &last_log);
        apply_fix(&fix, &mut extra_flags, &repo_dir);
    }

    if !installed_ok {
        return Err(humanize_pip_error(&last_log));
    }

    emit_tool_progress(app, tool_id, "ready", "Getting ready");

    let (panel_type, input_types, output_types) = infer_panel_metadata(&analysis.description);
    let colors = ["#EAF3DE", "#E6F1FB", "#FAEEDA", "#F1E6F8", "#E6F8F0"];
    let icon_color = colors[tool_id.len() % colors.len()];
    let name = existing_tool_name(app, tool_id).unwrap_or_else(|| capitalize_words(tool_id));
    let description = if analysis.description.is_empty() {
        "A packaged command-line tool.".to_string()
    } else {
        analysis.description.clone()
    };
    let installed_at = now_millis().to_string();

    let manifest = ToolManifest {
        id: tool_id.to_string(),
        name: name.clone(),
        description: description.clone(),
        entry_point,
        panel_type: panel_type.to_string(),
        input_types: input_types.iter().map(|s| s.to_string()).collect(),
        output_types: output_types.iter().map(|s| s.to_string()).collect(),
        installed_at,
        github_url: github_url.to_string(),
    };
    let manifest_text = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "We couldn't save this tool's information.".to_string())?;
    fs::write(tool_dir.join("manifest.json"), manifest_text)
        .map_err(|_| "We couldn't save this tool's information.".to_string())?;

    if let Some(state) = app.try_state::<AppState>() {
        if let Ok(conn) = state.db.lock() {
            let _ = conn.execute(
                "INSERT INTO tools (id, name, description, category, github_url, version, icon_color, panel_type, input_types, output_types, exe_path, installed, runs_offline, install_count)
                 VALUES (?1, ?2, ?3, 'Custom', ?4, '1.0.0', ?5, ?6, ?7, ?8, ?9, 1, 1, 0)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    description = excluded.description,
                    panel_type = excluded.panel_type,
                    input_types = excluded.input_types,
                    output_types = excluded.output_types,
                    exe_path = excluded.exe_path,
                    installed = 1",
                rusqlite::params![
                    tool_id,
                    name,
                    description,
                    github_url,
                    icon_color,
                    panel_type,
                    input_types.join(","),
                    output_types.join(","),
                    tool_dir.to_string_lossy().to_string(),
                ],
            );
        }
    }

    Ok(())
}

#[tauri::command]
fn install_tool(app: AppHandle, tool_id: String, github_url: String) -> Result<(), String> {
    let handle = app.clone();
    thread::spawn(move || {
        if let Err(error) = install_tool_blocking(&handle, &tool_id, &github_url) {
            emit_tool_progress(&handle, &tool_id, "error", &error);
        }
    });
    Ok(())
}

#[tauri::command]
fn get_installed_tools(app: AppHandle) -> Result<Vec<ToolManifest>, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find Toolbox's data folder.".to_string())?;
    let tools_dir = data_dir.join("tools");
    if !tools_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    if let Ok(entries) = fs::read_dir(&tools_dir) {
        for entry in entries.filter_map(|e| e.ok()) {
            let manifest_path = entry.path().join("manifest.json");
            if manifest_path.is_file() {
                if let Ok(text) = fs::read_to_string(&manifest_path) {
                    if let Ok(manifest) = serde_json::from_str::<ToolManifest>(&text) {
                        manifests.push(manifest);
                    }
                }
            }
        }
    }
    Ok(manifests)
}

#[tauri::command]
fn uninstall_tool(app: AppHandle, state: State<AppState>, tool_id: String) -> Result<(), String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "We couldn't find Toolbox's data folder.".to_string())?;
    let tool_dir = data_dir.join("tools").join(&tool_id);
    if tool_dir.exists() {
        fs::remove_dir_all(&tool_dir).map_err(|_| "We couldn't remove this tool's files.".to_string())?;
    }

    let conn = state.db.lock().map_err(|_| "The tool list is busy right now.".to_string())?;
    conn.execute(
        "UPDATE tools SET installed = 0, exe_path = NULL WHERE id = ?1",
        rusqlite::params![tool_id],
    )
    .map_err(|_| "We couldn't update this tool's status.".to_string())?;

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
    let manifest_text = fs::read_to_string(tool_dir.join("manifest.json"))
        .map_err(|_| "This tool's files are missing. Try reinstalling it.".to_string())?;
    let manifest: ToolManifest = serde_json::from_str(&manifest_text)
        .map_err(|_| "This tool's information is corrupted. Try reinstalling it.".to_string())?;

    let python = if cfg!(target_os = "windows") {
        tool_dir.join("venv").join("Scripts").join("python.exe")
    } else {
        tool_dir.join("venv").join("bin").join("python")
    };
    let entry_script = tool_dir.join("repo").join(&manifest.entry_point);

    if !python.exists() || !entry_script.exists() {
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
    command.arg(&entry_script);
    command.args(&full_args);
    command.current_dir(entry_script.parent().unwrap_or(&tool_dir));
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|_| "We couldn't start this tool. Try reinstalling it.".to_string())?;

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
            check_runtime,
            download_runtime,
            check_git_installed,
            install_tool,
            get_installed_tools,
            uninstall_tool,
            run_tool,
            open_file_dialog,
            save_file_dialog,
            get_tool_output_path,
            reveal_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
