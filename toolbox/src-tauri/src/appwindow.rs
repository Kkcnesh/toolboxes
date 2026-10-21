//! Embedded app windows.
//!
//! A running web app is shown inside a GitRun webview window instead of the
//! system browser. The window is keyed by URL so re-opening focuses the same
//! window, and it is closed when the run ends.

use tauri::{AppHandle, Manager};

fn label_for(url: &str) -> String {
    // FNV-1a: stable within the process, and short enough for a window label.
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in url.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("app-{hash:016x}")
}

#[tauri::command]
pub fn open_app_window(app: AppHandle, url: String, name: Option<String>) -> Result<(), String> {
    let parsed = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    let label = label_for(&url);

    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::External(parsed))
        .title(name.unwrap_or_else(|| "GitRun — app".to_string()))
        .inner_size(1080.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn close_app_window(app: AppHandle, url: String) -> Result<(), String> {
    close_app_window_for(&app, &url);
    Ok(())
}

/// Closes the window opened for `url`, if there is one.
pub fn close_app_window_for(app: &AppHandle, url: &str) {
    if let Some(window) = app.get_webview_window(&label_for(url)) {
        let _ = window.close();
    }
}
