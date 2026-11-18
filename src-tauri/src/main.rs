#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod migrate;
use std::collections::BTreeMap;
use tauri::Manager;

#[tauri::command]
async fn electron_saves(app: tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let mut path = app.path().data_dir().map_err(|e| e.to_string())?.join("river");
    #[cfg(feature = "relay-qa")]
    { path = std::env::var_os("RIVER_QA_PROFILE").ok_or("Missing test profile")?.into(); }
    path.push("Local Storage");
    path.push("leveldb");
    tauri::async_runtime::spawn_blocking(move || migrate::read(&path)).await.map_err(|e| e.to_string())?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![electron_saves])
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Ривер");
}
