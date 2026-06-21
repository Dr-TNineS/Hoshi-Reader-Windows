mod anki;
mod dict;
mod epub;
mod library;
mod storage;

use dict::commands::DictState;
use epub::commands::EpubState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(EpubState {
            book: std::sync::Mutex::new(None),
        })
        .manage(DictState::new())
        .invoke_handler(tauri::generate_handler![
            epub::commands::epub_open,
            epub::commands::epub_get_chapter_path,
            epub::commands::epub_read_chapter,
            epub::commands::epub_close,
            library::library_import_epub,
            library::library_list_books,
            library::library_open_book,
            library::library_forget_book,
            storage::reading_load_state,
            storage::reading_save_progress,
            storage::reading_clear_session,
            storage::reading_forget_book,
            storage::reading_import_legacy_state,
            dict::commands::dictionary_import_yomitan_zip,
            dict::commands::dictionary_import_yomitan_zips,
            dict::commands::dictionary_import_yomitan_folder,
            dict::commands::dictionary_list,
            dict::commands::dictionary_media,
            dict::commands::dictionary_styles,
            dict::commands::dictionary_set_enabled,
            dict::commands::dictionary_set_order,
            dict::commands::dictionary_remove_import,
            dict::commands::dict_lookup,
            dict::commands::dict_status,
            anki::anki_load_settings,
            anki::anki_save_settings,
            anki::anki_ping,
            anki::anki_fetch_config,
            anki::anki_check_note,
            anki::anki_add_note,
            anki::anki_store_dictionary_media,
            anki::anki_store_remote_audio,
        ])
        .setup(|app| {
            app.state::<DictState>().initialize(app.handle());
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
