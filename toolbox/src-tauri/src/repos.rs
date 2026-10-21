//! Saved repositories: the repo URL plus the QuickRun config the AI built
//! for it, so re-running does not rebuild the plan from scratch.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

/// Stored form (includes the YAML, which is never sent to the UI).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedRepo {
    pub repo: String,
    pub name: String,
    #[serde(default)]
    pub yaml: Option<String>,
    #[serde(default)]
    pub last_run: Option<u64>,
}

/// What the sidebar needs: no config text.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRepoView {
    pub repo: String,
    pub name: String,
    pub last_run: Option<u64>,
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("gitrun-repos.json"))
}

pub fn load(app: &AppHandle) -> Vec<SavedRepo> {
    let Ok(path) = store_path(app) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn write_all(app: &AppHandle, repos: &[SavedRepo]) {
    let Ok(path) = store_path(app) else {
        return;
    };
    if let Ok(text) = serde_json::to_string_pretty(repos) {
        let _ = fs::write(path, text);
    }
}

pub fn find(app: &AppHandle, repo: &str) -> Option<SavedRepo> {
    load(app).into_iter().find(|entry| entry.repo == repo)
}

pub fn upsert(app: &AppHandle, entry: SavedRepo) {
    let mut repos = load(app);
    if let Some(existing) = repos.iter_mut().find(|saved| saved.repo == entry.repo) {
        *existing = entry;
    } else {
        repos.push(entry);
    }
    repos.sort_by(|a, b| b.last_run.cmp(&a.last_run));
    write_all(app, &repos);
}

pub fn remove(app: &AppHandle, repo: &str) {
    let mut repos = load(app);
    repos.retain(|saved| saved.repo != repo);
    write_all(app, &repos);
}

pub fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn quickrun_list_saved(app: AppHandle) -> Vec<SavedRepoView> {
    load(&app)
        .into_iter()
        .map(|entry| SavedRepoView {
            repo: entry.repo,
            name: entry.name,
            last_run: entry.last_run,
        })
        .collect()
}

#[tauri::command]
pub fn quickrun_forget_saved(app: AppHandle, repo: String) {
    remove(&app, &repo);
}
