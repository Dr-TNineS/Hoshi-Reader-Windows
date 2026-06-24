use crate::audio_clip::{validate_audio_file, VERIFIED_AUDIO_CLIP_FORMATS};
use crate::epub::book::{filtered_reader_text, EpubBook};
use crate::library::{library_book_dir, library_book_file};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

const SIDECAR_VERSION: u32 = 1;
const MAX_SRT_BYTES: u64 = 16 * 1024 * 1024;
const SIDECAR_DIR_NAME: &str = "Sasayaki";
const STAGING_DIR_NAME: &str = ".Sasayaki-importing";
const BACKUP_DIR_NAME: &str = ".Sasayaki-replacing";
const DEFAULT_SEARCH_WINDOW: usize = 200;
const MIN_SEARCH_WINDOW: usize = 50;
const MAX_SEARCH_WINDOW: usize = 1000;
const MAX_CUE_PAGE_SIZE: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiSidecar {
    version: u32,
    book_id: String,
    audio: SasayakiAudioSource,
    subtitles: SasayakiSubtitle,
    cues: Vec<SasayakiCue>,
    match_data: SasayakiMatchData,
    #[serde(default)]
    corrections: Vec<SasayakiCorrection>,
    #[serde(default = "default_search_window")]
    search_window: usize,
    playback: SasayakiPlaybackData,
    updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "storage", rename_all = "camelCase")]
enum SasayakiAudioSource {
    External {
        path: String,
        original_file_name: String,
        extension: String,
        size_bytes: u64,
    },
    Copied {
        file_name: String,
        original_file_name: String,
        extension: String,
        size_bytes: u64,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiSubtitle {
    file_name: String,
    original_file_name: String,
    size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiCue {
    id: String,
    start_time: f64,
    end_time: f64,
    text: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiMatchData {
    matches: Vec<SasayakiMatch>,
    unmatched: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiMatch {
    id: String,
    start_time: f64,
    end_time: f64,
    text: String,
    chapter_index: usize,
    start: usize,
    length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiCorrection {
    cue_id: String,
    chapter_index: usize,
    start: usize,
    length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiPlaybackData {
    last_position: f64,
    delay: f64,
    rate: f32,
}

impl Default for SasayakiPlaybackData {
    fn default() -> Self {
        Self {
            last_position: 0.0,
            delay: 0.0,
            rate: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SasayakiStatus {
    configured: bool,
    audio_storage: Option<String>,
    audio_file_name: Option<String>,
    audio_extension: Option<String>,
    audio_size_bytes: Option<u64>,
    audio_available: bool,
    subtitle_file_name: Option<String>,
    subtitle_size_bytes: Option<u64>,
    cue_count: usize,
    matched_count: usize,
    unmatched_count: usize,
    corrected_count: usize,
    match_rate: f64,
    last_position: f64,
    delay: f64,
    rate: f32,
}

impl Default for SasayakiStatus {
    fn default() -> Self {
        Self {
            configured: false,
            audio_storage: None,
            audio_file_name: None,
            audio_extension: None,
            audio_size_bytes: None,
            audio_available: false,
            subtitle_file_name: None,
            subtitle_size_bytes: None,
            cue_count: 0,
            matched_count: 0,
            unmatched_count: 0,
            corrected_count: 0,
            match_rate: 0.0,
            last_position: 0.0,
            delay: 0.0,
            rate: 1.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SasayakiCueItem {
    id: String,
    start_time: f64,
    end_time: f64,
    text: String,
    matched: bool,
    corrected: bool,
    chapter_index: Option<usize>,
    start: Option<usize>,
    length: Option<usize>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SasayakiCuePage {
    total: usize,
    offset: usize,
    items: Vec<SasayakiCueItem>,
}

#[tauri::command]
pub fn sasayaki_status(book_id: String, app: AppHandle) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    status_from_book_dir(&book_dir, &book_id)
}

#[tauri::command]
pub fn sasayaki_import(
    book_id: String,
    audio_source_path: String,
    srt_source_path: String,
    copy_audio: bool,
    app: AppHandle,
) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    import_into_book_dir(
        &book_dir,
        &book_id,
        Path::new(&audio_source_path),
        Path::new(&srt_source_path),
        copy_audio,
    )
}

#[tauri::command]
pub fn sasayaki_remove(book_id: String, app: AppHandle) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    remove_from_book_dir(&book_dir, &book_id)
}

#[tauri::command]
pub fn sasayaki_rematch(
    book_id: String,
    search_window: usize,
    app: AppHandle,
) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    let book_file = library_book_file(&app, &book_id)?;
    rematch_book(&book_dir, &book_file, &book_id, search_window)
}

#[tauri::command]
pub fn sasayaki_list_cues(
    book_id: String,
    offset: usize,
    limit: usize,
    app: AppHandle,
) -> Result<SasayakiCuePage, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    cue_page_from_book_dir(&book_dir, &book_id, offset, limit)
}

#[tauri::command]
pub fn sasayaki_correct_cue(
    book_id: String,
    cue_id: String,
    chapter_index: usize,
    start: usize,
    length: usize,
    app: AppHandle,
) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    let book_file = library_book_file(&app, &book_id)?;
    correct_cue(
        &book_dir,
        &book_file,
        &book_id,
        &cue_id,
        chapter_index,
        start,
        length,
    )
}

#[tauri::command]
pub fn sasayaki_clear_correction(
    book_id: String,
    cue_id: String,
    app: AppHandle,
) -> Result<SasayakiStatus, String> {
    let book_dir = library_book_dir(&app, &book_id)?;
    let book_file = library_book_file(&app, &book_id)?;
    clear_correction(&book_dir, &book_file, &book_id, &cue_id)
}

fn import_into_book_dir(
    book_dir: &Path,
    book_id: &str,
    audio_source: &Path,
    srt_source: &Path,
    copy_audio: bool,
) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    let canonical_audio = canonical_source(audio_source, "audio")?;
    let canonical_srt = canonical_source(srt_source, "subtitle")?;
    let audio_extension = verified_audio_extension(&canonical_audio)?;
    validate_audio_file(&canonical_audio)?;
    let normalized_srt = read_valid_srt(&canonical_srt)?;
    let cues = parse_srt(&normalized_srt)?;
    let audio_size = fs::metadata(&canonical_audio)
        .map_err(|error| format!("Cannot read audio metadata: {error}"))?
        .len();
    let audio_original_name = source_file_name(&canonical_audio, "audio")?;
    let srt_original_name = source_file_name(&canonical_srt, "subtitle")?;

    let final_dir = book_dir.join(SIDECAR_DIR_NAME);
    let staging_dir = book_dir.join(STAGING_DIR_NAME);
    let backup_dir = book_dir.join(BACKUP_DIR_NAME);
    remove_dir_if_exists(&staging_dir, "stale Sasayaki import staging directory")?;
    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("Cannot create Sasayaki import staging directory: {error}"))?;

    let result = (|| {
        let subtitle_file_name = "subtitles.srt".to_string();
        write_file_synced(
            &staging_dir.join(&subtitle_file_name),
            normalized_srt.as_bytes(),
        )?;
        let audio = if copy_audio {
            let file_name = format!("audio.{audio_extension}");
            copy_file_synced(&canonical_audio, &staging_dir.join(&file_name))?;
            validate_audio_file(&staging_dir.join(&file_name))?;
            SasayakiAudioSource::Copied {
                file_name,
                original_file_name: audio_original_name,
                extension: audio_extension,
                size_bytes: audio_size,
            }
        } else {
            SasayakiAudioSource::External {
                path: canonical_audio.to_string_lossy().into_owned(),
                original_file_name: audio_original_name,
                extension: audio_extension,
                size_bytes: audio_size,
            }
        };
        let sidecar = SasayakiSidecar {
            version: SIDECAR_VERSION,
            book_id: book_id.to_string(),
            audio,
            subtitles: SasayakiSubtitle {
                file_name: subtitle_file_name,
                original_file_name: srt_original_name,
                size_bytes: normalized_srt.len() as u64,
            },
            match_data: SasayakiMatchData {
                matches: Vec::new(),
                unmatched: cues.len(),
            },
            cues,
            corrections: Vec::new(),
            search_window: DEFAULT_SEARCH_WINDOW,
            playback: SasayakiPlaybackData::default(),
            updated_at: now_millis()?,
        };
        write_sidecar(&staging_dir, &sidecar)?;
        replace_sidecar_dir(&final_dir, &staging_dir, &backup_dir)?;
        status_from_sidecar(&sidecar)
    })();

    if result.is_err() {
        let _ = fs::remove_dir_all(&staging_dir);
    }
    result
}

fn status_from_book_dir(book_dir: &Path, book_id: &str) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    let root = book_dir.join(SIDECAR_DIR_NAME);
    if !root.exists() {
        return Ok(SasayakiStatus::default());
    }
    let sidecar = read_sidecar(&root)?;
    if sidecar.book_id != book_id {
        return Err("Sasayaki sidecar belongs to a different book.".into());
    }
    validate_sidecar_files(&root, &sidecar)?;
    status_from_sidecar(&sidecar)
}

fn remove_from_book_dir(book_dir: &Path, book_id: &str) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    remove_dir_if_exists(&book_dir.join(SIDECAR_DIR_NAME), "app-owned Sasayaki data")?;
    remove_dir_if_exists(
        &book_dir.join(STAGING_DIR_NAME),
        "Sasayaki import staging directory",
    )?;
    remove_dir_if_exists(
        &book_dir.join(BACKUP_DIR_NAME),
        "Sasayaki replacement backup",
    )?;
    Ok(SasayakiStatus::default())
}

fn rematch_book(
    book_dir: &Path,
    book_file: &Path,
    book_id: &str,
    search_window: usize,
) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    let root = book_dir.join(SIDECAR_DIR_NAME);
    let mut sidecar = read_sidecar(&root)?;
    if sidecar.book_id != book_id {
        return Err("Sasayaki sidecar belongs to a different book.".into());
    }
    validate_sidecar_files(&root, &sidecar)?;
    let subtitle = contained_file(
        &root
            .canonicalize()
            .map_err(|error| format!("Cannot resolve Sasayaki directory: {error}"))?,
        &sidecar.subtitles.file_name,
        "subtitle",
    )?;
    let text = read_valid_srt(&subtitle)?;
    sidecar.cues = parse_srt(&text)?;
    let book = EpubBook::open(&book_file.to_string_lossy())?;
    sidecar.search_window = normalize_search_window(search_window);
    sidecar.match_data = match_cues(
        &book,
        &sidecar.cues,
        &sidecar.corrections,
        sidecar.search_window,
    )?;
    sidecar.updated_at = now_millis()?;
    write_sidecar_atomic(&root, &sidecar)?;
    status_from_sidecar(&sidecar)
}

fn cue_page_from_book_dir(
    book_dir: &Path,
    book_id: &str,
    offset: usize,
    limit: usize,
) -> Result<SasayakiCuePage, String> {
    validate_book_context(book_dir, book_id)?;
    let root = book_dir.join(SIDECAR_DIR_NAME);
    let sidecar = read_sidecar(&root)?;
    if sidecar.book_id != book_id {
        return Err("Sasayaki sidecar belongs to a different book.".into());
    }
    validate_sidecar_files(&root, &sidecar)?;
    let limit = limit.clamp(1, MAX_CUE_PAGE_SIZE);
    let matches = sidecar
        .match_data
        .matches
        .iter()
        .map(|matched| (matched.id.as_str(), matched))
        .collect::<std::collections::HashMap<_, _>>();
    let corrected = sidecar
        .corrections
        .iter()
        .map(|correction| correction.cue_id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let items = sidecar
        .cues
        .iter()
        .skip(offset)
        .take(limit)
        .map(|cue| {
            let matched = matches.get(cue.id.as_str()).copied();
            SasayakiCueItem {
                id: cue.id.clone(),
                start_time: cue.start_time,
                end_time: cue.end_time,
                text: cue.text.clone(),
                matched: matched.is_some(),
                corrected: corrected.contains(cue.id.as_str()),
                chapter_index: matched.map(|value| value.chapter_index),
                start: matched.map(|value| value.start),
                length: matched.map(|value| value.length),
            }
        })
        .collect();
    Ok(SasayakiCuePage {
        total: sidecar.cues.len(),
        offset,
        items,
    })
}

fn correct_cue(
    book_dir: &Path,
    book_file: &Path,
    book_id: &str,
    cue_id: &str,
    chapter_index: usize,
    start: usize,
    length: usize,
) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    let root = book_dir.join(SIDECAR_DIR_NAME);
    let mut sidecar = read_sidecar(&root)?;
    if !sidecar.cues.iter().any(|cue| cue.id == cue_id) {
        return Err(format!("Sasayaki cue not found: {cue_id}"));
    }
    let book = EpubBook::open(&book_file.to_string_lossy())?;
    validate_correction(&book, chapter_index, start, length)?;
    let correction = SasayakiCorrection {
        cue_id: cue_id.to_string(),
        chapter_index,
        start,
        length,
    };
    if let Some(existing) = sidecar
        .corrections
        .iter_mut()
        .find(|value| value.cue_id == cue_id)
    {
        *existing = correction;
    } else {
        sidecar.corrections.push(correction);
    }
    sidecar.match_data = match_cues(
        &book,
        &sidecar.cues,
        &sidecar.corrections,
        normalize_search_window(sidecar.search_window),
    )?;
    sidecar.updated_at = now_millis()?;
    write_sidecar_atomic(&root, &sidecar)?;
    status_from_sidecar(&sidecar)
}

fn clear_correction(
    book_dir: &Path,
    book_file: &Path,
    book_id: &str,
    cue_id: &str,
) -> Result<SasayakiStatus, String> {
    validate_book_context(book_dir, book_id)?;
    let root = book_dir.join(SIDECAR_DIR_NAME);
    let mut sidecar = read_sidecar(&root)?;
    let before = sidecar.corrections.len();
    sidecar
        .corrections
        .retain(|correction| correction.cue_id != cue_id);
    if sidecar.corrections.len() == before {
        return Err(format!("Sasayaki correction not found: {cue_id}"));
    }
    let book = EpubBook::open(&book_file.to_string_lossy())?;
    sidecar.match_data = match_cues(
        &book,
        &sidecar.cues,
        &sidecar.corrections,
        normalize_search_window(sidecar.search_window),
    )?;
    sidecar.updated_at = now_millis()?;
    write_sidecar_atomic(&root, &sidecar)?;
    status_from_sidecar(&sidecar)
}

fn status_from_sidecar(sidecar: &SasayakiSidecar) -> Result<SasayakiStatus, String> {
    let (storage, file_name, extension, size_bytes, audio_available) = match &sidecar.audio {
        SasayakiAudioSource::External {
            path,
            original_file_name,
            extension,
            size_bytes,
        } => (
            "external",
            original_file_name,
            extension,
            *size_bytes,
            Path::new(path).is_file(),
        ),
        SasayakiAudioSource::Copied {
            original_file_name,
            extension,
            size_bytes,
            ..
        } => ("copied", original_file_name, extension, *size_bytes, true),
    };
    let total = sidecar.cues.len();
    let matched = sidecar.match_data.matches.len();
    Ok(SasayakiStatus {
        configured: true,
        audio_storage: Some(storage.into()),
        audio_file_name: Some(file_name.clone()),
        audio_extension: Some(extension.clone()),
        audio_size_bytes: Some(size_bytes),
        audio_available,
        subtitle_file_name: Some(sidecar.subtitles.original_file_name.clone()),
        subtitle_size_bytes: Some(sidecar.subtitles.size_bytes),
        cue_count: total,
        matched_count: matched,
        unmatched_count: sidecar.match_data.unmatched,
        corrected_count: sidecar.corrections.len(),
        match_rate: if total == 0 {
            0.0
        } else {
            matched as f64 / total as f64 * 100.0
        },
        last_position: sidecar.playback.last_position,
        delay: sidecar.playback.delay,
        rate: sidecar.playback.rate,
    })
}

#[derive(Debug, Clone)]
struct MatchChapter {
    chapter_index: usize,
    start: usize,
    text: Vec<char>,
}

impl MatchChapter {
    fn end(&self) -> usize {
        self.start + self.text.len()
    }
}

fn parse_srt(text: &str) -> Result<Vec<SasayakiCue>, String> {
    let mut cues = Vec::new();
    let mut previous_number = 0_u64;
    let mut previous_start = -1.0_f64;
    for (block_index, block) in text.split("\n\n").enumerate() {
        let lines = block.lines().collect::<Vec<_>>();
        if lines.iter().all(|line| line.trim().is_empty()) {
            continue;
        }
        if lines.len() < 3 {
            return Err(format!(
                "SRT block {} must contain a number, timing row, and text.",
                block_index + 1
            ));
        }
        let number = lines[0]
            .trim()
            .parse::<u64>()
            .map_err(|_| format!("SRT block {} has an invalid cue number.", block_index + 1))?;
        if number == 0 || number <= previous_number {
            return Err(format!(
                "SRT cue numbers must be positive and strictly increasing; found {number} after {previous_number}."
            ));
        }
        let (start_time, end_time) = parse_timing_row(lines[1], number)?;
        if start_time < previous_start {
            return Err(format!("SRT cue {number} starts before the previous cue."));
        }
        let cue_text = lines[2..]
            .iter()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        if cue_text.is_empty() {
            return Err(format!("SRT cue {number} has no text."));
        }
        cues.push(SasayakiCue {
            id: number.to_string(),
            start_time,
            end_time,
            text: cue_text,
        });
        previous_number = number;
        previous_start = start_time;
    }
    if cues.is_empty() {
        return Err("Sasayaki subtitle file contains no valid cues.".into());
    }
    Ok(cues)
}

fn parse_timing_row(row: &str, cue_number: u64) -> Result<(f64, f64), String> {
    let (start, end) = row
        .split_once("-->")
        .ok_or_else(|| format!("SRT cue {cue_number} has no --> timing separator."))?;
    let start = parse_srt_timestamp(start.trim(), cue_number)?;
    let end = parse_srt_timestamp(
        end.split_whitespace().next().unwrap_or("").trim(),
        cue_number,
    )?;
    if end <= start {
        return Err(format!("SRT cue {cue_number} must end after it starts."));
    }
    Ok((start, end))
}

fn parse_srt_timestamp(value: &str, cue_number: u64) -> Result<f64, String> {
    let normalized = value.replace(',', ".");
    let parts = normalized.split(':').collect::<Vec<_>>();
    if parts.len() != 3 {
        return Err(format!(
            "SRT cue {cue_number} has an invalid timestamp: {value}."
        ));
    }
    let hours = parts[0]
        .parse::<u64>()
        .map_err(|_| format!("SRT cue {cue_number} has an invalid hour."))?;
    let minutes = parts[1]
        .parse::<u64>()
        .map_err(|_| format!("SRT cue {cue_number} has an invalid minute."))?;
    let seconds = parts[2]
        .parse::<f64>()
        .map_err(|_| format!("SRT cue {cue_number} has an invalid second."))?;
    if minutes >= 60 || !(0.0..60.0).contains(&seconds) {
        return Err(format!(
            "SRT cue {cue_number} has a timestamp outside normal minute/second ranges."
        ));
    }
    Ok(hours as f64 * 3600.0 + minutes as f64 * 60.0 + seconds)
}

fn match_cues(
    book: &EpubBook,
    cues: &[SasayakiCue],
    corrections: &[SasayakiCorrection],
    search_window: usize,
) -> Result<SasayakiMatchData, String> {
    let chapters = match_chapters(book)?;
    let mut source = Vec::new();
    for chapter in &chapters {
        source.extend(chapter.text.iter().copied());
    }
    let correction_map = corrections
        .iter()
        .map(|correction| (correction.cue_id.as_str(), correction))
        .collect::<std::collections::HashMap<_, _>>();
    let mut cursor = initial_match_start(&source, cues);
    let mut matches = Vec::new();

    for cue in cues {
        if let Some(correction) = correction_map.get(cue.id.as_str()) {
            validate_correction(
                book,
                correction.chapter_index,
                correction.start,
                correction.length,
            )?;
            matches.push(SasayakiMatch {
                id: cue.id.clone(),
                start_time: cue.start_time,
                end_time: cue.end_time,
                text: cue.text.clone(),
                chapter_index: correction.chapter_index,
                start: correction.start,
                length: correction.length,
            });
            if let Some(chapter) = chapters
                .iter()
                .find(|chapter| chapter.chapter_index == correction.chapter_index)
            {
                cursor = chapter.start + correction.start + correction.length;
            }
            continue;
        }

        let filtered = filtered_reader_text(&cue.text).chars().collect::<Vec<_>>();
        if filtered.is_empty() || (cue.text.starts_with('※') && filtered.len() < 5) {
            continue;
        }
        let end = source.len().min(
            cursor
                .saturating_add(filtered.len())
                .saturating_add(search_window),
        );
        let Some(index) = find_text(&source, &filtered, cursor, end) else {
            continue;
        };
        let match_end = index + filtered.len();
        let Some(chapter) = chapters
            .iter()
            .find(|chapter| index >= chapter.start && index < chapter.end())
        else {
            continue;
        };
        if match_end > chapter.end() {
            continue;
        }
        cursor = match_end;
        matches.push(SasayakiMatch {
            id: cue.id.clone(),
            start_time: cue.start_time,
            end_time: cue.end_time,
            text: cue.text.clone(),
            chapter_index: chapter.chapter_index,
            start: index - chapter.start,
            length: filtered.len(),
        });
    }

    Ok(SasayakiMatchData {
        unmatched: cues.len().saturating_sub(matches.len()),
        matches,
    })
}

fn match_chapters(book: &EpubBook) -> Result<Vec<MatchChapter>, String> {
    let manifest = book.manifest();
    let spine = book.spine();
    let guide_toc_hrefs = book
        .epub
        .toc()
        .landmarks()
        .into_iter()
        .flat_map(|root| root.iter())
        .filter(|entry| entry.kind_raw() == Some("toc"))
        .filter_map(|entry| entry.href().map(|href| href.path().decode().into_owned()))
        .collect::<std::collections::HashSet<_>>();
    let mut chapters = Vec::new();
    let mut start = 0;
    for (chapter_index, spine_entry) in spine.iter().enumerate() {
        if !spine_entry.linear {
            continue;
        }
        let Some(manifest_entry) = manifest.iter().find(|entry| entry.id == spine_entry.idref)
        else {
            continue;
        };
        let is_nav = manifest_entry
            .properties
            .as_deref()
            .unwrap_or("")
            .split_whitespace()
            .any(|property| property == "nav");
        if is_nav || guide_toc_hrefs.contains(&manifest_entry.href) {
            continue;
        }
        let text = filtered_reader_text(&book.read_spine_item_text(chapter_index as u32)?)
            .chars()
            .collect::<Vec<_>>();
        chapters.push(MatchChapter {
            chapter_index,
            start,
            text,
        });
        start = chapters.last().map(MatchChapter::end).unwrap_or(start);
    }
    Ok(chapters)
}

fn initial_match_start(source: &[char], cues: &[SasayakiCue]) -> usize {
    cues.iter()
        .take(15)
        .filter(|cue| !cue.text.starts_with('※'))
        .filter_map(|cue| {
            let text = filtered_reader_text(&cue.text).chars().collect::<Vec<_>>();
            (text.len() >= 6)
                .then(|| find_text(source, &text, 0, source.len()))
                .flatten()
        })
        .min()
        .unwrap_or(0)
}

fn find_text(source: &[char], text: &[char], start: usize, end: usize) -> Option<usize> {
    if text.is_empty() || start > end || text.len() > end.saturating_sub(start) {
        return None;
    }
    (start..=end - text.len()).find(|index| source[*index..*index + text.len()] == *text)
}

fn validate_correction(
    book: &EpubBook,
    chapter_index: usize,
    start: usize,
    length: usize,
) -> Result<(), String> {
    if length == 0 {
        return Err("Sasayaki correction length must be greater than zero.".into());
    }
    let chapter_length = match_chapters(book)?
        .into_iter()
        .find(|chapter| chapter.chapter_index == chapter_index)
        .map(|chapter| chapter.text.len())
        .ok_or_else(|| {
            format!(
                "Sasayaki correction cannot target missing, navigation, guide TOC, or non-linear chapter {chapter_index}."
            )
        })?;
    let end = start
        .checked_add(length)
        .ok_or_else(|| "Sasayaki correction range overflowed.".to_string())?;
    if end > chapter_length {
        return Err(format!(
            "Sasayaki correction range exceeds chapter {chapter_index} length {chapter_length}."
        ));
    }
    Ok(())
}

fn normalize_search_window(value: usize) -> usize {
    value.clamp(MIN_SEARCH_WINDOW, MAX_SEARCH_WINDOW)
}

fn default_search_window() -> usize {
    DEFAULT_SEARCH_WINDOW
}

fn validate_book_context(book_dir: &Path, book_id: &str) -> Result<(), String> {
    if book_id.trim().is_empty() {
        return Err("Library book id is empty.".into());
    }
    if !book_dir.is_dir() {
        return Err("App-owned library book directory is missing.".into());
    }
    let name = book_dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "App-owned library book directory has no valid name.".to_string())?;
    if name != book_id {
        return Err("Sasayaki book id does not match the app-owned book directory.".into());
    }
    Ok(())
}

fn canonical_source(source: &Path, kind: &str) -> Result<PathBuf, String> {
    if !source.is_file() {
        return Err(format!("Selected {kind} source is not a file."));
    }
    source
        .canonicalize()
        .map_err(|error| format!("Cannot resolve selected {kind} source: {error}"))
}

fn verified_audio_extension(source: &Path) -> Result<String, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Selected audio source has no file extension.".to_string())?;
    if !VERIFIED_AUDIO_CLIP_FORMATS.contains(&extension.as_str()) {
        return Err(format!(
            "Sasayaki audio must use one of the verified formats: {}.",
            VERIFIED_AUDIO_CLIP_FORMATS.join(", ")
        ));
    }
    Ok(extension)
}

fn read_valid_srt(source: &Path) -> Result<String, String> {
    if source
        .extension()
        .and_then(|value| value.to_str())
        .map_or(true, |extension| !extension.eq_ignore_ascii_case("srt"))
    {
        return Err("Sasayaki subtitles must use the .srt extension.".into());
    }
    let metadata =
        fs::metadata(source).map_err(|error| format!("Cannot read subtitle metadata: {error}"))?;
    if metadata.len() == 0 {
        return Err("Sasayaki subtitle file is empty.".into());
    }
    if metadata.len() > MAX_SRT_BYTES {
        return Err(format!(
            "Sasayaki subtitle file exceeds the {} MiB limit.",
            MAX_SRT_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(source).map_err(|error| format!("Cannot read subtitle file: {error}"))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| "Sasayaki subtitle file must be valid UTF-8.".to_string())?
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    if text.contains('\0') {
        return Err("Sasayaki subtitle file contains invalid NUL characters.".into());
    }
    if !text.contains("-->") {
        return Err("Sasayaki subtitle file does not contain an SRT timing row.".into());
    }
    Ok(text)
}

fn validate_sidecar_files(root: &Path, sidecar: &SasayakiSidecar) -> Result<(), String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Sasayaki directory: {error}"))?;
    let subtitle = contained_file(&canonical_root, &sidecar.subtitles.file_name, "subtitle")?;
    read_valid_srt(&subtitle)?;
    let subtitle_size = fs::metadata(&subtitle)
        .map_err(|error| format!("Cannot read Sasayaki subtitle metadata: {error}"))?
        .len();
    if subtitle_size != sidecar.subtitles.size_bytes {
        return Err("Sasayaki subtitle file size does not match its sidecar.".into());
    }
    match &sidecar.audio {
        SasayakiAudioSource::Copied {
            file_name,
            extension,
            size_bytes,
            ..
        } => {
            validate_recorded_audio_extension(extension)?;
            let audio = contained_file(&canonical_root, file_name, "audio")?;
            let audio_size = fs::metadata(&audio)
                .map_err(|error| format!("Cannot read Sasayaki audio metadata: {error}"))?
                .len();
            if audio_size != *size_bytes {
                return Err("Sasayaki audio file size does not match its sidecar.".into());
            }
            validate_audio_file(&audio)?;
        }
        SasayakiAudioSource::External {
            path,
            extension,
            size_bytes,
            ..
        } => {
            validate_recorded_audio_extension(extension)?;
            let audio = Path::new(path);
            if audio.is_file() {
                let audio_size = fs::metadata(audio)
                    .map_err(|error| {
                        format!("Cannot read linked Sasayaki audio metadata: {error}")
                    })?
                    .len();
                if audio_size != *size_bytes {
                    return Err(
                        "Linked Sasayaki audio changed after import. Select it again to relink."
                            .into(),
                    );
                }
                validate_audio_file(audio)?;
            }
        }
    }
    Ok(())
}

fn validate_recorded_audio_extension(extension: &str) -> Result<(), String> {
    if VERIFIED_AUDIO_CLIP_FORMATS.contains(&extension) {
        return Ok(());
    }
    Err("Sasayaki sidecar contains an unverified audio format.".into())
}

fn contained_file(root: &Path, file_name: &str, kind: &str) -> Result<PathBuf, String> {
    let candidate = root.join(file_name);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("Cannot resolve Sasayaki {kind} file: {error}"))?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err(format!(
            "Sasayaki {kind} path escapes the app-owned sidecar directory."
        ));
    }
    Ok(canonical)
}

fn source_file_name(source: &Path, kind: &str) -> Result<String, String> {
    source
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Selected {kind} source has no valid file name."))
}

fn read_sidecar(root: &Path) -> Result<SasayakiSidecar, String> {
    let raw = fs::read_to_string(root.join("sidecar.json"))
        .map_err(|error| format!("Cannot read Sasayaki sidecar: {error}"))?;
    let sidecar: SasayakiSidecar = serde_json::from_str(&raw)
        .map_err(|error| format!("Cannot parse Sasayaki sidecar: {error}"))?;
    if sidecar.version != SIDECAR_VERSION {
        return Err(format!(
            "Unsupported Sasayaki sidecar version: {}.",
            sidecar.version
        ));
    }
    Ok(sidecar)
}

fn write_sidecar(root: &Path, sidecar: &SasayakiSidecar) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(sidecar)
        .map_err(|error| format!("Cannot serialize Sasayaki sidecar: {error}"))?;
    write_file_synced(&root.join("sidecar.json"), &json)
}

fn write_sidecar_atomic(root: &Path, sidecar: &SasayakiSidecar) -> Result<(), String> {
    let json = serde_json::to_vec_pretty(sidecar)
        .map_err(|error| format!("Cannot serialize Sasayaki sidecar: {error}"))?;
    let path = root.join("sidecar.json");
    let temp = root.join("sidecar.json.tmp");
    let backup = root.join("sidecar.json.replacing");
    write_file_synced(&temp, &json)?;
    if path.exists() {
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|error| format!("Cannot clear stale Sasayaki sidecar backup: {error}"))?;
        }
        fs::rename(&path, &backup)
            .map_err(|error| format!("Cannot stage old Sasayaki sidecar: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, &path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &path);
        }
        let _ = fs::remove_file(&temp);
        return Err(format!("Cannot install Sasayaki sidecar: {error}"));
    }
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("Cannot clear Sasayaki sidecar backup: {error}"))?;
    }
    Ok(())
}

fn write_file_synced(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = fs::File::create(path)
        .map_err(|error| format!("Cannot create staged Sasayaki file: {error}"))?;
    file.write_all(bytes)
        .map_err(|error| format!("Cannot write staged Sasayaki file: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Cannot flush staged Sasayaki file: {error}"))
}

fn copy_file_synced(source: &Path, destination: &Path) -> Result<(), String> {
    let mut input =
        fs::File::open(source).map_err(|error| format!("Cannot open audio source: {error}"))?;
    let mut output = fs::File::create(destination)
        .map_err(|error| format!("Cannot create copied Sasayaki audio: {error}"))?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = input
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read audio source: {error}"))?;
        if read == 0 {
            break;
        }
        output
            .write_all(&buffer[..read])
            .map_err(|error| format!("Cannot copy Sasayaki audio: {error}"))?;
    }
    output
        .sync_all()
        .map_err(|error| format!("Cannot flush copied Sasayaki audio: {error}"))
}

fn replace_sidecar_dir(
    final_dir: &Path,
    staging_dir: &Path,
    backup_dir: &Path,
) -> Result<(), String> {
    remove_dir_if_exists(backup_dir, "stale Sasayaki replacement backup")?;
    if final_dir.exists() {
        fs::rename(final_dir, backup_dir)
            .map_err(|error| format!("Cannot stage existing Sasayaki data: {error}"))?;
    }
    if let Err(error) = fs::rename(staging_dir, final_dir) {
        if backup_dir.exists() {
            let _ = fs::rename(backup_dir, final_dir);
        }
        return Err(format!("Cannot install Sasayaki data: {error}"));
    }
    remove_dir_if_exists(backup_dir, "replaced Sasayaki data")
}

fn remove_dir_if_exists(path: &Path, label: &str) -> Result<(), String> {
    if path.exists() {
        fs::remove_dir_all(path).map_err(|error| format!("Cannot remove {label}: {error}"))?;
    }
    Ok(())
}

fn now_millis() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .map_err(|error| format!("Cannot read system time: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use hound::{SampleFormat, WavSpec, WavWriter};
    use zip::write::FileOptions;

    fn temp_book(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("hsw_sasayaki_{name}_{}", now_millis().unwrap()));
        let book_dir = root.join("books").join("book-id");
        fs::create_dir_all(&book_dir).unwrap();
        fs::write(book_dir.join("book.epub"), b"epub").unwrap();
        book_dir
    }

    fn write_wav(path: &Path) {
        let mut writer = WavWriter::create(
            path,
            WavSpec {
                channels: 1,
                sample_rate: 8_000,
                bits_per_sample: 16,
                sample_format: SampleFormat::Int,
            },
        )
        .unwrap();
        for sample in 0..8_000 {
            writer.write_sample(sample as i16).unwrap();
        }
        writer.finalize().unwrap();
    }

    fn write_srt(path: &Path) {
        fs::write(
            path,
            "\u{feff}1\r\n00:00:00,000 --> 00:00:00,500\r\n星の音\r\n",
        )
        .unwrap();
    }

    fn write_match_epub(path: &Path) {
        let file = fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = FileOptions::default();
        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>"#,
        )
        .unwrap();
        zip.start_file("content.opf", options).unwrap();
        zip.write_all(
            br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Match Book</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="nav"/>
    <itemref idref="one"/>
    <itemref idref="two"/>
  </spine>
</package>"#,
        )
        .unwrap();
        zip.start_file("nav.xhtml", options).unwrap();
        zip.write_all(
            r#"<html><body><nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops">目次だけ</nav></body></html>"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("one.xhtml", options).unwrap();
        zip.write_all(
            r#"<html><body><p><ruby>学校<rt>がっこう</rt></ruby>です。始まり本文。同じ文、同じ文。章末</p></body></html>"#
                .as_bytes(),
        )
        .unwrap();
        zip.start_file("two.xhtml", options).unwrap();
        zip.write_all(
            r#"<html><body><p>章開始。手動位置。次の本文です。</p></body></html>"#.as_bytes(),
        )
        .unwrap();
        zip.finish().unwrap();
    }

    #[test]
    fn parses_strict_srt_with_stable_number_ids_and_multiline_text() {
        let cues = parse_srt(
            "10\n00:00:01,250 --> 00:00:02,500\n学校です\n続き\n\n12\n00:00:03.000 --> 00:00:04.000\n次の本文",
        )
        .unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].id, "10");
        assert_eq!(cues[0].text, "学校です 続き");
        assert!((cues[0].start_time - 1.25).abs() < 0.0001);
        assert_eq!(cues[1].id, "12");
    }

    #[test]
    fn strict_srt_rejects_bad_numbering_times_and_empty_text() {
        assert!(parse_srt(
            "2\n00:00:01,000 --> 00:00:02,000\none\n\n1\n00:00:03,000 --> 00:00:04,000\ntwo"
        )
        .unwrap_err()
        .contains("strictly increasing"));
        assert!(parse_srt("1\n00:00:02,000 --> 00:00:01,000\ntext")
            .unwrap_err()
            .contains("end after"));
        assert!(parse_srt("1\n00:61:00,000 --> 01:02:00,000\ntext")
            .unwrap_err()
            .contains("normal"));
        assert!(parse_srt("1\n00:00:00,000 --> 00:00:01,000\n  ")
            .unwrap_err()
            .contains("no text"));
    }

    #[test]
    fn matches_filtered_ordered_text_without_crossing_chapters() {
        let root = temp_book("matcher");
        let epub_path = root.join("book.epub");
        write_match_epub(&epub_path);
        let book = EpubBook::open(&epub_path.to_string_lossy()).unwrap();
        let cues = vec![
            SasayakiCue {
                id: "1".into(),
                start_time: 0.0,
                end_time: 1.0,
                text: "学校です始まり本文".into(),
            },
            SasayakiCue {
                id: "2".into(),
                start_time: 1.0,
                end_time: 2.0,
                text: "同じ文".into(),
            },
            SasayakiCue {
                id: "3".into(),
                start_time: 2.0,
                end_time: 3.0,
                text: "同じ文".into(),
            },
            SasayakiCue {
                id: "4".into(),
                start_time: 3.0,
                end_time: 4.0,
                text: "章末章開".into(),
            },
            SasayakiCue {
                id: "5".into(),
                start_time: 4.0,
                end_time: 5.0,
                text: "※星".into(),
            },
            SasayakiCue {
                id: "6".into(),
                start_time: 5.0,
                end_time: 6.0,
                text: "次の本文です".into(),
            },
        ];
        let result = match_cues(&book, &cues, &[], 50).unwrap();
        assert_eq!(
            result
                .matches
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec!["1", "2", "3", "6"]
        );
        assert_eq!(result.unmatched, 2);
        assert_eq!(result.matches[0].chapter_index, 1);
        assert_eq!(result.matches[0].start, 0);
        assert_eq!(result.matches[1].start, 9);
        assert_eq!(result.matches[2].start, 12);
        assert_eq!(result.matches[3].chapter_index, 2);
        let _ = fs::remove_dir_all(root.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn manual_correction_survives_rematch_and_can_be_cleared() {
        let book_dir = temp_book("correction");
        let source_root = book_dir.parent().unwrap().parent().unwrap().join("sources");
        fs::create_dir_all(&source_root).unwrap();
        let audio = source_root.join("audio.wav");
        let srt = source_root.join("subtitles.srt");
        write_wav(&audio);
        fs::write(&srt, "1\n00:00:00,000 --> 00:00:01,000\n存在しない字幕\n").unwrap();
        write_match_epub(&book_dir.join("book.epub"));
        import_into_book_dir(&book_dir, "book-id", &audio, &srt, false).unwrap();

        let unmatched =
            rematch_book(&book_dir, &book_dir.join("book.epub"), "book-id", 200).unwrap();
        assert_eq!(unmatched.matched_count, 0);
        let corrected = correct_cue(
            &book_dir,
            &book_dir.join("book.epub"),
            "book-id",
            "1",
            2,
            0,
            2,
        )
        .unwrap();
        assert_eq!(corrected.matched_count, 1);
        assert_eq!(corrected.corrected_count, 1);

        let rematched =
            rematch_book(&book_dir, &book_dir.join("book.epub"), "book-id", 50).unwrap();
        assert_eq!(rematched.matched_count, 1);
        assert_eq!(rematched.corrected_count, 1);
        let page = cue_page_from_book_dir(&book_dir, "book-id", 0, 10).unwrap();
        assert!(page.items[0].corrected);
        assert_eq!(page.items[0].chapter_index, Some(2));

        let cleared =
            clear_correction(&book_dir, &book_dir.join("book.epub"), "book-id", "1").unwrap();
        assert_eq!(cleared.matched_count, 0);
        assert_eq!(cleared.corrected_count, 0);
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn imports_external_audio_and_utf8_srt_by_book_id() {
        let book_dir = temp_book("external");
        let source_root = book_dir.parent().unwrap().parent().unwrap().join("sources");
        fs::create_dir_all(&source_root).unwrap();
        let audio = source_root.join("星の音.wav");
        let srt = source_root.join("星の音.srt");
        write_wav(&audio);
        write_srt(&srt);

        let status = import_into_book_dir(&book_dir, "book-id", &audio, &srt, false).unwrap();
        assert!(status.configured);
        assert_eq!(status.audio_storage.as_deref(), Some("external"));
        assert!(status.audio_available);
        assert_eq!(status.audio_file_name.as_deref(), Some("星の音.wav"));
        assert!(!book_dir.join(SIDECAR_DIR_NAME).join("audio.wav").exists());
        assert_eq!(
            fs::read_to_string(book_dir.join(SIDECAR_DIR_NAME).join("subtitles.srt")).unwrap(),
            "1\n00:00:00,000 --> 00:00:00,500\n星の音\n"
        );
        let sidecar = read_sidecar(&book_dir.join(SIDECAR_DIR_NAME)).unwrap();
        assert!(matches!(
            sidecar.audio,
            SasayakiAudioSource::External { .. }
        ));
        assert_eq!(sidecar.cues.len(), 1);
        assert_eq!(sidecar.cues[0].id, "1");
        assert!(sidecar.match_data.matches.is_empty());
        assert_eq!(sidecar.match_data.unmatched, 1);
        assert_eq!(sidecar.playback, SasayakiPlaybackData::default());
        fs::remove_file(&audio).unwrap();
        assert!(
            !status_from_book_dir(&book_dir, "book-id")
                .unwrap()
                .audio_available
        );
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn copied_import_is_contained_and_remove_preserves_original() {
        let book_dir = temp_book("copied");
        let source_root = book_dir.parent().unwrap().parent().unwrap().join("sources");
        fs::create_dir_all(&source_root).unwrap();
        let audio = source_root.join("audio.wav");
        let srt = source_root.join("subtitles.srt");
        write_wav(&audio);
        write_srt(&srt);

        let status = import_into_book_dir(&book_dir, "book-id", &audio, &srt, true).unwrap();
        assert_eq!(status.audio_storage.as_deref(), Some("copied"));
        let copied_audio = book_dir.join(SIDECAR_DIR_NAME).join("audio.wav");
        assert!(copied_audio.is_file());
        let copied_size = fs::metadata(&copied_audio).unwrap().len() as usize;
        fs::write(&copied_audio, vec![0_u8; copied_size]).unwrap();
        assert!(status_from_book_dir(&book_dir, "book-id")
            .unwrap_err()
            .contains("Unsupported or corrupt"));
        remove_from_book_dir(&book_dir, "book-id").unwrap();
        assert!(audio.is_file());
        assert!(!book_dir.join(SIDECAR_DIR_NAME).exists());
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn failed_reimport_preserves_existing_sidecar() {
        let book_dir = temp_book("rollback");
        let source_root = book_dir.parent().unwrap().parent().unwrap().join("sources");
        fs::create_dir_all(&source_root).unwrap();
        let audio = source_root.join("audio.wav");
        let srt = source_root.join("subtitles.srt");
        write_wav(&audio);
        write_srt(&srt);
        import_into_book_dir(&book_dir, "book-id", &audio, &srt, true).unwrap();
        let before = fs::read(book_dir.join(SIDECAR_DIR_NAME).join("sidecar.json")).unwrap();

        let invalid_srt = source_root.join("invalid.srt");
        fs::write(&invalid_srt, b"not subtitles").unwrap();
        assert!(
            import_into_book_dir(&book_dir, "book-id", &audio, &invalid_srt, false)
                .unwrap_err()
                .contains("timing row")
        );
        assert_eq!(
            fs::read(book_dir.join(SIDECAR_DIR_NAME).join("sidecar.json")).unwrap(),
            before
        );
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn failed_directory_swap_restores_existing_sidecar() {
        let book_dir = temp_book("swap_restore");
        let final_dir = book_dir.join(SIDECAR_DIR_NAME);
        let missing_staging = book_dir.join(STAGING_DIR_NAME);
        let backup_dir = book_dir.join(BACKUP_DIR_NAME);
        fs::create_dir_all(&final_dir).unwrap();
        fs::write(final_dir.join("sidecar.json"), b"old").unwrap();

        assert!(
            replace_sidecar_dir(&final_dir, &missing_staging, &backup_dir)
                .unwrap_err()
                .contains("Cannot install")
        );
        assert_eq!(fs::read(final_dir.join("sidecar.json")).unwrap(), b"old");
        assert!(!backup_dir.exists());
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn rejects_unverified_audio_invalid_srt_and_wrong_book_context() {
        let book_dir = temp_book("invalid");
        let source_root = book_dir.parent().unwrap().parent().unwrap().join("sources");
        fs::create_dir_all(&source_root).unwrap();
        let audio = source_root.join("audio.m4a");
        let srt = source_root.join("subtitles.srt");
        fs::write(&audio, b"m4a").unwrap();
        write_srt(&srt);
        assert!(
            import_into_book_dir(&book_dir, "book-id", &audio, &srt, false)
                .unwrap_err()
                .contains("verified formats")
        );

        let wav = source_root.join("audio.wav");
        write_wav(&wav);
        let non_utf8 = source_root.join("non-utf8.srt");
        fs::write(&non_utf8, [0xff, 0xfe]).unwrap();
        assert!(
            import_into_book_dir(&book_dir, "book-id", &wav, &non_utf8, false)
                .unwrap_err()
                .contains("valid UTF-8")
        );
        let oversized = source_root.join("oversized.srt");
        let oversized_file = fs::File::create(&oversized).unwrap();
        oversized_file.set_len(MAX_SRT_BYTES + 1).unwrap();
        assert!(
            import_into_book_dir(&book_dir, "book-id", &wav, &oversized, false)
                .unwrap_err()
                .contains("MiB limit")
        );
        assert!(status_from_book_dir(&book_dir, "other")
            .unwrap_err()
            .contains("does not match"));
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }

    #[test]
    fn corrupt_or_escaping_sidecar_is_not_reported_as_ready() {
        let book_dir = temp_book("corrupt");
        let root = book_dir.join(SIDECAR_DIR_NAME);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("sidecar.json"), b"not json").unwrap();
        assert!(status_from_book_dir(&book_dir, "book-id")
            .unwrap_err()
            .contains("Cannot parse"));

        let outside = book_dir.join("outside.srt");
        write_srt(&outside);
        let sidecar = SasayakiSidecar {
            version: SIDECAR_VERSION,
            book_id: "book-id".into(),
            audio: SasayakiAudioSource::External {
                path: "C:/external/audio.wav".into(),
                original_file_name: "audio.wav".into(),
                extension: "wav".into(),
                size_bytes: 1,
            },
            subtitles: SasayakiSubtitle {
                file_name: "../outside.srt".into(),
                original_file_name: "outside.srt".into(),
                size_bytes: fs::metadata(&outside).unwrap().len(),
            },
            cues: Vec::new(),
            match_data: SasayakiMatchData::default(),
            corrections: Vec::new(),
            search_window: DEFAULT_SEARCH_WINDOW,
            playback: SasayakiPlaybackData::default(),
            updated_at: 1,
        };
        write_sidecar(&root, &sidecar).unwrap();
        assert!(status_from_book_dir(&book_dir, "book-id")
            .unwrap_err()
            .contains("escapes"));
        let _ = fs::remove_dir_all(book_dir.parent().unwrap().parent().unwrap());
    }
}
