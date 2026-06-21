use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use reqwest::blocking::{Client, Response};
use reqwest::header::{CONTENT_LENGTH, CONTENT_TYPE, LOCATION};
use reqwest::redirect::Policy;
use reqwest::{StatusCode, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[cfg(test)]
use crate::dict::commands::DictionaryManifestEntry;
use crate::dict::commands::{
    dictionary_manifest_path, load_dictionary_media, read_dictionary_manifest, DictionaryManifest,
};
use crate::library::library_cover_path;

const DEFAULT_ENDPOINT: &str = "http://127.0.0.1:8765";
const SETTINGS_VERSION: u32 = 2;
const TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REMOTE_AUDIO_BYTES: usize = 10 * 1024 * 1024;
const MAX_REMOTE_AUDIO_REDIRECTS: usize = 3;
const MAX_BOOK_COVER_BYTES: usize = 10 * 1024 * 1024;

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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AnkiDuplicateScope {
    #[default]
    Collection,
    Deck,
    DeckRoot,
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
    #[serde(default)]
    pub local_audio_enabled: bool,
    #[serde(default = "default_audio_sources")]
    pub audio_sources: Vec<AnkiAudioSource>,
    #[serde(default = "default_audio_download_timeout_ms")]
    pub audio_download_timeout_ms: u32,
    #[serde(default)]
    pub force_sync_after_add: bool,
    #[serde(default = "default_anki_tags")]
    pub tags: String,
    #[serde(default)]
    pub allow_duplicates: bool,
    #[serde(default)]
    pub check_duplicates_across_all_models: bool,
    #[serde(default)]
    pub duplicate_scope: AnkiDuplicateScope,
    #[serde(default)]
    pub compact_glossaries: bool,
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
            local_audio_enabled: false,
            audio_sources: default_audio_sources(),
            audio_download_timeout_ms: default_audio_download_timeout_ms(),
            force_sync_after_add: false,
            tags: default_anki_tags(),
            allow_duplicates: false,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Collection,
            compact_glossaries: false,
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
    #[serde(default)]
    pub force_sync_after_add: bool,
    #[serde(default)]
    pub allow_duplicates: bool,
    #[serde(default)]
    pub check_duplicates_across_all_models: bool,
    #[serde(default)]
    pub duplicate_scope: AnkiDuplicateScope,
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
    pub warnings: Vec<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiRemoteAudioRequest {
    pub source_name: String,
    pub url_template: String,
    pub expression: String,
    pub reading: String,
    pub timeout_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiStoreRemoteAudioResult {
    pub filename: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnkiStoreBookCoverResult {
    pub filename: Option<String>,
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
        local_audio_enabled: current.local_audio_enabled,
        audio_sources: current.audio_sources,
        audio_download_timeout_ms: current.audio_download_timeout_ms,
        force_sync_after_add: current.force_sync_after_add,
        tags: current.tags,
        allow_duplicates: current.allow_duplicates,
        check_duplicates_across_all_models: current.check_duplicates_across_all_models,
        duplicate_scope: current.duplicate_scope,
        compact_glossaries: current.compact_glossaries,
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
    add_note_with_request(&note, anki_request)
}

fn add_note_with_request<F>(
    note: &AnkiNoteRequest,
    mut request: F,
) -> Result<AnkiAddNoteResult, String>
where
    F: FnMut(&str, &str, Option<Value>) -> Result<Value, String>,
{
    let endpoint = normalize_endpoint(&note.endpoint)?;
    if !note.allow_duplicates {
        let check = parse_note_check_result(request(
            &endpoint,
            "canAddNotesWithErrorDetail",
            Some(json!({ "notes": [note_json(note)?] })),
        )?)?;
        if !check.can_add {
            return Ok(AnkiAddNoteResult {
                status: "duplicate".into(),
                note_id: None,
                message: check.message,
                warnings: Vec::new(),
            });
        }
    }

    let result = request(
        &endpoint,
        "addNote",
        Some(json!({ "note": note_json(&note)? })),
    )?;
    let note_id = result
        .as_i64()
        .ok_or_else(|| "AnkiConnect addNote returned an unexpected response.".to_string())?;
    let mut warnings = Vec::new();
    if note.force_sync_after_add {
        if let Err(error) = request(&endpoint, "sync", None) {
            warnings.push(format!("Anki sync failed: {error}"));
        }
    }
    Ok(AnkiAddNoteResult {
        status: "added".into(),
        note_id: Some(note_id),
        message: format!("Added Anki note {note_id}."),
        warnings,
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

#[tauri::command]
pub fn anki_store_remote_audio(
    endpoint: String,
    request: AnkiRemoteAudioRequest,
) -> Result<AnkiStoreRemoteAudioResult, String> {
    let endpoint = normalize_endpoint(&endpoint)?;
    let Some(download) = download_remote_audio(&request)? else {
        return Ok(AnkiStoreRemoteAudioResult {
            filename: None,
            warnings: vec![remote_audio_warning(
                &request.source_name,
                "No audio was returned.",
            )],
        });
    };
    if let Some(warning) = download.warning {
        return Ok(AnkiStoreRemoteAudioResult {
            filename: None,
            warnings: vec![remote_audio_warning(&request.source_name, &warning)],
        });
    }
    let Some(bytes) = download.bytes else {
        return Ok(AnkiStoreRemoteAudioResult {
            filename: None,
            warnings: vec![remote_audio_warning(
                &request.source_name,
                "No audio was returned.",
            )],
        });
    };
    let Some(extension) = detect_audio_extension(
        &bytes,
        download.content_type.as_deref(),
        download.final_url.path(),
    ) else {
        return Ok(AnkiStoreRemoteAudioResult {
            filename: None,
            warnings: vec![remote_audio_warning(
                &request.source_name,
                "The response was not a supported MP3, OGG/Opus, WAV, M4A, or AAC file.",
            )],
        });
    };
    let stored_filename = store_audio_bytes(&endpoint, &bytes, extension)?;
    Ok(AnkiStoreRemoteAudioResult {
        filename: Some(stored_filename),
        warnings: Vec::new(),
    })
}

#[tauri::command]
pub fn anki_store_book_cover(
    endpoint: String,
    book_id: String,
    app: AppHandle,
) -> Result<AnkiStoreBookCoverResult, String> {
    let cover = match library_cover_path(&app, &book_id) {
        Ok(Some(path)) => path,
        Ok(None) => {
            return Ok(AnkiStoreBookCoverResult {
                filename: None,
                warnings: vec!["Book cover is not available.".into()],
            })
        }
        Err(error) if error.starts_with("Library book not found:") => {
            return Ok(AnkiStoreBookCoverResult {
                filename: None,
                warnings: vec![error],
            })
        }
        Err(error) => return Err(error),
    };
    store_book_cover_from_path(&endpoint, &cover, anki_request)
}

fn store_book_cover_from_path<F>(
    endpoint: &str,
    cover: &Path,
    mut request: F,
) -> Result<AnkiStoreBookCoverResult, String>
where
    F: FnMut(&str, &str, Option<Value>) -> Result<Value, String>,
{
    let endpoint = normalize_endpoint(endpoint)?;
    let Some(hint) = cover_extension_hint(cover) else {
        return Ok(AnkiStoreBookCoverResult {
            filename: None,
            warnings: vec!["Book cover is not a supported JPEG, PNG, GIF, or WebP image.".into()],
        });
    };
    let size = fs::metadata(cover)
        .map_err(|e| format!("Cannot read book cover metadata: {e}"))?
        .len();
    if size > MAX_BOOK_COVER_BYTES as u64 {
        return Err("Book cover exceeds the 10 MiB limit.".into());
    }
    let mut bytes = Vec::with_capacity(size as usize);
    fs::File::open(cover)
        .map_err(|e| format!("Cannot open book cover: {e}"))?
        .take((MAX_BOOK_COVER_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read book cover: {e}"))?;
    if bytes.len() > MAX_BOOK_COVER_BYTES {
        return Err("Book cover exceeds the 10 MiB limit.".into());
    }
    if bytes.is_empty() {
        return Ok(AnkiStoreBookCoverResult {
            filename: None,
            warnings: vec!["Book cover is empty.".into()],
        });
    }
    let detected = detect_book_cover_extension(&bytes).ok_or_else(|| {
        "Book cover signature does not match a supported image format.".to_string()
    })?;
    if detected != hint {
        return Err("Book cover extension does not match its file signature.".into());
    }
    let digest = Sha256::digest(&bytes);
    let hash = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let filename = format!("hsw_cover_{hash}.{detected}");
    let stored = request(
        &endpoint,
        "storeMediaFile",
        Some(json!({
            "filename": filename,
            "data": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        })),
    )?
    .as_str()
    .ok_or_else(|| "AnkiConnect storeMediaFile returned an unexpected response.".to_string())?
    .to_string();
    Ok(AnkiStoreBookCoverResult {
        filename: Some(validate_anki_media_filename(&stored)?),
        warnings: Vec::new(),
    })
}

fn cover_extension_hint(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("jpg"),
        "png" => Some("png"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        _ => None,
    }
}

fn detect_book_cover_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

pub(crate) fn store_audio_bytes(
    endpoint: &str,
    bytes: &[u8],
    extension: &str,
) -> Result<String, String> {
    let endpoint = normalize_endpoint(endpoint)?;
    ensure_remote_audio_size(bytes.len())?;
    let filename = remote_audio_filename(bytes, extension);
    let stored_filename = anki_request(
        &endpoint,
        "storeMediaFile",
        Some(json!({
            "filename": filename,
            "data": base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes),
        })),
    )?
    .as_str()
    .ok_or_else(|| "AnkiConnect storeMediaFile returned an unexpected response.".to_string())?
    .to_string();
    validate_anki_media_filename(&stored_filename)
}

#[derive(Debug)]
struct RemoteAudioDownload {
    bytes: Option<Vec<u8>>,
    content_type: Option<String>,
    final_url: Url,
    warning: Option<String>,
}

fn download_remote_audio(
    request: &AnkiRemoteAudioRequest,
) -> Result<Option<RemoteAudioDownload>, String> {
    let expanded = match expand_audio_url_template(
        &request.url_template,
        &request.expression,
        &request.reading,
    ) {
        Ok(expanded) => expanded,
        Err(warning) => {
            return Ok(Some(RemoteAudioDownload {
                bytes: None,
                content_type: None,
                final_url: Url::parse("https://invalid.invalid/").expect("static URL"),
                warning: Some(warning),
            }))
        }
    };
    let mut current = match Url::parse(&expanded) {
        Ok(url) => url,
        Err(error) => {
            return Ok(Some(RemoteAudioDownload {
                bytes: None,
                content_type: None,
                final_url: Url::parse("https://invalid.invalid/").expect("static URL"),
                warning: Some(format!("The expanded audio URL is invalid: {error}")),
            }))
        }
    };
    let timeout = remote_audio_timeout(request.timeout_ms);

    for redirect_count in 0..=MAX_REMOTE_AUDIO_REDIRECTS {
        let target = match validate_remote_audio_url(&current) {
            Ok(target) => target,
            Err(error)
                if error.starts_with("Cannot resolve remote audio host:")
                    || error == "Remote audio host resolved to no addresses." =>
            {
                return Ok(Some(RemoteAudioDownload {
                    bytes: None,
                    content_type: None,
                    final_url: current,
                    warning: Some(error),
                }))
            }
            Err(error) => return Err(error),
        };
        let client = match Client::builder()
            .redirect(Policy::none())
            .connect_timeout(timeout)
            .timeout(timeout)
            .resolve(&target.host, target.address)
            .build()
        {
            Ok(client) => client,
            Err(error) => {
                return Ok(Some(RemoteAudioDownload {
                    bytes: None,
                    content_type: None,
                    final_url: current,
                    warning: Some(format!("Cannot build remote audio client: {error}")),
                }))
            }
        };
        let response = match client.get(current.clone()).send() {
            Ok(response) => response,
            Err(error) => {
                return Ok(Some(RemoteAudioDownload {
                    bytes: None,
                    content_type: None,
                    final_url: current,
                    warning: Some(format!("Remote audio request failed: {error}")),
                }))
            }
        };

        if response.status().is_redirection() {
            ensure_remote_audio_redirect_allowed(redirect_count)?;
            let Some(location) = response.headers().get(LOCATION) else {
                return Ok(Some(RemoteAudioDownload {
                    bytes: None,
                    content_type: None,
                    final_url: current,
                    warning: Some(
                        "Remote audio redirect did not include a Location header.".into(),
                    ),
                }));
            };
            let location = match location.to_str() {
                Ok(location) => location,
                Err(_) => {
                    return Ok(Some(RemoteAudioDownload {
                        bytes: None,
                        content_type: None,
                        final_url: current,
                        warning: Some(
                            "Remote audio redirect included an invalid Location header.".into(),
                        ),
                    }))
                }
            };
            current = match current.join(location) {
                Ok(url) => url,
                Err(error) => {
                    return Ok(Some(RemoteAudioDownload {
                        bytes: None,
                        content_type: None,
                        final_url: current,
                        warning: Some(format!("Remote audio redirect URL is invalid: {error}")),
                    }))
                }
            };
            continue;
        }
        return read_remote_audio_response(response, current);
    }
    unreachable!("redirect loop always returns")
}

fn expand_audio_url_template(
    template: &str,
    expression: &str,
    reading: &str,
) -> Result<String, String> {
    let template = template.trim();
    if template.is_empty() {
        return Err("The audio URL template is empty.".into());
    }
    let term = utf8_percent_encode(expression.trim(), NON_ALPHANUMERIC).to_string();
    let reading = utf8_percent_encode(reading.trim(), NON_ALPHANUMERIC).to_string();
    let expanded = template
        .replace("{term}", &term)
        .replace("{reading}", &reading);
    if expanded.contains('{') || expanded.contains('}') {
        return Err("The audio URL template contains an unknown or incomplete placeholder.".into());
    }
    Ok(expanded)
}

fn remote_audio_timeout(timeout_ms: u32) -> Duration {
    Duration::from_millis(timeout_ms.clamp(1000, 30000) as u64)
}

fn ensure_remote_audio_redirect_allowed(completed_redirects: usize) -> Result<(), String> {
    if completed_redirects >= MAX_REMOTE_AUDIO_REDIRECTS {
        return Err(format!(
            "Remote audio exceeded the limit of {MAX_REMOTE_AUDIO_REDIRECTS} redirects."
        ));
    }
    Ok(())
}

#[derive(Debug)]
struct ResolvedRemoteTarget {
    host: String,
    address: SocketAddr,
}

fn validate_remote_audio_url(url: &Url) -> Result<ResolvedRemoteTarget, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Remote audio URL must use HTTP or HTTPS.".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Remote audio URL must not contain credentials.".into());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "Remote audio URL must include a host.".to_string())?;
    if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") {
        return Err("Remote audio URL must not target localhost.".into());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Remote audio URL has no usable port.".to_string())?;
    let addresses: Vec<SocketAddr> = (host, port)
        .to_socket_addrs()
        .map_err(|error| format!("Cannot resolve remote audio host: {error}"))?
        .collect();
    if addresses.is_empty() {
        return Err("Remote audio host resolved to no addresses.".into());
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err("Remote audio URL resolved to a private, local, or reserved address.".into());
    }
    Ok(ResolvedRemoteTarget {
        host: host.into(),
        address: addresses[0],
    })
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_multicast()
        || ip.is_broadcast()
        || ip.is_documentation()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0)
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && matches!(b, 18 | 19))
        || a >= 240)
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_public_ipv4(ipv4);
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xffc0) == 0xfec0
        || (segments[0] & 0xe000) != 0x2000
        || (segments[0] == 0x2001 && (segments[1] <= 0x01ff || segments[1] == 0x0db8)))
}

fn read_remote_audio_response(
    mut response: Response,
    final_url: Url,
) -> Result<Option<RemoteAudioDownload>, String> {
    let status = response.status();
    if let Some(warning) = remote_audio_status_warning(status) {
        return Ok(Some(RemoteAudioDownload {
            bytes: None,
            content_type: None,
            final_url,
            warning: Some(warning),
        }));
    }
    if let Some(length) = response
        .headers()
        .get(CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
    {
        ensure_remote_audio_size(length as usize)?;
    }
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mut bytes = Vec::new();
    if let Err(error) = response
        .by_ref()
        .take((MAX_REMOTE_AUDIO_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
    {
        return Ok(Some(RemoteAudioDownload {
            bytes: None,
            content_type,
            final_url,
            warning: Some(format!("Cannot read remote audio response: {error}")),
        }));
    }
    ensure_remote_audio_size(bytes.len())?;
    if bytes.is_empty() {
        return Ok(Some(RemoteAudioDownload {
            bytes: None,
            content_type,
            final_url,
            warning: Some("Remote audio source returned an empty response.".into()),
        }));
    }
    Ok(Some(RemoteAudioDownload {
        bytes: Some(bytes),
        content_type,
        final_url,
        warning: None,
    }))
}

fn remote_audio_status_warning(status: StatusCode) -> Option<String> {
    if status.is_success() && status != StatusCode::NO_CONTENT {
        None
    } else {
        Some(format!(
            "Remote audio source returned HTTP {}.",
            status.as_u16()
        ))
    }
}

pub(crate) fn ensure_remote_audio_size(length: usize) -> Result<(), String> {
    if length > MAX_REMOTE_AUDIO_BYTES {
        return Err(format!(
            "Remote audio exceeds the {} MiB size limit.",
            MAX_REMOTE_AUDIO_BYTES / 1024 / 1024
        ));
    }
    Ok(())
}

pub(crate) fn detect_audio_extension(
    bytes: &[u8],
    content_type: Option<&str>,
    path: &str,
) -> Option<&'static str> {
    let signature = if matches!(bytes, [0xff, second, ..] if second & 0xf6 == 0xf0) {
        "aac"
    } else if bytes.starts_with(b"ID3")
        || matches!(bytes, [0xff, second, ..] if second & 0xe0 == 0xe0)
    {
        "mp3"
    } else if bytes.starts_with(b"OggS") {
        if normalize_content_type(content_type)
            .is_some_and(|mime| mime.eq_ignore_ascii_case("audio/opus"))
        {
            "opus"
        } else {
            "ogg"
        }
    } else if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" {
        "wav"
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        "m4a"
    } else {
        return None;
    };
    if let Some(mime) = normalize_content_type(content_type) {
        if mime.eq_ignore_ascii_case("application/octet-stream") {
            // Generic binary responses are accepted when the file signature is supported.
        } else if let Some(mime_extension) = audio_extension_for_mime(mime) {
            if !audio_extensions_compatible(signature, mime_extension) {
                return None;
            }
        } else {
            return None;
        }
    }
    if let Some(path_extension) = supported_path_audio_extension(path) {
        if !audio_extensions_compatible(signature, path_extension) {
            return None;
        }
    }
    Some(signature)
}

fn normalize_content_type(content_type: Option<&str>) -> Option<&str> {
    content_type?
        .split(';')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn audio_extension_for_mime(mime: &str) -> Option<&'static str> {
    match mime.to_ascii_lowercase().as_str() {
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/ogg" | "application/ogg" => Some("ogg"),
        "audio/opus" => Some("opus"),
        "audio/wav" | "audio/wave" | "audio/x-wav" => Some("wav"),
        "audio/mp4" | "audio/x-m4a" => Some("m4a"),
        "audio/aac" | "audio/x-aac" => Some("aac"),
        _ => None,
    }
}

fn supported_path_audio_extension(path: &str) -> Option<&str> {
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    match extension.as_str() {
        "mp3" | "ogg" | "opus" | "wav" | "m4a" | "aac" => Some(match extension.as_str() {
            "mp3" => "mp3",
            "ogg" => "ogg",
            "opus" => "opus",
            "wav" => "wav",
            "m4a" => "m4a",
            _ => "aac",
        }),
        _ => None,
    }
}

fn audio_extensions_compatible(left: &str, right: &str) -> bool {
    left == right
        || matches!(
            (left, right),
            ("ogg", "opus") | ("opus", "ogg") | ("m4a", "aac") | ("aac", "m4a")
        )
}

fn remote_audio_filename(bytes: &[u8], extension: &str) -> String {
    let digest = Sha256::digest(bytes);
    let hash = digest[..12]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("hsw_audio_{hash}.{extension}")
}

fn remote_audio_warning(source_name: &str, warning: &str) -> String {
    let source_name = source_name.trim();
    if source_name.is_empty() {
        format!("Word audio: {warning}")
    } else {
        format!("Word audio ({source_name}): {warning}")
    }
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
    let settings =
        serde_json::from_str(&raw).map_err(|e| format!("Cannot parse Anki settings: {e}"))?;
    Ok(normalize_settings(settings))
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
    settings.version = SETTINGS_VERSION;
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
    settings.tags = settings
        .tags
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    settings
}

fn default_anki_tags() -> String {
    "hoshi-reader".into()
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
    let Some(note_type) = note_types
        .iter()
        .find(|note_type| note_type.name == selected_note_type)
    else {
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
        .ok_or_else(|| {
            "AnkiConnect duplicate check returned an unexpected response.".to_string()
        })?;
    let can_add = first
        .get("canAdd")
        .and_then(Value::as_bool)
        .ok_or_else(|| "AnkiConnect duplicate check did not include canAdd.".to_string())?;
    let error = first
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
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
    let mut duplicate_scope_options = serde_json::Map::new();
    let duplicate_scope = match note.duplicate_scope {
        AnkiDuplicateScope::Collection => "collection",
        AnkiDuplicateScope::Deck => "deck",
        AnkiDuplicateScope::DeckRoot => {
            duplicate_scope_options.insert(
                "deckName".into(),
                Value::String(
                    note.deck_name
                        .trim()
                        .split("::")
                        .next()
                        .unwrap_or("")
                        .into(),
                ),
            );
            duplicate_scope_options.insert("checkChildren".into(), Value::Bool(true));
            "deck"
        }
    };
    if note.check_duplicates_across_all_models {
        duplicate_scope_options.insert("checkAllModels".into(), Value::Bool(true));
    }
    let mut options = json!({
        "allowDuplicate": note.allow_duplicates,
        "duplicateScope": duplicate_scope,
    });
    if !duplicate_scope_options.is_empty() {
        options["duplicateScopeOptions"] = Value::Object(duplicate_scope_options);
    }
    Ok(json!({
        "deckName": note.deck_name.trim(),
        "modelName": note.model_name.trim(),
        "fields": note.fields,
        "tags": note.tags,
        "options": options,
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
                warnings.push(format!("{} / {}: {}", item.dictionary, item.path, error));
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
    error.starts_with("Dictionary media not found:")
        || error.starts_with("Dictionary not found for media request:")
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
    let fields = result.as_array().ok_or_else(|| {
        "AnkiConnect modelFieldNames returned an unexpected response.".to_string()
    })?;
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
    parse_anki_response(&response)
}

fn parse_anki_response(response: &str) -> Result<Value, String> {
    let json: Value = serde_json::from_str(response)
        .map_err(|e| format!("Cannot parse AnkiConnect response: {e}"))?;
    if !json.get("error").unwrap_or(&Value::Null).is_null() {
        return Err(format!(
            "AnkiConnect error: {}",
            json.get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
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
    Ok(format!(
        "http://{}:{}{}",
        endpoint.host, endpoint.port, path
    ))
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
        assert!(!loaded.local_audio_enabled);
        assert_eq!(loaded.audio_sources, default_audio_sources());
        assert_eq!(
            loaded.audio_download_timeout_ms,
            default_audio_download_timeout_ms()
        );
        assert_eq!(loaded.version, SETTINGS_VERSION);
        assert_eq!(loaded.tags, "hoshi-reader");
        assert!(!loaded.allow_duplicates);
        assert_eq!(loaded.duplicate_scope, AnkiDuplicateScope::Collection);
        assert!(!loaded.compact_glossaries);
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
    fn expands_remote_audio_template_with_encoded_lookup_values() {
        let expanded = expand_audio_url_template(
            "https://audio.example/clip/{term}?reading={reading}",
            "学 校",
            "がっこう",
        )
        .unwrap();
        assert_eq!(
            expanded,
            "https://audio.example/clip/%E5%AD%A6%20%E6%A0%A1?reading=%E3%81%8C%E3%81%A3%E3%81%93%E3%81%86"
        );
        assert!(
            expand_audio_url_template("https://audio.example/{unknown}", "学校", "")
                .unwrap_err()
                .contains("unknown")
        );
        assert!(
            expand_audio_url_template("https://audio.example/{term", "学校", "")
                .unwrap_err()
                .contains("incomplete")
        );
    }

    #[test]
    fn remote_audio_url_validation_blocks_non_public_targets() {
        for url in [
            "file:///C:/audio.mp3",
            "ftp://8.8.8.8/audio.mp3",
            "http://localhost/audio.mp3",
            "http://127.0.0.1/audio.mp3",
            "http://10.0.0.1/audio.mp3",
            "http://169.254.1.2/audio.mp3",
            "http://[::1]/audio.mp3",
            "http://[fc00::1]/audio.mp3",
            "http://user:pass@8.8.8.8/audio.mp3",
        ] {
            assert!(
                validate_remote_audio_url(&Url::parse(url).unwrap()).is_err(),
                "{url}"
            );
        }
        let public =
            validate_remote_audio_url(&Url::parse("https://8.8.8.8/audio.mp3").unwrap()).unwrap();
        assert_eq!(public.address.ip(), "8.8.8.8".parse::<IpAddr>().unwrap());
    }

    #[test]
    fn detects_supported_remote_audio_and_rejects_mismatches() {
        assert_eq!(detect_audio_extension(&[], None, "/audio"), None);
        assert_eq!(
            detect_audio_extension(b"ID3\x04\0\0probe", Some("audio/mpeg"), "/a.mp3"),
            Some("mp3")
        );
        assert_eq!(
            detect_audio_extension(b"OggSprobe", Some("audio/opus"), "/a.opus"),
            Some("opus")
        );
        assert_eq!(
            detect_audio_extension(b"RIFF\0\0\0\0WAVEprobe", Some("audio/wav"), "/a.wav"),
            Some("wav")
        );
        assert_eq!(
            detect_audio_extension(b"\0\0\0\x18ftypM4A probe", Some("audio/mp4"), "/a.m4a"),
            Some("m4a")
        );
        assert_eq!(
            detect_audio_extension(&[0xff, 0xf1, 0x50, 0x80], Some("audio/aac"), "/a.aac"),
            Some("aac")
        );
        assert_eq!(
            detect_audio_extension(b"ID3\x04\0\0probe", Some("audio/wav"), "/a.mp3"),
            None
        );
        assert_eq!(
            detect_audio_extension(b"<html>not audio</html>", Some("text/html"), "/audio.mp3"),
            None
        );
    }

    #[test]
    fn detects_and_stores_stable_book_cover_media() {
        assert_eq!(
            detect_book_cover_extension(&[0xff, 0xd8, 0xff]),
            Some("jpg")
        );
        assert_eq!(
            detect_book_cover_extension(b"\x89PNG\r\n\x1a\nprobe"),
            Some("png")
        );
        assert_eq!(detect_book_cover_extension(b"GIF89aprobe"), Some("gif"));
        assert_eq!(
            detect_book_cover_extension(b"RIFF\0\0\0\0WEBPprobe"),
            Some("webp")
        );
        assert_eq!(detect_book_cover_extension(b"<html>"), None);

        let root = temp_root("cover_store");
        let cover = root.join("cover.jpg");
        fs::write(&cover, [0xff, 0xd8, 0xff, 1, 2, 3]).unwrap();
        let mut stored_filename = String::new();
        let result = store_book_cover_from_path(DEFAULT_ENDPOINT, &cover, |_, action, params| {
            assert_eq!(action, "storeMediaFile");
            let params = params.unwrap();
            stored_filename = params["filename"].as_str().unwrap().to_string();
            assert!(!params["data"].as_str().unwrap().is_empty());
            Ok(Value::String(stored_filename.clone()))
        })
        .unwrap();
        assert_eq!(result.filename.as_deref(), Some(stored_filename.as_str()));
        assert!(stored_filename.starts_with("hsw_cover_"));
        assert!(stored_filename.ends_with(".jpg"));

        let same = store_book_cover_from_path(DEFAULT_ENDPOINT, &cover, |_, _, params| {
            Ok(params.unwrap()["filename"].clone())
        })
        .unwrap();
        assert_eq!(same.filename, result.filename);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn book_cover_rejects_forged_and_oversized_files_and_warns_on_unsupported_type() {
        let root = temp_root("cover_errors");
        let forged = root.join("cover.jpg");
        fs::write(&forged, b"<html>not an image</html>").unwrap();
        assert!(
            store_book_cover_from_path(DEFAULT_ENDPOINT, &forged, |_, _, _| unreachable!())
                .unwrap_err()
                .contains("signature")
        );

        let unsupported = root.join("cover.svg");
        fs::write(&unsupported, b"<svg></svg>").unwrap();
        let result =
            store_book_cover_from_path(DEFAULT_ENDPOINT, &unsupported, |_, _, _| unreachable!())
                .unwrap();
        assert!(result.filename.is_none());
        assert!(result.warnings[0].contains("supported"));

        let oversized = root.join("cover.png");
        fs::File::create(&oversized)
            .unwrap()
            .set_len((MAX_BOOK_COVER_BYTES + 1) as u64)
            .unwrap();
        assert!(
            store_book_cover_from_path(DEFAULT_ENDPOINT, &oversized, |_, _, _| unreachable!())
                .unwrap_err()
                .contains("10 MiB")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remote_audio_size_and_filename_are_stable() {
        assert_eq!(remote_audio_timeout(1), Duration::from_millis(1000));
        assert_eq!(remote_audio_timeout(7000), Duration::from_millis(7000));
        assert_eq!(remote_audio_timeout(u32::MAX), Duration::from_millis(30000));
        ensure_remote_audio_redirect_allowed(MAX_REMOTE_AUDIO_REDIRECTS - 1).unwrap();
        assert!(
            ensure_remote_audio_redirect_allowed(MAX_REMOTE_AUDIO_REDIRECTS)
                .unwrap_err()
                .contains("3 redirects")
        );
        assert!(remote_audio_status_warning(StatusCode::OK).is_none());
        assert!(remote_audio_status_warning(StatusCode::NO_CONTENT)
            .unwrap()
            .contains("204"));
        assert!(remote_audio_status_warning(StatusCode::NOT_FOUND)
            .unwrap()
            .contains("404"));
        assert!(
            remote_audio_status_warning(StatusCode::INTERNAL_SERVER_ERROR)
                .unwrap()
                .contains("500")
        );
        ensure_remote_audio_size(MAX_REMOTE_AUDIO_BYTES).unwrap();
        assert!(ensure_remote_audio_size(MAX_REMOTE_AUDIO_BYTES + 1)
            .unwrap_err()
            .contains("10 MiB"));
        let first = remote_audio_filename(b"ID3 stable bytes", "mp3");
        let second = remote_audio_filename(b"ID3 stable bytes", "mp3");
        assert_eq!(first, second);
        assert!(first.starts_with("hsw_audio_"));
        assert!(first.ends_with(".mp3"));
        assert!(!first.contains('/') && !first.contains('\\'));
    }

    #[test]
    fn parses_ankiconnect_store_media_response() {
        assert_eq!(
            parse_anki_response(r#"{"result":"hsw_audio_probe.mp3","error":null}"#).unwrap(),
            json!("hsw_audio_probe.mp3")
        );
        assert!(
            parse_anki_response(r#"{"result":null,"error":"store failed"}"#)
                .unwrap_err()
                .contains("store failed")
        );
        assert!(parse_anki_response("not json")
            .unwrap_err()
            .contains("Cannot parse"));
    }

    #[test]
    fn malformed_remote_audio_request_is_warning_but_unsafe_url_is_error() {
        let malformed = AnkiRemoteAudioRequest {
            source_name: "Probe".into(),
            url_template: "not a url {term}".into(),
            expression: "学校".into(),
            reading: "がっこう".into(),
            timeout_ms: 5000,
        };
        let result = download_remote_audio(&malformed).unwrap().unwrap();
        assert!(result.warning.unwrap().contains("invalid"));

        let unsafe_request = AnkiRemoteAudioRequest {
            url_template: "http://127.0.0.1/{term}.mp3".into(),
            ..malformed
        };
        assert!(download_remote_audio(&unsafe_request)
            .unwrap_err()
            .contains("private, local, or reserved"));
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
            force_sync_after_add: false,
            allow_duplicates: false,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Collection,
        };
        let value = note_json(&note).unwrap();
        assert_eq!(value["deckName"], "Mining");
        assert_eq!(value["modelName"], "Basic");
        assert_eq!(value["fields"]["Expression"], "学校");
        assert_eq!(value["tags"][0], "hoshi-reader");
        assert_eq!(value["options"]["allowDuplicate"], false);
        assert_eq!(value["options"]["duplicateScope"], "collection");
        assert!(value["options"].get("duplicateScopeOptions").is_none());

        let deck_root = AnkiNoteRequest {
            deck_name: "Japanese::Mining".into(),
            allow_duplicates: true,
            check_duplicates_across_all_models: true,
            duplicate_scope: AnkiDuplicateScope::DeckRoot,
            ..note.clone()
        };
        let value = note_json(&deck_root).unwrap();
        assert_eq!(value["options"]["allowDuplicate"], true);
        assert_eq!(value["options"]["duplicateScope"], "deck");
        assert_eq!(
            value["options"]["duplicateScopeOptions"]["deckName"],
            "Japanese"
        );
        assert_eq!(
            value["options"]["duplicateScopeOptions"]["checkChildren"],
            true
        );
        assert_eq!(
            value["options"]["duplicateScopeOptions"]["checkAllModels"],
            true
        );

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

        let duplicate = parse_note_check_result(
            json!([{ "canAdd": false, "error": "cannot create note because it is a duplicate" }]),
        )
        .unwrap();
        assert!(!duplicate.can_add);
        assert!(duplicate.duplicate);
        assert!(duplicate.message.contains("duplicate"));

        assert!(parse_note_check_result(json!({ "bad": true })).is_err());
    }

    #[test]
    fn sync_runs_only_after_success_and_failure_is_a_warning() {
        let mut fields = BTreeMap::new();
        fields.insert("Expression".into(), "probe".into());
        let note = AnkiNoteRequest {
            endpoint: DEFAULT_ENDPOINT.into(),
            deck_name: "Mining".into(),
            model_name: "Basic".into(),
            fields,
            tags: vec!["hoshi-reader".into()],
            force_sync_after_add: true,
            allow_duplicates: false,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Collection,
        };
        let mut actions = Vec::new();
        let result = add_note_with_request(&note, |_endpoint, action, _params| {
            actions.push(action.to_string());
            match action {
                "canAddNotesWithErrorDetail" => Ok(json!([{ "canAdd": true, "error": null }])),
                "addNote" => Ok(json!(42)),
                "sync" => Err("probe sync failure".into()),
                _ => unreachable!(),
            }
        })
        .unwrap();
        assert_eq!(actions, ["canAddNotesWithErrorDetail", "addNote", "sync"]);
        assert_eq!(result.status, "added");
        assert_eq!(result.note_id, Some(42));
        assert_eq!(result.warnings.len(), 1);
        assert!(result.warnings[0].contains("probe sync failure"));
    }

    #[test]
    fn duplicate_never_runs_sync() {
        let mut fields = BTreeMap::new();
        fields.insert("Expression".into(), "probe".into());
        let note = AnkiNoteRequest {
            endpoint: DEFAULT_ENDPOINT.into(),
            deck_name: "Mining".into(),
            model_name: "Basic".into(),
            fields,
            tags: Vec::new(),
            force_sync_after_add: true,
            allow_duplicates: false,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Collection,
        };
        let mut actions = Vec::new();
        let result = add_note_with_request(&note, |_endpoint, action, _params| {
            actions.push(action.to_string());
            Ok(json!([{ "canAdd": false, "error": "duplicate" }]))
        })
        .unwrap();
        assert_eq!(actions, ["canAddNotesWithErrorDetail"]);
        assert_eq!(result.status, "duplicate");
        assert!(result.warnings.is_empty());
    }

    #[test]
    fn allowed_duplicates_skip_preflight_and_add_directly() {
        let mut fields = BTreeMap::new();
        fields.insert("Expression".into(), "probe".into());
        let note = AnkiNoteRequest {
            endpoint: DEFAULT_ENDPOINT.into(),
            deck_name: "Mining".into(),
            model_name: "Basic".into(),
            fields,
            tags: Vec::new(),
            force_sync_after_add: false,
            allow_duplicates: true,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Deck,
        };
        let mut actions = Vec::new();
        let result = add_note_with_request(&note, |_endpoint, action, params| {
            actions.push(action.to_string());
            assert_eq!(action, "addNote");
            assert_eq!(params.unwrap()["note"]["options"]["allowDuplicate"], true);
            assert_eq!(
                note_json(&note).unwrap()["options"]["duplicateScope"],
                "deck"
            );
            Ok(json!(73))
        })
        .unwrap();
        assert_eq!(actions, ["addNote"]);
        assert_eq!(result.note_id, Some(73));
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
        let result =
            store_dictionary_media_from_manifest(DEFAULT_ENDPOINT, &manifest, &refs).unwrap();
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
        let error =
            store_dictionary_media_from_manifest(DEFAULT_ENDPOINT, &manifest, &refs).unwrap_err();
        assert!(error.starts_with("Unsupported dictionary media type:"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    #[ignore]
    fn validates_real_ankiconnect_add_note_and_duplicate_check() {
        if std::env::var("HSW_ANKI_RUNTIME_VALIDATE").ok().as_deref() != Some("1") {
            eprintln!(
                "Set HSW_ANKI_RUNTIME_VALIDATE=1 to run the real AnkiConnect add-note validation."
            );
            return;
        }

        let endpoint =
            std::env::var("HSW_ANKI_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
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
        fields.insert(
            "Meaning".into(),
            "Created by HSW runtime validation.".into(),
        );
        let note = AnkiNoteRequest {
            endpoint: endpoint.clone(),
            deck_name: deck_name.clone(),
            model_name: model_name.clone(),
            fields,
            tags: vec!["hoshi-reader-runtime-validation".into()],
            force_sync_after_add: false,
            allow_duplicates: false,
            check_duplicates_across_all_models: false,
            duplicate_scope: AnkiDuplicateScope::Collection,
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
        let _ = anki_request(
            &endpoint,
            "deleteModel",
            Some(json!({ "modelName": model_name })),
        );
    }

    #[test]
    #[ignore]
    fn validates_real_ankiconnect_store_dictionary_media() {
        if std::env::var("HSW_ANKI_RUNTIME_VALIDATE").ok().as_deref() != Some("1") {
            eprintln!(
                "Set HSW_ANKI_RUNTIME_VALIDATE=1 to run the real AnkiConnect media validation."
            );
            return;
        }

        let endpoint =
            std::env::var("HSW_ANKI_ENDPOINT").unwrap_or_else(|_| DEFAULT_ENDPOINT.into());
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
