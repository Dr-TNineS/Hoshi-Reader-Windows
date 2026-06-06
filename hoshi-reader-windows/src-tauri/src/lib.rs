mod dict;
mod epub;
mod library;

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
            dict::commands::dict_lookup,
            dict::commands::dict_status,
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
