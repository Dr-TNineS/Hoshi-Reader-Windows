use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[cfg(hoshi_dicts_linked)]
use crate::dict::ffi;
#[cfg(hoshi_dicts_linked)]
use std::ffi::{c_void, CStr, CString};
#[cfg(hoshi_dicts_linked)]
use std::fs::File;
#[cfg(hoshi_dicts_linked)]
use std::io::{Read, Write};

#[cfg(hoshi_dicts_linked)]
const MAX_LOOKUP_RESULTS: i32 = 16;
#[cfg(hoshi_dicts_linked)]
const SCAN_LENGTH: i32 = 16;

#[derive(Debug, Clone, Serialize)]
pub struct DictResult {
    pub expression: String,
    pub reading: String,
    pub glossary: Vec<GlossaryEntry>,
    pub matched: String,
    pub deinflected: String,
    pub rules: String,
    pub dictionary: String,
    pub frequencies: Vec<FrequencyEntry>,
    pub pitches: Vec<PitchEntry>,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct GlossaryEntry {
    pub dict: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyEntry {
    pub dictionary: String,
    pub items: Vec<FrequencyItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FrequencyItem {
    pub value: i32,
    pub display_value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PitchEntry {
    pub dictionary: String,
    pub positions: Vec<i32>,
    pub transcriptions: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictImportSummary {
    pub dict_id: String,
    pub title: String,
    pub dictionary_path: String,
    pub term_count: usize,
    pub meta_count: usize,
    pub freq_count: usize,
    pub pitch_count: usize,
    pub media_count: usize,
    pub ready: bool,
    pub reused: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStatus {
    pub status: DictionaryStatusKind,
    pub message: String,
    pub loaded_count: usize,
    pub imported_count: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub enum DictionaryStatusKind {
    Ready,
    NoDictionaries,
    EngineUnavailable,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryManifestEntry {
    pub dict_id: String,
    pub title: String,
    pub kind: String,
    pub enabled: bool,
    pub order: usize,
    pub internal_path: String,
    pub term_count: usize,
    pub meta_count: usize,
    pub freq_count: usize,
    pub pitch_count: usize,
    pub media_count: usize,
    pub last_imported: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryMediaResource {
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DictionaryManifest {
    dictionaries: Vec<DictionaryManifestEntry>,
}

#[derive(Default)]
struct DictRuntime {
    #[cfg(hoshi_dicts_linked)]
    backend: Option<DictBackend>,
    #[allow(dead_code)]
    dictionary_title_overrides: HashMap<String, String>,
    loaded_dictionaries: usize,
    imported_count: usize,
    error: Option<String>,
    manifest_error: Option<String>,
}

pub struct DictState {
    runtime: Mutex<DictRuntime>,
}

impl DictState {
    pub fn new() -> Self {
        Self {
            runtime: Mutex::new(DictRuntime::default()),
        }
    }

    pub fn initialize(&self, app: &AppHandle) {
        let result = initialize_runtime(app);
        let mut runtime = self.runtime.lock().unwrap();
        *runtime = result;
    }
}

#[tauri::command]
pub fn dict_lookup(
    text: String,
    state: tauri::State<DictState>,
) -> Result<Vec<DictResult>, String> {
    let runtime = state.runtime.lock().unwrap();
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    #[cfg(hoshi_dicts_linked)]
    {
        let backend = runtime
            .backend
            .as_ref()
            .ok_or_else(|| runtime_error(&runtime))?;
        let mut results = backend.lookup(&text)?;
        apply_dictionary_title_overrides(&mut results, &runtime.dictionary_title_overrides);
        return Ok(results);
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        Err(runtime_error(&runtime))
    }
}

#[tauri::command]
pub fn dict_status(state: tauri::State<DictState>) -> DictionaryStatus {
    let runtime = state.runtime.lock().unwrap();
    runtime_status(&runtime)
}

#[tauri::command]
pub fn dictionary_list(app: AppHandle) -> Result<Vec<DictionaryManifestEntry>, String> {
    Ok(read_dictionary_manifest(&dictionary_manifest_path(&app)?)?.dictionaries)
}

#[tauri::command]
pub fn dictionary_media(
    dictionary: String,
    path: String,
    app: AppHandle,
) -> Result<DictionaryMediaResource, String> {
    let manifest = read_dictionary_manifest(&dictionary_manifest_path(&app)?)?;
    load_dictionary_media(&manifest, &dictionary, &path)
}

#[tauri::command]
pub fn dictionary_set_enabled(
    dict_id: String,
    enabled: bool,
    app: AppHandle,
    state: tauri::State<DictState>,
) -> Result<DictionaryStatus, String> {
    let manifest_path = dictionary_manifest_path(&app)?;
    set_dictionary_enabled(&manifest_path, &dict_id, enabled)?;
    state.initialize(&app);
    let runtime = state.runtime.lock().unwrap();
    Ok(runtime_status(&runtime))
}

#[tauri::command]
pub fn dictionary_set_order(
    dict_ids: Vec<String>,
    app: AppHandle,
    state: tauri::State<DictState>,
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let manifest_path = dictionary_manifest_path(&app)?;
    let entries = set_dictionary_order(&manifest_path, &dict_ids)?;
    state.initialize(&app);
    Ok(entries)
}

fn runtime_status(runtime: &DictRuntime) -> DictionaryStatus {
    if let Some(error) = &runtime.manifest_error {
        return DictionaryStatus {
            status: DictionaryStatusKind::Error,
            message: error.clone(),
            loaded_count: 0,
            imported_count: runtime.imported_count,
        };
    }

    if runtime.imported_count == 0 {
        return DictionaryStatus {
            status: DictionaryStatusKind::NoDictionaries,
            message: "No imported dictionaries found.".into(),
            loaded_count: 0,
            imported_count: 0,
        };
    }

    if runtime.loaded_dictionaries == 0 {
        return DictionaryStatus {
            status: DictionaryStatusKind::NoDictionaries,
            message: runtime_error(runtime),
            loaded_count: 0,
            imported_count: runtime.imported_count,
        };
    }

    #[cfg(hoshi_dicts_linked)]
    {
        if runtime.backend.is_some() {
            return DictionaryStatus {
                status: DictionaryStatusKind::Ready,
                message: format!("{} dictionary loaded.", runtime.loaded_dictionaries),
                loaded_count: runtime.loaded_dictionaries,
                imported_count: runtime.imported_count,
            };
        }

        DictionaryStatus {
            status: DictionaryStatusKind::Error,
            message: runtime_error(runtime),
            loaded_count: 0,
            imported_count: runtime.imported_count,
        }
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        DictionaryStatus {
            status: DictionaryStatusKind::EngineUnavailable,
            message: runtime_error(runtime),
            loaded_count: 0,
            imported_count: runtime.imported_count,
        }
    }
}

#[tauri::command]
pub fn dictionary_import_yomitan_zip(
    zip_path: String,
    app: AppHandle,
    state: tauri::State<DictState>,
) -> Result<DictImportSummary, String> {
    import_yomitan_zip(&zip_path, &app, &state)
}

fn import_yomitan_zip(
    zip_path: &str,
    app: &AppHandle,
    state: &DictState,
) -> Result<DictImportSummary, String> {
    let source = PathBuf::from(zip_path);
    if !source.is_file() {
        return Err(format!(
            "Dictionary zip does not exist: {}",
            source.display()
        ));
    }

    let dict_id = dictionary_zip_id(&source)?;
    let manifest_path = dictionary_manifest_path(app)?;
    let imported_root = imported_dictionary_root(app)?;
    let final_dir = imported_root.join(&dict_id);

    if is_hoshidicts_term_dir(&final_dir) {
        let existing = read_dictionary_manifest(&manifest_path)?
            .dictionaries
            .into_iter()
            .find(|dictionary| dictionary.dict_id == dict_id)
            .map(Ok)
            .unwrap_or_else(|| {
                upsert_dictionary_manifest_entry(
                    &manifest_path,
                    DictionaryManifestEntry {
                        dict_id: dict_id.clone(),
                        title: read_imported_dictionary_title(&final_dir)
                            .unwrap_or_else(|| "Imported Dictionary".into()),
                        kind: "term".into(),
                        enabled: true,
                        order: 0,
                        internal_path: final_dir.to_string_lossy().into_owned(),
                        term_count: 0,
                        meta_count: 0,
                        freq_count: 0,
                        pitch_count: 0,
                        media_count: 0,
                        last_imported: current_unix_time(),
                    },
                )
            })?;
        state.initialize(app);
        let runtime = state.runtime.lock().unwrap();
        return Ok(DictImportSummary {
            dict_id,
            title: existing.title,
            dictionary_path: existing.internal_path,
            term_count: existing.term_count,
            meta_count: existing.meta_count,
            freq_count: existing.freq_count,
            pitch_count: existing.pitch_count,
            media_count: existing.media_count,
            ready: dict_runtime_ready(&runtime),
            reused: true,
        });
    }

    #[cfg(hoshi_dicts_linked)]
    {
        import_yomitan_zip_linked(
            &source,
            &manifest_path,
            &imported_root,
            &final_dir,
            &dict_id,
            app,
            state,
        )
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        let _ = imported_root;
        let _ = final_dir;
        let _ = state;
        Err("Dictionary importer is not linked. Install CMake/C++ build tools and rebuild HSW with hoshidicts.".into())
    }
}

fn initialize_runtime(app: &AppHandle) -> DictRuntime {
    let manifest_path = match dictionary_manifest_path(app) {
        Ok(path) => path,
        Err(error) => {
            return DictRuntime {
                error: Some(error),
                ..DictRuntime::default()
            }
        }
    };
    let manifest = match read_dictionary_manifest(&manifest_path) {
        Ok(manifest) => manifest,
        Err(error) => {
            return DictRuntime {
                error: Some(error.clone()),
                manifest_error: Some(error),
                ..DictRuntime::default()
            }
        }
    };
    let imported_count = manifest.dictionaries.len();
    let load_plan = enabled_dictionary_load_plan(&manifest);
    let dictionary_title_overrides = dictionary_title_overrides(&manifest);

    if !load_plan.iter().any(|entry| entry.use_term) {
        return DictRuntime {
            loaded_dictionaries: 0,
            imported_count,
            dictionary_title_overrides,
            error: if imported_count == 0 {
                Some("No imported dictionaries found.".into())
            } else {
                Some("No enabled term dictionaries found in dictionary manifest.".into())
            },
            ..DictRuntime::default()
        };
    }

    #[cfg(hoshi_dicts_linked)]
    {
        match DictBackend::load(&load_plan) {
            Ok(backend) => DictRuntime {
                backend: Some(backend),
                loaded_dictionaries: load_plan.len(),
                imported_count,
                dictionary_title_overrides,
                error: None,
                manifest_error: None,
            },
            Err(error) => DictRuntime {
                loaded_dictionaries: 0,
                imported_count,
                error: Some(error),
                ..DictRuntime::default()
            },
        }
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        DictRuntime {
            loaded_dictionaries: load_plan.len(),
            imported_count,
            dictionary_title_overrides,
            error: Some("Dictionary engine not linked. Install CMake/C++ build tools and rebuild HSW with hoshidicts.".into()),
            manifest_error: None,
        }
    }
}

fn dictionary_title_overrides(manifest: &DictionaryManifest) -> HashMap<String, String> {
    manifest
        .dictionaries
        .iter()
        .filter_map(|entry| {
            let internal_title =
                read_imported_dictionary_title(&PathBuf::from(&entry.internal_path))?;
            (internal_title != entry.title).then_some((internal_title, entry.title.clone()))
        })
        .collect()
}

#[allow(dead_code)]
fn apply_dictionary_title_overrides(
    results: &mut [DictResult],
    overrides: &HashMap<String, String>,
) {
    if overrides.is_empty() {
        return;
    }

    for result in results {
        apply_title_override(&mut result.dictionary, overrides);
        for glossary in &mut result.glossary {
            apply_title_override(&mut glossary.dict, overrides);
        }
        for frequency in &mut result.frequencies {
            apply_title_override(&mut frequency.dictionary, overrides);
        }
        for pitch in &mut result.pitches {
            apply_title_override(&mut pitch.dictionary, overrides);
        }
    }
}

#[allow(dead_code)]
fn apply_title_override(value: &mut String, overrides: &HashMap<String, String>) {
    if let Some(title) = overrides.get(value) {
        *value = title.clone();
    }
}

fn dict_runtime_ready(runtime: &DictRuntime) -> bool {
    #[cfg(hoshi_dicts_linked)]
    {
        runtime.backend.is_some()
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        let _ = runtime;
        false
    }
}

fn imported_dictionary_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = dictionary_data_root(app)?.join("imported");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create dictionary dir: {e}"))?;
    Ok(root)
}

fn dictionary_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("dictionaries");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create dictionary data dir: {e}"))?;
    Ok(root)
}

fn dictionary_manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dictionary_data_root(app)?.join("manifest.json"))
}

fn read_dictionary_manifest(path: &Path) -> Result<DictionaryManifest, String> {
    if !path.exists() {
        return Ok(DictionaryManifest::default());
    }

    let content =
        fs::read_to_string(path).map_err(|e| format!("Cannot read dictionary manifest: {e}"))?;
    serde_json::from_str::<DictionaryManifest>(&content)
        .map_err(|e| format!("Cannot parse dictionary manifest: {e}"))
}

fn write_dictionary_manifest(path: &Path, manifest: &DictionaryManifest) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dictionary manifest dir: {e}"))?;
    }
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Cannot serialize dictionary manifest: {e}"))?;
    fs::write(path, content).map_err(|e| format!("Cannot write dictionary manifest: {e}"))
}

fn upsert_dictionary_manifest_entry(
    path: &Path,
    mut entry: DictionaryManifestEntry,
) -> Result<DictionaryManifestEntry, String> {
    let mut manifest = read_dictionary_manifest(path)?;
    let existing_order = manifest
        .dictionaries
        .iter()
        .find(|dictionary| dictionary.dict_id == entry.dict_id)
        .map(|dictionary| dictionary.order);

    if let Some(order) = existing_order {
        entry.order = order;
        if let Some(existing) = manifest
            .dictionaries
            .iter_mut()
            .find(|dictionary| dictionary.dict_id == entry.dict_id)
        {
            *existing = entry.clone();
        }
    } else {
        entry.order = manifest
            .dictionaries
            .iter()
            .map(|dictionary| dictionary.order)
            .max()
            .map(|order| order + 1)
            .unwrap_or(0);
        manifest.dictionaries.push(entry.clone());
    }
    manifest
        .dictionaries
        .sort_by_key(|dictionary| dictionary.order);
    write_dictionary_manifest(path, &manifest)?;
    Ok(entry)
}

fn set_dictionary_enabled(path: &Path, dict_id: &str, enabled: bool) -> Result<(), String> {
    let mut manifest = read_dictionary_manifest(path)?;
    let Some(entry) = manifest
        .dictionaries
        .iter_mut()
        .find(|dictionary| dictionary.dict_id == dict_id)
    else {
        return Err(format!("Dictionary not found: {dict_id}"));
    };

    entry.enabled = enabled;
    write_dictionary_manifest(path, &manifest)
}

fn set_dictionary_order(
    path: &Path,
    dict_ids: &[String],
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let mut manifest = read_dictionary_manifest(path)?;
    validate_dictionary_order_ids(&manifest, dict_ids)?;

    for (order, dict_id) in dict_ids.iter().enumerate() {
        if let Some(entry) = manifest
            .dictionaries
            .iter_mut()
            .find(|dictionary| &dictionary.dict_id == dict_id)
        {
            entry.order = order;
        }
    }
    manifest
        .dictionaries
        .sort_by_key(|dictionary| dictionary.order);
    write_dictionary_manifest(path, &manifest)?;
    Ok(manifest.dictionaries)
}

fn validate_dictionary_order_ids(
    manifest: &DictionaryManifest,
    dict_ids: &[String],
) -> Result<(), String> {
    if dict_ids.len() != manifest.dictionaries.len() {
        return Err("Dictionary order must include every dictionary exactly once.".into());
    }

    let mut sorted_requested = dict_ids.to_vec();
    sorted_requested.sort();
    let duplicate = sorted_requested
        .windows(2)
        .find(|pair| pair[0] == pair[1])
        .map(|pair| pair[0].clone());
    if let Some(dict_id) = duplicate {
        return Err(format!("Dictionary order contains duplicate id: {dict_id}"));
    }

    let mut existing = manifest
        .dictionaries
        .iter()
        .map(|dictionary| dictionary.dict_id.clone())
        .collect::<Vec<_>>();
    existing.sort();

    if sorted_requested != existing {
        let unknown = sorted_requested
            .iter()
            .find(|dict_id| !existing.contains(dict_id))
            .cloned();
        if let Some(dict_id) = unknown {
            return Err(format!("Dictionary not found: {dict_id}"));
        }
        return Err("Dictionary order must include every dictionary exactly once.".into());
    }

    Ok(())
}

fn find_dictionary_media_entry<'a>(
    manifest: &'a DictionaryManifest,
    dictionary: &str,
) -> Result<&'a DictionaryManifestEntry, String> {
    let needle = dictionary.trim();
    if needle.is_empty() {
        return Err("Dictionary media request is missing a dictionary id.".into());
    }

    manifest
        .dictionaries
        .iter()
        .find(|entry| entry.dict_id == needle)
        .or_else(|| {
            manifest
                .dictionaries
                .iter()
                .filter(|entry| entry.title == needle)
                .min_by_key(|entry| entry.order)
        })
        .ok_or_else(|| format!("Dictionary not found for media request: {needle}"))
}

fn load_dictionary_media(
    manifest: &DictionaryManifest,
    dictionary: &str,
    path: &str,
) -> Result<DictionaryMediaResource, String> {
    let entry = find_dictionary_media_entry(manifest, dictionary)?;
    let media_path = resolve_dictionary_media_path(Path::new(&entry.internal_path), path)?;
    let mime_type = dictionary_media_mime_type(&media_path)?;
    let data =
        fs::read(&media_path).map_err(|e| format!("Cannot read dictionary media '{path}': {e}"))?;

    Ok(DictionaryMediaResource {
        mime_type: mime_type.into(),
        data_base64: general_purpose::STANDARD.encode(data),
    })
}

fn resolve_dictionary_media_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative_path = relative_path.trim();
    if relative_path.is_empty() {
        return Err("Dictionary media path is empty.".into());
    }

    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        return Err("Dictionary media path must stay inside the imported dictionary.".into());
    }

    let root = root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve dictionary media root: {e}"))?;
    let media_path = root.join(relative);
    let media_path = media_path
        .canonicalize()
        .map_err(|_| format!("Dictionary media not found: {relative_path}"))?;

    if !media_path.starts_with(&root) {
        return Err("Dictionary media path escaped the imported dictionary.".into());
    }
    if !media_path.is_file() {
        return Err(format!("Dictionary media is not a file: {relative_path}"));
    }

    Ok(media_path)
}

fn dictionary_media_mime_type(path: &Path) -> Result<&'static str, String> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "png" => Ok("image/png"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "gif" => Ok("image/gif"),
        "webp" => Ok("image/webp"),
        "avif" => Ok("image/avif"),
        "heic" | "heif" => Ok("image/heic"),
        "svg" => Ok("image/svg+xml"),
        _ => Err(format!(
            "Unsupported dictionary media type: {}",
            path.display()
        )),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DictionaryLoadEntry {
    path: PathBuf,
    use_term: bool,
    use_freq: bool,
    use_pitch: bool,
}

fn enabled_dictionary_load_plan(manifest: &DictionaryManifest) -> Vec<DictionaryLoadEntry> {
    let mut entries = manifest
        .dictionaries
        .iter()
        .filter(|entry| entry.enabled)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.order);
    entries
        .into_iter()
        .filter_map(|entry| {
            let path = PathBuf::from(&entry.internal_path);
            if !is_hoshidicts_term_dir(&path) {
                return None;
            }
            let use_term = entry.term_count > 0 || entry.kind == "term";
            let use_freq = entry.freq_count > 0;
            let use_pitch = entry.pitch_count > 0;
            (use_term || use_freq || use_pitch).then_some(DictionaryLoadEntry {
                path,
                use_term,
                use_freq,
                use_pitch,
            })
        })
        .collect()
}

#[cfg(test)]
fn find_term_dictionary_dirs(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut dirs = fs::read_dir(root)
        .map_err(|e| format!("Cannot read dictionary dir: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_hoshidicts_term_dir(path))
        .collect::<Vec<_>>();
    dirs.sort();
    Ok(dirs)
}

fn is_hoshidicts_term_dir(path: &Path) -> bool {
    path.is_dir()
        && path.join(".hoshidicts_1").is_file()
        && path.join("index.json").is_file()
        && path.join("hash.table").is_file()
        && path.join("blobs.bin").is_file()
}

fn runtime_error(runtime: &DictRuntime) -> String {
    runtime.error.clone().unwrap_or_else(|| {
        if runtime.loaded_dictionaries == 0 {
            "Dictionary backend is not ready: no imported dictionaries loaded.".into()
        } else {
            "Dictionary backend is not ready.".into()
        }
    })
}

fn current_unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn dictionary_zip_id(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| format!("Cannot read dictionary zip: {e}"))?;
    let hash = Sha256::digest(bytes);
    Ok(hash[..8].iter().map(|byte| format!("{byte:02x}")).collect())
}

#[allow(dead_code)]
fn dictionary_kind_from_counts(term_count: usize, freq_count: usize, pitch_count: usize) -> String {
    if term_count > 0 {
        "term".into()
    } else if freq_count > 0 {
        "freq".into()
    } else if pitch_count > 0 {
        "pitch".into()
    } else {
        "unknown".into()
    }
}

#[allow(dead_code)]
fn parse_frequency_entries(json: &str) -> Vec<FrequencyEntry> {
    serde_json::from_str::<Vec<FrequencyEntry>>(json).unwrap_or_default()
}

#[allow(dead_code)]
fn parse_pitch_entries(json: &str) -> Vec<PitchEntry> {
    serde_json::from_str::<Vec<PitchEntry>>(json).unwrap_or_default()
}

#[derive(serde::Deserialize)]
struct ImportedDictionaryIndex {
    title: Option<String>,
}

fn read_imported_dictionary_title(path: &Path) -> Option<String> {
    let content = fs::read_to_string(path.join("index.json")).ok()?;
    let index = serde_json::from_str::<ImportedDictionaryIndex>(&content).ok()?;
    index.title.filter(|title| !title.trim().is_empty())
}

#[cfg(hoshi_dicts_linked)]
fn import_yomitan_zip_linked(
    source: &Path,
    manifest_path: &Path,
    imported_root: &Path,
    final_dir: &Path,
    dict_id: &str,
    app: &AppHandle,
    state: &DictState,
) -> Result<DictImportSummary, String> {
    let staging_root = imported_root.join(format!(".importing-{dict_id}"));
    if staging_root.exists() {
        fs::remove_dir_all(&staging_root)
            .map_err(|e| format!("Cannot clean dictionary import staging dir: {e}"))?;
    }
    fs::create_dir_all(&staging_root)
        .map_err(|e| format!("Cannot create dictionary import staging dir: {e}"))?;

    let mut attempt = run_linked_import_attempt(source, &staging_root)?;
    let mut restored_title = None;
    let mut lookup_safe_zip = None;

    if !attempt.ok() && is_windows_code_page_import_error(&attempt.errors) {
        let _ = fs::remove_dir_all(&staging_root);
        fs::create_dir_all(&staging_root)
            .map_err(|e| format!("Cannot recreate dictionary import staging dir: {e}"))?;

        let safe_zip_path = imported_root.join(format!(".importing-{dict_id}.lookup-safe.zip"));
        let safe_zip = create_lookup_safe_import_zip(source, &safe_zip_path, dict_id)?;
        attempt = run_linked_import_attempt(&safe_zip.path, &staging_root)?;
        restored_title = safe_zip.original_title;
        lookup_safe_zip = Some(safe_zip.path);
    }

    if !attempt.ok() {
        let _ = fs::remove_dir_all(&staging_root);
        if let Some(path) = lookup_safe_zip {
            let _ = fs::remove_file(path);
        }
        return Err(import_error_message(&attempt.errors));
    }

    let imported_dir = find_single_imported_dictionary_dir(&staging_root)?;
    if final_dir.exists() {
        fs::remove_dir_all(final_dir)
            .map_err(|e| format!("Cannot replace existing dictionary dir: {e}"))?;
    }
    fs::rename(&imported_dir, final_dir)
        .or_else(|_| {
            copy_dir_all(&imported_dir, final_dir)?;
            fs::remove_dir_all(&imported_dir)
        })
        .map_err(|e| format!("Cannot move imported dictionary into library: {e}"))?;
    let _ = fs::remove_dir_all(&staging_root);
    if let Some(path) = lookup_safe_zip {
        let _ = fs::remove_file(path);
    }

    let entry = upsert_dictionary_manifest_entry(
        manifest_path,
        DictionaryManifestEntry {
            dict_id: dict_id.to_string(),
            title: if let Some(title) = restored_title {
                title
            } else if attempt.title.trim().is_empty() {
                read_imported_dictionary_title(final_dir)
                    .unwrap_or_else(|| "Imported Dictionary".into())
            } else {
                attempt.title
            },
            kind: dictionary_kind_from_counts(attempt.counts.0, attempt.counts.2, attempt.counts.3),
            enabled: true,
            order: 0,
            internal_path: final_dir.to_string_lossy().into_owned(),
            term_count: attempt.counts.0,
            meta_count: attempt.counts.1,
            freq_count: attempt.counts.2,
            pitch_count: attempt.counts.3,
            media_count: attempt.counts.4,
            last_imported: current_unix_time(),
        },
    )?;

    state.initialize(app);
    let runtime = state.runtime.lock().unwrap();
    Ok(DictImportSummary {
        dict_id: entry.dict_id,
        title: entry.title,
        dictionary_path: entry.internal_path,
        term_count: entry.term_count,
        meta_count: entry.meta_count,
        freq_count: entry.freq_count,
        pitch_count: entry.pitch_count,
        media_count: entry.media_count,
        ready: dict_runtime_ready(&runtime),
        reused: false,
    })
}

#[cfg(hoshi_dicts_linked)]
struct LinkedImportAttempt {
    status: i32,
    success: bool,
    title: String,
    counts: (usize, usize, usize, usize, usize),
    errors: Vec<String>,
}

#[cfg(hoshi_dicts_linked)]
impl LinkedImportAttempt {
    fn ok(&self) -> bool {
        self.status == 0 && self.success
    }
}

#[cfg(hoshi_dicts_linked)]
struct LookupSafeImportZip {
    path: PathBuf,
    original_title: Option<String>,
}

#[cfg(hoshi_dicts_linked)]
fn run_linked_import_attempt(
    source: &Path,
    staging_root: &Path,
) -> Result<LinkedImportAttempt, String> {
    use std::ptr;

    let source_c = CString::new(source.to_string_lossy().as_bytes()).map_err(|_| {
        format!(
            "Dictionary zip path contains an interior NUL: {}",
            source.display()
        )
    })?;
    let staging_c = CString::new(staging_root.to_string_lossy().as_bytes()).map_err(|_| {
        format!(
            "Dictionary import staging path contains an interior NUL: {}",
            staging_root.display()
        )
    })?;
    let mut raw = ffi::DictImportResultC {
        success: 0,
        title: ptr::null(),
        term_count: 0,
        meta_count: 0,
        freq_count: 0,
        pitch_count: 0,
        media_count: 0,
        errors_json: ptr::null(),
    };

    let status =
        unsafe { ffi::dict_import_yomitan_zip(source_c.as_ptr(), staging_c.as_ptr(), 0, &mut raw) };
    let title = unsafe { c_string(raw.title) };
    let errors_json = unsafe { c_string(raw.errors_json) };
    let errors = serde_json::from_str::<Vec<String>>(&errors_json).unwrap_or_default();
    let attempt = LinkedImportAttempt {
        status,
        success: raw.success != 0,
        title,
        counts: (
            raw.term_count,
            raw.meta_count,
            raw.freq_count,
            raw.pitch_count,
            raw.media_count,
        ),
        errors,
    };
    unsafe {
        ffi::free_import_result(&mut raw);
    }
    Ok(attempt)
}

#[cfg(hoshi_dicts_linked)]
fn is_windows_code_page_import_error(errors: &[String]) -> bool {
    errors
        .iter()
        .any(|error| error.contains("Unicode character") || error.contains("multi-byte code page"))
}

#[cfg(hoshi_dicts_linked)]
fn create_lookup_safe_import_zip(
    source: &Path,
    output: &Path,
    dict_id: &str,
) -> Result<LookupSafeImportZip, String> {
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Cannot create dictionary compatibility zip dir: {e}"))?;
    }
    let input = File::open(source).map_err(|e| format!("Cannot open dictionary zip: {e}"))?;
    let mut archive =
        zip::ZipArchive::new(input).map_err(|e| format!("Cannot read dictionary zip: {e}"))?;
    let output_file = File::create(output)
        .map_err(|e| format!("Cannot create dictionary compatibility zip: {e}"))?;
    let mut writer = zip::ZipWriter::new(output_file);
    let options =
        zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut original_index_json = None;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Cannot read dictionary zip entry: {e}"))?;
        let name = file.name().replace('\\', "/");
        if !is_lookup_safe_yomitan_entry(&name) {
            continue;
        }

        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)
            .map_err(|e| format!("Cannot read dictionary zip entry: {e}"))?;
        if name == "index.json" {
            let index_json = String::from_utf8(bytes)
                .map_err(|e| format!("Dictionary index.json is not UTF-8: {e}"))?;
            original_index_json = Some(index_json.clone());
            bytes = rewrite_index_title_for_compat_import(&index_json, dict_id)?;
        }

        writer
            .start_file(name, options)
            .map_err(|e| format!("Cannot write dictionary compatibility zip entry: {e}"))?;
        writer
            .write_all(&bytes)
            .map_err(|e| format!("Cannot write dictionary compatibility zip entry: {e}"))?;
    }

    writer
        .finish()
        .map_err(|e| format!("Cannot finalize dictionary compatibility zip: {e}"))?;
    let original_index_json = original_index_json
        .ok_or_else(|| "Dictionary zip does not contain index.json.".to_string())?;
    let original_title = serde_json::from_str::<ImportedDictionaryIndex>(
        original_index_json.trim_start_matches('\u{feff}'),
    )
    .ok()
    .and_then(|index| index.title)
    .filter(|title| !title.trim().is_empty());
    Ok(LookupSafeImportZip {
        path: output.to_path_buf(),
        original_title,
    })
}

#[cfg(hoshi_dicts_linked)]
fn is_lookup_safe_yomitan_entry(name: &str) -> bool {
    name == "index.json"
        || name == "styles.css"
        || is_numbered_yomitan_bank(name, "term_bank_", ".json")
        || is_numbered_yomitan_bank(name, "term_meta_bank_", ".json")
        || is_numbered_yomitan_bank(name, "tag_bank_", ".json")
}

#[cfg(hoshi_dicts_linked)]
fn is_numbered_yomitan_bank(name: &str, prefix: &str, suffix: &str) -> bool {
    let Some(number) = name
        .strip_prefix(prefix)
        .and_then(|rest| rest.strip_suffix(suffix))
    else {
        return false;
    };
    !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit())
}

#[cfg(hoshi_dicts_linked)]
fn rewrite_index_title_for_compat_import(
    index_json: &str,
    dict_id: &str,
) -> Result<Vec<u8>, String> {
    let mut index =
        serde_json::from_str::<serde_json::Value>(index_json.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("Cannot parse dictionary index.json: {e}"))?;
    if let Some(object) = index.as_object_mut() {
        object.insert(
            "title".into(),
            serde_json::Value::String(format!("hoshi-import-{dict_id}")),
        );
    }
    serde_json::to_vec(&index).map_err(|e| format!("Cannot rewrite dictionary index metadata: {e}"))
}

#[cfg(hoshi_dicts_linked)]
fn import_error_message(errors: &[String]) -> String {
    if errors.is_empty() {
        "Dictionary import failed.".into()
    } else {
        errors.join("; ")
    }
}

#[cfg(hoshi_dicts_linked)]
fn find_single_imported_dictionary_dir(staging_root: &Path) -> Result<PathBuf, String> {
    let mut dirs = fs::read_dir(staging_root)
        .map_err(|e| format!("Cannot read dictionary import staging dir: {e}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_hoshidicts_term_dir(path))
        .collect::<Vec<_>>();
    dirs.sort();
    dirs.into_iter().next().ok_or_else(|| {
        "Dictionary import did not create a valid hoshidicts term dictionary.".into()
    })
}

#[cfg(hoshi_dicts_linked)]
fn copy_dir_all(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_all(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(hoshi_dicts_linked)]
struct DictBackend {
    query: ffi::DictQuery,
    deinflector: ffi::Deinflector,
    engine: ffi::LookupEngine,
}

#[cfg(hoshi_dicts_linked)]
unsafe impl Send for DictBackend {}

#[cfg(hoshi_dicts_linked)]
impl DictBackend {
    fn load(load_plan: &[DictionaryLoadEntry]) -> Result<Self, String> {
        unsafe {
            let query = ffi::dict_query_create();
            if query.is_null() {
                return Err("Cannot create dictionary query.".into());
            }

            for entry in load_plan {
                let path = CString::new(entry.path.to_string_lossy().as_bytes()).map_err(|_| {
                    format!(
                        "Dictionary path contains an interior NUL: {}",
                        entry.path.display()
                    )
                })?;
                if entry.use_term && ffi::dict_query_add_term_dict(query, path.as_ptr()) != 0 {
                    ffi::dict_query_destroy(query);
                    return Err(format!(
                        "Cannot load term dictionary: {}",
                        entry.path.display()
                    ));
                }
                if entry.use_freq && ffi::dict_query_add_freq_dict(query, path.as_ptr()) != 0 {
                    ffi::dict_query_destroy(query);
                    return Err(format!(
                        "Cannot load frequency dictionary: {}",
                        entry.path.display()
                    ));
                }
                if entry.use_pitch && ffi::dict_query_add_pitch_dict(query, path.as_ptr()) != 0 {
                    ffi::dict_query_destroy(query);
                    return Err(format!(
                        "Cannot load pitch dictionary: {}",
                        entry.path.display()
                    ));
                }
            }

            let deinflector = ffi::deinflector_create();
            if deinflector.is_null() {
                ffi::dict_query_destroy(query);
                return Err("Cannot create deinflector.".into());
            }

            let engine = ffi::lookup_engine_create(query, deinflector);
            if engine.is_null() {
                ffi::deinflector_destroy(deinflector);
                ffi::dict_query_destroy(query);
                return Err("Cannot create dictionary lookup engine.".into());
            }

            Ok(Self {
                query,
                deinflector,
                engine,
            })
        }
    }

    fn lookup(&self, text: &str) -> Result<Vec<DictResult>, String> {
        let text = CString::new(text.as_bytes())
            .map_err(|_| "Lookup text contains an interior NUL.".to_string())?;
        let mut out = Vec::<DictResult>::new();
        let status = unsafe {
            ffi::lookup_engine_lookup(
                self.engine,
                text.as_ptr(),
                MAX_LOOKUP_RESULTS,
                SCAN_LENGTH,
                Some(collect_lookup_results),
                &mut out as *mut Vec<DictResult> as *mut c_void,
            )
        };
        if status == 0 {
            Ok(out)
        } else {
            Err("Dictionary lookup failed.".into())
        }
    }
}

#[cfg(hoshi_dicts_linked)]
impl Drop for DictBackend {
    fn drop(&mut self) {
        unsafe {
            ffi::lookup_engine_destroy(self.engine);
            ffi::deinflector_destroy(self.deinflector);
            ffi::dict_query_destroy(self.query);
        }
    }
}

#[cfg(hoshi_dicts_linked)]
unsafe extern "C" fn collect_lookup_results(
    results: *const ffi::LookupResultC,
    count: i32,
    user_data: *mut c_void,
) {
    if results.is_null() || user_data.is_null() || count <= 0 {
        return;
    }

    let out = &mut *(user_data as *mut Vec<DictResult>);
    for index in 0..count {
        let result = &*results.add(index as usize);
        let glossary_json = c_string(result.term.glossary_json);
        let glossary =
            serde_json::from_str::<Vec<GlossaryEntry>>(&glossary_json).unwrap_or_default();
        let frequencies_json = c_string(result.term.frequencies_json);
        let pitches_json = c_string(result.term.pitches_json);
        out.push(DictResult {
            expression: c_string(result.term.expression),
            reading: c_string(result.term.reading),
            glossary,
            matched: c_string(result.matched),
            deinflected: c_string(result.deinflected),
            rules: c_string(result.term.rules),
            dictionary: c_string(result.term.dict_name),
            frequencies: parse_frequency_entries(&frequencies_json),
            pitches: parse_pitch_entries(&pitches_json),
        });
    }
}

#[cfg(hoshi_dicts_linked)]
unsafe fn c_string(value: *const std::ffi::c_char) -> String {
    if value.is_null() {
        String::new()
    } else {
        CStr::from_ptr(value).to_string_lossy().into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hoshi_dict_test_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn manifest_entry(dict_id: &str, order: usize) -> DictionaryManifestEntry {
        DictionaryManifestEntry {
            dict_id: dict_id.into(),
            title: format!("Dictionary {dict_id}"),
            kind: "term".into(),
            enabled: true,
            order,
            internal_path: format!("dictionaries/imported/{dict_id}"),
            term_count: 10,
            meta_count: 1,
            freq_count: 2,
            pitch_count: 3,
            media_count: 4,
            last_imported: 123,
        }
    }

    fn create_valid_dictionary_dir(root: &Path, name: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        for file in [".hoshidicts_1", "index.json", "hash.table", "blobs.bin"] {
            fs::write(dir.join(file), "").unwrap();
        }
        dir
    }

    #[test]
    fn finds_only_imported_hoshidicts_term_dirs() {
        let root = temp_path("term_dirs");
        let valid = root.join("valid");
        let invalid = root.join("invalid");
        fs::create_dir_all(&valid).unwrap();
        fs::create_dir_all(&invalid).unwrap();
        for file in [".hoshidicts_1", "index.json", "hash.table", "blobs.bin"] {
            fs::write(valid.join(file), "").unwrap();
        }
        fs::write(invalid.join("index.json"), "").unwrap();

        let dirs = find_term_dictionary_dirs(&root).unwrap();
        assert_eq!(dirs, vec![valid]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_manifest_reads_as_empty() {
        let root = temp_path("missing_manifest");
        let path = root.join("manifest.json");

        let manifest = read_dictionary_manifest(&path).unwrap();
        assert!(manifest.dictionaries.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_manifest_returns_clear_error() {
        let root = temp_path("corrupt_manifest");
        let path = root.join("manifest.json");
        fs::create_dir_all(&root).unwrap();
        fs::write(&path, "{not-json").unwrap();

        let error = read_dictionary_manifest(&path).unwrap_err();
        assert!(error.starts_with("Cannot parse dictionary manifest:"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_media_loads_by_id_or_title() {
        let root = temp_path("media_lookup");
        let dict_dir = root.join("dict");
        fs::create_dir_all(dict_dir.join("images")).unwrap();
        fs::write(dict_dir.join("images").join("entry.png"), b"png-bytes").unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.title = "Readable Dictionary".into();
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let by_id = load_dictionary_media(&manifest, "abc", "images/entry.png").unwrap();
        assert_eq!(by_id.mime_type, "image/png");
        assert_eq!(by_id.data_base64, "cG5nLWJ5dGVz");

        let by_title =
            load_dictionary_media(&manifest, "Readable Dictionary", "images/entry.png").unwrap();
        assert_eq!(by_title.data_base64, by_id.data_base64);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_media_rejects_path_escape() {
        let root = temp_path("media_escape");
        let dict_dir = root.join("dict");
        fs::create_dir_all(&dict_dir).unwrap();
        fs::write(root.join("outside.png"), b"outside").unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let parent_error = load_dictionary_media(&manifest, "abc", "../outside.png").unwrap_err();
        assert!(parent_error.contains("must stay inside"));
        let absolute_error = load_dictionary_media(
            &manifest,
            "abc",
            &root.join("outside.png").to_string_lossy(),
        )
        .unwrap_err();
        assert!(absolute_error.contains("must stay inside"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_media_reports_missing_or_unsupported_media() {
        let root = temp_path("media_missing");
        let dict_dir = root.join("dict");
        fs::create_dir_all(&dict_dir).unwrap();
        fs::write(dict_dir.join("entry.txt"), b"text").unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let missing = load_dictionary_media(&manifest, "abc", "missing.png").unwrap_err();
        assert!(missing.starts_with("Dictionary media not found:"));
        let unsupported = load_dictionary_media(&manifest, "abc", "entry.txt").unwrap_err();
        assert!(unsupported.starts_with("Unsupported dictionary media type:"));
        let unknown = load_dictionary_media(&manifest, "missing", "entry.png").unwrap_err();
        assert!(unknown.starts_with("Dictionary not found for media request:"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upsert_manifest_entry_adds_and_lists_dictionary() {
        let root = temp_path("manifest_upsert");
        let path = root.join("manifest.json");

        let entry = upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();
        assert_eq!(entry.dict_id, "abc");
        assert_eq!(entry.order, 0);

        let manifest = read_dictionary_manifest(&path).unwrap();
        assert_eq!(manifest.dictionaries, vec![entry]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upsert_manifest_entry_reuses_existing_order() {
        let root = temp_path("manifest_reuse");
        let path = root.join("manifest.json");

        upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();
        upsert_dictionary_manifest_entry(&path, manifest_entry("def", 0)).unwrap();
        let mut updated = manifest_entry("abc", 99);
        updated.title = "Updated".into();
        updated.term_count = 42;
        let entry = upsert_dictionary_manifest_entry(&path, updated).unwrap();

        let manifest = read_dictionary_manifest(&path).unwrap();
        assert_eq!(entry.order, 0);
        assert_eq!(manifest.dictionaries.len(), 2);
        assert_eq!(manifest.dictionaries[0].title, "Updated");
        assert_eq!(manifest.dictionaries[0].term_count, 42);
        assert_eq!(manifest.dictionaries[1].dict_id, "def");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_plan_filters_disabled_entries_and_preserves_order() {
        let root = temp_path("load_plan_order");
        let first = create_valid_dictionary_dir(&root, "first");
        let second = create_valid_dictionary_dir(&root, "second");
        let disabled = create_valid_dictionary_dir(&root, "disabled");
        let missing = root.join("missing");
        let manifest = DictionaryManifest {
            dictionaries: vec![
                DictionaryManifestEntry {
                    internal_path: second.to_string_lossy().into_owned(),
                    order: 2,
                    ..manifest_entry("second", 2)
                },
                DictionaryManifestEntry {
                    internal_path: disabled.to_string_lossy().into_owned(),
                    enabled: false,
                    order: 0,
                    ..manifest_entry("disabled", 0)
                },
                DictionaryManifestEntry {
                    internal_path: first.to_string_lossy().into_owned(),
                    order: 1,
                    ..manifest_entry("first", 1)
                },
                DictionaryManifestEntry {
                    internal_path: missing.to_string_lossy().into_owned(),
                    order: 3,
                    ..manifest_entry("missing", 3)
                },
            ],
        };

        let plan = enabled_dictionary_load_plan(&manifest);
        assert_eq!(
            plan.iter()
                .map(|entry| entry.path.clone())
                .collect::<Vec<_>>(),
            vec![first, second]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_plan_maps_dictionary_roles_from_counts_and_legacy_kind() {
        let root = temp_path("load_plan_roles");
        let term = create_valid_dictionary_dir(&root, "term");
        let freq = create_valid_dictionary_dir(&root, "freq");
        let pitch = create_valid_dictionary_dir(&root, "pitch");
        let legacy = create_valid_dictionary_dir(&root, "legacy");
        let manifest = DictionaryManifest {
            dictionaries: vec![
                DictionaryManifestEntry {
                    internal_path: term.to_string_lossy().into_owned(),
                    term_count: 1,
                    freq_count: 2,
                    pitch_count: 3,
                    kind: "term".into(),
                    order: 0,
                    ..manifest_entry("term", 0)
                },
                DictionaryManifestEntry {
                    internal_path: freq.to_string_lossy().into_owned(),
                    term_count: 0,
                    freq_count: 2,
                    pitch_count: 0,
                    kind: "freq".into(),
                    order: 1,
                    ..manifest_entry("freq", 1)
                },
                DictionaryManifestEntry {
                    internal_path: pitch.to_string_lossy().into_owned(),
                    term_count: 0,
                    freq_count: 0,
                    pitch_count: 3,
                    kind: "pitch".into(),
                    order: 2,
                    ..manifest_entry("pitch", 2)
                },
                DictionaryManifestEntry {
                    internal_path: legacy.to_string_lossy().into_owned(),
                    term_count: 0,
                    freq_count: 0,
                    pitch_count: 0,
                    kind: "term".into(),
                    order: 3,
                    ..manifest_entry("legacy", 3)
                },
            ],
        };

        let plan = enabled_dictionary_load_plan(&manifest);
        assert_eq!(plan.len(), 4);
        assert_eq!(
            (plan[0].use_term, plan[0].use_freq, plan[0].use_pitch),
            (true, true, true)
        );
        assert_eq!(
            (plan[1].use_term, plan[1].use_freq, plan[1].use_pitch),
            (false, true, false)
        );
        assert_eq!(
            (plan[2].use_term, plan[2].use_freq, plan[2].use_pitch),
            (false, false, true)
        );
        assert_eq!(
            (plan[3].use_term, plan[3].use_freq, plan[3].use_pitch),
            (true, false, false)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn set_dictionary_enabled_updates_manifest() {
        let root = temp_path("set_enabled");
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();

        set_dictionary_enabled(&path, "abc", false).unwrap();
        let manifest = read_dictionary_manifest(&path).unwrap();
        assert!(!manifest.dictionaries[0].enabled);

        let error = set_dictionary_enabled(&path, "missing", true).unwrap_err();
        assert_eq!(error, "Dictionary not found: missing");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn set_dictionary_order_reorders_and_rejects_invalid_ids() {
        let root = temp_path("set_order");
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();
        upsert_dictionary_manifest_entry(&path, manifest_entry("def", 0)).unwrap();
        upsert_dictionary_manifest_entry(&path, manifest_entry("ghi", 0)).unwrap();

        let ordered =
            set_dictionary_order(&path, &["ghi".into(), "abc".into(), "def".into()]).unwrap();
        assert_eq!(
            ordered
                .iter()
                .map(|entry| entry.dict_id.as_str())
                .collect::<Vec<_>>(),
            vec!["ghi", "abc", "def"]
        );

        let duplicate =
            set_dictionary_order(&path, &["ghi".into(), "abc".into(), "abc".into()]).unwrap_err();
        assert_eq!(duplicate, "Dictionary order contains duplicate id: abc");

        let unknown = set_dictionary_order(&path, &["ghi".into(), "abc".into(), "missing".into()])
            .unwrap_err();
        assert_eq!(unknown, "Dictionary not found: missing");

        let missing = set_dictionary_order(&path, &["ghi".into(), "abc".into()]).unwrap_err();
        assert_eq!(
            missing,
            "Dictionary order must include every dictionary exactly once."
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn kind_from_counts_prefers_term_then_freq_then_pitch() {
        assert_eq!(dictionary_kind_from_counts(1, 1, 1), "term");
        assert_eq!(dictionary_kind_from_counts(0, 1, 1), "freq");
        assert_eq!(dictionary_kind_from_counts(0, 0, 1), "pitch");
        assert_eq!(dictionary_kind_from_counts(0, 0, 0), "unknown");
    }

    #[test]
    fn parses_frequency_entries() {
        let parsed = parse_frequency_entries(
            r#"[{"dictionary":"freq-a","items":[{"value":1,"displayValue":"ichi"},{"value":42,"displayValue":"42"}]}]"#,
        );

        assert_eq!(
            parsed,
            vec![FrequencyEntry {
                dictionary: "freq-a".into(),
                items: vec![
                    FrequencyItem {
                        value: 1,
                        display_value: "ichi".into(),
                    },
                    FrequencyItem {
                        value: 42,
                        display_value: "42".into(),
                    },
                ],
            }]
        );
    }

    #[test]
    fn parses_pitch_entries() {
        let parsed = parse_pitch_entries(
            r#"[{"dictionary":"pitch-a","positions":[1,2],"transcriptions":["ア","イ"]}]"#,
        );

        assert_eq!(
            parsed,
            vec![PitchEntry {
                dictionary: "pitch-a".into(),
                positions: vec![1, 2],
                transcriptions: vec!["ア".into(), "イ".into()],
            }]
        );
    }

    #[test]
    fn invalid_lookup_metadata_json_returns_empty_entries() {
        assert!(parse_frequency_entries("{not-json").is_empty());
        assert!(parse_pitch_entries("{not-json").is_empty());
    }

    #[test]
    fn dict_result_shape_includes_lookup_metadata() {
        let result = DictResult {
            expression: "学校".into(),
            reading: "がっこう".into(),
            glossary: vec![GlossaryEntry {
                dict: "dict-a".into(),
                text: "school".into(),
            }],
            matched: "学校".into(),
            deinflected: "学校".into(),
            rules: "n".into(),
            dictionary: "dict-a".into(),
            frequencies: parse_frequency_entries(
                r#"[{"dictionary":"freq-a","items":[{"value":10,"displayValue":"10"}]}]"#,
            ),
            pitches: parse_pitch_entries(
                r#"[{"dictionary":"pitch-a","positions":[1],"transcriptions":["ガッコー"]}]"#,
            ),
        };

        assert_eq!(result.rules, "n");
        assert_eq!(result.dictionary, "dict-a");
        assert_eq!(result.frequencies[0].items[0].display_value, "10");
        assert_eq!(result.pitches[0].positions, vec![1]);
    }

    #[test]
    fn dictionary_title_overrides_update_lookup_result_sources() {
        let mut results = vec![DictResult {
            expression: "学校".into(),
            reading: "がっこう".into(),
            glossary: vec![GlossaryEntry {
                dict: "hoshi-import-abc".into(),
                text: "school".into(),
            }],
            matched: "学校".into(),
            deinflected: "学校".into(),
            rules: String::new(),
            dictionary: "hoshi-import-abc".into(),
            frequencies: vec![FrequencyEntry {
                dictionary: "hoshi-import-abc".into(),
                items: vec![FrequencyItem {
                    value: 1,
                    display_value: "1".into(),
                }],
            }],
            pitches: vec![PitchEntry {
                dictionary: "hoshi-import-abc".into(),
                positions: vec![1],
                transcriptions: Vec::new(),
            }],
        }];
        let overrides = HashMap::from([("hoshi-import-abc".into(), "明鏡国語辞典 第三版".into())]);

        apply_dictionary_title_overrides(&mut results, &overrides);

        assert_eq!(results[0].dictionary, "明鏡国語辞典 第三版");
        assert_eq!(results[0].glossary[0].dict, "明鏡国語辞典 第三版");
        assert_eq!(results[0].frequencies[0].dictionary, "明鏡国語辞典 第三版");
        assert_eq!(results[0].pitches[0].dictionary, "明鏡国語辞典 第三版");
    }

    #[test]
    fn runtime_status_reports_no_dictionaries() {
        let status = runtime_status(&DictRuntime::default());
        assert_eq!(status.status, DictionaryStatusKind::NoDictionaries);
        assert_eq!(status.imported_count, 0);
        assert_eq!(status.loaded_count, 0);
    }

    #[test]
    fn runtime_status_reports_manifest_error() {
        let status = runtime_status(&DictRuntime {
            manifest_error: Some("Cannot parse dictionary manifest: test".into()),
            ..DictRuntime::default()
        });
        assert_eq!(status.status, DictionaryStatusKind::Error);
        assert!(status.message.contains("Cannot parse dictionary manifest"));
    }

    #[cfg(not(hoshi_dicts_linked))]
    #[test]
    fn runtime_status_reports_engine_unavailable_with_imports() {
        let status = runtime_status(&DictRuntime {
            imported_count: 1,
            loaded_dictionaries: 1,
            error: Some("Dictionary engine not linked.".into()),
            ..DictRuntime::default()
        });
        assert_eq!(status.status, DictionaryStatusKind::EngineUnavailable);
        assert_eq!(status.imported_count, 1);
    }

    #[test]
    fn runtime_status_reports_no_enabled_term_dictionary() {
        let status = runtime_status(&DictRuntime {
            imported_count: 1,
            error: Some("No enabled term dictionaries found in dictionary manifest.".into()),
            ..DictRuntime::default()
        });
        assert_eq!(status.status, DictionaryStatusKind::NoDictionaries);
        assert_eq!(
            status.message,
            "No enabled term dictionaries found in dictionary manifest."
        );
    }

    #[cfg(hoshi_dicts_linked)]
    #[test]
    #[ignore]
    fn imports_real_yomitan_zip_and_loads_runtime() {
        let zip_path =
            std::env::var("HSW_REAL_YOMITAN_ZIP").expect("HSW_REAL_YOMITAN_ZIP is required");
        let source = PathBuf::from(zip_path);
        assert!(source.is_file(), "real dictionary zip must exist");

        let root = temp_path("real_yomitan_import");
        let staging_root = root.join("staging");
        let imported_root = root.join("imported");
        let manifest_path = root.join("manifest.json");
        fs::create_dir_all(&staging_root).unwrap();
        fs::create_dir_all(&imported_root).unwrap();

        let dict_id = dictionary_zip_id(&source).unwrap();
        let mut attempt = run_linked_import_attempt(&source, &staging_root).unwrap();
        let mut restored_title = None;
        let mut lookup_safe_zip = None;

        if !attempt.ok() && is_windows_code_page_import_error(&attempt.errors) {
            let _ = fs::remove_dir_all(&staging_root);
            fs::create_dir_all(&staging_root).unwrap();
            let safe_zip_path = imported_root.join(format!(".importing-{dict_id}.lookup-safe.zip"));
            let safe_zip =
                create_lookup_safe_import_zip(&source, &safe_zip_path, &dict_id).unwrap();
            attempt = run_linked_import_attempt(&safe_zip.path, &staging_root).unwrap();
            restored_title = safe_zip.original_title;
            lookup_safe_zip = Some(safe_zip.path);
        }
        assert!(
            attempt.ok(),
            "importer failed: {}",
            import_error_message(&attempt.errors)
        );
        let counts = attempt.counts;
        assert!(counts.0 > 0, "real dictionary must contain terms");

        let imported_dir = find_single_imported_dictionary_dir(&staging_root).unwrap();
        assert!(is_hoshidicts_term_dir(&imported_dir));
        let final_dir = imported_root.join(&dict_id);
        fs::rename(&imported_dir, &final_dir).unwrap();
        let _ = fs::remove_dir_all(&staging_root);
        if let Some(path) = lookup_safe_zip {
            let _ = fs::remove_file(path);
        }

        for file in [".hoshidicts_1", "index.json", "hash.table", "blobs.bin"] {
            assert!(final_dir.join(file).is_file(), "{file} should exist");
        }

        let first = upsert_dictionary_manifest_entry(
            &manifest_path,
            DictionaryManifestEntry {
                dict_id: dict_id.clone(),
                title: if let Some(title) = restored_title {
                    title
                } else if attempt.title.trim().is_empty() {
                    read_imported_dictionary_title(&final_dir)
                        .unwrap_or_else(|| "Imported Dictionary".into())
                } else {
                    attempt.title
                },
                kind: dictionary_kind_from_counts(counts.0, counts.2, counts.3),
                enabled: true,
                order: 0,
                internal_path: final_dir.to_string_lossy().into_owned(),
                term_count: counts.0,
                meta_count: counts.1,
                freq_count: counts.2,
                pitch_count: counts.3,
                media_count: counts.4,
                last_imported: current_unix_time(),
            },
        )
        .unwrap();
        let second = upsert_dictionary_manifest_entry(&manifest_path, first.clone()).unwrap();
        assert_eq!(first.dict_id, second.dict_id);
        assert_eq!(second.order, 0);

        let manifest = read_dictionary_manifest(&manifest_path).unwrap();
        assert_eq!(manifest.dictionaries.len(), 1);
        assert_eq!(manifest.dictionaries[0].dict_id, dict_id);
        assert!(manifest.dictionaries[0].enabled);
        assert_eq!(manifest.dictionaries[0].kind, "term");
        assert_eq!(manifest.dictionaries[0].internal_path, first.internal_path);
        assert_eq!(manifest.dictionaries[0].term_count, counts.0);
        assert!(manifest.dictionaries[0].last_imported > 0);

        let plan = enabled_dictionary_load_plan(&manifest);
        assert_eq!(plan.len(), 1);
        let backend = DictBackend::load(&plan).expect("linked runtime loads real dictionary");
        let results = backend.lookup("学校").expect("real lookup succeeds");
        assert!(!results.is_empty(), "real lookup should return results");

        eprintln!("title={}", first.title);
        eprintln!("dict_id={}", first.dict_id);
        eprintln!(
            "counts term={} meta={} freq={} pitch={} media={}",
            counts.0, counts.1, counts.2, counts.3, counts.4
        );
        eprintln!("lookup_results={}", results.len());

        let _ = fs::remove_dir_all(root);
    }
}
