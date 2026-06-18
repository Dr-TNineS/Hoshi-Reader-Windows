use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::dict::commands::{
    dictionary_manifest_path, load_dictionary_media, read_dictionary_manifest, DictionaryManifest,
};
#[cfg(test)]
use crate::dict::commands::DictionaryManifestEntry;

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8765";
const SETTINGS_VERSION: u32 = 1;
const TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiDeck {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNoteType {
    pub name: String,
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiFieldMapping {
    pub field: String,
    pub template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiAudioSource {
    pub name: String,
    pub url: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiSettings {
    pub version: u32,
    pub endpoint: String,
    pub selected_deck: Option<String>,
    pub selected_note_type: Option<String>,
    pub decks: Vec<AnkiDeck>,
    pub note_types: Vec<AnkiNoteType>,
    #[serde(default)]
    pub field_mappings: Vec<AnkiFieldMapping>,
    #[serde(default)]
    pub audio_enabled: bool,
    #[serde(default = "default_audio_sources")]
    pub audio_sources: Vec<AnkiAudioSource>,
    #[serde(default = "default_audio_download_timeout_ms")]
    pub audio_download_timeout_ms: u32,
    pub last_fetched_at: Option<u64>,
}

impl Default for AnkiSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            endpoint: DEFAULT_ENDPOINT.into(),
            selected_deck: None,
            selected_note_type: None,
            decks: Vec::new(),
            note_types: Vec::new(),
            field_mappings: Vec::new(),
            audio_enabled: false,
            audio_sources: default_audio_sources(),
            audio_download_timeout_ms: default_audio_download_timeout_ms(),
            last_fetched_at: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiConnectionStatus {
    pub ok: bool,
    pub message: String,
    pub version: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNoteRequest {
    pub endpoint: String,
    pub deck_name: String,
    pub model_name: String,
    pub fields: BTreeMap<String, String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiNoteCheckResult {
    pub can_add: bool,
    pub duplicate: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiAddNoteResult {
    pub status: String,
    pub note_id: Option<i64>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiDictionaryMediaRef {
    pub dictionary: String,
    pub path: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiStoredMedia {
    pub dictionary: String,
    pub path: String,
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiStoreMediaResult {
    pub stored: Vec<AnkiStoredMedia>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn anki_load_settings(app: AppHandle) -> Result<AnkiSettings, String> {
    let root = anki_root(&app)?;
    read_settings(&root)
}

#[tauri::command]
pub fn anki_save_settings(settings: AnkiSettings, app: AppHandle) -> Result<AnkiSettings, String> {
    let root = anki_root(&app)?;
    let mut next = normalize_settings(settings);
    normalize_endpoint(&next.endpoint)?;
    next.version = SETTINGS_VERSION;
    write_settings(&root, &next)?;
    Ok(next)
}

#[tauri::command]
pub fn anki_ping(endpoint: String) -> Result<AnkiConnectionStatus, String> {
    match anki_request(&endpoint, "version", None) {
        Ok(value) => Ok(AnkiConnectionStatus {
            ok: true,
            message: "Connected to AnkiConnect.".into(),
            version: value.as_u64(),
        }),
        Err(error) => Ok(AnkiConnectionStatus {
            ok: false,
            message: error,
            version: None,
        }),
    }
}

#[tauri::command]
pub fn anki_fetch_config(endpoint: String, app: AppHandle) -> Result<AnkiSettings, String> {
    let root = anki_root(&app)?;
    let current = read_settings(&root).unwrap_or_default();
    let endpoint = normalize_endpoint(&endpoint)?;
    let decks = fetch_decks(&endpoint)?;
    let note_types = fetch_note_types(&endpoint)?;
    if decks.is_empty() {
        return Err("AnkiConnect returned no decks.".into());
    }
    if note_types.is_empty() {
        return Err("AnkiConnect returned no note types.".into());
    }

    let selected_deck = current
        .selected_deck
        .filter(|name| decks.iter().any(|deck| deck.name == *name))
        .or_else(|| decks.first().map(|deck| deck.name.clone()));
    let selected_note_type = current
        .selected_note_type
        .filter(|name| note_types.iter().any(|note_type| note_type.name == *name))
        .or_else(|| note_types.first().map(|note_type| note_type.name.clone()));
    let field_mappings = retain_field_mappings_for_note_type(
        &current.field_mappings,
        selected_note_type.as_deref(),
        &note_types,
    );
    let next = normalize_settings(AnkiSettings {
        version: SETTINGS_VERSION,
        endpoint,
        selected_deck,
        selected_note_type,
        decks,
        note_types,
        field_mappings,
        audio_enabled: current.audio_enabled,
        audio_sources: current.audio_sources,
        audio_download_timeout_ms: current.audio_download_timeout_ms,
        last_fetched_at: Some(now_millis()?),
    });
    write_settings(&root, &next)?;
    Ok(next)
}

#[tauri::command]
pub fn anki_check_note(note: AnkiNoteRequest) -> Result<AnkiNoteCheckResult, String> {
    check_note(&note)
}

#[tauri::command]
pub fn anki_add_note(note: AnkiNoteRequest) -> Result<AnkiAddNoteResult, String> {
    let check = check_note(&note)?;
    if !check.can_add {
        return Ok(AnkiAddNoteResult {
            status: "duplicate".into(),
            note_id: None,
            message: check.message,
        });
    }

    let endpoint = normalize_endpoint(&note.endpoint)?;
    let result = anki_request(&endpoint, "addNote", Some(json!({ "note": note_json(&note)? })))?;
    let note_id = result
        .as_i64()
        .ok_or_else(|| "AnkiConnect addNote returned an unexpected response.".to_string())?;
    Ok(AnkiAddNoteResult {
        status: "added".into(),
        note_id: Some(note_id),
        message: format!("Added Anki note {note_id}."),
    })
}

#[tauri::command]
pub fn anki_store_dictionary_media(
    endpoint: String,
    media: Vec<AnkiDictionaryMediaRef>,
    app: AppHandle,
) -> Result<AnkiStoreMediaResult, String> {
    let manifest = read_dictionary_manifest(&dictionary_manifest_path(&app)?)?;
    store_dictionary_media_from_manifest(&endpoint, &manifest, &media)
}

fn anki_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("anki");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create Anki settings dir: {e}"))?;
    Ok(root)
}

fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

fn read_settings(root: &Path) -> Result<AnkiSettings, String> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(AnkiSettings::default());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read Anki settings: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse Anki settings: {e}"))
}

fn write_settings(root: &Path, settings: &AnkiSettings) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("Cannot create Anki settings dir: {e}"))?;
    let path = settings_path(root);
    let temp_path = root.join("settings.json.tmp");
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize Anki settings: {e}"))?;

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Cannot create temporary Anki settings: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Cannot write temporary Anki settings: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temporary Anki settings: {e}"))?;
    }

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot replace old Anki settings: {e}"))?;
    }
    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot replace Anki settings: {e}"))
}

fn normalize_settings(mut settings: AnkiSettings) -> AnkiSettings {
    if settings.endpoint.trim().is_empty() {
        settings.endpoint = DEFAULT_ENDPOINT.into();
    } else {
        settings.endpoint = settings.endpoint.trim().trim_end_matches('/').into();
    }
    settings.field_mappings = retain_field_mappings_for_note_type(
        &settings.field_mappings,
        settings.selected_note_type.as_deref(),
        &settings.note_types,
    );
    settings.audio_sources = normalize_audio_sources(settings.audio_sources);
    settings.audio_download_timeout_ms = settings.audio_download_timeout_ms.clamp(1000, 30000);
    settings
}

fn default_audio_sources() -> Vec<AnkiAudioSource> {
    vec![AnkiAudioSource {
        name: "Default".into(),
        url: String::new(),
        enabled: false,
    }]
}

fn default_audio_download_timeout_ms() -> u32 {
    5000
}

fn normalize_audio_sources(sources: Vec<AnkiAudioSource>) -> Vec<AnkiAudioSource> {
    let mut normalized: Vec<AnkiAudioSource> = sources
        .into_iter()
        .map(|source| AnkiAudioSource {
            name: source.name.trim().into(),
            url: source.url.trim().into(),
            enabled: source.enabled,
        })
        .filter(|source| !source.name.is_empty() || !source.url.is_empty())
        .collect();
    if normalized.is_empty() {
        normalized = default_audio_sources();
    }
    normalized
}

fn retain_field_mappings_for_note_type(
    mappings: &[AnkiFieldMapping],
    selected_note_type: Option<&str>,
    note_types: &[AnkiNoteType],
) -> Vec<AnkiFieldMapping> {
    let Some(selected_note_type) = selected_note_type else {
        return Vec::new();
    };
    let Some(note_type) = note_types.iter().find(|note_type| note_type.name == selected_note_type) else {
        return Vec::new();
    };
    mappings
        .iter()
        .filter(|mapping| note_type.fields.iter().any(|field| field == &mapping.field))
        .cloned()
        .collect()
}

fn check_note(note: &AnkiNoteRequest) -> Result<AnkiNoteCheckResult, String> {
    let endpoint = normalize_endpoint(&note.endpoint)?;
    let result = anki_request(
        &endpoint,
        "canAddNotesWithErrorDetail",
        Some(json!({ "notes": [note_json(note)?] })),
    )?;
    parse_note_check_result(result)
}

fn parse_note_check_result(result: Value) -> Result<AnkiNoteCheckResult, String> {
    let first = result
        .as_array()
        .and_then(|items| items.first())
        .ok_or_else(|| "AnkiConnect duplicate check returned an unexpected response.".to_string())?;
    let can_add = first
        .get("canAdd")
        .and_then(Value::as_bool)
        .ok_or_else(|| "AnkiConnect duplicate check did not include canAdd.".to_string())?;
    let error = first.get("error").and_then(Value::as_str).unwrap_or("").trim();
    if can_add {
        return Ok(AnkiNoteCheckResult {
            can_add: true,
            duplicate: false,
            message: "Anki note can be added.".into(),
        });
    }
    Ok(AnkiNoteCheckResult {
        can_add: false,
        duplicate: true,
        message: if error.is_empty() {
            "Anki reported this note cannot be added.".into()
        } else {
            error.into()
        },
    })
}

fn note_json(note: &AnkiNoteRequest) -> Result<Value, String> {
    normalize_endpoint(&note.endpoint)?;
    if note.deck_name.trim().is_empty() {
        return Err("Anki deck is not configured.".into());
    }
    if note.model_name.trim().is_empty() {
        return Err("Anki note type is not configured.".into());
    }
    if note.fields.is_empty() {
        return Err("Anki note fields are empty.".into());
    }
    if note.fields.keys().any(|field| field.trim().is_empty()) {
        return Err("Anki note contains an empty field name.".into());
    }
    Ok(json!({
        "deckName": note.deck_name.trim(),
        "modelName": note.model_name.trim(),
        "fields": note.fields,
        "tags": note.tags,
        "options": {
            "allowDuplicate": false,
        },
    }))
}

fn store_dictionary_media_from_manifest(
    endpoint: &str,
    manifest: &DictionaryManifest,
    media: &[AnkiDictionaryMediaRef],
) -> Result<AnkiStoreMediaResult, String> {
    let endpoint = normalize_endpoint(endpoint)?;
    let mut stored = Vec::new();
    let mut warnings = Vec::new();
    for item in media {
        let filename = validate_anki_media_filename(&item.filename)?;
        match load_dictionary_media(manifest, &item.dictionary, &item.path) {
            Ok(resource) => {
                anki_request(
                    &endpoint,
                    "storeMediaFile",
                    Some(json!({
                        "filename": filename,
                        "data": resource.data_base64,
                    })),
                )?;
                stored.push(AnkiStoredMedia {
                    dictionary: item.dictionary.clone(),
                    path: item.path.clone(),
                    filename,
                });
            }
            Err(error) if is_nonfatal_media_missing(&error) => {
                warnings.push(format!(
                    "{} / {}: {}",
                    item.dictionary, item.path, error
                ));
            }
            Err(error) => return Err(error),
        }
    }
    Ok(AnkiStoreMediaResult { stored, warnings })
}

fn validate_anki_media_filename(filename: &str) -> Result<String, String> {
    let filename = filename.trim();
    if filename.is_empty() {
        return Err("Anki media filename is empty.".into());
    }
    if filename.contains('/')
        || filename.contains('\\')
        || filename.contains(':')
        || filename == "."
        || filename == ".."
        || filename.contains("..")
    {
        return Err("Anki media filename must be a plain file name.".into());
    }
    Ok(filename.into())
}

fn is_nonfatal_media_missing(error: &str) -> bool {
    error.starts_with("Dictionary media not found:") || error.starts_with("Dictionary not found for media request:")
}

fn fetch_decks(endpoint: &str) -> Result<Vec<AnkiDeck>, String> {
    let result = anki_request(endpoint, "deckNames", None)?;
    let names = result
        .as_array()
        .ok_or_else(|| "AnkiConnect deckNames returned an unexpected response.".to_string())?;
    Ok(names
        .iter()
        .filter_map(|value| value.as_str())
        .map(|name| AnkiDeck { name: name.into() })
        .collect())
}

fn fetch_note_types(endpoint: &str) -> Result<Vec<AnkiNoteType>, String> {
    let result = anki_request(endpoint, "modelNames", None)?;
    let names = result
        .as_array()
        .ok_or_else(|| "AnkiConnect modelNames returned an unexpected response.".to_string())?;
    let mut note_types = Vec::new();
    for name in names.iter().filter_map(|value| value.as_str()) {
        let fields = fetch_note_type_fields(endpoint, name)?;
        note_types.push(AnkiNoteType {
            name: name.into(),
            fields,
        });
    }
    Ok(note_types)
}

fn fetch_note_type_fields(endpoint: &str, model_name: &str) -> Result<Vec<String>, String> {
    let result = anki_request(
        endpoint,
        "modelFieldNames",
        Some(json!({ "modelName": model_name })),
    )?;
    let fields = result
        .as_array()
        .ok_or_else(|| "AnkiConnect modelFieldNames returned an unexpected response.".to_string())?;
    Ok(fields
        .iter()
        .filter_map(|value| value.as_str())
        .map(str::to_string)
        .collect())
}

fn anki_request(endpoint: &str, action: &str, params: Option<Value>) -> Result<Value, String> {
    let endpoint = parse_http_endpoint(endpoint)?;
    let mut body = json!({
        "action": action,
        "version": 6,
    });
    if let Some(params) = params {
        body["params"] = params;
    }
    let body = body.to_string();
    let response = http_post_json(&endpoint, &body)?;
    let json: Value = serde_json::from_str(&response)
        .map_err(|e| format!("Cannot parse AnkiConnect response: {e}"))?;
    if !json.get("error").unwrap_or(&Value::Null).is_null() {
        return Err(format!(
            "AnkiConnect error: {}",
            json.get("error").and_then(Value::as_str).unwrap_or("unknown error")
        ));
    }
    Ok(json.get("result").cloned().unwrap_or(Value::Null))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct HttpEndpoint {
    host: String,
    port: u16,
    path: String,
}

fn normalize_endpoint(endpoint: &str) -> Result<String, String> {
    let endpoint = parse_http_endpoint(endpoint)?;
    let path = if endpoint.path == "/" {
        String::new()
    } else {
        endpoint.path
    };
    Ok(format!("http://{}:{}{}", endpoint.host, endpoint.port, path))
}

fn parse_http_endpoint(endpoint: &str) -> Result<HttpEndpoint, String> {
    let trimmed = endpoint.trim().trim_end_matches('/');
    let raw = if trimmed.is_empty() {
        DEFAULT_ENDPOINT
    } else {
        trimmed
    };
    let rest = raw
        .strip_prefix("http://")
        .ok_or_else(|| "AnkiConnect endpoint must start with http://.".to_string())?;
    let (host_port, path) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = match host_port.split_once(':') {
        Some((host, port)) => {
            let port = port
                .parse::<u16>()
                .map_err(|_| "AnkiConnect endpoint port must be a number.".to_string())?;
            (host, port)
        }
        None => (host_port, 80),
    };
    if !matches!(host, "127.0.0.1" | "localhost") {
        return Err("AnkiConnect endpoint must use localhost or 127.0.0.1.".into());
    }
    Ok(HttpEndpoint {
        host: host.into(),
        port,
        path: format!("/{}", path.trim_start_matches('/')),
    })
}

fn http_post_json(endpoint: &HttpEndpoint, body: &str) -> Result<String, String> {
    let address = format!("{}:{}", endpoint.host, endpoint.port);
    let socket = address
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve AnkiConnect endpoint: {e}"))?
        .next()
        .ok_or_else(|| "Cannot resolve AnkiConnect endpoint.".to_string())?;
    let mut stream = TcpStream::connect_timeout(&socket, TIMEOUT)
        .map_err(|e| format!("Cannot connect to AnkiConnect at {address}: {e}"))?;
    stream
        .set_read_timeout(Some(TIMEOUT))
        .map_err(|e| format!("Cannot set AnkiConnect read timeout: {e}"))?;
    stream
        .set_write_timeout(Some(TIMEOUT))
        .map_err(|e| format!("Cannot set AnkiConnect write timeout: {e}"))?;

    let request = format!(
        "POST {} HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        endpoint.path,
        address,
        body.len(),
        body
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| format!("Cannot write AnkiConnect request: {e}"))?;

    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| format!("Cannot read AnkiConnect response: {e}"))?;
    let (head, body) = response
        .split_once("\r\n\r\n")
        .ok_or_else(|| "AnkiConnect returned an invalid HTTP response.".to_string())?;
    if !head.starts_with("HTTP/1.1 200") && !head.starts_with("HTTP/1.0 200") {
        let status = head.lines().next().unwrap_or("HTTP error");
        return Err(format!("AnkiConnect HTTP request failed: {status}"));
    }
    Ok(body.into())
}

fn now_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|e| format!("Cannot read system time: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hoshi_anki_settings_{name}_{}",
            now_millis().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn missing_settings_returns_default_endpoint() {
        let root = temp_root("missing");
        let settings = read_settings(&root).unwrap();
        assert_eq!(settings.endpoint, DEFAULT_ENDPOINT);
        assert!(settings.decks.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_settings_returns_clear_error() {
        let root = temp_root("corrupt");
        fs::write(settings_path(&root), "not json").unwrap();
        let error = read_settings(&root).unwrap_err();
        assert!(error.contains("Cannot parse Anki settings"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn writes_settings_atomically() {
        let root = temp_root("write");
        let settings = AnkiSettings {
            selected_deck: Some("Mining".into()),
            decks: vec![AnkiDeck {
                name: "Mining".into(),
            }],
            ..AnkiSettings::default()
        };
        write_settings(&root, &settings).unwrap();
        let loaded = read_settings(&root).unwrap();
        assert_eq!(loaded.selected_deck.as_deref(), Some("Mining"));
        assert!(!root.join("settings.json.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_field_mappings_in_old_settings_defaults_empty() {
        let root = temp_root("legacy_mapping");
        fs::write(
            settings_path(&root),
            r#"{
              "version": 1,
              "endpoint": "http://127.0.0.1:8765",
              "selectedDeck": null,
              "selectedNoteType": null,
              "decks": [],
              "noteTypes": [],
              "lastFetchedAt": null
            }"#,
        )
        .unwrap();
        let loaded = read_settings(&root).unwrap();
        assert!(loaded.field_mappings.is_empty());
        assert!(!loaded.audio_enabled);
        assert_eq!(loaded.audio_sources, default_audio_sources());
        assert_eq!(loaded.audio_download_timeout_ms, default_audio_download_timeout_ms());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn normalize_settings_prunes_field_mappings_to_selected_note_type() {
        let settings = AnkiSettings {
            selected_note_type: Some("Basic".into()),
            note_types: vec![AnkiNoteType {
                name: "Basic".into(),
                fields: vec!["Front".into()],
            }],
            field_mappings: vec![
                AnkiFieldMapping {
                    field: "Front".into(),
                    template: "{expression}".into(),
                },
                AnkiFieldMapping {
                    field: "Back".into(),
                    template: "{glossary}".into(),
                },
            ],
            ..AnkiSettings::default()
        };
        let normalized = normalize_settings(settings);
        assert_eq!(normalized.field_mappings.len(), 1);
        assert_eq!(normalized.field_mappings[0].field, "Front");
    }

    #[test]
    fn normalize_settings_trims_audio_sources_and_clamps_timeout() {
        let settings = AnkiSettings {
            audio_enabled: true,
            audio_sources: vec![AnkiAudioSource {
                name: " Probe ".into(),
                url: " https://example.invalid/audio?term={term} ".into(),
                enabled: true,
            }],
            audio_download_timeout_ms: 999_999,
            ..AnkiSettings::default()
        };
        let normalized = normalize_settings(settings);
        assert!(normalized.audio_enabled);
        assert_eq!(normalized.audio_sources[0].name, "Probe");
        assert_eq!(
            normalized.audio_sources[0].url,
            "https://example.invalid/audio?term={term}"
        );
        assert_eq!(normalized.audio_sources[0].enabled, true);
        assert_eq!(normalized.audio_download_timeout_ms, 30000);
    }

    #[test]
    fn parses_and_restricts_ankiconnect_endpoint() {
        assert_eq!(
            normalize_endpoint("http://127.0.0.1:8765/").unwrap(),
            "http://127.0.0.1:8765"
        );
        assert_eq!(
            normalize_endpoint("http://localhost:8765/api").unwrap(),
            "http://localhost:8765/api"
        );
        assert!(normalize_endpoint("https://127.0.0.1:8765").is_err());
        assert!(normalize_endpoint("http://example.com:8765").is_err());
        assert!(normalize_endpoint("http://127.0.0.1:notaport").is_err());
    }

    #[test]
    fn note_json_requires_configured_note_shape() {
        let mut fields = BTreeMap::new();
        fields.insert("Expression".into(), "学校".into());
        let note = AnkiNoteRequest {
            endpoint: DEFAULT_ENDPOINT.into(),
            deck_name: "Mining".into(),
            model_name: "Basic".into(),
            fields,
            tags: vec!["hoshi-reader".into()],
        };
        let value = note_json(&note).unwrap();
        assert_eq!(value["deckName"], "Mining");
        assert_eq!(value["modelName"], "Basic");
        assert_eq!(value["fields"]["Expression"], "学校");
        assert_eq!(value["tags"][0], "hoshi-reader");
        assert_eq!(value["options"]["allowDuplicate"], false);

        let missing_deck = AnkiNoteRequest {
            deck_name: "".into(),
            ..note.clone()
        };
        assert!(note_json(&missing_deck).unwrap_err().contains("deck"));
        let empty_fields = AnkiNoteRequest {
            fields: BTreeMap::new(),
            ..note
        };
        assert!(note_json(&empty_fields).unwrap_err().contains("fields"));
    }

    #[test]
    fn parses_duplicate_check_response() {
        let can_add = parse_note_check_result(json!([{ "canAdd": true, "error": null }])).unwrap();
        assert!(can_add.can_add);
        assert!(!can_add.duplicate);

        let duplicate = parse_note_check_result(json!([{ "canAdd": false, "error": "cannot create note because it is a duplicate" }])).unwrap();
        assert!(!duplicate.can_add);
        assert!(duplicate.duplicate);
        assert!(duplicate.message.contains("duplicate"));

        assert!(parse_note_check_result(json!({ "bad": true })).is_err());
    }

    fn test_manifest(root: &Path) -> DictionaryManifest {
        DictionaryManifest {
            dictionaries: vec![DictionaryManifestEntry {
                dict_id: "dict:term".into(),
                import_id: "dict".into(),
                title: "Readable Dict".into(),
                kind: "term".into(),
                role: "term".into(),
                enabled: true,
                order: 0,
                internal_path: root.to_string_lossy().into_owned(),
                term_count: 1,
                meta_count: 0,
                freq_count: 0,
                pitch_count: 0,
                media_count: 1,
                last_imported: 1,
            }],
        }
    }

    #[test]
    fn validates_anki_media_filename() {
        assert_eq!(
            validate_anki_media_filename(" hsw_1234.png ").unwrap(),
            "hsw_1234.png"
        );
        assert!(validate_anki_media_filename("").is_err());
        assert!(validate_anki_media_filename("../x.png").is_err());
        assert!(validate_anki_media_filename("nested/x.png").is_err());
        assert!(validate_anki_media_filename("C:\\x.png").is_err());
    }

    #[test]
    fn store_dictionary_media_reports_missing_as_warning() {
        let root = temp_root("store_media_missing");
        let manifest = test_manifest(&root);
        let refs = vec![AnkiDictionaryMediaRef {
            dictionary: "dict".into(),
            path: "missing.png".into(),
            filename: "hsw_missing.png".into(),
        }];
        let result = store_dictionary_media_from_manifest(DEFAULT_ENDPOINT, &manifest, &refs).unwrap();
        assert!(result.stored.is_empty());
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("Dictionary media not found"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn store_dictionary_media_blocks_invalid_paths_before_ankiconnect() {
        let root = temp_root("store_media_escape");
        let media_dir = root.join("images");
        fs::create_dir_all(&media_dir).unwrap();
        fs::write(media_dir.join("entry.txt"), b"text").unwrap();
        let manifest = test_manifest(&root);
        let refs = vec![AnkiDictionaryMediaRef {
            dictionary: "dict".into(),
            path: "images/entry.txt".into(),
            filename: "hsw_entry.txt".into(),
        }];
        let error = store_dictionary_media_from_manifest(DEFAULT_ENDPOINT, &manifest, &refs).unwrap_err();
        assert!(error.starts_with("Unsupported dictionary media type:"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore]
    fn validates_real_ankiconnect_add_note_and_duplicate_check() {
        if std::env::var("HSW_ANKI_RUNTIME_VALIDATE").ok().as_deref() != Some("1") {
            eprintln!("Set HSW_ANKI_RUNTIME_VALIDATE=1 to run the real AnkiConnect add-note validation.");
            return;
        }

        let endpoint = std::env::var("HSW_ANKI_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
        let suffix = now_millis().unwrap();
        let deck_name = format!("HSW Runtime Validation {suffix}");
        let model_name = format!("HSW Runtime Model {suffix}");
        let expression = format!("hoshi-runtime-{suffix}");

        anki_request(&endpoint, "createDeck", Some(json!({ "deck": deck_name }))).unwrap();
        anki_request(
            &endpoint,
            "createModel",
            Some(json!({
                "modelName": model_name,
                "inOrderFields": ["Expression", "Meaning"],
                "css": ".card { font-family: arial; }",
                "cardTemplates": [{
                    "Name": "Card 1",
                    "Front": "{{Expression}}",
                    "Back": "{{Meaning}}"
                }]
            })),
        )
        .unwrap();

        let mut fields = BTreeMap::new();
        fields.insert("Expression".into(), expression);
        fields.insert("Meaning".into(), "Created by HSW runtime validation.".into());
        let note = AnkiNoteRequest {
            endpoint: endpoint.clone(),
            deck_name: deck_name.clone(),
            model_name: model_name.clone(),
            fields,
            tags: vec!["hoshi-reader-runtime-validation".into()],
        };

        let added = anki_add_note(note.clone()).unwrap();
        assert_eq!(added.status, "added");
        assert!(added.note_id.is_some());

        let duplicate = anki_add_note(note).unwrap();
        assert_eq!(duplicate.status, "duplicate");
        assert!(duplicate.message.to_lowercase().contains("duplicate"));

        let _ = anki_request(
            &endpoint,
            "deleteDecks",
            Some(json!({ "decks": [deck_name], "cardsToo": true })),
        );
        let _ = anki_request(&endpoint, "deleteModel", Some(json!({ "modelName": model_name })));
    }

    #[test]
    #[ignore]
    fn validates_real_ankiconnect_store_dictionary_media() {
        if std::env::var("HSW_ANKI_RUNTIME_VALIDATE").ok().as_deref() != Some("1") {
            eprintln!("Set HSW_ANKI_RUNTIME_VALIDATE=1 to run the real AnkiConnect media validation.");
            return;
        }

        let endpoint = std::env::var("HSW_ANKI_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
        let suffix = now_millis().unwrap();
        let filename = format!("hsw_runtime_{suffix}.svg");
        let root = temp_root("store_media_runtime");
        let media_dir = root.join("images");
        fs::create_dir_all(&media_dir).unwrap();
        fs::write(
            media_dir.join("entry.svg"),
            br#"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"></svg>"#,
        )
        .unwrap();

        let manifest = test_manifest(&root);
        let refs = vec![AnkiDictionaryMediaRef {
            dictionary: "dict".into(),
            path: "images/entry.svg".into(),
            filename: filename.clone(),
        }];
        let result = store_dictionary_media_from_manifest(&endpoint, &manifest, &refs).unwrap();
        assert_eq!(result.stored.len(), 1);
        assert!(result.warnings.is_empty());

        let retrieved = anki_request(
            &endpoint,
            "retrieveMediaFile",
            Some(json!({ "filename": filename })),
        )
        .unwrap();
        assert!(retrieved.as_str().unwrap_or("").contains("PHN2Zy"));

        let _ = anki_request(
            &endpoint,
            "deleteMediaFile",
            Some(json!({ "filename": result.stored[0].filename.clone() })),
        );
        let _ = fs::remove_dir_all(root);
    }
}
