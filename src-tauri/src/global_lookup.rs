use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    fs,
    io::Write,
    path::{Path, PathBuf},
    str::FromStr,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Runtime, WebviewUrl, WebviewWindowBuilder,
    Window, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutEvent, ShortcutState};

#[cfg(windows)]
use windows::Win32::{
    Foundation::POINT,
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    },
    UI::{
        Accessibility::{
            CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern,
            IUIAutomationTreeWalker, UIA_TextPatternId,
        },
        WindowsAndMessaging::{
            GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
            GWL_EXSTYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
            SWP_NOZORDER, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
        },
    },
};

const SETTINGS_VERSION: u32 = 1;
const WINDOW_LABEL: &str = "global-lookup";
const WINDOW_WIDTH: i32 = 390;
const WINDOW_HEIGHT: i32 = 360;
const MAX_SELECTED_TEXT_CHARS: i32 = 4000;
const DISMISS_GRACE_MS: u64 = 700;
const MAX_UIA_ANCESTORS: usize = 8;
const MAX_UIA_DESCENDANTS_PER_ROOT: usize = 120;
const MAX_UIA_DESCENDANT_ROOTS: usize = 4;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortcutBinding {
    pub modifiers: Vec<String>,
    pub key_code: String,
    pub display_label: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalShortcutRegistration {
    pub registered: bool,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalLookupSettings {
    pub version: u32,
    pub enabled: bool,
    pub shortcut: ShortcutBinding,
    pub registration: GlobalShortcutRegistration,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlobalLookupPayload {
    pub request_id: u64,
    pub source: String,
    pub text: Option<String>,
    pub error: Option<String>,
}

pub struct GlobalLookupState {
    settings: Mutex<GlobalLookupSettings>,
    active_shortcut: Mutex<Option<Shortcut>>,
    pending: Mutex<Option<GlobalLookupPayload>>,
    presented_at: Mutex<Option<Instant>>,
    request_serial: AtomicU64,
}

impl Default for GlobalLookupState {
    fn default() -> Self {
        Self {
            settings: Mutex::new(GlobalLookupSettings::default()),
            active_shortcut: Mutex::new(None),
            pending: Mutex::new(None),
            presented_at: Mutex::new(None),
            request_serial: AtomicU64::new(0),
        }
    }
}

impl Default for ShortcutBinding {
    fn default() -> Self {
        Self {
            modifiers: vec!["Ctrl".into(), "Alt".into()],
            key_code: "KeyH".into(),
            display_label: "Ctrl + Alt + H".into(),
        }
    }
}

impl Default for GlobalShortcutRegistration {
    fn default() -> Self {
        Self {
            registered: true,
            error: None,
        }
    }
}

impl Default for GlobalLookupSettings {
    fn default() -> Self {
        Self {
            version: SETTINGS_VERSION,
            enabled: true,
            shortcut: ShortcutBinding::default(),
            registration: GlobalShortcutRegistration::default(),
        }
    }
}

fn normalized_modifier(modifier: &str) -> Option<&'static str> {
    match modifier.trim().to_ascii_lowercase().as_str() {
        "ctrl" | "control" => Some("Ctrl"),
        "alt" | "option" => Some("Alt"),
        "shift" => Some("Shift"),
        "win" | "meta" | "super" | "command" | "cmd" => Some("Win"),
        _ => None,
    }
}

fn modifier_order(modifier: &str) -> usize {
    match modifier {
        "Ctrl" => 0,
        "Alt" => 1,
        "Shift" => 2,
        "Win" => 3,
        _ => 4,
    }
}

fn normalize_modifiers(modifiers: &[String]) -> Vec<String> {
    let mut normalized = modifiers
        .iter()
        .filter_map(|modifier| normalized_modifier(modifier).map(str::to_string))
        .collect::<Vec<_>>();
    normalized.sort_by_key(|modifier| modifier_order(modifier));
    normalized.dedup();
    normalized
}

fn key_label(key_code: &str) -> Option<String> {
    let key_code = key_code.trim();
    if let Some(letter) = key_code.strip_prefix("Key") {
        if letter.len() == 1 && letter.chars().all(|c| c.is_ascii_alphabetic()) {
            return Some(letter.to_ascii_uppercase());
        }
    }
    if let Some(digit) = key_code.strip_prefix("Digit") {
        if digit.len() == 1 && digit.chars().all(|c| c.is_ascii_digit()) {
            return Some(digit.into());
        }
    }
    if matches!(
        key_code,
        "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12"
    ) {
        return Some(key_code.into());
    }
    if let Some(arrow) = key_code.strip_prefix("Arrow") {
        if matches!(arrow, "Up" | "Down" | "Left" | "Right") {
            return Some(arrow.into());
        }
    }
    match key_code {
        "Space" => Some("Space".into()),
        "Minus" => Some("-".into()),
        "Equal" => Some("=".into()),
        "BracketLeft" => Some("[".into()),
        "BracketRight" => Some("]".into()),
        "Backslash" => Some("\\".into()),
        "Semicolon" => Some(";".into()),
        "Quote" => Some("'".into()),
        "Comma" => Some(",".into()),
        "Period" => Some(".".into()),
        "Slash" => Some("/".into()),
        "Backquote" => Some("`".into()),
        "Home" | "End" | "PageUp" | "PageDown" | "Insert" | "Delete" => Some(key_code.into()),
        _ => None,
    }
}

fn is_reserved_key(key_code: &str) -> bool {
    matches!(
        key_code,
        "Escape"
            | "Tab"
            | "Enter"
            | "NumpadEnter"
            | "Backspace"
            | "CapsLock"
            | "ContextMenu"
            | "ControlLeft"
            | "ControlRight"
            | "AltLeft"
            | "AltRight"
            | "ShiftLeft"
            | "ShiftRight"
            | "MetaLeft"
            | "MetaRight"
    )
}

pub fn validate_shortcut_binding(binding: &ShortcutBinding) -> Result<(), String> {
    let modifiers = normalize_modifiers(&binding.modifiers);
    if !modifiers
        .iter()
        .any(|modifier| modifier == "Ctrl" || modifier == "Alt" || modifier == "Win")
    {
        return Err("Shortcut must include Ctrl, Alt, or Win.".into());
    }
    let key_code = binding.key_code.trim();
    if key_code.is_empty() || is_reserved_key(key_code) || key_label(key_code).is_none() {
        return Err("Shortcut must include a supported non-modifier key.".into());
    }
    Ok(())
}

pub fn normalize_shortcut_binding(binding: ShortcutBinding) -> Result<ShortcutBinding, String> {
    validate_shortcut_binding(&binding)?;
    let modifiers = normalize_modifiers(&binding.modifiers);
    let key_code = binding.key_code.trim().to_string();
    let key = key_label(&key_code)
        .ok_or_else(|| "Shortcut must include a supported non-modifier key.".to_string())?;
    let display_label = modifiers
        .iter()
        .cloned()
        .chain(std::iter::once(key))
        .collect::<Vec<_>>()
        .join(" + ");
    Ok(ShortcutBinding {
        modifiers,
        key_code,
        display_label,
    })
}

pub fn normalize_settings(
    mut settings: GlobalLookupSettings,
) -> Result<GlobalLookupSettings, String> {
    settings.version = SETTINGS_VERSION;
    settings.shortcut = normalize_shortcut_binding(settings.shortcut)?;
    Ok(settings)
}

pub fn settings_path(root: &Path) -> PathBuf {
    root.join("settings.json")
}

pub fn read_settings_from_root(root: &Path) -> Result<GlobalLookupSettings, String> {
    let path = settings_path(root);
    if !path.exists() {
        return Ok(GlobalLookupSettings::default());
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read global lookup settings: {e}"))?;
    let settings = serde_json::from_str::<GlobalLookupSettings>(&raw)
        .map_err(|e| format!("Cannot parse global lookup settings: {e}"))?;
    normalize_settings(settings)
}

pub fn write_settings_to_root(root: &Path, settings: &GlobalLookupSettings) -> Result<(), String> {
    fs::create_dir_all(root)
        .map_err(|e| format!("Cannot create global lookup settings dir: {e}"))?;
    let path = settings_path(root);
    let temp_path = root.join("settings.json.tmp");
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Cannot serialize global lookup settings: {e}"))?;

    {
        let mut file = fs::File::create(&temp_path)
            .map_err(|e| format!("Cannot create temporary global lookup settings: {e}"))?;
        file.write_all(json.as_bytes())
            .map_err(|e| format!("Cannot write temporary global lookup settings: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temporary global lookup settings: {e}"))?;
    }

    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Cannot replace old global lookup settings: {e}"))?;
    }
    fs::rename(&temp_path, &path).map_err(|e| format!("Cannot replace global lookup settings: {e}"))
}

pub fn initialize(app: &AppHandle) {
    let state = app.state::<GlobalLookupState>();
    let mut settings = read_app_settings(app);
    settings.registration = apply_registration(app, &state, &settings).unwrap_or_else(|error| {
        GlobalShortcutRegistration {
            registered: false,
            error: Some(error),
        }
    });
    *state.settings.lock().unwrap() = settings;
}

pub fn handle_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if window.label() != WINDOW_LABEL {
        return;
    }
    if matches!(event, WindowEvent::Focused(false))
        && window.is_visible().unwrap_or(false)
        && window
            .state::<GlobalLookupState>()
            .presented_at
            .lock()
            .unwrap()
            .is_none_or(|presented_at| {
                presented_at.elapsed() >= Duration::from_millis(DISMISS_GRACE_MS)
            })
    {
        let _ = window.destroy();
    }
}

#[tauri::command]
pub fn global_lookup_load_settings(
    app: AppHandle,
    state: tauri::State<'_, GlobalLookupState>,
) -> Result<GlobalLookupSettings, String> {
    let mut settings = read_app_settings(&app);
    let current = state.settings.lock().unwrap().clone();
    settings.registration = current.registration;
    *state.settings.lock().unwrap() = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn global_lookup_save_settings(
    app: AppHandle,
    state: tauri::State<'_, GlobalLookupState>,
    settings: GlobalLookupSettings,
) -> Result<GlobalLookupSettings, String> {
    let current = state.settings.lock().unwrap().clone();
    let mut next = match normalize_settings(settings) {
        Ok(settings) => settings,
        Err(error) => {
            let mut failed = current;
            failed.registration.error = Some(error);
            return Ok(failed);
        }
    };

    match apply_registration(&app, &state, &next) {
        Ok(registration) => next.registration = registration,
        Err(error) => {
            let mut failed = current;
            failed.registration.error = Some(error);
            return Ok(failed);
        }
    }

    write_app_settings(&app, &next)?;
    *state.settings.lock().unwrap() = next.clone();
    Ok(next)
}

#[tauri::command]
pub fn global_lookup_take_pending(
    state: tauri::State<'_, GlobalLookupState>,
) -> Result<Option<GlobalLookupPayload>, String> {
    Ok(state.pending.lock().unwrap().take())
}

#[tauri::command]
pub fn global_lookup_show_window(
    app: AppHandle,
    state: tauri::State<'_, GlobalLookupState>,
) -> Result<(), String> {
    let window = app
        .get_webview_window(WINDOW_LABEL)
        .ok_or_else(|| "Global lookup window is not available.".to_string())?;
    apply_tool_window_style(&window)?;
    state
        .presented_at
        .lock()
        .unwrap()
        .replace(Instant::now());
    window
        .show()
        .map_err(|e| format!("Cannot show global lookup window: {e}"))?;
    window
        .set_focus()
        .map_err(|e| format!("Cannot focus global lookup window: {e}"))
}

fn settings_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("global-lookup");
    fs::create_dir_all(&root)
        .map_err(|e| format!("Cannot create global lookup settings dir: {e}"))?;
    Ok(root)
}

fn read_app_settings(app: &AppHandle) -> GlobalLookupSettings {
    settings_root(app)
        .and_then(|root| read_settings_from_root(&root))
        .unwrap_or_default()
}

fn write_app_settings(app: &AppHandle, settings: &GlobalLookupSettings) -> Result<(), String> {
    let root = settings_root(app)?;
    write_settings_to_root(&root, settings)
}

fn shortcut_string(binding: &ShortcutBinding) -> String {
    binding
        .modifiers
        .iter()
        .map(|modifier| match modifier.as_str() {
            "Ctrl" => "Control",
            "Alt" => "Alt",
            "Shift" => "Shift",
            "Win" => "Super",
            other => other,
        })
        .chain(std::iter::once(binding.key_code.as_str()))
        .collect::<Vec<_>>()
        .join("+")
}

fn shortcut_from_binding(binding: &ShortcutBinding) -> Result<Shortcut, String> {
    Shortcut::from_str(&shortcut_string(binding))
        .map_err(|e| format!("Cannot parse global lookup shortcut: {e}"))
}

fn apply_registration(
    app: &AppHandle,
    state: &GlobalLookupState,
    settings: &GlobalLookupSettings,
) -> Result<GlobalShortcutRegistration, String> {
    let next_shortcut = if settings.enabled {
        Some(shortcut_from_binding(&settings.shortcut)?)
    } else {
        None
    };

    let mut active = state.active_shortcut.lock().unwrap();
    if *active == next_shortcut {
        return Ok(GlobalShortcutRegistration {
            registered: next_shortcut.is_some(),
            error: None,
        });
    }

    if let Some(shortcut) = next_shortcut {
        app.global_shortcut()
            .on_shortcut(shortcut, handle_shortcut_event)
            .map_err(|e| format!("Cannot register global lookup shortcut: {e}"))?;
        if let Some(previous) = *active {
            let _ = app.global_shortcut().unregister(previous);
        }
        *active = Some(shortcut);
        Ok(GlobalShortcutRegistration {
            registered: true,
            error: None,
        })
    } else {
        if let Some(previous) = active.take() {
            app.global_shortcut()
                .unregister(previous)
                .map_err(|e| format!("Cannot unregister global lookup shortcut: {e}"))?;
        }
        Ok(GlobalShortcutRegistration {
            registered: false,
            error: None,
        })
    }
}

fn handle_shortcut_event(app: &AppHandle, _shortcut: &Shortcut, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let request_id = app
            .state::<GlobalLookupState>()
            .request_serial
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        let payload = match selected_text_from_focused_element(MAX_SELECTED_TEXT_CHARS) {
            Ok(text) => GlobalLookupPayload {
                request_id,
                source: "uia".into(),
                text: Some(text),
                error: None,
            },
            Err(error) => GlobalLookupPayload {
                request_id,
                source: "uia".into(),
                text: None,
                error: Some(error),
            },
        };
        let app_for_main = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = present_global_lookup(&app_for_main, payload) {
                log::warn!("Cannot present global lookup window: {error}");
            }
        });
    });
}

fn present_global_lookup(app: &AppHandle, payload: GlobalLookupPayload) -> Result<(), String> {
    app.state::<GlobalLookupState>()
        .pending
        .lock()
        .unwrap()
        .replace(payload.clone());

    let window = if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window
    } else {
        WebviewWindowBuilder::new(
            app,
            WINDOW_LABEL,
            WebviewUrl::App("/?globalLookup=1".into()),
        )
        .title("Hoshi Lookup")
        .inner_size(f64::from(WINDOW_WIDTH), f64::from(WINDOW_HEIGHT))
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .shadow(true)
        .visible(false)
        .build()
        .map_err(|e| format!("Cannot create global lookup window: {e}"))?
    };

    apply_tool_window_style(&window)?;
    if let Some(position) = cursor_window_position() {
        let _ = window.set_position(position);
    }
    app.emit_to(WINDOW_LABEL, "global-lookup-request", payload)
        .map_err(|e| format!("Cannot emit global lookup request: {e}"))
}

#[cfg(windows)]
fn apply_tool_window_style<R: Runtime>(window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    unsafe {
        let hwnd = window
            .hwnd()
            .map_err(|e| format!("Cannot resolve global lookup window handle: {e}"))?;
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next_style = (style & !(WS_EX_APPWINDOW.0 as isize)) | (WS_EX_TOOLWINDOW.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next_style);
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        )
        .map_err(|_| "Cannot apply global lookup tool-window style.".to_string())
    }
}

#[cfg(not(windows))]
fn apply_tool_window_style<R: Runtime>(_window: &tauri::WebviewWindow<R>) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn cursor_window_position() -> Option<PhysicalPosition<i32>> {
    unsafe {
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_err() {
            return None;
        }
        let monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return Some(PhysicalPosition::new(point.x + 16, point.y + 16));
        }
        let work = info.rcWork;
        let max_x = (work.right - WINDOW_WIDTH).max(work.left);
        let max_y = (work.bottom - WINDOW_HEIGHT).max(work.top);
        Some(PhysicalPosition::new(
            (point.x + 16).clamp(work.left, max_x),
            (point.y + 16).clamp(work.top, max_y),
        ))
    }
}

#[cfg(not(windows))]
fn cursor_window_position() -> Option<PhysicalPosition<i32>> {
    None
}

#[cfg(windows)]
fn selected_text_from_focused_element(max_chars: i32) -> Result<String, String> {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if hr.is_err() {
            return Err("Windows text selection is not available in this thread.".into());
        }
        let result = selected_text_from_focused_element_inner(max_chars);
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
unsafe fn selected_text_from_focused_element_inner(max_chars: i32) -> Result<String, String> {
    let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
        .map_err(|_| "Windows UI Automation is unavailable.".to_string())?;
    let walker = automation
        .RawViewWalker()
        .or_else(|_| automation.ControlViewWalker())
        .map_err(|_| "Windows UI Automation tree navigation is unavailable.".to_string())?;

    let mut candidates = Vec::new();
    if let Ok(element) = automation.GetFocusedElement() {
        candidates.push(element);
    }

    let mut point = POINT::default();
    if GetCursorPos(&mut point).is_ok() {
        if let Ok(element) = automation.ElementFromPoint(point) {
            candidates.push(element);
        }
    }

    let hwnd = GetForegroundWindow();
    if !hwnd.0.is_null() {
        if let Ok(element) = automation.ElementFromHandle(hwnd) {
            candidates.push(element);
        }
    }

    if candidates.is_empty() {
        return Err("No focused text element is available for global lookup.".to_string());
    }

    for element in candidates {
        if let Ok(text) = selected_text_from_element_tree(&walker, &element, max_chars) {
            return Ok(text);
        }
    }

    Err("The focused application does not expose selected text through UI Automation.".into())
}

#[cfg(windows)]
unsafe fn selected_text_from_element_tree(
    walker: &IUIAutomationTreeWalker,
    element: &IUIAutomationElement,
    max_chars: i32,
) -> Result<String, String> {
    if let Ok(text) = selected_text_from_element(element, max_chars) {
        return Ok(text);
    }

    let mut roots = vec![element.clone()];
    let mut current = element.clone();
    for _ in 0..MAX_UIA_ANCESTORS {
        let Ok(parent) = walker.GetParentElement(&current) else {
            break;
        };
        if let Ok(text) = selected_text_from_element(&parent, max_chars) {
            return Ok(text);
        }
        roots.push(parent.clone());
        current = parent;
    }

    for root in roots.iter().take(MAX_UIA_DESCENDANT_ROOTS) {
        if let Ok(text) = selected_text_from_descendants(walker, root, max_chars) {
            return Ok(text);
        }
    }

    Err("No selected text was found in this UI Automation subtree.".into())
}

#[cfg(windows)]
unsafe fn selected_text_from_descendants(
    walker: &IUIAutomationTreeWalker,
    root: &IUIAutomationElement,
    max_chars: i32,
) -> Result<String, String> {
    let mut queue = VecDeque::new();
    enqueue_children(walker, root, &mut queue, MAX_UIA_DESCENDANTS_PER_ROOT);
    let mut visited = 0usize;
    while let Some(element) = queue.pop_front() {
        visited += 1;
        if let Ok(text) = selected_text_from_element(&element, max_chars) {
            return Ok(text);
        }
        if visited >= MAX_UIA_DESCENDANTS_PER_ROOT {
            break;
        }
        enqueue_children(
            walker,
            &element,
            &mut queue,
            MAX_UIA_DESCENDANTS_PER_ROOT.saturating_sub(visited),
        );
    }
    Err("No selected text was found in nearby UI Automation elements.".into())
}

#[cfg(windows)]
unsafe fn enqueue_children(
    walker: &IUIAutomationTreeWalker,
    parent: &IUIAutomationElement,
    queue: &mut VecDeque<IUIAutomationElement>,
    remaining: usize,
) {
    if remaining == 0 {
        return;
    }
    let Ok(mut child) = walker.GetFirstChildElement(parent) else {
        return;
    };
    for _ in 0..remaining {
        queue.push_back(child.clone());
        let Ok(next) = walker.GetNextSiblingElement(&child) else {
            break;
        };
        child = next;
    }
}

#[cfg(windows)]
unsafe fn selected_text_from_element(
    element: &IUIAutomationElement,
    max_chars: i32,
) -> Result<String, String> {
    let pattern = element
        .GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId)
        .map_err(|_| "Element does not expose UI Automation TextPattern.".to_string())?;
    let ranges = pattern
        .GetSelection()
        .map_err(|_| "No UI Automation text selection is available.".to_string())?;
    let len = ranges
        .Length()
        .map_err(|_| "Cannot read the UI Automation text selection.".to_string())?;
    if len <= 0 {
        return Err("No text is selected.".into());
    }

    let mut parts = Vec::new();
    for index in 0..len {
        let range = ranges
            .GetElement(index)
            .map_err(|_| "Cannot read one selected text range.".to_string())?;
        let text = range
            .GetText(max_chars)
            .map_err(|_| "Cannot extract text from the selected range.".to_string())?
            .to_string();
        let text = text.trim();
        if !text.is_empty() {
            parts.push(text.to_string());
        }
    }

    let text = parts.join("\n").trim().to_string();
    if text.is_empty() {
        return Err("Selected text is empty.".into());
    }
    Ok(text)
}

#[cfg(not(windows))]
fn selected_text_from_focused_element(_max_chars: i32) -> Result<String, String> {
    Err("Global selected-text lookup is only available on Windows.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "hoshi_global_lookup_{name}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn default_settings_enable_ctrl_alt_h() {
        let settings = GlobalLookupSettings::default();
        assert!(settings.enabled);
        assert_eq!(settings.shortcut.display_label, "Ctrl + Alt + H");
        assert_eq!(settings.shortcut.key_code, "KeyH");
        assert_eq!(settings.shortcut.modifiers, vec!["Ctrl", "Alt"]);
        assert!(settings.registration.registered);
        assert_eq!(settings.registration.error, None);
    }

    #[test]
    fn validate_shortcut_requires_command_modifier_and_non_modifier_key() {
        assert!(validate_shortcut_binding(&ShortcutBinding {
            modifiers: vec!["Ctrl".into()],
            key_code: "KeyL".into(),
            display_label: "Ctrl + L".into(),
        })
        .is_ok());
        assert!(validate_shortcut_binding(&ShortcutBinding {
            modifiers: vec!["Shift".into()],
            key_code: "KeyL".into(),
            display_label: "Shift + L".into(),
        })
        .is_err());
        assert!(validate_shortcut_binding(&ShortcutBinding {
            modifiers: vec!["Ctrl".into()],
            key_code: "Escape".into(),
            display_label: "Ctrl + Esc".into(),
        })
        .is_err());
        assert!(validate_shortcut_binding(&ShortcutBinding {
            modifiers: vec!["Ctrl".into()],
            key_code: "ControlLeft".into(),
            display_label: "Ctrl".into(),
        })
        .is_err());
    }

    #[test]
    fn normalize_shortcut_orders_modifiers_and_label() {
        let binding = normalize_shortcut_binding(ShortcutBinding {
            modifiers: vec!["Shift".into(), "Alt".into(), "Ctrl".into()],
            key_code: "KeyJ".into(),
            display_label: "ignored".into(),
        })
        .unwrap();
        assert_eq!(binding.modifiers, vec!["Ctrl", "Alt", "Shift"]);
        assert_eq!(binding.display_label, "Ctrl + Alt + Shift + J");
    }

    #[test]
    fn missing_settings_read_defaults_and_corrupt_settings_errors() {
        let root = temp_root("missing_corrupt");
        let missing = read_settings_from_root(&root).unwrap();
        assert_eq!(missing.shortcut.display_label, "Ctrl + Alt + H");

        fs::write(settings_path(&root), "not json").unwrap();
        let error = read_settings_from_root(&root).unwrap_err();
        assert!(error.contains("Cannot parse global lookup settings"));
    }

    #[test]
    fn write_settings_round_trips_without_temp_file() {
        let root = temp_root("round_trip");
        let settings = normalize_settings(GlobalLookupSettings {
            enabled: false,
            shortcut: ShortcutBinding {
                modifiers: vec!["Alt".into(), "Ctrl".into()],
                key_code: "KeyJ".into(),
                display_label: "ignored".into(),
            },
            registration: GlobalShortcutRegistration {
                registered: false,
                error: Some("old error".into()),
            },
            ..GlobalLookupSettings::default()
        })
        .unwrap();

        write_settings_to_root(&root, &settings).unwrap();
        let loaded = read_settings_from_root(&root).unwrap();
        assert!(!loaded.enabled);
        assert_eq!(loaded.shortcut.display_label, "Ctrl + Alt + J");
        assert!(!settings_path(&root).with_extension("json.tmp").exists());
    }

}
