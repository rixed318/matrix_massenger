#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};

const CREDENTIALS_STORE_PATH: &str = "secure_credentials.store";
const CREDENTIALS_KEY: &str = "matrix_credentials";

#[derive(Debug, Serialize, Deserialize)]
pub struct Credentials {
    homeserver_url: String,
    user_id: String,
    access_token: String,
}

#[tauri::command]
fn save_credentials(app: tauri::AppHandle, creds: Credentials) -> Result<(), String> {
    tauri_plugin_store::with_store(&app, CREDENTIALS_STORE_PATH, |store| {
        let value = serde_json::json!({
            "homeserver_url": creds.homeserver_url,
            "user_id": creds.user_id,
            "access_token": creds.access_token,
        });
        store.insert(CREDENTIALS_KEY, value);
        store.save()
    })
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn load_credentials(app: tauri::AppHandle) -> Result<Option<Credentials>, String> {
    tauri_plugin_store::with_store(&app, CREDENTIALS_STORE_PATH, |store| {
        let creds = store
            .get(CREDENTIALS_KEY)
            .and_then(|value| serde_json::from_value(value.clone()).ok());
        Ok(creds)
    })
    .map_err(|err| err.to_string())
}

#[tauri::command]
fn clear_credentials(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_store::with_store(&app, CREDENTIALS_STORE_PATH, |store| {
        store.delete(CREDENTIALS_KEY);
        store.save()
    })
    .map_err(|err| err.to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            save_credentials,
            load_credentials,
            clear_credentials
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
