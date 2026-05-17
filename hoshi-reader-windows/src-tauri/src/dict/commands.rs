use serde::Serialize;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct DictResult {
    pub expression: String,
    pub reading: String,
    pub glossary: Vec<GlossaryEntry>,
    pub matched: String,
    pub deinflected: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct GlossaryEntry {
    pub dict: String,
    pub text: String,
}

pub struct DictState {
    pub ready: Mutex<bool>,
}

#[tauri::command]
pub fn dict_lookup(
    _text: String,
    _state: tauri::State<DictState>,
) -> Result<Vec<DictResult>, String> {
    // TODO: Implement when hoshidicts is compiled and linked
    Err("Dictionary engine not yet linked. Build hoshidicts first.".into())
}

#[tauri::command]
pub fn dict_status(state: tauri::State<DictState>) -> bool {
    *state.ready.lock().unwrap()
}
