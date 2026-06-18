use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
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
    #[serde(default)]
    pub import_id: String,
    pub title: String,
    pub kind: String,
    #[serde(default)]
    pub role: String,
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryStyleResource {
    pub css: String,
    pub source: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryManifest {
    pub(crate) dictionaries: Vec<DictionaryManifestEntry>,
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
pub fn dictionary_styles(
    dictionary: String,
    app: AppHandle,
) -> Result<DictionaryStyleResource, String> {
    let manifest = read_dictionary_manifest(&dictionary_manifest_path(&app)?)?;
    load_dictionary_styles(&manifest, &dictionary)
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
    role: String,
    dict_ids: Vec<String>,
    app: AppHandle,
    state: tauri::State<DictState>,
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let manifest_path = dictionary_manifest_path(&app)?;
    let entries = set_dictionary_order(&manifest_path, &role, &dict_ids)?;
    state.initialize(&app);
    Ok(entries)
}

#[tauri::command]
pub fn dictionary_remove_import(
    import_id: String,
    app: AppHandle,
    state: tauri::State<DictState>,
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let manifest_path = dictionary_manifest_path(&app)?;
    let imported_root = imported_dictionary_root(&app)?;
    let entries = remove_dictionary_import(&manifest_path, &imported_root, &import_id)?;
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
            .find(|dictionary| dictionary.import_id == dict_id)
            .map(Ok)
            .unwrap_or_else(|| {
                let entries = dictionary_entries_for_import(
                    &dict_id,
                    read_imported_dictionary_title(&final_dir)
                        .unwrap_or_else(|| "Imported Dictionary".into()),
                    final_dir.to_string_lossy().into_owned(),
                    (0, 0, 0, 0, 0),
                    current_unix_time(),
                );
                upsert_dictionary_manifest_entries(&manifest_path, entries).and_then(|entries| {
                    entries
                        .into_iter()
                        .next()
                        .ok_or_else(|| "Dictionary import created no entries.".into())
                })
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

pub(crate) fn dictionary_manifest_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(dictionary_data_root(app)?.join("manifest.json"))
}

pub(crate) fn read_dictionary_manifest(path: &Path) -> Result<DictionaryManifest, String> {
    if !path.exists() {
        return Ok(DictionaryManifest::default());
    }

    let content =
        fs::read_to_string(path).map_err(|e| format!("Cannot read dictionary manifest: {e}"))?;
    let manifest = serde_json::from_str::<DictionaryManifest>(&content)
        .map_err(|e| format!("Cannot parse dictionary manifest: {e}"))?;
    Ok(normalize_dictionary_manifest(manifest))
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

fn normalize_dictionary_manifest(manifest: DictionaryManifest) -> DictionaryManifest {
    let mut dictionaries = Vec::new();
    for entry in manifest.dictionaries {
        dictionaries.extend(normalize_dictionary_manifest_entry(entry));
    }
    sort_dictionary_manifest_entries(&mut dictionaries);
    DictionaryManifest { dictionaries }
}

fn normalize_dictionary_manifest_entry(
    mut entry: DictionaryManifestEntry,
) -> Vec<DictionaryManifestEntry> {
    if let Some(role) = normalize_dictionary_role(&entry.role) {
        entry.role = role.clone();
        entry.kind = role;
        if entry.import_id.trim().is_empty() {
            entry.import_id = import_id_from_role_dict_id(&entry.dict_id);
        }
        if !entry.dict_id.ends_with(&format!(":{}", entry.role)) {
            entry.dict_id = role_dict_id(&entry.import_id, &entry.role);
        }
        return vec![entry];
    }

    let import_id = if entry.import_id.trim().is_empty() {
        import_id_from_role_dict_id(&entry.dict_id)
    } else {
        entry.import_id.clone()
    };
    let roles = dictionary_roles_from_counts(&entry);
    roles
        .into_iter()
        .map(|role| {
            let mut role_entry = entry.clone();
            role_entry.import_id = import_id.clone();
            role_entry.role = role.clone();
            role_entry.kind = role.clone();
            role_entry.dict_id = role_dict_id(&import_id, &role);
            role_entry
        })
        .collect()
}

fn dictionary_roles_from_counts(entry: &DictionaryManifestEntry) -> Vec<String> {
    let mut roles = Vec::new();
    if entry.term_count > 0 || normalize_dictionary_role(&entry.kind).as_deref() == Some("term") {
        roles.push("term".into());
    }
    if entry.freq_count > 0
        || normalize_dictionary_role(&entry.kind).as_deref() == Some("frequency")
    {
        roles.push("frequency".into());
    }
    if entry.pitch_count > 0 || normalize_dictionary_role(&entry.kind).as_deref() == Some("pitch") {
        roles.push("pitch".into());
    }
    if roles.is_empty() {
        roles.push("term".into());
    }
    roles
}

fn normalize_dictionary_role(role: &str) -> Option<String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "term" => Some("term".into()),
        "freq" | "frequency" => Some("frequency".into()),
        "pitch" => Some("pitch".into()),
        _ => None,
    }
}

fn import_id_from_role_dict_id(dict_id: &str) -> String {
    for role in ["term", "frequency", "freq", "pitch"] {
        if let Some(import_id) = dict_id.strip_suffix(&format!(":{role}")) {
            return import_id.into();
        }
    }
    dict_id.into()
}

fn role_dict_id(import_id: &str, role: &str) -> String {
    format!("{import_id}:{role}")
}

fn next_dictionary_role_order(manifest: &DictionaryManifest, role: &str) -> usize {
    manifest
        .dictionaries
        .iter()
        .filter(|dictionary| dictionary.role == role)
        .map(|dictionary| dictionary.order)
        .max()
        .map(|order| order + 1)
        .unwrap_or(0)
}

fn sort_dictionary_manifest_entries(entries: &mut [DictionaryManifestEntry]) {
    entries
        .sort_by_key(|dictionary| (dictionary_role_sort_key(&dictionary.role), dictionary.order));
}

fn dictionary_role_sort_key(role: &str) -> usize {
    match role {
        "term" => 0,
        "frequency" => 1,
        "pitch" => 2,
        _ => 3,
    }
}

fn dictionary_entries_for_import(
    import_id: &str,
    title: String,
    internal_path: String,
    counts: (usize, usize, usize, usize, usize),
    last_imported: u64,
) -> Vec<DictionaryManifestEntry> {
    let template = DictionaryManifestEntry {
        dict_id: import_id.into(),
        import_id: import_id.into(),
        title,
        kind: "term".into(),
        role: String::new(),
        enabled: true,
        order: 0,
        internal_path,
        term_count: counts.0,
        meta_count: counts.1,
        freq_count: counts.2,
        pitch_count: counts.3,
        media_count: counts.4,
        last_imported,
    };
    dictionary_roles_from_counts(&template)
        .into_iter()
        .map(|role| DictionaryManifestEntry {
            dict_id: role_dict_id(import_id, &role),
            import_id: import_id.into(),
            kind: role.clone(),
            role,
            ..template.clone()
        })
        .collect()
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
        entry.order = next_dictionary_role_order(&manifest, &entry.role);
        manifest.dictionaries.push(entry.clone());
    }
    sort_dictionary_manifest_entries(&mut manifest.dictionaries);
    write_dictionary_manifest(path, &manifest)?;
    Ok(entry)
}

fn upsert_dictionary_manifest_entries(
    path: &Path,
    entries: Vec<DictionaryManifestEntry>,
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let mut saved = Vec::new();
    for entry in entries {
        saved.push(upsert_dictionary_manifest_entry(path, entry)?);
    }
    Ok(saved)
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
    role: &str,
    dict_ids: &[String],
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let mut manifest = read_dictionary_manifest(path)?;
    let role = normalize_dictionary_role(role)
        .ok_or_else(|| format!("Unknown dictionary role: {role}"))?;
    validate_dictionary_order_ids(&manifest, &role, dict_ids)?;

    for (order, dict_id) in dict_ids.iter().enumerate() {
        if let Some(entry) = manifest
            .dictionaries
            .iter_mut()
            .find(|dictionary| &dictionary.dict_id == dict_id)
        {
            entry.order = order;
        }
    }
    sort_dictionary_manifest_entries(&mut manifest.dictionaries);
    write_dictionary_manifest(path, &manifest)?;
    Ok(manifest.dictionaries)
}

fn validate_dictionary_order_ids(
    manifest: &DictionaryManifest,
    role: &str,
    dict_ids: &[String],
) -> Result<(), String> {
    let role_entries = manifest
        .dictionaries
        .iter()
        .filter(|dictionary| dictionary.role == role)
        .collect::<Vec<_>>();

    if dict_ids.len() != role_entries.len() {
        return Err(
            "Dictionary order must include every dictionary in the selected category exactly once."
                .into(),
        );
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

    let mut existing = role_entries
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
        return Err(
            "Dictionary order must include every dictionary in the selected category exactly once."
                .into(),
        );
    }

    Ok(())
}

fn remove_dictionary_import(
    manifest_path: &Path,
    imported_root: &Path,
    import_id: &str,
) -> Result<Vec<DictionaryManifestEntry>, String> {
    let import_id = import_id.trim();
    if import_id.is_empty() {
        return Err("Dictionary import id is empty.".into());
    }

    let mut manifest = read_dictionary_manifest(manifest_path)?;
    let removed = manifest
        .dictionaries
        .iter()
        .filter(|entry| entry.import_id == import_id)
        .cloned()
        .collect::<Vec<_>>();
    if removed.is_empty() {
        return Err(format!("Dictionary import not found: {import_id}"));
    }

    let mut paths = removed
        .iter()
        .map(|entry| entry.internal_path.clone())
        .collect::<Vec<_>>();
    paths.sort();
    paths.dedup();
    if paths.len() != 1 {
        return Err(format!(
            "Dictionary import has inconsistent paths and cannot be removed safely: {import_id}"
        ));
    }

    let remove_path = safe_imported_dictionary_remove_path(imported_root, &paths[0])?;
    manifest
        .dictionaries
        .retain(|entry| entry.import_id != import_id);
    write_dictionary_manifest(manifest_path, &manifest)?;

    if remove_path.exists() {
        fs::remove_dir_all(&remove_path)
            .map_err(|e| format!("Cannot remove imported dictionary: {e}"))?;
    }

    Ok(manifest.dictionaries)
}

fn safe_imported_dictionary_remove_path(
    imported_root: &Path,
    internal_path: &str,
) -> Result<PathBuf, String> {
    let root = imported_root
        .canonicalize()
        .map_err(|e| format!("Cannot resolve imported dictionary root: {e}"))?;
    let path = PathBuf::from(internal_path);
    if path.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::Prefix(_) | Component::RootDir
        )
    }) && !path.is_absolute()
    {
        return Err("Imported dictionary path escaped the app dictionary directory.".into());
    }
    let resolved = if path.exists() {
        path.canonicalize()
            .map_err(|e| format!("Cannot resolve imported dictionary path: {e}"))?
    } else if path.is_absolute() {
        path
    } else {
        root.join(path)
    };

    if !resolved.starts_with(&root) {
        return Err("Imported dictionary path escaped the app dictionary directory.".into());
    }
    Ok(resolved)
}

fn find_dictionary_entry<'a>(
    manifest: &'a DictionaryManifest,
    dictionary: &str,
    request_kind: &str,
) -> Result<&'a DictionaryManifestEntry, String> {
    let needle = dictionary.trim();
    if needle.is_empty() {
        return Err(format!(
            "Dictionary {request_kind} request is missing a dictionary id."
        ));
    }

    manifest
        .dictionaries
        .iter()
        .find(|entry| entry.dict_id == needle)
        .or_else(|| {
            manifest
                .dictionaries
                .iter()
                .find(|entry| entry.import_id == needle)
        })
        .or_else(|| {
            manifest
                .dictionaries
                .iter()
                .filter(|entry| entry.title == needle)
                .min_by_key(|entry| entry.order)
        })
        .ok_or_else(|| format!("Dictionary not found for {request_kind} request: {needle}"))
}

pub(crate) fn load_dictionary_media(
    manifest: &DictionaryManifest,
    dictionary: &str,
    path: &str,
) -> Result<DictionaryMediaResource, String> {
    let entry = find_dictionary_entry(manifest, dictionary, "media")?;
    let media_path = resolve_dictionary_media_path(Path::new(&entry.internal_path), path)?;
    let mime_type = dictionary_media_mime_type(&media_path)?;
    let data =
        fs::read(&media_path).map_err(|e| format!("Cannot read dictionary media '{path}': {e}"))?;

    Ok(DictionaryMediaResource {
        mime_type: mime_type.into(),
        data_base64: general_purpose::STANDARD.encode(data),
    })
}

fn load_dictionary_styles(
    manifest: &DictionaryManifest,
    dictionary: &str,
) -> Result<DictionaryStyleResource, String> {
    let entry = find_dictionary_entry(manifest, dictionary, "styles")?;
    let styles_path = Path::new(&entry.internal_path).join("styles.css");
    if !styles_path.exists() {
        return Ok(DictionaryStyleResource {
            css: String::new(),
            source: entry.dict_id.clone(),
        });
    }
    if !styles_path.is_file() {
        return Err(format!(
            "Dictionary styles path is not a file: {}",
            styles_path.display()
        ));
    }

    let css = fs::read_to_string(&styles_path)
        .map_err(|e| format!("Cannot read dictionary styles.css: {e}"))?;
    Ok(DictionaryStyleResource {
        css,
        source: entry.dict_id.clone(),
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
    entries.sort_by_key(|entry| (dictionary_role_sort_key(&entry.role), entry.order));
    let mut seen = HashSet::<(PathBuf, String)>::new();
    entries
        .into_iter()
        .filter_map(|entry| {
            let path = PathBuf::from(&entry.internal_path);
            if !is_hoshidicts_term_dir(&path) {
                return None;
            }
            let role = normalize_dictionary_role(&entry.role)
                .or_else(|| normalize_dictionary_role(&entry.kind))?;
            if !seen.insert((path.clone(), role.clone())) {
                return None;
            }
            let use_term = role == "term" && (entry.term_count > 0 || entry.kind == "term");
            let use_freq = role == "frequency" && entry.freq_count > 0;
            let use_pitch = role == "pitch" && entry.pitch_count > 0;
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

#[cfg(any(hoshi_dicts_linked, test))]
fn prepare_ascii_dictionary_import_source(
    source: &Path,
    imported_root: &Path,
    dict_id: &str,
) -> Result<PathBuf, String> {
    fs::create_dir_all(imported_root)
        .map_err(|e| format!("Cannot create dictionary import temp dir: {e}"))?;
    let temp_source = imported_root.join(format!(".importing-{dict_id}.source.zip"));
    if temp_source.exists() {
        fs::remove_file(&temp_source)
            .map_err(|e| format!("Cannot replace dictionary import temp zip: {e}"))?;
    }
    fs::copy(source, &temp_source)
        .map_err(|e| format!("Cannot prepare dictionary import temp zip: {e}"))?;
    Ok(temp_source)
}

#[cfg(any(hoshi_dicts_linked, test))]
fn cleanup_dictionary_import_temps(staging_root: &Path, temp_paths: &[PathBuf]) {
    let _ = fs::remove_dir_all(staging_root);
    for path in temp_paths {
        let _ = fs::remove_file(path);
    }
}

#[allow(dead_code)]
fn dictionary_kind_from_counts(term_count: usize, freq_count: usize, pitch_count: usize) -> String {
    if term_count > 0 {
        "term".into()
    } else if freq_count > 0 {
        "frequency".into()
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
    let mut temp_paths = Vec::<PathBuf>::new();
    let result = (|| -> Result<DictImportSummary, String> {
        if staging_root.exists() {
            fs::remove_dir_all(&staging_root)
                .map_err(|e| format!("Cannot clean dictionary import staging dir: {e}"))?;
        }
        fs::create_dir_all(&staging_root)
            .map_err(|e| format!("Cannot create dictionary import staging dir: {e}"))?;

        let ascii_source_zip =
            prepare_ascii_dictionary_import_source(source, imported_root, dict_id)?;
        temp_paths.push(ascii_source_zip.clone());

        let mut attempt = run_linked_import_attempt(&ascii_source_zip, &staging_root)?;
        let mut restored_title = None;

        if !attempt.ok() && is_windows_code_page_import_error(&attempt.errors) {
            let _ = fs::remove_dir_all(&staging_root);
            fs::create_dir_all(&staging_root)
                .map_err(|e| format!("Cannot recreate dictionary import staging dir: {e}"))?;

            let safe_zip_path = imported_root.join(format!(".importing-{dict_id}.lookup-safe.zip"));
            let safe_zip =
                create_lookup_safe_import_zip(&ascii_source_zip, &safe_zip_path, dict_id)?;
            attempt = run_linked_import_attempt(&safe_zip.path, &staging_root)?;
            restored_title = safe_zip.original_title;
            temp_paths.push(safe_zip.path);
        }

        if !attempt.ok() {
            return Err(import_error_message(&attempt.errors));
        }

        let imported_dir = find_single_imported_dictionary_dir(&staging_root)?;
        replace_imported_dictionary_dir(&imported_dir, final_dir)?;

        let title = if let Some(title) = restored_title {
            title
        } else if attempt.title.trim().is_empty() {
            read_imported_dictionary_title(final_dir)
                .unwrap_or_else(|| "Imported Dictionary".into())
        } else {
            attempt.title
        };
        let entries = upsert_dictionary_manifest_entries(
            manifest_path,
            dictionary_entries_for_import(
                dict_id,
                title,
                final_dir.to_string_lossy().into_owned(),
                attempt.counts,
                current_unix_time(),
            ),
        )?;
        let entry = entries
            .first()
            .cloned()
            .ok_or_else(|| "Dictionary import created no entries.".to_string())?;

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
    })();

    cleanup_dictionary_import_temps(&staging_root, &temp_paths);
    result
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

#[cfg_attr(not(hoshi_dicts_linked), allow(dead_code))]
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

#[cfg_attr(not(hoshi_dicts_linked), allow(dead_code))]
fn replace_imported_dictionary_dir(imported_dir: &Path, final_dir: &Path) -> Result<(), String> {
    let backup_dir = final_dir.with_extension("replacing");
    if final_dir.exists() {
        if backup_dir.exists() {
            fs::remove_dir_all(&backup_dir)
                .map_err(|e| format!("Cannot clean dictionary replacement backup: {e}"))?;
        }
        fs::rename(final_dir, &backup_dir)
            .map_err(|e| format!("Cannot prepare existing dictionary dir for replacement: {e}"))?;
    }

    let moved = fs::rename(imported_dir, final_dir).or_else(|_| {
        copy_dir_all(imported_dir, final_dir)?;
        fs::remove_dir_all(imported_dir)
    });

    if let Err(error) = moved {
        if backup_dir.exists() {
            if final_dir.exists() {
                let _ = fs::remove_dir_all(final_dir);
            }
            let _ = fs::rename(&backup_dir, final_dir);
        }
        return Err(format!(
            "Cannot move imported dictionary into library: {error}"
        ));
    }

    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir)
            .map_err(|e| format!("Cannot remove replaced dictionary backup: {e}"))?;
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
            dict_id: role_dict_id(dict_id, "term"),
            import_id: dict_id.into(),
            title: format!("Dictionary {dict_id}"),
            kind: "term".into(),
            role: "term".into(),
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
    fn prepares_ascii_dictionary_import_source_from_non_ascii_filename() {
        let root = temp_path("ascii_import_source");
        let source_dir = root.join("Yomitan辞典");
        let imported_root = root.join("imported");
        fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("[画像付き] 絵でわかる日本語 v3.zip");
        fs::write(&source, b"dictionary zip bytes").unwrap();

        let dict_id = dictionary_zip_id(&source).unwrap();
        let temp_source =
            prepare_ascii_dictionary_import_source(&source, &imported_root, &dict_id).unwrap();

        assert_eq!(
            temp_source.file_name().unwrap().to_string_lossy(),
            format!(".importing-{dict_id}.source.zip")
        );
        assert!(temp_source
            .file_name()
            .unwrap()
            .to_string_lossy()
            .bytes()
            .all(|byte| byte.is_ascii()));
        assert_eq!(fs::read(&temp_source).unwrap(), fs::read(&source).unwrap());
        assert_eq!(dictionary_zip_id(&temp_source).unwrap(), dict_id);
        assert!(
            source.is_file(),
            "original dictionary zip should remain untouched"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cleanup_dictionary_import_temps_removes_staging_and_temp_zips() {
        let root = temp_path("cleanup_import_temps");
        let staging_root = root.join(".importing-abc");
        let imported_root = root.join("imported");
        fs::create_dir_all(&staging_root).unwrap();
        fs::create_dir_all(&imported_root).unwrap();
        let source_temp = imported_root.join(".importing-abc.source.zip");
        let safe_temp = imported_root.join(".importing-abc.lookup-safe.zip");
        fs::write(&source_temp, b"source").unwrap();
        fs::write(&safe_temp, b"safe").unwrap();

        cleanup_dictionary_import_temps(&staging_root, &[source_temp.clone(), safe_temp.clone()]);

        assert!(!staging_root.exists());
        assert!(!source_temp.exists());
        assert!(!safe_temp.exists());

        let _ = fs::remove_dir_all(root);
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
    fn legacy_manifest_entries_expand_to_role_entries() {
        let root = temp_path("legacy_manifest_roles");
        let path = root.join("manifest.json");
        fs::create_dir_all(&root).unwrap();
        let legacy = serde_json::json!({
            "dictionaries": [{
                "dictId": "legacy",
                "title": "Legacy Dictionary",
                "kind": "term",
                "enabled": true,
                "order": 7,
                "internalPath": "dictionaries/imported/legacy",
                "termCount": 10,
                "metaCount": 1,
                "freqCount": 2,
                "pitchCount": 3,
                "mediaCount": 4,
                "lastImported": 123
            }]
        });
        fs::write(&path, serde_json::to_string_pretty(&legacy).unwrap()).unwrap();

        let manifest = read_dictionary_manifest(&path).unwrap();
        assert_eq!(
            manifest
                .dictionaries
                .iter()
                .map(|entry| (
                    entry.dict_id.as_str(),
                    entry.import_id.as_str(),
                    entry.role.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("legacy:term", "legacy", "term"),
                ("legacy:frequency", "legacy", "frequency"),
                ("legacy:pitch", "legacy", "pitch"),
            ]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_entries_are_split_by_detected_roles() {
        let entries = dictionary_entries_for_import(
            "abc",
            "Split Dictionary".into(),
            "dictionaries/imported/abc".into(),
            (10, 1, 2, 3, 4),
            123,
        );

        assert_eq!(
            entries
                .iter()
                .map(|entry| (
                    entry.dict_id.as_str(),
                    entry.kind.as_str(),
                    entry.role.as_str()
                ))
                .collect::<Vec<_>>(),
            vec![
                ("abc:term", "term", "term"),
                ("abc:frequency", "frequency", "frequency"),
                ("abc:pitch", "pitch", "pitch"),
            ]
        );
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
    fn dictionary_styles_loads_by_id_or_title() {
        let root = temp_path("styles_lookup");
        let dict_dir = root.join("dict");
        fs::create_dir_all(&dict_dir).unwrap();
        fs::write(
            dict_dir.join("styles.css"),
            ".gloss-sc-span { color: rgb(1, 2, 3); }",
        )
        .unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.title = "Readable Dictionary".into();
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let by_id = load_dictionary_styles(&manifest, "abc").unwrap();
        assert_eq!(by_id.source, "abc:term");
        assert!(by_id.css.contains("rgb(1, 2, 3)"));

        let by_title = load_dictionary_styles(&manifest, "Readable Dictionary").unwrap();
        assert_eq!(by_title.css, by_id.css);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_styles_missing_file_returns_empty_css() {
        let root = temp_path("styles_missing");
        let dict_dir = root.join("dict");
        fs::create_dir_all(&dict_dir).unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let styles = load_dictionary_styles(&manifest, "abc").unwrap();
        assert_eq!(styles.source, "abc:term");
        assert_eq!(styles.css, "");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_styles_reports_invalid_source() {
        let root = temp_path("styles_invalid");
        let dict_dir = root.join("dict");
        fs::create_dir_all(dict_dir.join("styles.css")).unwrap();

        let mut entry = manifest_entry("abc", 0);
        entry.internal_path = dict_dir.to_string_lossy().into_owned();
        let manifest = DictionaryManifest {
            dictionaries: vec![entry],
        };

        let invalid = load_dictionary_styles(&manifest, "abc").unwrap_err();
        assert!(invalid.starts_with("Dictionary styles path is not a file:"));
        let unknown = load_dictionary_styles(&manifest, "missing").unwrap_err();
        assert!(unknown.starts_with("Dictionary not found for styles request:"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upsert_manifest_entry_adds_and_lists_dictionary() {
        let root = temp_path("manifest_upsert");
        let path = root.join("manifest.json");

        let entry = upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();
        assert_eq!(entry.dict_id, "abc:term");
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
        assert_eq!(manifest.dictionaries[1].dict_id, "def:term");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_replacement_restores_existing_dir_on_failure() {
        let root = temp_path("dict_replace_restore");
        let final_dir = root.join("imported").join("abc");
        let imported_dir = root.join("imported").join(".importing-abc").join("dict");
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("index.json"), "old").unwrap();

        let error = replace_imported_dictionary_dir(&imported_dir, &final_dir).unwrap_err();
        assert!(error.starts_with("Cannot move imported dictionary into library:"));
        assert_eq!(
            fs::read_to_string(final_dir.join("index.json")).unwrap(),
            "old"
        );
        assert!(!final_dir.with_extension("replacing").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_replacement_removes_backup_after_success() {
        let root = temp_path("dict_replace_success");
        let final_dir = root.join("imported").join("abc");
        let imported_dir = root.join("imported").join(".importing-abc").join("dict");
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("index.json"), "old").unwrap();
        fs::create_dir_all(&imported_dir).unwrap();
        fs::write(imported_dir.join("index.json"), "new").unwrap();

        replace_imported_dictionary_dir(&imported_dir, &final_dir).unwrap();
        assert_eq!(
            fs::read_to_string(final_dir.join("index.json")).unwrap(),
            "new"
        );
        assert!(!imported_dir.exists());
        assert!(!final_dir.with_extension("replacing").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn dictionary_import_cleanup_removes_staging_and_safe_zip() {
        let root = temp_path("dict_cleanup");
        let staging_root = root.join(".importing-abc");
        let safe_zip = root.join(".importing-abc.lookup-safe.zip");
        fs::create_dir_all(&staging_root).unwrap();
        fs::write(staging_root.join("temp"), "temp").unwrap();
        fs::write(&safe_zip, "zip").unwrap();

        cleanup_dictionary_import_temps(&staging_root, std::slice::from_ref(&safe_zip));
        assert!(!staging_root.exists());
        assert!(!safe_zip.exists());

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
                    kind: "frequency".into(),
                    role: "frequency".into(),
                    dict_id: "freq:frequency".into(),
                    order: 1,
                    ..manifest_entry("freq", 1)
                },
                DictionaryManifestEntry {
                    internal_path: pitch.to_string_lossy().into_owned(),
                    term_count: 0,
                    freq_count: 0,
                    pitch_count: 3,
                    kind: "pitch".into(),
                    role: "pitch".into(),
                    dict_id: "pitch:pitch".into(),
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
            (true, false, false)
        );
        assert_eq!(
            (plan[1].use_term, plan[1].use_freq, plan[1].use_pitch),
            (true, false, false)
        );
        assert_eq!(
            (plan[2].use_term, plan[2].use_freq, plan[2].use_pitch),
            (false, true, false)
        );
        assert_eq!(
            (plan[3].use_term, plan[3].use_freq, plan[3].use_pitch),
            (false, false, true)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn set_dictionary_enabled_updates_manifest() {
        let root = temp_path("set_enabled");
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entry(&path, manifest_entry("abc", 0)).unwrap();

        set_dictionary_enabled(&path, "abc:term", false).unwrap();
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

        let ordered = set_dictionary_order(
            &path,
            "term",
            &["ghi:term".into(), "abc:term".into(), "def:term".into()],
        )
        .unwrap();
        assert_eq!(
            ordered
                .iter()
                .map(|entry| entry.dict_id.as_str())
                .collect::<Vec<_>>(),
            vec!["ghi:term", "abc:term", "def:term"]
        );

        let duplicate = set_dictionary_order(
            &path,
            "term",
            &["ghi:term".into(), "abc:term".into(), "abc:term".into()],
        )
        .unwrap_err();
        assert_eq!(
            duplicate,
            "Dictionary order contains duplicate id: abc:term"
        );

        let unknown = set_dictionary_order(
            &path,
            "term",
            &["ghi:term".into(), "abc:term".into(), "missing:term".into()],
        )
        .unwrap_err();
        assert_eq!(unknown, "Dictionary not found: missing:term");

        let missing = set_dictionary_order(&path, "term", &["ghi:term".into(), "abc:term".into()])
            .unwrap_err();
        assert_eq!(
            missing,
            "Dictionary order must include every dictionary in the selected category exactly once."
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn set_dictionary_order_is_scoped_to_role() {
        let root = temp_path("set_order_role_scope");
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entries(
            &path,
            vec![
                manifest_entry("a", 0),
                manifest_entry("b", 1),
                DictionaryManifestEntry {
                    dict_id: "a:frequency".into(),
                    import_id: "a".into(),
                    kind: "frequency".into(),
                    role: "frequency".into(),
                    order: 0,
                    freq_count: 10,
                    ..manifest_entry("a", 0)
                },
                DictionaryManifestEntry {
                    dict_id: "b:frequency".into(),
                    import_id: "b".into(),
                    kind: "frequency".into(),
                    role: "frequency".into(),
                    order: 1,
                    freq_count: 10,
                    ..manifest_entry("b", 1)
                },
            ],
        )
        .unwrap();

        let ordered = set_dictionary_order(
            &path,
            "frequency",
            &["b:frequency".into(), "a:frequency".into()],
        )
        .unwrap();
        let terms = ordered
            .iter()
            .filter(|entry| entry.role == "term")
            .map(|entry| (entry.dict_id.as_str(), entry.order))
            .collect::<Vec<_>>();
        let frequencies = ordered
            .iter()
            .filter(|entry| entry.role == "frequency")
            .map(|entry| (entry.dict_id.as_str(), entry.order))
            .collect::<Vec<_>>();

        assert_eq!(terms, vec![("a:term", 0), ("b:term", 1)]);
        assert_eq!(frequencies, vec![("b:frequency", 0), ("a:frequency", 1)]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_dictionary_import_removes_roles_and_directory() {
        let root = temp_path("remove_import");
        let imported_root = root.join("imported");
        let dict_dir = create_valid_dictionary_dir(&imported_root, "abc");
        let other_dir = create_valid_dictionary_dir(&imported_root, "other");
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entries(
            &path,
            vec![
                DictionaryManifestEntry {
                    internal_path: dict_dir.to_string_lossy().into_owned(),
                    ..manifest_entry("abc", 0)
                },
                DictionaryManifestEntry {
                    dict_id: "abc:frequency".into(),
                    import_id: "abc".into(),
                    kind: "frequency".into(),
                    role: "frequency".into(),
                    internal_path: dict_dir.to_string_lossy().into_owned(),
                    freq_count: 5,
                    ..manifest_entry("abc", 0)
                },
                DictionaryManifestEntry {
                    internal_path: other_dir.to_string_lossy().into_owned(),
                    ..manifest_entry("other", 1)
                },
            ],
        )
        .unwrap();

        let entries = remove_dictionary_import(&path, &imported_root, "abc").unwrap();
        assert!(!dict_dir.exists());
        assert!(other_dir.exists());
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].import_id, "other");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn remove_dictionary_import_rejects_paths_outside_import_root() {
        let root = temp_path("remove_import_guard");
        let imported_root = root.join("imported");
        let outside = create_valid_dictionary_dir(&root, "outside");
        fs::create_dir_all(&imported_root).unwrap();
        let path = root.join("manifest.json");
        upsert_dictionary_manifest_entry(
            &path,
            DictionaryManifestEntry {
                internal_path: outside.to_string_lossy().into_owned(),
                ..manifest_entry("abc", 0)
            },
        )
        .unwrap();

        let error = remove_dictionary_import(&path, &imported_root, "abc").unwrap_err();
        assert_eq!(
            error,
            "Imported dictionary path escaped the app dictionary directory."
        );
        assert!(outside.exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn kind_from_counts_prefers_term_then_freq_then_pitch() {
        assert_eq!(dictionary_kind_from_counts(1, 1, 1), "term");
        assert_eq!(dictionary_kind_from_counts(0, 1, 1), "frequency");
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
        let mut temp_paths = Vec::<PathBuf>::new();
        let ascii_source_zip =
            prepare_ascii_dictionary_import_source(&source, &imported_root, &dict_id).unwrap();
        temp_paths.push(ascii_source_zip.clone());
        let mut attempt = run_linked_import_attempt(&ascii_source_zip, &staging_root).unwrap();
        let mut restored_title = None;

        if !attempt.ok() && is_windows_code_page_import_error(&attempt.errors) {
            let _ = fs::remove_dir_all(&staging_root);
            fs::create_dir_all(&staging_root).unwrap();
            let safe_zip_path = imported_root.join(format!(".importing-{dict_id}.lookup-safe.zip"));
            let safe_zip =
                create_lookup_safe_import_zip(&ascii_source_zip, &safe_zip_path, &dict_id).unwrap();
            attempt = run_linked_import_attempt(&safe_zip.path, &staging_root).unwrap();
            restored_title = safe_zip.original_title;
            temp_paths.push(safe_zip.path);
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
        cleanup_dictionary_import_temps(&staging_root, &temp_paths);

        for file in [".hoshidicts_1", "index.json", "hash.table", "blobs.bin"] {
            assert!(final_dir.join(file).is_file(), "{file} should exist");
        }

        let title = if let Some(title) = restored_title {
            title
        } else if attempt.title.trim().is_empty() {
            read_imported_dictionary_title(&final_dir)
                .unwrap_or_else(|| "Imported Dictionary".into())
        } else {
            attempt.title
        };
        let first_entries = upsert_dictionary_manifest_entries(
            &manifest_path,
            dictionary_entries_for_import(
                &dict_id,
                title,
                final_dir.to_string_lossy().into_owned(),
                counts,
                current_unix_time(),
            ),
        )
        .unwrap();
        let first = first_entries.first().unwrap().clone();
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
