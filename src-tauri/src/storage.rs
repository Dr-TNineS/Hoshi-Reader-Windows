use serde::de::{self, Deserializer};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const STATE_VERSION: u32 = 1;
const MAX_BOOKS: usize = 12;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookRecord {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    pub title: String,
    pub chapter: u32,
    pub total_chapters: u32,
    pub last_opened: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_read_chars: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_characters: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedSession {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub library_path: Option<String>,
    pub chapter: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub chapter_progress: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub book_read_chars: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub total_characters: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStateResponse {
    pub books: Vec<BookRecord>,
    pub session: Option<SavedSession>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadingStatistics {
    pub title: String,
    pub date_key: String,
    #[serde(default, deserialize_with = "deserialize_clamped_i32")]
    pub characters_read: i32,
    #[serde(default)]
    pub reading_time: f64,
    #[serde(default, deserialize_with = "deserialize_clamped_i32")]
    pub min_reading_speed: i32,
    #[serde(default, deserialize_with = "deserialize_clamped_i32")]
    pub alt_min_reading_speed: i32,
    #[serde(default, deserialize_with = "deserialize_clamped_i32")]
    pub last_reading_speed: i32,
    #[serde(default, deserialize_with = "deserialize_clamped_i32")]
    pub max_reading_speed: i32,
    #[serde(default)]
    pub last_statistic_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ReadingState {
    version: u32,
    books: Vec<BookRecord>,
    session: Option<SavedSession>,
    migrated_local_storage_at: Option<u64>,
}

impl Default for ReadingState {
    fn default() -> Self {
        Self {
            version: STATE_VERSION,
            books: Vec::new(),
            session: None,
            migrated_local_storage_at: None,
        }
    }
}

impl From<ReadingState> for ReadingStateResponse {
    fn from(state: ReadingState) -> Self {
        Self {
            books: state.books,
            session: state.session,
        }
    }
}

#[tauri::command]
pub fn reading_load_state(app: AppHandle) -> Result<ReadingStateResponse, String> {
    let root = reading_root(&app)?;
    Ok(read_state(&root)?.into())
}

#[tauri::command]
pub fn reading_save_progress(
    record: BookRecord,
    session: SavedSession,
    app: AppHandle,
) -> Result<Vec<BookRecord>, String> {
    let root = reading_root(&app)?;
    let mut state = read_state(&root)?;
    if has_newer_record(&state.books, &record) {
        return Ok(state.books);
    }
    state.books = upsert_book(state.books, record);
    state.session = Some(session);
    write_state(&root, &state)?;
    Ok(state.books)
}

#[tauri::command]
pub fn reading_clear_session(app: AppHandle) -> Result<(), String> {
    let root = reading_root(&app)?;
    let mut state = read_state(&root)?;
    state.session = None;
    write_state(&root, &state)
}

#[tauri::command]
pub fn reading_forget_book(
    book_id: Option<String>,
    path: Option<String>,
    app: AppHandle,
) -> Result<Vec<BookRecord>, String> {
    let root = reading_root(&app)?;
    let mut state = read_state(&root)?;
    let key = locator_key(book_id.as_deref(), path.as_deref())?;
    forget_book_in_state(&mut state, &key);
    write_state(&root, &state)?;
    Ok(state.books)
}

#[tauri::command]
pub fn reading_import_legacy_state(
    books: Vec<BookRecord>,
    session: Option<SavedSession>,
    app: AppHandle,
) -> Result<ReadingStateResponse, String> {
    let root = reading_root(&app)?;
    let mut state = read_state(&root)?;
    if state.migrated_local_storage_at.is_none() {
        state.books = merge_books(state.books, books);
        if state.session.is_none() {
            state.session = session;
        }
        state.migrated_local_storage_at = Some(now_millis()?);
        write_state(&root, &state)?;
    }
    Ok(state.into())
}

#[tauri::command]
pub fn reading_load_statistics(
    book_id: String,
    app: AppHandle,
) -> Result<Vec<ReadingStatistics>, String> {
    let book_dir = crate::library::library_book_dir(&app, &book_id)?;
    read_statistics(&book_dir)
}

#[tauri::command]
pub fn reading_save_statistics(
    book_id: String,
    statistics: Vec<ReadingStatistics>,
    app: AppHandle,
) -> Result<Vec<ReadingStatistics>, String> {
    let book_dir = crate::library::library_book_dir(&app, &book_id)?;
    let next = deduplicate_statistics(statistics);
    write_statistics(&book_dir, &next)?;
    Ok(next)
}

fn reading_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("reading");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create reading state dir: {e}"))?;
    Ok(root)
}

fn state_path(root: &Path) -> PathBuf {
    root.join("state.json")
}

fn statistics_path(book_dir: &Path) -> PathBuf {
    book_dir.join("statistics.json")
}

fn deserialize_clamped_i32<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::Number(number) => {
            if let Some(value) = number.as_i64() {
                Ok(value.clamp(0, i32::MAX as i64) as i32)
            } else if let Some(value) = number.as_u64() {
                Ok(value.min(i32::MAX as u64) as i32)
            } else if let Some(value) = number.as_f64() {
                if value.is_finite() {
                    Ok(value.trunc().clamp(0.0, i32::MAX as f64) as i32)
                } else {
                    Ok(0)
                }
            } else {
                Ok(0)
            }
        }
        serde_json::Value::Null => Ok(0),
        other => Err(de::Error::custom(format!(
            "expected numeric reading statistics field, got {other}"
        ))),
    }
}

fn read_state(root: &Path) -> Result<ReadingState, String> {
    let path = state_path(root);
    if !path.exists() {
        return Ok(ReadingState::default());
    }

    let raw = fs::read_to_string(&path).map_err(|e| format!("Cannot read reading state: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse reading state: {e}"))
}

fn write_state(root: &Path, state: &ReadingState) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("Cannot create reading state dir: {e}"))?;
    let path = state_path(root);
    let temp_path = root.join("state.json.tmp");
    let json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Cannot serialize reading state: {e}"))?;

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Cannot create temporary reading state: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Cannot write temporary reading state: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temporary reading state: {e}"))?;
    }

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot replace old reading state: {e}"))?;
    }
    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot replace reading state: {e}"))
}

fn read_statistics(book_dir: &Path) -> Result<Vec<ReadingStatistics>, String> {
    let path = statistics_path(book_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Cannot read reading statistics: {e}"))?;
    let statistics: Vec<ReadingStatistics> = serde_json::from_str(&raw)
        .map_err(|e| format!("Cannot parse reading statistics: {e}"))?;
    Ok(deduplicate_statistics(statistics))
}

fn write_statistics(book_dir: &Path, statistics: &[ReadingStatistics]) -> Result<(), String> {
    fs::create_dir_all(book_dir).map_err(|e| format!("Cannot create book statistics dir: {e}"))?;
    let path = statistics_path(book_dir);
    let temp_path = book_dir.join("statistics.json.tmp");
    let json = serde_json::to_string_pretty(statistics)
        .map_err(|e| format!("Cannot serialize reading statistics: {e}"))?;

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Cannot create temporary reading statistics: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Cannot write temporary reading statistics: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temporary reading statistics: {e}"))?;
    }

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Cannot replace old reading statistics: {e}"))?;
    }
    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot replace reading statistics: {e}"))
}

fn deduplicate_statistics(statistics: Vec<ReadingStatistics>) -> Vec<ReadingStatistics> {
    let mut grouped: Vec<ReadingStatistics> = Vec::new();
    for statistic in statistics {
        if let Some(existing) = grouped
            .iter_mut()
            .find(|existing| existing.date_key == statistic.date_key)
        {
            if statistic.last_statistic_modified > existing.last_statistic_modified {
                *existing = statistic;
            }
        } else {
            grouped.push(statistic);
        }
    }
    grouped
}

fn upsert_book(books: Vec<BookRecord>, record: BookRecord) -> Vec<BookRecord> {
    let key = book_key(&record);
    let mut next = vec![record];
    next.extend(books.into_iter().filter(|book| book_key(book) != key));
    trim_books(next)
}

fn has_newer_record(books: &[BookRecord], record: &BookRecord) -> bool {
    let key = book_key(record);
    books
        .iter()
        .any(|book| book_key(book) == key && book.last_opened > record.last_opened)
}

fn merge_books(existing: Vec<BookRecord>, incoming: Vec<BookRecord>) -> Vec<BookRecord> {
    let mut merged: Vec<BookRecord> = Vec::new();
    for record in existing.into_iter().chain(incoming) {
        let key = book_key(&record);
        if let Some(current) = merged.iter_mut().find(|book| book_key(book) == key) {
            if record.last_opened > current.last_opened {
                *current = record;
            }
        } else {
            merged.push(record);
        }
    }
    merged.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    trim_books(merged)
}

fn trim_books(mut books: Vec<BookRecord>) -> Vec<BookRecord> {
    books.truncate(MAX_BOOKS);
    books
}

fn book_key(book: &BookRecord) -> String {
    if let Some(book_id) = book.book_id.as_ref().filter(|value| !value.is_empty()) {
        return format!("library:{book_id}");
    }
    format!("path:{}", book.path.as_deref().unwrap_or(""))
}

fn session_key(session: &SavedSession) -> String {
    if let Some(book_id) = session.book_id.as_ref().filter(|value| !value.is_empty()) {
        return format!("library:{book_id}");
    }
    format!("path:{}", session.path.as_deref().unwrap_or(""))
}

fn locator_key(book_id: Option<&str>, path: Option<&str>) -> Result<String, String> {
    if let Some(book_id) = book_id.filter(|value| !value.is_empty()) {
        return Ok(format!("library:{book_id}"));
    }
    if let Some(path) = path.filter(|value| !value.is_empty()) {
        return Ok(format!("path:{path}"));
    }
    Err("Cannot forget reading record without a book id or path.".into())
}

fn forget_book_in_state(state: &mut ReadingState, key: &str) {
    state.books.retain(|book| book_key(book) != key);
    if state
        .session
        .as_ref()
        .is_some_and(|session| session_key(session) == key)
    {
        state.session = None;
    }
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
            "hoshi_reading_state_{name}_{}",
            now_millis().unwrap()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn record(key: &str, last_opened: u64) -> BookRecord {
        BookRecord {
            book_id: key.strip_prefix("library:").map(|value| value.to_string()),
            path: key.strip_prefix("path:").map(|value| value.to_string()),
            source_path: None,
            library_path: None,
            cover_path: None,
            title: key.to_string(),
            chapter: 0,
            total_chapters: 1,
            last_opened,
            chapter_progress: None,
            book_read_chars: None,
            total_characters: None,
            percent: None,
        }
    }

    fn session(key: &str) -> SavedSession {
        SavedSession {
            book_id: key.strip_prefix("library:").map(|value| value.to_string()),
            path: key.strip_prefix("path:").map(|value| value.to_string()),
            source_path: None,
            library_path: None,
            chapter: 0,
            chapter_progress: Some(0.25),
            book_read_chars: Some(10),
            total_characters: Some(40),
            percent: Some(25.0),
        }
    }

    fn statistic(date_key: &str, characters_read: i32, modified: u64) -> ReadingStatistics {
        ReadingStatistics {
            title: "Book".into(),
            date_key: date_key.into(),
            characters_read,
            reading_time: 0.0,
            min_reading_speed: 0,
            alt_min_reading_speed: 0,
            last_reading_speed: 0,
            max_reading_speed: 0,
            last_statistic_modified: modified,
        }
    }

    #[test]
    fn missing_state_reads_empty() {
        let root = temp_root("missing");
        let state = read_state(&root).unwrap();
        assert!(state.books.is_empty());
        assert!(state.session.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_state_returns_clear_error() {
        let root = temp_root("corrupt");
        fs::write(state_path(&root), "not json").unwrap();
        let err = read_state(&root).unwrap_err();
        assert!(err.contains("Cannot parse reading state"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upsert_book_dedupes_and_trims_to_recent_limit() {
        let mut books = Vec::new();
        for i in 0..14 {
            books = upsert_book(books, record(&format!("path:{i}.epub"), i));
        }

        books = upsert_book(books, record("path:3.epub", 99));

        assert_eq!(books.len(), MAX_BOOKS);
        assert_eq!(books[0].path.as_deref(), Some("3.epub"));
        assert_eq!(
            books
                .iter()
                .filter(|book| book.path.as_deref() == Some("3.epub"))
                .count(),
            1
        );
    }

    #[test]
    fn newer_existing_record_blocks_stale_progress_save() {
        let newer = record("library:abc", 100);
        let stale = record("library:abc", 90);

        assert!(has_newer_record(&[newer], &stale));
    }

    #[test]
    fn clear_session_persists_none() {
        let root = temp_root("clear");
        let mut state = ReadingState::default();
        state.session = Some(session("library:abc"));
        write_state(&root, &state).unwrap();

        let mut state = read_state(&root).unwrap();
        state.session = None;
        write_state(&root, &state).unwrap();

        assert!(read_state(&root).unwrap().session.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn forget_book_removes_record_and_matching_session() {
        let root = temp_root("forget");
        let state = ReadingState {
            books: vec![record("library:abc", 10), record("path:keep.epub", 20)],
            session: Some(session("library:abc")),
            ..ReadingState::default()
        };
        write_state(&root, &state).unwrap();

        let mut loaded = read_state(&root).unwrap();
        let key = locator_key(Some("abc"), None).unwrap();
        forget_book_in_state(&mut loaded, &key);
        write_state(&root, &loaded).unwrap();

        let final_state = read_state(&root).unwrap();
        assert_eq!(final_state.books.len(), 1);
        assert_eq!(final_state.books[0].path.as_deref(), Some("keep.epub"));
        assert!(final_state.session.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn legacy_merge_prefers_newer_books_and_existing_session() {
        let existing_session = session("library:existing");
        let state = ReadingState {
            books: vec![record("library:a", 10), record("path:old.epub", 20)],
            session: Some(existing_session.clone()),
            ..ReadingState::default()
        };

        let merged = merge_books(
            state.books,
            vec![record("library:a", 30), record("path:new.epub", 25)],
        );

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0].book_id.as_deref(), Some("a"));
        assert_eq!(merged[0].last_opened, 30);
        assert_eq!(state.session, Some(existing_session));
    }

    #[test]
    fn legacy_migration_marker_makes_import_idempotent() {
        let root = temp_root("idempotent");
        let mut state = ReadingState::default();
        state.books = merge_books(state.books, vec![record("path:first.epub", 1)]);
        state.migrated_local_storage_at = Some(1);
        write_state(&root, &state).unwrap();

        let mut loaded = read_state(&root).unwrap();
        if loaded.migrated_local_storage_at.is_none() {
            loaded.books = merge_books(loaded.books, vec![record("path:second.epub", 2)]);
            loaded.migrated_local_storage_at = Some(2);
            write_state(&root, &loaded).unwrap();
        }

        let final_state = read_state(&root).unwrap();
        assert_eq!(final_state.books.len(), 1);
        assert_eq!(final_state.books[0].path.as_deref(), Some("first.epub"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn missing_statistics_reads_empty() {
        let root = temp_root("statistics_missing");

        let statistics = read_statistics(&root).unwrap();

        assert!(statistics.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn statistics_json_matches_hsa_sidecar_shape() {
        let json = serde_json::to_string(&vec![statistic("2026-05-13", 0, 0)]).unwrap();

        assert_eq!(
            json,
            r#"[{"title":"Book","dateKey":"2026-05-13","charactersRead":0,"readingTime":0.0,"minReadingSpeed":0,"altMinReadingSpeed":0,"lastReadingSpeed":0,"maxReadingSpeed":0,"lastStatisticModified":0}]"#
        );
    }

    #[test]
    fn statistics_deserialize_clamps_large_integer_fields() {
        let statistics: Vec<ReadingStatistics> = serde_json::from_str(
            r#"[{"title":"Book","dateKey":"2026-05-13","charactersRead":65310171428,"readingTime":0.001,"minReadingSpeed":65310171428,"altMinReadingSpeed":65310171428,"lastReadingSpeed":65310171428,"maxReadingSpeed":65310171428,"lastStatisticModified":1778623200000}]"#,
        )
        .unwrap();

        assert_eq!(statistics.len(), 1);
        let statistic = &statistics[0];
        assert_eq!(statistic.characters_read, i32::MAX);
        assert_eq!(statistic.min_reading_speed, i32::MAX);
        assert_eq!(statistic.alt_min_reading_speed, i32::MAX);
        assert_eq!(statistic.last_reading_speed, i32::MAX);
        assert_eq!(statistic.max_reading_speed, i32::MAX);
    }

    #[test]
    fn statistics_dedupes_by_date_key_keeping_latest_modified() {
        let statistics = deduplicate_statistics(vec![
            statistic("2026-05-13", 10, 100),
            statistic("2026-05-13", 20, 200),
            statistic("2026-05-14", 30, 150),
        ]);

        assert_eq!(statistics.len(), 2);
        assert_eq!(
            statistics
                .iter()
                .find(|statistic| statistic.date_key == "2026-05-13")
                .unwrap()
                .characters_read,
            20
        );
        assert_eq!(
            statistics
                .iter()
                .find(|statistic| statistic.date_key == "2026-05-14")
                .unwrap()
                .characters_read,
            30
        );
    }

    #[test]
    fn statistics_save_load_round_trip() {
        let root = temp_root("statistics_round_trip");

        write_statistics(&root, &[statistic("2026-05-13", 12, 100)]).unwrap();
        let loaded = read_statistics(&root).unwrap();

        assert_eq!(loaded, vec![statistic("2026-05-13", 12, 100)]);
        assert!(statistics_path(&root).is_file());
        let _ = fs::remove_dir_all(root);
    }
}
