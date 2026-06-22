use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::anki::{detect_audio_extension, ensure_remote_audio_size, store_audio_bytes};

const CONFIG_VERSION: u32 = 1;
const DATABASE_NAME: &str = "android.db";
const CONFIG_NAME: &str = "sources.json";
const SUPPORTED_EXTENSIONS: [&str; 3] = ["mp3", "opus", "ogg"];
const BUILT_IN_PRIORITY: [&str; 10] = [
    "nhk16",
    "daijisen",
    "shinmeikai8",
    "jpod",
    "jpod_alternate",
    "taas",
    "ozk5",
    "forvo",
    "forvo_ext",
    "forvo_ext2",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAudioSourceStatus {
    pub name: String,
    pub order: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAudioStatus {
    pub imported: bool,
    pub size_bytes: Option<u64>,
    pub sources: Vec<LocalAudioSourceStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAudioStoreRequest {
    pub expression: String,
    pub reading: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocalAudioStoreResult {
    pub filename: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SourceConfig {
    version: u32,
    source_order: Vec<String>,
}

#[derive(Debug, Clone)]
struct LocalAudioEntry {
    source: String,
    expression: String,
    reading: Option<String>,
    file: String,
}

#[tauri::command]
pub fn anki_local_audio_status(app: AppHandle) -> Result<LocalAudioStatus, String> {
    status_from_root(&audio_root(&app)?)
}

#[tauri::command]
pub fn anki_import_local_audio(
    database_path: String,
    app: AppHandle,
) -> Result<LocalAudioStatus, String> {
    import_database(&audio_root(&app)?, Path::new(&database_path))
}

#[tauri::command]
pub fn anki_remove_local_audio(app: AppHandle) -> Result<LocalAudioStatus, String> {
    let root = audio_root(&app)?;
    remove_if_exists(&database_path(&root))?;
    remove_if_exists(&config_path(&root))?;
    remove_if_exists(&root.join("sources.json.tmp"))?;
    remove_if_exists(&root.join("sources.json.bak"))?;
    remove_if_exists(&root.join("android.db.tmp"))?;
    remove_if_exists(&root.join("android.db.bak"))?;
    Ok(LocalAudioStatus {
        imported: false,
        size_bytes: None,
        sources: Vec::new(),
    })
}

#[tauri::command]
pub fn anki_set_local_audio_source_order(
    source_order: Vec<String>,
    app: AppHandle,
) -> Result<LocalAudioStatus, String> {
    let root = audio_root(&app)?;
    let db_path = database_path(&root);
    if !db_path.is_file() {
        return Err("No local audio database is imported.".into());
    }
    let sources = inspect_database(&db_path, false)?;
    let repaired = repair_source_order(source_order, &sources);
    write_source_config(&root, &repaired)?;
    status_from_parts(&db_path, repaired)
}

#[tauri::command]
pub fn anki_store_local_audio(
    endpoint: String,
    request: LocalAudioStoreRequest,
    app: AppHandle,
) -> Result<LocalAudioStoreResult, String> {
    let root = audio_root(&app)?;
    match resolve_audio(&root, &request.expression, &request.reading) {
        Ok(None) => Ok(LocalAudioStoreResult {
            filename: None,
            warnings: Vec::new(),
        }),
        Ok(Some((bytes, extension))) => {
            let filename = store_audio_bytes(&endpoint, &bytes, &extension)?;
            Ok(LocalAudioStoreResult {
                filename: Some(filename),
                warnings: Vec::new(),
            })
        }
        Err(error) => Ok(LocalAudioStoreResult {
            filename: None,
            warnings: vec![format!("Local word audio: {error}")],
        }),
    }
}

fn audio_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data dir: {error}"))?
        .join("audio");
    fs::create_dir_all(&root)
        .map_err(|error| format!("Cannot create local audio directory: {error}"))?;
    Ok(root)
}

fn database_path(root: &Path) -> PathBuf {
    root.join(DATABASE_NAME)
}

fn config_path(root: &Path) -> PathBuf {
    root.join(CONFIG_NAME)
}

fn import_database(root: &Path, source: &Path) -> Result<LocalAudioStatus, String> {
    if !source.is_file() {
        return Err("Selected local audio database does not exist.".into());
    }
    if !source
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("db"))
    {
        return Err("Local audio import requires a .db file.".into());
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("Cannot create local audio directory: {error}"))?;
    let staging = root.join("android.db.tmp");
    let backup = root.join("android.db.bak");
    remove_if_exists(&staging)?;
    remove_if_exists(&backup)?;
    if let Err(error) = fs::copy(source, &staging) {
        let _ = fs::remove_file(&staging);
        return Err(format!("Cannot copy local audio database: {error}"));
    }
    fs::OpenOptions::new()
        .write(true)
        .open(&staging)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Cannot flush local audio database copy: {error}"))?;
    let sources = match validate_database(&staging) {
        Ok(sources) => sources,
        Err(error) => {
            let _ = fs::remove_file(&staging);
            return Err(error);
        }
    };
    let target = database_path(root);
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| format!("Cannot stage existing local audio database: {error}"))?;
    }
    if let Err(error) = fs::rename(&staging, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        let _ = fs::remove_file(&staging);
        return Err(format!("Cannot install local audio database: {error}"));
    }
    let order = default_source_order(&sources);
    if let Err(error) = write_source_config(root, &order) {
        let _ = fs::remove_file(&target);
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(error);
    }
    remove_if_exists(&backup)?;
    status_from_parts(&target, order)
}

fn validate_database(path: &Path) -> Result<Vec<String>, String> {
    inspect_database(path, true)
}

fn inspect_database(path: &Path, run_quick_check: bool) -> Result<Vec<String>, String> {
    let mut header = [0u8; 16];
    fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut header))
        .map_err(|error| format!("Cannot read local audio database header: {error}"))?;
    if &header != b"SQLite format 3\0" {
        return Err("Local audio database is not a SQLite 3 database.".into());
    }
    let connection = open_database(path)?;
    if run_quick_check {
        let quick_check: String = connection
            .query_row("PRAGMA quick_check", [], |row| row.get(0))
            .map_err(|error| format!("Cannot validate local audio database: {error}"))?;
        if quick_check != "ok" {
            return Err(format!(
                "Local audio database quick check failed: {quick_check}"
            ));
        }
    }
    require_columns(
        &connection,
        "entries",
        &["source", "expression", "reading", "file"],
    )?;
    require_columns(&connection, "android", &["source", "file", "data"])?;

    let mut statement = connection
        .prepare(
            "SELECT DISTINCT e.source
             FROM entries e JOIN android a ON a.source = e.source AND a.file = e.file
             WHERE length(a.data) > 0 AND
               (lower(e.file) LIKE '%.mp3' OR lower(e.file) LIKE '%.opus' OR lower(e.file) LIKE '%.ogg')",
        )
        .map_err(|error| format!("Cannot inspect local audio sources: {error}"))?;
    let sources = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Cannot query local audio sources: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Cannot read local audio sources: {error}"))?;
    let sources = default_source_order(&sources);
    if sources.is_empty() {
        return Err("Local audio database contains no supported audio records.".into());
    }
    Ok(sources)
}

fn open_database(path: &Path) -> Result<Connection, String> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| format!("Cannot open local audio database: {error}"))
}

fn require_columns(connection: &Connection, table: &str, required: &[&str]) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Cannot inspect local audio table '{table}': {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Cannot query local audio table '{table}': {error}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("Cannot read local audio table '{table}': {error}"))?;
    let missing: Vec<&str> = required
        .iter()
        .copied()
        .filter(|column| !columns.contains(*column))
        .collect();
    if !missing.is_empty() {
        return Err(format!(
            "Local audio table '{table}' is missing columns: {}.",
            missing.join(", ")
        ));
    }
    Ok(())
}

fn status_from_root(root: &Path) -> Result<LocalAudioStatus, String> {
    let path = database_path(root);
    if !path.is_file() {
        return Ok(LocalAudioStatus {
            imported: false,
            size_bytes: None,
            sources: Vec::new(),
        });
    }
    let sources = inspect_database(&path, false)?;
    let configured = read_source_config(root).unwrap_or_default();
    let order = repair_source_order(configured, &sources);
    status_from_parts(&path, order)
}

fn status_from_parts(path: &Path, order: Vec<String>) -> Result<LocalAudioStatus, String> {
    let size_bytes = fs::metadata(path)
        .map_err(|error| format!("Cannot read local audio database metadata: {error}"))?
        .len();
    Ok(LocalAudioStatus {
        imported: true,
        size_bytes: Some(size_bytes),
        sources: order
            .into_iter()
            .enumerate()
            .map(|(order, name)| LocalAudioSourceStatus { name, order })
            .collect(),
    })
}

fn read_source_config(root: &Path) -> Result<Vec<String>, String> {
    let path = config_path(root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("Cannot read local audio source config: {error}"))?;
    let config: SourceConfig = serde_json::from_str(&raw)
        .map_err(|error| format!("Cannot parse local audio source config: {error}"))?;
    if config.version != CONFIG_VERSION {
        return Ok(Vec::new());
    }
    Ok(config.source_order)
}

fn write_source_config(root: &Path, source_order: &[String]) -> Result<(), String> {
    let config = SourceConfig {
        version: CONFIG_VERSION,
        source_order: source_order.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Cannot serialize local audio source config: {error}"))?;
    let temp = root.join("sources.json.tmp");
    let backup = root.join("sources.json.bak");
    remove_if_exists(&temp)?;
    remove_if_exists(&backup)?;
    fs::write(&temp, raw)
        .map_err(|error| format!("Cannot write local audio source config: {error}"))?;
    let target = config_path(root);
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|error| format!("Cannot stage local audio source config: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(format!("Cannot install local audio source config: {error}"));
    }
    remove_if_exists(&backup)
}

fn default_source_order(sources: &[String]) -> Vec<String> {
    let mut sources: Vec<String> = sources
        .iter()
        .map(|source| source.trim().to_string())
        .filter(|source| !source.is_empty())
        .collect();
    sources.sort_by(|left, right| {
        let left_rank = BUILT_IN_PRIORITY
            .iter()
            .position(|source| source == left)
            .unwrap_or(usize::MAX);
        let right_rank = BUILT_IN_PRIORITY
            .iter()
            .position(|source| source == right)
            .unwrap_or(usize::MAX);
        left_rank.cmp(&right_rank).then_with(|| left.cmp(right))
    });
    sources.dedup();
    sources
}

fn repair_source_order(requested: Vec<String>, available: &[String]) -> Vec<String> {
    let available_set: HashSet<&str> = available.iter().map(String::as_str).collect();
    let mut seen = HashSet::new();
    let mut repaired: Vec<String> = requested
        .into_iter()
        .map(|source| source.trim().to_string())
        .filter(|source| available_set.contains(source.as_str()) && seen.insert(source.clone()))
        .collect();
    for source in default_source_order(available) {
        if seen.insert(source.clone()) {
            repaired.push(source);
        }
    }
    repaired
}

fn resolve_audio(
    root: &Path,
    expression: &str,
    reading: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    let path = database_path(root);
    if !path.is_file() {
        return Ok(None);
    }
    let connection = open_database(&path)?;
    let normalized_reading = katakana_to_hiragana(reading.trim());
    let configured_order = read_source_config(root).unwrap_or_default();
    let source_order = if configured_order.is_empty() {
        default_source_order(&inspect_database(&path, false)?)
    } else {
        configured_order
    };
    let source_rank: HashMap<&str, usize> = source_order
        .iter()
        .enumerate()
        .map(|(index, source)| (source.as_str(), index))
        .collect();
    let mut statement = connection
        .prepare(
            "SELECT source, expression, reading, file FROM entries
             WHERE (expression = ?1 OR (?2 <> '' AND reading = ?2))
               AND EXISTS (SELECT 1 FROM android a WHERE a.source = entries.source AND a.file = entries.file AND length(a.data) > 0)",
        )
        .map_err(|error| format!("Cannot prepare local audio lookup: {error}"))?;
    let mut candidates = statement
        .query_map(params![expression.trim(), normalized_reading], |row| {
            Ok(LocalAudioEntry {
                source: row.get(0)?,
                expression: row.get(1)?,
                reading: row.get(2)?,
                file: row.get(3)?,
            })
        })
        .map_err(|error| format!("Cannot query local audio entries: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Cannot read local audio entry: {error}"))?;
    candidates.retain(|entry| {
        (entry.expression == expression.trim()
            || entry.reading.as_deref() == Some(normalized_reading.as_str()))
            && supported_extension(&entry.file).is_some()
    });
    candidates.sort_by(|left, right| {
        let left_reading = !normalized_reading.is_empty()
            && left.reading.as_deref() == Some(normalized_reading.as_str());
        let right_reading = !normalized_reading.is_empty()
            && right.reading.as_deref() == Some(normalized_reading.as_str());
        right_reading
            .cmp(&left_reading)
            .then_with(|| {
                source_rank
                    .get(left.source.as_str())
                    .unwrap_or(&usize::MAX)
                    .cmp(
                        source_rank
                            .get(right.source.as_str())
                            .unwrap_or(&usize::MAX),
                    )
            })
            .then_with(|| left.source.cmp(&right.source))
    });
    let Some(entry) = candidates.first() else {
        return Ok(None);
    };
    let bytes: Option<Vec<u8>> = connection
        .query_row(
            "SELECT data FROM android WHERE source = ?1 AND file = ?2 LIMIT 1",
            params![entry.source, entry.file],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Cannot load local audio blob: {error}"))?;
    let Some(bytes) = bytes.filter(|bytes| !bytes.is_empty()) else {
        return Err("The selected local audio record has no audio blob.".into());
    };
    ensure_remote_audio_size(bytes.len())?;
    let extension = supported_extension(&entry.file).ok_or_else(|| {
        "The selected local audio record has an unsupported file type.".to_string()
    })?;
    if detect_audio_extension(&bytes, None, &entry.file).is_none() {
        return Err(
            "The selected local audio blob does not match a supported audio format.".into(),
        );
    }
    Ok(Some((bytes, extension.into())))
}

pub(crate) fn resolve_local_audio(
    app: &AppHandle,
    expression: &str,
    reading: &str,
) -> Result<Option<(Vec<u8>, String)>, String> {
    resolve_audio(&audio_root(app)?, expression, reading)
}

fn supported_extension(file: &str) -> Option<&str> {
    let extension = file.rsplit_once('.')?.1;
    SUPPORTED_EXTENSIONS
        .iter()
        .copied()
        .find(|supported| extension.eq_ignore_ascii_case(supported))
}

fn katakana_to_hiragana(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            let code = character as u32;
            if (0x30a1..=0x30f6).contains(&code) {
                char::from_u32(code - 0x60).unwrap_or(character)
            } else {
                character
            }
        })
        .collect()
}

fn remove_if_exists(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("Cannot remove '{}': {error}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hsw_local_audio_{name}_{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn create_database(path: &Path) -> Connection {
        let connection = Connection::open(path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE entries (source TEXT, expression TEXT, reading TEXT, file TEXT);
                 CREATE TABLE android (source TEXT, file TEXT, data BLOB);",
            )
            .unwrap();
        connection
    }

    fn insert_audio(
        connection: &Connection,
        source: &str,
        expression: &str,
        reading: Option<&str>,
        file: &str,
        bytes: &[u8],
    ) {
        connection
            .execute(
                "INSERT INTO entries(source, expression, reading, file) VALUES (?1, ?2, ?3, ?4)",
                params![source, expression, reading, file],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO android(source, file, data) VALUES (?1, ?2, ?3)",
                params![source, file, bytes],
            )
            .unwrap();
    }

    #[test]
    fn imports_valid_database_and_uses_hsa_source_order() {
        let root = temp_root("import");
        let source = root.join("source.db");
        let connection = create_database(&source);
        insert_audio(
            &connection,
            "forvo",
            "学校",
            Some("がっこう"),
            "a.mp3",
            b"ID3forvo",
        );
        insert_audio(
            &connection,
            "nhk16",
            "学校",
            Some("がっこう"),
            "b.ogg",
            b"OggSnhk",
        );
        insert_audio(
            &connection,
            "custom",
            "学校",
            Some("がっこう"),
            "c.opus",
            b"OggScustom",
        );
        drop(connection);

        let app_root = root.join("app");
        let status = import_database(&app_root, &source).unwrap();
        assert!(status.imported);
        assert_eq!(
            status
                .sources
                .iter()
                .map(|source| source.name.as_str())
                .collect::<Vec<_>>(),
            vec!["nhk16", "forvo", "custom"]
        );
        assert!(database_path(&app_root).is_file());
        assert!(config_path(&app_root).is_file());
        assert!(!app_root.join("android.db.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_invalid_schema_and_empty_media_database() {
        let root = temp_root("invalid");
        let missing = root.join("missing.db");
        Connection::open(&missing)
            .unwrap()
            .execute("CREATE TABLE entries (source TEXT)", [])
            .unwrap();
        assert!(validate_database(&missing)
            .unwrap_err()
            .contains("missing columns"));

        let empty = root.join("empty.db");
        drop(create_database(&empty));
        assert!(validate_database(&empty)
            .unwrap_err()
            .contains("no supported audio records"));

        let corrupt = root.join("corrupt.db");
        fs::write(&corrupt, b"not sqlite").unwrap();
        assert!(validate_database(&corrupt)
            .unwrap_err()
            .contains("database header"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_replacement_preserves_existing_database() {
        let root = temp_root("preserve");
        let first = root.join("first.db");
        let connection = create_database(&first);
        insert_audio(
            &connection,
            "nhk16",
            "星",
            Some("ほし"),
            "star.mp3",
            b"ID3old",
        );
        drop(connection);
        let app_root = root.join("app");
        import_database(&app_root, &first).unwrap();
        let old = fs::read(database_path(&app_root)).unwrap();

        let invalid = root.join("invalid.db");
        fs::write(&invalid, b"bad replacement").unwrap();
        assert!(import_database(&app_root, &invalid).is_err());
        assert_eq!(fs::read(database_path(&app_root)).unwrap(), old);
        assert!(!app_root.join("android.db.tmp").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn repairs_and_persists_custom_source_order() {
        let root = temp_root("order");
        fs::create_dir_all(&root).unwrap();
        let available = vec!["nhk16".into(), "forvo".into(), "custom".into()];
        let repaired = repair_source_order(
            vec!["forvo".into(), "missing".into(), "forvo".into()],
            &available,
        );
        assert_eq!(repaired, vec!["forvo", "nhk16", "custom"]);
        write_source_config(&root, &repaired).unwrap();
        assert_eq!(read_source_config(&root).unwrap(), repaired);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_exact_reading_before_source_priority_and_honors_custom_order() {
        let root = temp_root("resolve");
        fs::create_dir_all(&root).unwrap();
        let connection = create_database(&database_path(&root));
        insert_audio(
            &connection,
            "nhk16",
            "食べる",
            Some("たべない"),
            "wrong.mp3",
            b"ID3wrong",
        );
        insert_audio(
            &connection,
            "forvo",
            "食べる",
            Some("たべる"),
            "right.mp3",
            b"ID3right",
        );
        drop(connection);
        let (bytes, extension) = resolve_audio(&root, "食べる", "タベル").unwrap().unwrap();
        assert_eq!(bytes, b"ID3right");
        assert_eq!(extension, "mp3");

        let connection = Connection::open(database_path(&root)).unwrap();
        connection.execute("DELETE FROM entries", []).unwrap();
        connection.execute("DELETE FROM android", []).unwrap();
        insert_audio(
            &connection,
            "nhk16",
            "お冷や",
            Some("おひや"),
            "nhk.ogg",
            b"OggSnhk",
        );
        insert_audio(
            &connection,
            "forvo",
            "お冷や",
            Some("おひや"),
            "forvo.ogg",
            b"OggSforvo",
        );
        drop(connection);
        write_source_config(&root, &["forvo".into(), "nhk16".into()]).unwrap();
        let (bytes, _) = resolve_audio(&root, "お冷や", "おひや").unwrap().unwrap();
        assert_eq!(bytes, b"OggSforvo");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_missing_invalid_and_oversized_blobs_as_lookup_warnings() {
        let root = temp_root("blob");
        fs::create_dir_all(&root).unwrap();
        let connection = create_database(&database_path(&root));
        insert_audio(
            &connection,
            "nhk16",
            "星",
            Some("ほし"),
            "bad.mp3",
            b"not audio",
        );
        drop(connection);
        assert!(resolve_audio(&root, "星", "ほし")
            .unwrap_err()
            .contains("does not match"));

        let connection = Connection::open(database_path(&root)).unwrap();
        connection.execute("DELETE FROM entries", []).unwrap();
        connection.execute("DELETE FROM android", []).unwrap();
        let oversized = vec![0u8; 10 * 1024 * 1024 + 1];
        insert_audio(
            &connection,
            "nhk16",
            "大",
            Some("だい"),
            "large.mp3",
            &oversized,
        );
        drop(connection);
        assert!(resolve_audio(&root, "大", "だい")
            .unwrap_err()
            .contains("10 MiB"));
        let _ = fs::remove_dir_all(root);
    }
}
