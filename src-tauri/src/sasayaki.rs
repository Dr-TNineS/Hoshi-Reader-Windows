use crate::audio_clip::{validate_audio_file, VERIFIED_AUDIO_CLIP_FORMATS};
use crate::library::library_book_dir;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SasayakiSidecar {
    version: u32,
    book_id: String,
    audio: SasayakiAudioSource,
    subtitles: SasayakiSubtitle,
    cues: Vec<SasayakiCue>,
    match_data: SasayakiMatchData,
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
            last_position: 0.0,
            delay: 0.0,
            rate: 1.0,
        }
    }
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
            cues: Vec::new(),
            match_data: SasayakiMatchData::default(),
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
    Ok(SasayakiStatus {
        configured: true,
        audio_storage: Some(storage.into()),
        audio_file_name: Some(file_name.clone()),
        audio_extension: Some(extension.clone()),
        audio_size_bytes: Some(size_bytes),
        audio_available,
        subtitle_file_name: Some(sidecar.subtitles.original_file_name.clone()),
        subtitle_size_bytes: Some(sidecar.subtitles.size_bytes),
        cue_count: sidecar.cues.len(),
        matched_count: sidecar.match_data.matches.len(),
        unmatched_count: sidecar.match_data.unmatched,
        last_position: sidecar.playback.last_position,
        delay: sidecar.playback.delay,
        rate: sidecar.playback.rate,
    })
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
        assert!(sidecar.cues.is_empty());
        assert!(sidecar.match_data.matches.is_empty());
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
