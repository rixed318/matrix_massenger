#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod deployment;

use deployment::{deploy_synapse_server, DeploymentConfig, DeploymentStatus};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::{SystemTime, UNIX_EPOCH}};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreBuilder;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;

const STORE_FILE: &str = "secure_credentials.store";
const ACCOUNTS_KEY: &str = "accounts";
const BACKUP_STORE_FILE: &str = "secure_key_backups.store";
const BACKUP_KEY: &str = "backups";
const PBKDF2_ITERATIONS: u32 = 120_000;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StoredPushSubscription {
  pub endpoint: String,
  pub auth: String,
  pub p256dh: String,
  pub push_key: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub expiration_time: Option<f64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub updated_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Credentials {
  pub homeserver_url: String,
  pub user_id: String,
  pub access_token: String,
  #[serde(default)]
  #[serde(skip_serializing_if = "Option::is_none")]
  pub push_subscription: Option<StoredPushSubscription>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
  pub key: String,
  pub homeserver_url: String,
  pub user_id: String,
  pub access_token: String,
  #[serde(default)]
  #[serde(skip_serializing_if = "Option::is_none")]
  pub push_subscription: Option<StoredPushSubscription>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct EncryptedBackup {
  salt: String,
  nonce: String,
  ciphertext: String,
  updated_at: u64,
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

fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
  let mut key = [0u8; 32];
  pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
  key
}

fn encrypt_payload(passphrase: &str, payload: &str) -> Result<EncryptedBackup, String> {
  let mut salt = [0u8; SALT_LEN];
  let mut nonce_bytes = [0u8; NONCE_LEN];
  OsRng.fill_bytes(&mut salt);
  OsRng.fill_bytes(&mut nonce_bytes);

  let key = derive_key(passphrase, &salt);
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
  let nonce = Nonce::from_slice(&nonce_bytes);
  let ciphertext = cipher
    .encrypt(nonce, payload.as_bytes())
    .map_err(|e| e.to_string())?;

  let now = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_err(|e| e.to_string())?
    .as_secs();

  Ok(EncryptedBackup {
    salt: general_purpose::STANDARD.encode(salt),
    nonce: general_purpose::STANDARD.encode(nonce_bytes),
    ciphertext: general_purpose::STANDARD.encode(ciphertext),
    updated_at: now,
  })
}

fn decrypt_payload(passphrase: &str, backup: &EncryptedBackup) -> Result<String, String> {
  let salt = general_purpose::STANDARD
    .decode(&backup.salt)
    .map_err(|e| e.to_string())?;
  let nonce_bytes = general_purpose::STANDARD
    .decode(&backup.nonce)
    .map_err(|e| e.to_string())?;
  let ciphertext = general_purpose::STANDARD
    .decode(&backup.ciphertext)
    .map_err(|e| e.to_string())?;

  let key = derive_key(passphrase, &salt);
  let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| e.to_string())?;
  let nonce = Nonce::from_slice(&nonce_bytes);
  let plaintext = cipher
    .decrypt(nonce, ciphertext.as_ref())
    .map_err(|e| e.to_string())?;

  String::from_utf8(plaintext).map_err(|e| e.to_string())
}

async fn read_backups_map(app: &AppHandle) -> Result<HashMap<String, EncryptedBackup>, String> {
  let store = StoreBuilder::new(app, BACKUP_STORE_FILE)
    .build()
    .map_err(|e| e.to_string())?;
  let value = store.get(BACKUP_KEY);
  if let Some(v) = value {
    serde_json::from_value::<HashMap<String, EncryptedBackup>>(v.clone())
      .map_err(|e| e.to_string())
  } else {
    Ok(HashMap::new())
  }
}

async fn write_backups_map(app: &AppHandle, map: &HashMap<String, EncryptedBackup>) -> Result<(), String> {
  let store = StoreBuilder::new(app, BACKUP_STORE_FILE)
    .build()
    .map_err(|e| e.to_string())?;
  let v = serde_json::to_value(map).map_err(|e| e.to_string())?;
  store.set(BACKUP_KEY.to_string(), v);
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
      push_subscription: c.push_subscription,
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

#[tauri::command]
async fn secure_store_save_seed(app: AppHandle, label: String, payload_json: String, passphrase: String) -> Result<(), String> {
  let mut map = read_backups_map(&app).await?;
  let entry = encrypt_payload(&passphrase, &payload_json)?;
  map.insert(label, entry);
  write_backups_map(&app, &map).await
}

#[tauri::command]
async fn secure_store_load_seed(app: AppHandle, label: String, passphrase: String) -> Result<Option<String>, String> {
  let map = read_backups_map(&app).await?;
  if let Some(entry) = map.get(&label) {
    let decrypted = decrypt_payload(&passphrase, entry)?;
    Ok(Some(decrypted))
  } else {
    Ok(None)
  }
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
    .plugin(tauri_plugin_secure_storage::Plugin::new())
    .plugin(tauri_plugin_notification::init())
    .setup(|app| {
      #[cfg(not(debug_assertions))]
      {
        let handle = app.handle();
        tauri::async_runtime::spawn(async move {
          let _ = handle
            .notification()
            .builder()
            .title("Matrix Messenger ready")
            .body("Background services initialized successfully.")
            .show();
        });
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      save_credentials,
      load_credentials,
      clear_credentials,
      secure_store_save_seed,
      secure_store_load_seed,
      deploy_matrix_server,
      test_ssh_connection
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
