mod dict;
mod epub;

use dict::commands::DictState;
use epub::commands::EpubState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(EpubState {
            book: std::sync::Mutex::new(None),
        })
        .manage(DictState {
            ready: std::sync::Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            epub::commands::epub_open,
            epub::commands::epub_get_chapter_path,
            epub::commands::epub_read_chapter,
            epub::commands::epub_close,
            dict::commands::dict_lookup,
            dict::commands::dict_status,
        ])
        .setup(|app| {
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
