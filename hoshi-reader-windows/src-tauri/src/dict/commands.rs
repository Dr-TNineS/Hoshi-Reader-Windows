use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(hoshi_dicts_linked)]
use crate::dict::ffi;
#[cfg(hoshi_dicts_linked)]
use std::ffi::{c_void, CStr, CString};

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
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct GlossaryEntry {
    pub dict: String,
    pub text: String,
}

#[derive(Default)]
struct DictRuntime {
    #[cfg(hoshi_dicts_linked)]
    backend: Option<DictBackend>,
    loaded_term_dicts: Vec<PathBuf>,
    error: Option<String>,
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
pub fn dict_lookup(text: String, state: tauri::State<DictState>) -> Result<Vec<DictResult>, String> {
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
        return backend.lookup(&text);
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        Err(runtime_error(&runtime))
    }
}

#[tauri::command]
pub fn dict_status(state: tauri::State<DictState>) -> bool {
    #[cfg(hoshi_dicts_linked)]
    {
        let runtime = state.runtime.lock().unwrap();
        runtime.backend.is_some()
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        let _ = state;
        false
    }
}

fn initialize_runtime(app: &AppHandle) -> DictRuntime {
    let imported_root = match imported_dictionary_root(app) {
        Ok(root) => root,
        Err(error) => {
            return DictRuntime {
                error: Some(error),
                ..DictRuntime::default()
            }
        }
    };
    let term_dirs = match find_term_dictionary_dirs(&imported_root) {
        Ok(dirs) => dirs,
        Err(error) => {
            return DictRuntime {
                error: Some(error),
                ..DictRuntime::default()
            }
        }
    };

    if term_dirs.is_empty() {
        return DictRuntime {
            loaded_term_dicts: term_dirs,
            error: Some(format!(
                "No imported hoshidicts term dictionaries found in {}",
                imported_root.display()
            )),
            ..DictRuntime::default()
        };
    }

    #[cfg(hoshi_dicts_linked)]
    {
        match DictBackend::load(&term_dirs) {
            Ok(backend) => DictRuntime {
                backend: Some(backend),
                loaded_term_dicts: term_dirs,
                error: None,
            },
            Err(error) => DictRuntime {
                loaded_term_dicts: term_dirs,
                error: Some(error),
                ..DictRuntime::default()
            },
        }
    }

    #[cfg(not(hoshi_dicts_linked))]
    {
        DictRuntime {
            loaded_term_dicts: term_dirs,
            error: Some("Dictionary engine not linked. Install CMake/C++ build tools and rebuild HSW with hoshidicts.".into()),
        }
    }
}

fn imported_dictionary_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("dictionaries")
        .join("imported");
    fs::create_dir_all(&root).map_err(|e| format!("Cannot create dictionary dir: {e}"))?;
    Ok(root)
}

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
        if runtime.loaded_term_dicts.is_empty() {
            "Dictionary backend is not ready: no imported dictionaries loaded.".into()
        } else {
            "Dictionary backend is not ready.".into()
        }
    })
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
    fn load(term_dirs: &[PathBuf]) -> Result<Self, String> {
        unsafe {
            let query = ffi::dict_query_create();
            if query.is_null() {
                return Err("Cannot create dictionary query.".into());
            }

            for dir in term_dirs {
                let path = CString::new(dir.to_string_lossy().as_bytes())
                    .map_err(|_| format!("Dictionary path contains an interior NUL: {}", dir.display()))?;
                if ffi::dict_query_add_term_dict(query, path.as_ptr()) != 0 {
                    ffi::dict_query_destroy(query);
                    return Err(format!("Cannot load term dictionary: {}", dir.display()));
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
        let glossary = serde_json::from_str::<Vec<GlossaryEntry>>(&glossary_json).unwrap_or_default();
        out.push(DictResult {
            expression: c_string(result.term.expression),
            reading: c_string(result.term.reading),
            glossary,
            matched: c_string(result.matched),
            deinflected: c_string(result.deinflected),
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
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn finds_only_imported_hoshidicts_term_dirs() {
        let root = std::env::temp_dir().join(format!(
            "hoshi_dict_test_{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
}
