#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod deployment;

use deployment::{deploy_synapse_server, DeploymentConfig, DeploymentStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;
use tauri_plugin_store::StoreBuilder;

const STORE_FILE: &str = "secure_credentials.store";
const ACCOUNTS_KEY: &str = "accounts";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
  pub homeserver_url: String,
  pub user_id: String,
  pub access_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
  pub key: String,
  pub homeserver_url: String,
  pub user_id: String,
  pub access_token: String,
}

fn norm_hs(url: &str) -> String {
  let trimmed = url.trim();
  if trimmed.ends_with('/') {
    trimmed.trim_end_matches('/').to_string()
  } else {
    trimmed.to_string()
  }
}

fn make_key(homeserver_url: &str, user_id: &str) -> String {
  format!("{}/{}", norm_hs(homeserver_url), user_id)
}

async fn read_accounts_map(app: &AppHandle) -> Result<HashMap<String, Credentials>, String> {
  let store = StoreBuilder::new(app, STORE_FILE)
      .build()
      .map_err(|e| e.to_string())?;

  let value = store.get(ACCOUNTS_KEY);
  if let Some(v) = value {
    serde_json::from_value::<HashMap<String, Credentials>>(v.clone())
      .map_err(|e| format!("Corrupt store: {}", e))
  } else {
    Ok(HashMap::new())
  }
}

async fn write_accounts_map(app: &AppHandle, map: &HashMap<String, Credentials>) -> Result<(), String> {
  let store = StoreBuilder::new(app, STORE_FILE)
      .build()
      .map_err(|e| e.to_string())?;
  let v = serde_json::to_value(map).map_err(|e| e.to_string())?;
  store.set(ACCOUNTS_KEY.to_string(), v);
  store.save().map_err(|e| e.to_string())
}

/// Add or update one account in the secure store.
#[tauri::command]
async fn save_credentials(app: AppHandle, creds: Credentials) -> Result<(), String> {
  let mut map = read_accounts_map(&app).await?;
  let key = make_key(&creds.homeserver_url, &creds.user_id);
  map.insert(key, creds);
  write_accounts_map(&app, &map).await
}

/// Load all saved accounts. Returns an ordered list (stable by key).
#[tauri::command]
async fn load_credentials(app: AppHandle) -> Result<Vec<StoredAccount>, String> {
  let map = read_accounts_map(&app).await?;
  let mut out: Vec<StoredAccount> = map
    .into_iter()
    .map(|(key, c)| StoredAccount {
      key,
      homeserver_url: c.homeserver_url,
      user_id: c.user_id,
      access_token: c.access_token,
    })
    .collect();
  out.sort_by(|a, b| a.key.cmp(&b.key));
  Ok(out)
}

/// Remove one account by key. If `key` is None, clears all accounts.
#[tauri::command]
async fn clear_credentials(app: AppHandle, key: Option<String>) -> Result<(), String> {
  if let Some(k) = key {
    let mut map = read_accounts_map(&app).await?;
    map.remove(&k);
    write_accounts_map(&app, &map).await?;
  } else {
    // Clear entire collection
    let store = StoreBuilder::new(&app, STORE_FILE)
        .build()
        .map_err(|e| e.to_string())?;
    store.delete(ACCOUNTS_KEY);
    store.save().map_err(|e| e.to_string())?;
  }
  Ok(())
}

/// Deploy Matrix Synapse server via SSH
#[tauri::command]
async fn deploy_matrix_server(config: DeploymentConfig) -> Result<Vec<DeploymentStatus>, String> {
  tokio::task::spawn_blocking(move || deploy_synapse_server(config))
    .await
    .map_err(|e| format!("Deployment task failed: {}", e))?
}

/// Test SSH connection to server
#[tauri::command]
async fn test_ssh_connection(
  server_ip: String,
  ssh_user: String,
  ssh_password: String,
) -> Result<String, String> {
  let config = DeploymentConfig {
    server_ip,
    ssh_user,
    ssh_password,
    domain: None,
    admin_username: String::new(),
    admin_password: String::new(),
  };

  tokio::task::spawn_blocking(move || {
    deployment::execute_remote_command(&config, "echo 'Connection successful' && uname -a")
  })
  .await
  .map_err(|e| format!("Connection test failed: {}", e))?
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .invoke_handler(tauri::generate_handler![
      save_credentials,
      load_credentials,
      clear_credentials,
      deploy_matrix_server,
      test_ssh_connection
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
