//! API-key settings: status and saving, surfaced in the app's Settings dialog.

use tauri::AppHandle;

use crate::{load_config, save_config};

#[derive(serde::Serialize)]
pub struct KeyStatus {
    pub openrouter: bool,
    pub deepseek: bool,
    pub tinyfish: bool,
    pub openrouter_hint: Option<String>,
    pub deepseek_hint: Option<String>,
    pub tinyfish_hint: Option<String>,
}

fn key_hint(key: &Option<String>) -> Option<String> {
    key.as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| {
            let chars: Vec<char> = value.chars().collect();
            if chars.len() <= 4 {
                "set".to_string()
            } else {
                format!("…{}", chars[chars.len() - 4..].iter().collect::<String>())
            }
        })
}

#[tauri::command]
pub fn config_key_status(app: AppHandle) -> KeyStatus {
    let config = load_config(&app);
    KeyStatus {
        openrouter: config
            .openrouter_api_key
            .as_ref()
            .map_or(false, |key| !key.trim().is_empty()),
        deepseek: config
            .deepseek_api_key
            .as_ref()
            .map_or(false, |key| !key.trim().is_empty()),
        tinyfish: config
            .tinyfish_api_key
            .as_ref()
            .map_or(false, |key| !key.trim().is_empty()),
        openrouter_hint: key_hint(&config.openrouter_api_key),
        deepseek_hint: key_hint(&config.deepseek_api_key),
        tinyfish_hint: key_hint(&config.tinyfish_api_key),
    }
}

#[tauri::command]
pub fn config_set_key(app: AppHandle, provider: String, key: String) -> Result<(), String> {
    let mut config = load_config(&app);
    let trimmed = key.trim().to_string();
    let value = if trimmed.is_empty() { None } else { Some(trimmed) };

    match provider.as_str() {
        "openrouter" => config.openrouter_api_key = value,
        "deepseek" => config.deepseek_api_key = value,
        "tinyfish" => config.tinyfish_api_key = value,
        other => return Err(format!("unknown key: {other}")),
    }

    save_config(&app, &config)
}
