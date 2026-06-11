use crate::epub::book::EpubBook;
use crate::epub::commands::EpubState;
use crate::epub::types::EpubMeta;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State};

const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookRecord {
    pub book_id: String,
    pub title: Option<String>,
    pub source_path: String,
    pub library_path: String,
    pub content_hash: String,
    pub size_bytes: u64,
    pub imported_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LibraryManifest {
    version: u32,
    books: Vec<LibraryBookRecord>,
}

impl Default for LibraryManifest {
    fn default() -> Self {
        Self {
            version: MANIFEST_VERSION,
            books: Vec::new(),
        }
    }
}

#[tauri::command]
pub fn library_import_epub(
    source_path: String,
    app: AppHandle,
) -> Result<LibraryBookRecord, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(format!("EPUB source is not a file: {source_path}"));
    }

    let root = library_root(&app)?;
    let content_hash = hash_file(&source)?;
    let book_id = content_hash.clone();
    let book_dir = root.join("books").join(&book_id);
    let library_file = book_dir.join("book.epub");

    fs::create_dir_all(&book_dir).map_err(|e| format!("Cannot create library book dir: {e}"))?;
    if !library_file.exists() {
        copy_file_atomic(&source, &library_file)?;
    }

    let title = EpubBook::open(&library_file.to_string_lossy())
        .ok()
        .and_then(|book| book.title());
    let size_bytes = fs::metadata(&library_file)
        .map_err(|e| format!("Cannot read imported EPUB metadata: {e}"))?
        .len();

    let record = LibraryBookRecord {
        book_id,
        title,
        source_path,
        library_path: library_file.to_string_lossy().to_string(),
        content_hash,
        size_bytes,
        imported_at: now_secs()?,
    };

    let mut manifest = read_manifest(&root)?;
    if let Some(existing) = manifest
        .books
        .iter_mut()
        .find(|book| book.book_id == record.book_id)
    {
        *existing = record.clone();
    } else {
        manifest.books.insert(0, record.clone());
    }
    write_manifest(&root, &manifest)?;

    Ok(record)
}

#[tauri::command]
pub fn library_list_books(app: AppHandle) -> Result<Vec<LibraryBookRecord>, String> {
    let root = library_root(&app)?;
    Ok(read_manifest(&root)?.books)
}

#[tauri::command]
pub fn library_open_book(
    book_id: String,
    app: AppHandle,
    state: State<EpubState>,
) -> Result<EpubMeta, String> {
    let root = library_root(&app)?;
    let manifest = read_manifest(&root)?;
    let record = manifest
        .books
        .iter()
        .find(|book| book.book_id == book_id)
        .ok_or_else(|| format!("Library book not found: {book_id}"))?;

    let book = EpubBook::open(&record.library_path)?;
    let meta = EpubMeta {
        title: book.title(),
        cover_href: book.cover_href(),
        manifest: book.manifest(),
        spine: book.spine(),
        toc: book.toc(),
        book_info: book.book_info(),
    };
    *state.book.lock().unwrap() = Some(book);
    Ok(meta)
}

fn library_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("library");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create library dir: {e}"))?;
    Ok(root)
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join("manifest.json")
}

fn read_manifest(root: &Path) -> Result<LibraryManifest, String> {
    let path = manifest_path(root);
    if !path.exists() {
        return Ok(LibraryManifest::default());
    }

    let raw =
        fs::read_to_string(&path).map_err(|e| format!("Cannot read library manifest: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse library manifest: {e}"))
}

fn write_manifest(root: &Path, manifest: &LibraryManifest) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("Cannot create library dir: {e}"))?;
    let path = manifest_path(root);
    let temp_path = root.join("manifest.json.tmp");
    let json = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Cannot serialize library manifest: {e}"))?;

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Cannot create temporary manifest: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Cannot write temporary manifest: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temporary manifest: {e}"))?;
    }

    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("Cannot replace old library manifest: {e}"))?;
    }
    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot replace library manifest: {e}"))
}

fn copy_file_atomic(source: &Path, dest: &Path) -> Result<(), String> {
    let parent = dest
        .parent()
        .ok_or_else(|| "Imported EPUB destination has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create import destination: {e}"))?;
    let temp_path = dest.with_extension("epub.tmp");
    fs::copy(source, &temp_path).map_err(|e| format!("Cannot copy EPUB into library: {e}"))?;
    fs::rename(&temp_path, dest).map_err(|e| format!("Cannot finalize imported EPUB: {e}"))
}

fn hash_file(path: &Path) -> Result<String, String> {
    let mut file =
        fs::File::open(path).map_err(|e| format!("Cannot open EPUB for hashing: {e}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("Cannot read EPUB for hashing: {e}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn now_secs() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|e| format!("Cannot read system time: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_manifest_lists_empty_books() {
        let root = std::env::temp_dir().join(format!("hoshi_library_test_{}", now_secs().unwrap()));
        fs::create_dir_all(&root).unwrap();

        let manifest = read_manifest(&root).unwrap();
        assert!(manifest.books.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_manifest_returns_error() {
        let root = std::env::temp_dir().join(format!("hoshi_library_bad_{}", now_secs().unwrap()));
        fs::create_dir_all(&root).unwrap();
        fs::write(manifest_path(&root), "not json").unwrap();

        let err = read_manifest(&root).unwrap_err();
        assert!(err.contains("Cannot parse library manifest"));

        let _ = fs::remove_dir_all(root);
    }
}
