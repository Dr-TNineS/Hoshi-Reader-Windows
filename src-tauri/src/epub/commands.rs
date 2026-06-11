use crate::epub::book::EpubBook;
use crate::epub::types::EpubMeta;
use std::sync::Mutex;
use tauri::State;

pub struct EpubState {
    pub book: Mutex<Option<EpubBook>>,
}

#[tauri::command]
pub fn epub_open(path: String, state: State<EpubState>) -> Result<EpubMeta, String> {
    let book = EpubBook::open(&path)?;
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

#[tauri::command]
pub fn epub_get_chapter_path(
    spine_index: u32,
    state: State<EpubState>,
) -> Result<Option<String>, String> {
    let guard = state.book.lock().unwrap();
    let book = guard.as_ref().ok_or("No book opened")?;
    book.chapter_absolute_path(spine_index)
}

#[tauri::command]
pub fn epub_read_chapter(spine_index: u32, state: State<EpubState>) -> Result<String, String> {
    let guard = state.book.lock().unwrap();
    let book = guard.as_ref().ok_or("No book opened")?;
    book.read_spine_item_text(spine_index)
}

#[tauri::command]
pub fn epub_close(state: State<EpubState>) {
    *state.book.lock().unwrap() = None;
}
