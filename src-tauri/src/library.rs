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
    let root = library_root(&app)?;
    import_epub_into_library(&root, &source)
}

fn import_epub_into_library(root: &Path, source: &Path) -> Result<LibraryBookRecord, String> {
    if !source.is_file() {
        return Err(format!("EPUB source is not a file: {}", source.display()));
    }

    let content_hash = hash_file(&source)?;
    let book_id = content_hash.clone();
    let book_dir = root.join("books").join(&book_id);
    let library_file = book_dir.join("book.epub");

    let mut manifest = read_manifest(root)?;
    if let Some(existing) = manifest
        .books
        .iter()
        .find(|book| book.book_id == book_id && Path::new(&book.library_path).is_file())
    {
        return Ok(existing.clone());
    }

    import_epub_file_staged(source, &book_dir, &library_file, &book_id)?;
    let title = EpubBook::open(&library_file.to_string_lossy())
        .ok()
        .and_then(|book| book.title());
    let size_bytes = fs::metadata(&library_file)
        .map_err(|e| format!("Cannot read imported EPUB metadata: {e}"))?
        .len();

    let record = LibraryBookRecord {
        book_id,
        title,
        source_path: source.to_string_lossy().into_owned(),
        library_path: library_file.to_string_lossy().to_string(),
        content_hash,
        size_bytes,
        imported_at: now_secs()?,
    };

    if let Some(existing) = manifest
        .books
        .iter_mut()
        .find(|book| book.book_id == record.book_id)
    {
        *existing = record.clone();
    } else {
        manifest.books.insert(0, record.clone());
    }
    write_manifest(root, &manifest)?;

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
    let library_path = library_book_path_for_open(&root, &book_id)?;

    let book = EpubBook::open(&library_path)?;
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

fn library_book_path_for_open(root: &Path, book_id: &str) -> Result<String, String> {
    let manifest = read_manifest(root)?;
    let record = manifest
        .books
        .iter()
        .find(|book| book.book_id == book_id)
        .ok_or_else(|| format!("Library book not found: {book_id}"))?;

    if !Path::new(&record.library_path).is_file() {
        return Err(format!(
            "Imported EPUB file is missing for '{}'. Re-import the book to restore it.",
            record.title.as_deref().unwrap_or(&record.book_id)
        ));
    }

    Ok(record.library_path.clone())
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

fn import_epub_file_staged(
    source: &Path,
    book_dir: &Path,
    library_file: &Path,
    book_id: &str,
) -> Result<(), String> {
    let books_root = book_dir
        .parent()
        .ok_or_else(|| "Library book dir has no parent".to_string())?;
    fs::create_dir_all(books_root).map_err(|e| format!("Cannot create library books dir: {e}"))?;
    let staging_dir = books_root.join(format!(".importing-{book_id}"));
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir)
            .map_err(|e| format!("Cannot clean library import staging dir: {e}"))?;
    }
    let staging_file = staging_dir.join("book.epub");

    let result = (|| {
        copy_file_atomic(source, &staging_file)?;
        EpubBook::open(&staging_file.to_string_lossy())
            .map(|_| ())
            .map_err(|e| format!("Imported EPUB could not be opened after copy: {e}"))?;
        replace_dir_with_staged(book_dir, &staging_dir)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir);
    }

    if result.is_ok() && !library_file.is_file() {
        return Err("Imported EPUB did not finalize into the library.".into());
    }

    result
}

fn replace_dir_with_staged(final_dir: &Path, staging_dir: &Path) -> Result<(), String> {
    let backup_dir = final_dir.with_extension("replacing");
    if final_dir.exists() {
        if backup_dir.exists() {
            fs::remove_dir_all(&backup_dir)
                .map_err(|e| format!("Cannot clean library import replacement backup: {e}"))?;
        }
        fs::rename(final_dir, &backup_dir)
            .map_err(|e| format!("Cannot prepare existing library book for replacement: {e}"))?;
    }

    let moved = fs::rename(staging_dir, final_dir).or_else(|_| {
        copy_dir_all(staging_dir, final_dir)?;
        fs::remove_dir_all(staging_dir)
    });

    if let Err(error) = moved {
        if backup_dir.exists() {
            if final_dir.exists() {
                let _ = fs::remove_dir_all(final_dir);
            }
            let _ = fs::rename(&backup_dir, final_dir);
        }
        return Err(format!("Cannot move imported EPUB into library: {error}"));
    }

    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir)
            .map_err(|e| format!("Cannot remove replaced library book backup: {e}"))?;
    }
    Ok(())
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
    use zip::write::FileOptions;

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hoshi_library_{name}_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn write_test_epub(path: &Path, title: &str) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default();

        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#,
        )
        .unwrap();
        zip.start_file("content.opf", options).unwrap();
        zip.write_all(
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">test-book</dc:identifier>
    <dc:title>{title}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter1"/>
  </spine>
</package>"#
            )
            .as_bytes(),
        )
        .unwrap();
        zip.start_file("nav.xhtml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Nav</title></head>
  <body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><ol><li><a href="text/chapter1.xhtml">Chapter</a></li></ol></nav></body>
</html>"#).unwrap();
        zip.start_file("text/chapter1.xhtml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Chapter</title></head>
  <body><p>Chapter one text.</p></body>
</html>"#,
        )
        .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn missing_manifest_lists_empty_books() {
        let root = temp_root("missing_manifest");
        fs::create_dir_all(&root).unwrap();
        let manifest = read_manifest(&root).unwrap();
        assert!(manifest.books.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_manifest_returns_error() {
        let root = temp_root("bad_manifest");
        fs::create_dir_all(&root).unwrap();
        fs::write(manifest_path(&root), "not json").unwrap();

        let err = read_manifest(&root).unwrap_err();
        assert!(err.contains("Cannot parse library manifest"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn import_epub_uses_staging_and_reuses_duplicate_record() {
        let root = temp_root("duplicate");
        fs::create_dir_all(&root).unwrap();
        let first_source = root.join("first.epub");
        let second_source = root.join("second.epub");
        write_test_epub(&first_source, "Stable Book");
        fs::copy(&first_source, &second_source).unwrap();

        let first = import_epub_into_library(&root, &first_source).unwrap();
        let first_imported_at = first.imported_at;
        let second = import_epub_into_library(&root, &second_source).unwrap();

        assert_eq!(first.book_id, second.book_id);
        assert_eq!(second.source_path, first_source.to_string_lossy());
        assert_eq!(second.imported_at, first_imported_at);
        let manifest = read_manifest(&root).unwrap();
        assert_eq!(manifest.books.len(), 1);
        assert!(Path::new(&second.library_path).is_file());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_import_cleans_staging_and_does_not_write_manifest() {
        let root = temp_root("failed_import");
        fs::create_dir_all(&root).unwrap();
        let source = root.join("bad.epub");
        fs::write(&source, "not an epub").unwrap();

        let error = import_epub_into_library(&root, &source).unwrap_err();
        assert!(error.starts_with("Imported EPUB could not be opened after copy:"));
        assert!(!manifest_path(&root).exists());
        let books_root = root.join("books");
        let staging_left = fs::read_dir(&books_root)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".importing-")
            });
        assert!(!staging_left);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn library_open_helper_reports_missing_imported_epub() {
        let root = temp_root("missing_book_file");
        fs::create_dir_all(&root).unwrap();
        let missing_path = root.join("books").join("abc").join("book.epub");
        let manifest = LibraryManifest {
            version: MANIFEST_VERSION,
            books: vec![LibraryBookRecord {
                book_id: "abc".into(),
                title: Some("Missing Book".into()),
                source_path: "source.epub".into(),
                library_path: missing_path.to_string_lossy().into_owned(),
                content_hash: "abc".into(),
                size_bytes: 123,
                imported_at: 1,
            }],
        };
        write_manifest(&root, &manifest).unwrap();

        let error = library_book_path_for_open(&root, "abc").unwrap_err();
        assert!(error.contains("Missing Book"));
        assert!(error.contains("Re-import the book"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn failed_replacement_restores_existing_library_dir() {
        let root = temp_root("replace_restore");
        let final_dir = root.join("books").join("abc");
        let staging_dir = root.join("books").join(".importing-abc");
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("book.epub"), "old").unwrap();

        let error = replace_dir_with_staged(&final_dir, &staging_dir).unwrap_err();
        assert!(error.starts_with("Cannot move imported EPUB into library:"));
        assert_eq!(
            fs::read_to_string(final_dir.join("book.epub")).unwrap(),
            "old"
        );
        assert!(!final_dir.with_extension("replacing").exists());

        let _ = fs::remove_dir_all(root);
    }
}
