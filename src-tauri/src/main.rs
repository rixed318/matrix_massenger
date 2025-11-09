#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod deployment;

use deployment::{deploy_synapse_server, DeploymentConfig, DeploymentStatus};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, time::{SystemTime, UNIX_EPOCH}};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_store::StoreBuilder;
use aes_gcm::{aead::{Aead, KeyInit}, Aes256Gcm, Nonce};
use base64::{engine::general_purpose, Engine as _};
use pbkdf2::pbkdf2_hmac;
use rand::{rngs::OsRng, RngCore};
use sha2::Sha256;
use rusqlite::{params, params_from_iter, types::Value, Connection};

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MediaItemRecord {
  id: String,
  event_id: String,
  room_id: String,
  #[serde(rename = "type")]
  media_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  mxc_url: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  thumbnail_mxc: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  file_name: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  size: Option<i64>,
  #[serde(skip_serializing_if = "Option::is_none")]
  mimetype: Option<String>,
  sender: String,
  timestamp: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  body: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexedMessageRecord {
  event_id: String,
  room_id: String,
  sender: String,
  timestamp: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  body: Option<String>,
  tokens: Vec<String>,
  tags: Vec<String>,
  reactions: Vec<String>,
  #[serde(rename = "hasMedia")]
  has_media: bool,
  #[serde(rename = "mediaTypes")]
  media_types: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexUpsertPayload {
  room_id: String,
  messages: Vec<IndexedMessageRecord>,
  #[serde(rename = "mediaItems")]
  media_items: Vec<MediaItemRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LocalSearchQueryPayload {
  term: Option<String>,
  room_id: Option<String>,
  senders: Option<Vec<String>>,
  #[serde(rename = "fromTs")]
  from_ts: Option<i64>,
  #[serde(rename = "toTs")]
  to_ts: Option<i64>,
  #[serde(rename = "hasMedia")]
  has_media: Option<bool>,
  limit: Option<usize>,
  #[serde(rename = "mediaTypes")]
  media_types: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedRoomIndexResponse {
  media: Vec<MediaItemRecord>,
  messages: Vec<IndexedMessageRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SmartCollectionSummaryResponse {
  id: String,
  label: String,
  description: String,
  count: usize,
  token: String,
}

fn index_db_path(app: &AppHandle) -> Result<PathBuf, String> {
  let resolver = app.path_resolver();
  let dir = resolver
    .app_data_dir()
    .ok_or_else(|| "Unable to resolve application data directory".to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir.join("search_index.sqlite3"))
}

fn init_index_db(conn: &Connection) -> Result<(), rusqlite::Error> {
  conn.execute_batch(
    "CREATE TABLE IF NOT EXISTS message_index (
        room_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        body TEXT,
        search_tokens TEXT,
        tokens_json TEXT,
        tags_json TEXT,
        reactions_json TEXT,
        has_media INTEGER NOT NULL,
        media_types_json TEXT,
        PRIMARY KEY (room_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_message_room ON message_index(room_id);
      CREATE INDEX IF NOT EXISTS idx_message_sender ON message_index(sender);
      CREATE TABLE IF NOT EXISTS media_index (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        mxc_url TEXT,
        thumbnail_mxc TEXT,
        file_name TEXT,
        size INTEGER,
        mimetype TEXT,
        sender TEXT,
        timestamp INTEGER,
        body TEXT,
        url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_media_room ON media_index(room_id);
    ",
  )
}

fn to_json_string(values: &Vec<String>) -> Result<String, String> {
  serde_json::to_string(values).map_err(|e| e.to_string())
}

fn insert_index_records(conn: &Connection, payload: &IndexUpsertPayload) -> Result<(), String> {
  if payload.messages.is_empty() && payload.media_items.is_empty() {
    return Ok(());
  }
  let tx = conn.transaction().map_err(|e| e.to_string())?;
  for message in &payload.messages {
    let tokens_json = to_json_string(&message.tokens)?;
    let tags_json = to_json_string(&message.tags)?;
    let reactions_json = to_json_string(&message.reactions)?;
    let media_types_json = to_json_string(&message.media_types)?;
    let search_tokens = format!(" {} ", message.tokens.join(" "));
    tx.execute(
      "INSERT INTO message_index (
          room_id, event_id, sender, timestamp, body, search_tokens, tokens_json, tags_json, reactions_json, has_media, media_types_json
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(room_id, event_id) DO UPDATE SET
          sender = excluded.sender,
          timestamp = excluded.timestamp,
          body = excluded.body,
          search_tokens = excluded.search_tokens,
          tokens_json = excluded.tokens_json,
          tags_json = excluded.tags_json,
          reactions_json = excluded.reactions_json,
          has_media = excluded.has_media,
          media_types_json = excluded.media_types_json",
      params![
        message.room_id,
        message.event_id,
        message.sender,
        message.timestamp,
        message.body,
        search_tokens,
        tokens_json,
        tags_json,
        reactions_json,
        if message.has_media { 1 } else { 0 },
        media_types_json,
      ],
    )
    .map_err(|e| e.to_string())?;
  }
  for item in &payload.media_items {
    tx.execute(
      "INSERT INTO media_index (
          id, event_id, room_id, media_type, mxc_url, thumbnail_mxc, file_name, size, mimetype, sender, timestamp, body, url
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
        ON CONFLICT(id) DO UPDATE SET
          event_id = excluded.event_id,
          room_id = excluded.room_id,
          media_type = excluded.media_type,
          mxc_url = excluded.mxc_url,
          thumbnail_mxc = excluded.thumbnail_mxc,
          file_name = excluded.file_name,
          size = excluded.size,
          mimetype = excluded.mimetype,
          sender = excluded.sender,
          timestamp = excluded.timestamp,
          body = excluded.body,
          url = excluded.url",
      params![
        item.id,
        item.event_id,
        item.room_id,
        item.media_type,
        item.mxc_url,
        item.thumbnail_mxc,
        item.file_name,
        item.size,
        item.mimetype,
        item.sender,
        item.timestamp,
        item.body,
        item.url,
      ],
    )
    .map_err(|e| e.to_string())?;
  }
  tx.commit().map_err(|e| e.to_string())
}

fn parse_vec(json_value: &str) -> Vec<String> {
  serde_json::from_str::<Vec<String>>(json_value).unwrap_or_default()
}

fn query_index_records(
  conn: &Connection,
  query: &LocalSearchQueryPayload,
  mention_target: Option<&str>,
) -> Result<Vec<IndexedMessageRecord>, String> {
  let mut sql = String::from(
    "SELECT room_id, event_id, sender, timestamp, body, tokens_json, tags_json, reactions_json, has_media, media_types_json FROM message_index WHERE 1=1",
  );
  let mut params: Vec<Value> = Vec::new();
  if let Some(room_id) = &query.room_id {
    sql.push_str(" AND room_id = ?");
    params.push(Value::from(room_id.clone()));
  }
  if let Some(senders) = &query.senders {
    if !senders.is_empty() {
      let placeholders: Vec<String> = senders.iter().map(|_| "?".to_string()).collect();
      sql.push_str(&format!(" AND sender IN ({})", placeholders.join(",")));
      for sender in senders {
        params.push(Value::from(sender.clone()));
      }
    }
  }
  if let Some(from_ts) = query.from_ts {
    sql.push_str(" AND timestamp >= ?");
    params.push(Value::from(from_ts));
  }
  if let Some(to_ts) = query.to_ts {
    sql.push_str(" AND timestamp <= ?");
    params.push(Value::from(to_ts));
  }
  if query.has_media.unwrap_or(false) {
    sql.push_str(" AND has_media = 1");
  }
  if let Some(media_types) = &query.media_types {
    if !media_types.is_empty() {
      for media in media_types {
        sql.push_str(" AND media_types_json LIKE ?");
        let pattern = format!("%\"{}\"%", media);
        params.push(Value::from(pattern));
      }
    }
  }
  if let Some(token) = mention_target {
    let like = format!("% {} %", token.to_lowercase());
    sql.push_str(" AND search_tokens LIKE ?");
    params.push(Value::from(like));
  }
  if let Some(term) = &query.term {
    let trimmed = term.trim();
    if !trimmed.is_empty() {
      let lower = trimmed.to_lowercase();
      let like = format!("%{}%", lower);
      sql.push_str(" AND (LOWER(IFNULL(body,'')) LIKE ? OR LOWER(sender) LIKE ? OR LOWER(tags_json) LIKE ? OR LOWER(reactions_json) LIKE ? OR search_tokens LIKE ?)");
      params.push(Value::from(like.clone()));
      params.push(Value::from(like.clone()));
      params.push(Value::from(like.clone()));
      params.push(Value::from(like.clone()));
      params.push(Value::from(format!("% {} %", lower)));
    }
  }
  sql.push_str(" ORDER BY timestamp DESC");
  if let Some(limit) = query.limit {
    sql.push_str(" LIMIT ?");
    params.push(Value::from(limit as i64));
  }
  let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map(params_from_iter(params.iter()), |row| {
      let tokens_json: String = row.get(5)?;
      let tags_json: String = row.get(6)?;
      let reactions_json: String = row.get(7)?;
      let media_types_json: String = row.get(9)?;
      Ok(IndexedMessageRecord {
        event_id: row.get(1)?,
        room_id: row.get(0)?,
        sender: row.get(2)?,
        timestamp: row.get(3)?,
        body: row.get(4)?,
        tokens: parse_vec(&tokens_json),
        tags: parse_vec(&tags_json),
        reactions: parse_vec(&reactions_json),
        has_media: row.get::<_, i64>(8)? != 0,
        media_types: parse_vec(&media_types_json),
      })
    })
    .map_err(|e| e.to_string())?;
  let mut out: Vec<IndexedMessageRecord> = Vec::new();
  for row in rows {
    if let Ok(record) = row {
      out.push(record);
    }
  }
  Ok(out)
}

fn load_room_index_from_conn(conn: &Connection, room_id: &str) -> Result<PersistedRoomIndexResponse, String> {
  let mut stmt = conn
    .prepare(
      "SELECT room_id, event_id, sender, timestamp, body, tokens_json, tags_json, reactions_json, has_media, media_types_json
       FROM message_index WHERE room_id = ? ORDER BY timestamp DESC",
    )
    .map_err(|e| e.to_string())?;
  let rows = stmt
    .query_map([room_id], |row| {
      let tokens_json: String = row.get(5)?;
      let tags_json: String = row.get(6)?;
      let reactions_json: String = row.get(7)?;
      let media_types_json: String = row.get(9)?;
      Ok(IndexedMessageRecord {
        event_id: row.get(1)?,
        room_id: row.get(0)?,
        sender: row.get(2)?,
        timestamp: row.get(3)?,
        body: row.get(4)?,
        tokens: parse_vec(&tokens_json),
        tags: parse_vec(&tags_json),
        reactions: parse_vec(&reactions_json),
        has_media: row.get::<_, i64>(8)? != 0,
        media_types: parse_vec(&media_types_json),
      })
    })
    .map_err(|e| e.to_string())?;
  let mut messages = Vec::new();
  for row in rows {
    if let Ok(rec) = row { messages.push(rec); }
  }

  let mut media_stmt = conn
    .prepare(
      "SELECT id, event_id, room_id, media_type, mxc_url, thumbnail_mxc, file_name, size, mimetype, sender, timestamp, body, url
       FROM media_index WHERE room_id = ? ORDER BY timestamp DESC",
    )
    .map_err(|e| e.to_string())?;
  let media_rows = media_stmt
    .query_map([room_id], |row| {
      Ok(MediaItemRecord {
        id: row.get(0)?,
        event_id: row.get(1)?,
        room_id: row.get(2)?,
        media_type: row.get(3)?,
        mxc_url: row.get(4)?,
        thumbnail_mxc: row.get(5)?,
        file_name: row.get(6)?,
        size: row.get(7)?,
        mimetype: row.get(8)?,
        sender: row.get(9)?,
        timestamp: row.get(10)?,
        body: row.get(11)?,
        url: row.get(12)?,
      })
    })
    .map_err(|e| e.to_string())?;
  let mut media = Vec::new();
  for row in media_rows {
    if let Ok(item) = row { media.push(item); }
  }
  Ok(PersistedRoomIndexResponse { media, messages })
}

fn normalized_localpart(user_id: &str) -> String {
  let lower = user_id.to_lowercase();
  let without_domain = lower.split(':').next().unwrap_or(&lower);
  without_domain.trim_start_matches('@').to_string()
}

fn compute_smart_collections(
  conn: &Connection,
  user_id: &str,
) -> Result<Vec<SmartCollectionSummaryResponse>, String> {
  let important_count: usize = conn
    .query_row(
      "SELECT COUNT(*) FROM message_index WHERE tags_json LIKE '%\"important\"%' OR reactions_json LIKE '%\"⭐\"%' OR reactions_json LIKE '%\"🔥\"%' OR reactions_json LIKE '%\"❗\"%'",
      [],
      |row| row.get(0),
    )
    .unwrap_or(0);
  let mut out: Vec<SmartCollectionSummaryResponse> = Vec::new();
  if important_count > 0 {
    out.push(SmartCollectionSummaryResponse {
      id: "important".to_string(),
      label: "Важно".to_string(),
      description: "Сообщения с тегом important или популярными реакциями".to_string(),
      count: important_count,
      token: "smart:important".to_string(),
    });
  }
  let local = normalized_localpart(user_id);
  if !local.is_empty() {
    let token_pattern = format!("% {} %", local);
    let mention_pattern = format!("%@{}%", local);
    let mentions_count: usize = conn
      .query_row(
        "SELECT COUNT(*) FROM message_index WHERE search_tokens LIKE ?1 OR LOWER(IFNULL(body,'')) LIKE ?2",
        params![token_pattern, mention_pattern],
        |row| row.get(0),
      )
      .unwrap_or(0);
    if mentions_count > 0 {
      out.push(SmartCollectionSummaryResponse {
        id: "mentions".to_string(),
        label: "Пропущенные упоминания".to_string(),
        description: "Сообщения с упоминанием вашего аккаунта".to_string(),
        count: mentions_count,
        token: "smart:mentions".to_string(),
      });
    }
  }
  Ok(out)
}

#[tauri::command]
async fn upsert_index_records(app: AppHandle, payload: IndexUpsertPayload) -> Result<(), String> {
  let path = index_db_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init_index_db(&conn).map_err(|e| e.to_string())?;
    insert_index_records(&conn, &payload)
  })
  .await
  .map_err(|e| e.to_string())??;
  Ok(())
}

#[tauri::command]
async fn query_local_index(
  app: AppHandle,
  query: LocalSearchQueryPayload,
  mention_target: Option<String>,
) -> Result<Vec<IndexedMessageRecord>, String> {
  let path = index_db_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || -> Result<Vec<IndexedMessageRecord>, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init_index_db(&conn).map_err(|e| e.to_string())?;
    query_index_records(&conn, &query, mention_target.as_deref())
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn load_room_index(app: AppHandle, room_id: String) -> Result<Option<PersistedRoomIndexResponse>, String> {
  let path = index_db_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || -> Result<Option<PersistedRoomIndexResponse>, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init_index_db(&conn).map_err(|e| e.to_string())?;
    load_room_index_from_conn(&conn, &room_id).map(Some)
  })
  .await
  .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_smart_collections(app: AppHandle, user_id: String) -> Result<Vec<SmartCollectionSummaryResponse>, String> {
  let path = index_db_path(&app)?;
  tauri::async_runtime::spawn_blocking(move || -> Result<Vec<SmartCollectionSummaryResponse>, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init_index_db(&conn).map_err(|e| e.to_string())?;
    compute_smart_collections(&conn, &user_id)
  })
  .await
  .map_err(|e| e.to_string())?
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
      upsert_index_records,
      query_local_index,
      load_room_index,
      get_smart_collections,
      deploy_matrix_server,
      test_ssh_connection
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
