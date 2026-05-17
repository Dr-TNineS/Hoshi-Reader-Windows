// FFI bindings to hoshidicts C wrapper
// See dict_capi.h for the C API

#[allow(non_camel_case_types)]
pub type DictQuery = *mut std::ffi::c_void;
pub type Deinflector = *mut std::ffi::c_void;
pub type LookupEngine = *mut std::ffi::c_void;

#[repr(C)]
pub struct TermResultC {
    pub expression: *const std::ffi::c_char,
    pub reading: *const std::ffi::c_char,
    pub rules: *const std::ffi::c_char,
    pub glossary_json: *const std::ffi::c_char,
    pub dict_name: *const std::ffi::c_char,
}

#[repr(C)]
pub struct LookupResultC {
    pub matched: *const std::ffi::c_char,
    pub deinflected: *const std::ffi::c_char,
    pub term: TermResultC,
    pub preprocessor_steps: i32,
}

pub type ResultCallback = Option<unsafe extern "C" fn(results: *const LookupResultC, count: i32, user_data: *mut std::ffi::c_void)>;

extern "C" {
    pub fn dict_query_create() -> DictQuery;
    pub fn dict_query_destroy(q: DictQuery);
    pub fn dict_query_add_term_dict(q: DictQuery, path: *const std::ffi::c_char) -> i32;
    pub fn dict_query_add_freq_dict(q: DictQuery, path: *const std::ffi::c_char) -> i32;
    pub fn dict_query_add_pitch_dict(q: DictQuery, path: *const std::ffi::c_char) -> i32;
    pub fn deinflector_create() -> Deinflector;
    pub fn deinflector_destroy(d: Deinflector);
    pub fn lookup_engine_create(q: DictQuery, d: Deinflector) -> LookupEngine;
    pub fn lookup_engine_destroy(e: LookupEngine);
    pub fn lookup_engine_lookup(e: LookupEngine, text: *const std::ffi::c_char, max_results: i32, scan_length: i32, cb: ResultCallback, user_data: *mut std::ffi::c_void) -> i32;
    pub fn free_result(r: *mut TermResultC);
}
