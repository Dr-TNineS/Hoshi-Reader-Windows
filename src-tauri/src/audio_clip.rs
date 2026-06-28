#![allow(dead_code)]

use std::fs::File;
use std::io::Cursor;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::{Time, TimeBase};

const MAX_CLIP_DURATION_MS: u64 = 60_000;
const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_CHANNELS: usize = 8;
const MAX_SAMPLE_RATE: u32 = 192_000;

pub(crate) const VERIFIED_AUDIO_CLIP_FORMATS: &[&str] = &["m4b", "mp3", "wav"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioFileInfo {
    pub sample_rate: u32,
    pub channels: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioClipRange {
    pub start_ms: u64,
    pub end_ms: u64,
}

pub(crate) fn clip_audio_file_to_wav(
    source: &Path,
    range: AudioClipRange,
) -> Result<Vec<u8>, String> {
    validate_range(range)?;

    let file = File::open(source).map_err(|error| format!("Cannot open audio source: {error}"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = source.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Unsupported or corrupt audio source: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "Audio source has no decodable default track.".to_string())?;
    let track_id = track.id;
    let track_time_base = track.codec_params.time_base;
    let track_sample_rate = track.codec_params.sample_rate;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Unsupported audio codec: {error}"))?;

    let mut output = Vec::new();
    let mut sample_buffer = None;
    let mut decoded_frames = seek_to_clip_start(
        &mut format,
        &mut decoder,
        track_id,
        track_time_base,
        track_sample_rate,
        range,
    );
    let mut output_spec = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("Cannot read audio source: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }

        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("Cannot decode audio source: {error}"))?;
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        validate_output_spec(spec.rate, channels)?;

        match output_spec {
            Some((sample_rate, channel_count))
                if sample_rate != spec.rate || channel_count != channels =>
            {
                return Err("Audio source changes sample format during decoding.".into());
            }
            None => output_spec = Some((spec.rate, channels)),
            _ => {}
        }

        let buffer = sample_buffer
            .get_or_insert_with(|| SampleBuffer::<i16>::new(decoded.capacity() as u64, spec));
        if buffer.capacity() < decoded.capacity() {
            *buffer = SampleBuffer::<i16>::new(decoded.capacity() as u64, spec);
        }
        buffer.copy_interleaved_ref(decoded);

        let packet_frames = buffer.samples().len() / channels;
        let start_frame = milliseconds_to_frame(range.start_ms, spec.rate);
        let end_frame = milliseconds_to_frame(range.end_ms, spec.rate);
        let packet_end = decoded_frames.saturating_add(packet_frames as u64);

        if packet_end > start_frame && decoded_frames < end_frame {
            let local_start = start_frame.saturating_sub(decoded_frames) as usize;
            let local_end = (end_frame.min(packet_end) - decoded_frames) as usize;
            let sample_start = local_start * channels;
            let sample_end = local_end * channels;
            let selected = &buffer.samples()[sample_start..sample_end];
            ensure_output_limit(output.len(), selected.len(), channels)?;
            output.extend_from_slice(selected);
        }

        decoded_frames = packet_end;
        if decoded_frames >= end_frame {
            break;
        }
    }

    let (sample_rate, channels) =
        output_spec.ok_or_else(|| "Audio source contains no decoded samples.".to_string())?;
    if output.is_empty() {
        return Err("Requested audio range is outside the decoded source.".into());
    }
    let requested_end_frame = milliseconds_to_frame(range.end_ms, sample_rate);
    if decoded_frames < requested_end_frame {
        return Err("Requested audio range extends beyond the decoded source.".into());
    }

    encode_pcm_wav(&output, sample_rate, channels as u16)
}

pub(crate) fn validate_audio_file(source: &Path) -> Result<AudioFileInfo, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "Audio source has no supported file extension.".to_string())?;
    if !VERIFIED_AUDIO_CLIP_FORMATS.contains(&extension.as_str()) {
        return Err(format!(
            "Audio source must use one of the verified formats: {}.",
            VERIFIED_AUDIO_CLIP_FORMATS.join(", ")
        ));
    }

    let file = File::open(source).map_err(|error| format!("Cannot open audio source: {error}"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(&extension);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Unsupported or corrupt audio source: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "Audio source has no decodable default track.".to_string())?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|error| format!("Unsupported audio codec: {error}"))?;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                return Err("Audio source contains no decoded samples.".into());
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(error) => return Err(format!("Cannot read audio source: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("Cannot decode audio source: {error}"))?;
        let spec = *decoded.spec();
        let channels = spec.channels.count();
        validate_output_spec(spec.rate, channels)?;
        if decoded.frames() == 0 {
            continue;
        }
        return Ok(AudioFileInfo {
            sample_rate: spec.rate,
            channels,
        });
    }
}

fn validate_range(range: AudioClipRange) -> Result<(), String> {
    if range.end_ms <= range.start_ms {
        return Err("Audio clip end must be after its start.".into());
    }
    if range.end_ms - range.start_ms > MAX_CLIP_DURATION_MS {
        return Err(format!(
            "Audio clip exceeds the {} second duration limit.",
            MAX_CLIP_DURATION_MS / 1000
        ));
    }
    Ok(())
}

fn validate_output_spec(sample_rate: u32, channels: usize) -> Result<(), String> {
    if sample_rate == 0 || sample_rate > MAX_SAMPLE_RATE {
        return Err(format!(
            "Audio sample rate must be between 1 and {MAX_SAMPLE_RATE} Hz."
        ));
    }
    if channels == 0 || channels > MAX_CHANNELS {
        return Err(format!(
            "Audio channel count must be between 1 and {MAX_CHANNELS}."
        ));
    }
    Ok(())
}

fn milliseconds_to_frame(milliseconds: u64, sample_rate: u32) -> u64 {
    milliseconds
        .saturating_mul(sample_rate as u64)
        .saturating_div(1000)
}

fn milliseconds_to_time(milliseconds: u64) -> Time {
    let seconds = milliseconds / 1000;
    let frac = (milliseconds % 1000) as f64 / 1000.0;
    Time::new(seconds, frac)
}

fn time_to_frame(time: Time, sample_rate: u32) -> u64 {
    let whole = time.seconds.saturating_mul(sample_rate as u64);
    let fractional = (time.frac * sample_rate as f64).floor().max(0.0) as u64;
    whole.saturating_add(fractional)
}

fn timestamp_to_frame(time_base: Option<TimeBase>, timestamp: u64, sample_rate: u32) -> u64 {
    time_base
        .map(|base| time_to_frame(base.calc_time(timestamp), sample_rate))
        .unwrap_or(timestamp)
}

fn seek_to_clip_start(
    format: &mut Box<dyn symphonia::core::formats::FormatReader>,
    decoder: &mut Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    track_time_base: Option<TimeBase>,
    track_sample_rate: Option<u32>,
    range: AudioClipRange,
) -> u64 {
    if range.start_ms == 0 {
        return 0;
    }
    let seeked = format.seek(
        SeekMode::Accurate,
        SeekTo::Time {
            time: milliseconds_to_time(range.start_ms),
            track_id: Some(track_id),
        },
    );
    match seeked {
        Ok(position) if position.track_id == track_id => {
            decoder.reset();
            track_sample_rate
                .map(|sample_rate| {
                    timestamp_to_frame(track_time_base, position.actual_ts, sample_rate)
                })
                .unwrap_or(0)
        }
        Ok(_) => {
            decoder.reset();
            0
        }
        Err(_) => 0,
    }
}

fn ensure_output_limit(
    current_samples: usize,
    added_samples: usize,
    channels: usize,
) -> Result<(), String> {
    let sample_count = current_samples
        .checked_add(added_samples)
        .ok_or_else(|| "Audio clip output size overflowed.".to_string())?;
    let data_bytes = sample_count
        .checked_mul(std::mem::size_of::<i16>())
        .ok_or_else(|| "Audio clip output size overflowed.".to_string())?;
    let total_bytes = data_bytes
        .checked_add(44)
        .ok_or_else(|| "Audio clip output size overflowed.".to_string())?;
    if total_bytes > MAX_OUTPUT_BYTES {
        return Err(format!(
            "Audio clip exceeds the {} MiB output limit.",
            MAX_OUTPUT_BYTES / (1024 * 1024)
        ));
    }
    if sample_count % channels != 0 {
        return Err("Decoded audio samples are not channel-aligned.".into());
    }
    Ok(())
}

fn encode_pcm_wav(samples: &[i16], sample_rate: u32, channels: u16) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::with_capacity(samples.len() * std::mem::size_of::<i16>() + 44);
    let mut cursor = Cursor::new(&mut bytes);
    let spec = hound::WavSpec {
        channels,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    {
        let mut writer = hound::WavWriter::new(&mut cursor, spec)
            .map_err(|error| format!("Cannot create cue WAV: {error}"))?;
        for sample in samples {
            writer
                .write_sample(*sample)
                .map_err(|error| format!("Cannot write cue WAV: {error}"))?;
        }
        writer
            .finalize()
            .map_err(|error| format!("Cannot finalize cue WAV: {error}"))?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    use std::fs;
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

    const MP3_FIXTURE_BASE64: &str = "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";

    const M4B_TAIL_MOOV_FIXTURE_BASE64: &str = "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";

    fn temp_root(name: &str) -> std::path::PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hsw_audio_clip_{name}_{suffix}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write_wav(path: &Path, seconds: u64, sample_rate: u32) {
        let mut writer = hound::WavWriter::create(
            path,
            hound::WavSpec {
                channels: 1,
                sample_rate,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        for frame in 0..seconds * sample_rate as u64 {
            writer
                .write_sample((frame % i16::MAX as u64) as i16)
                .unwrap();
        }
        writer.finalize().unwrap();
    }

    fn inspect_wav(bytes: &[u8]) -> (hound::WavSpec, Vec<i16>) {
        let mut reader = hound::WavReader::new(Cursor::new(bytes)).unwrap();
        let spec = reader.spec();
        let samples = reader
            .samples::<i16>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        (spec, samples)
    }

    #[test]
    fn verified_formats_include_m4b_mp3_and_wav() {
        assert_eq!(VERIFIED_AUDIO_CLIP_FORMATS, ["m4b", "mp3", "wav"]);
    }

    #[test]
    fn clips_wav_at_exact_frame_boundaries_deterministically() {
        let root = temp_root("wav");
        let source = root.join("source.wav");
        write_wav(&source, 2, 8_000);
        let range = AudioClipRange {
            start_ms: 250,
            end_ms: 500,
        };

        let first = clip_audio_file_to_wav(&source, range).unwrap();
        let second = clip_audio_file_to_wav(&source, range).unwrap();
        assert_eq!(first, second);

        let (spec, samples) = inspect_wav(&first);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 8_000);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(samples.len(), 2_000);
        assert_eq!(samples[0], 2_000);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clips_mp3_fixture_to_deterministic_pcm_wav() {
        let root = temp_root("mp3");
        let source = root.join("source.mp3");
        fs::write(
            &source,
            base64::engine::general_purpose::STANDARD
                .decode(MP3_FIXTURE_BASE64)
                .unwrap(),
        )
        .unwrap();
        let range = AudioClipRange {
            start_ms: 100,
            end_ms: 300,
        };

        let first = clip_audio_file_to_wav(&source, range).unwrap();
        let second = clip_audio_file_to_wav(&source, range).unwrap();
        assert_eq!(first, second);

        let (spec, samples) = inspect_wav(&first);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 8_000);
        assert_eq!(samples.len(), 1_600);
        assert!(samples.iter().any(|sample| *sample != 0));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clips_m4b_aac_fixture_to_deterministic_pcm_wav() {
        let root = temp_root("m4b");
        let source = root.join("source.m4b");
        let fixture = base64::engine::general_purpose::STANDARD
            .decode(M4B_TAIL_MOOV_FIXTURE_BASE64)
            .unwrap();
        fs::write(&source, fixture).unwrap();
        let range = AudioClipRange {
            start_ms: 50,
            end_ms: 250,
        };

        let first = clip_audio_file_to_wav(&source, range).unwrap();
        let second = clip_audio_file_to_wav(&source, range).unwrap();
        assert_eq!(first, second);

        let (spec, samples) = inspect_wav(&first);
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, 8_000);
        assert_eq!(samples.len(), 1_600);
        assert!(samples.iter().any(|sample| *sample != 0));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_only_verified_decodable_audio_formats() {
        let root = temp_root("validate");
        let wav = root.join("source.wav");
        write_wav(&wav, 1, 8_000);
        assert_eq!(
            validate_audio_file(&wav).unwrap(),
            AudioFileInfo {
                sample_rate: 8_000,
                channels: 1,
            }
        );

        let corrupt_m4b = root.join("source.m4b");
        fs::write(&corrupt_m4b, b"not m4b").unwrap();
        assert!(validate_audio_file(&corrupt_m4b)
            .unwrap_err()
            .contains("Unsupported or corrupt"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn supports_unicode_source_paths() {
        let root = temp_root("unicode");
        let source = root.join("星の音.wav");
        write_wav(&source, 1, 8_000);
        let bytes = clip_audio_file_to_wav(
            &source,
            AudioClipRange {
                start_ms: 0,
                end_ms: 100,
            },
        )
        .unwrap();
        assert_eq!(inspect_wav(&bytes).1.len(), 800);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clips_late_range_from_long_file_without_buffering_the_source() {
        let root = temp_root("long");
        let source = root.join("long.wav");
        write_wav(&source, 120, 8_000);
        let bytes = clip_audio_file_to_wav(
            &source,
            AudioClipRange {
                start_ms: 119_000,
                end_ms: 119_250,
            },
        )
        .unwrap();
        assert_eq!(inspect_wav(&bytes).1.len(), 2_000);
        assert!(bytes.len() < 8_000);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_corrupt_input_and_invalid_or_oversized_ranges() {
        let root = temp_root("invalid");
        let corrupt = root.join("broken.mp3");
        let mut file = File::create(&corrupt).unwrap();
        file.write_all(b"not audio").unwrap();
        assert!(clip_audio_file_to_wav(
            &corrupt,
            AudioClipRange {
                start_ms: 0,
                end_ms: 100,
            },
        )
        .unwrap_err()
        .contains("Unsupported or corrupt"));

        let source = root.join("source.wav");
        write_wav(&source, 1, 8_000);
        assert!(clip_audio_file_to_wav(
            &source,
            AudioClipRange {
                start_ms: 100,
                end_ms: 100,
            },
        )
        .unwrap_err()
        .contains("end must be after"));
        assert!(clip_audio_file_to_wav(
            &source,
            AudioClipRange {
                start_ms: 0,
                end_ms: MAX_CLIP_DURATION_MS + 1,
            },
        )
        .unwrap_err()
        .contains("duration limit"));
        assert!(clip_audio_file_to_wav(
            &source,
            AudioClipRange {
                start_ms: 900,
                end_ms: 1_100,
            },
        )
        .unwrap_err()
        .contains("extends beyond"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_output_that_would_exceed_the_memory_bound() {
        let samples_at_limit = (MAX_OUTPUT_BYTES - 44) / std::mem::size_of::<i16>();
        ensure_output_limit(0, samples_at_limit, 1).unwrap();
        assert!(ensure_output_limit(0, samples_at_limit + 1, 1)
            .unwrap_err()
            .contains("output limit"));
    }
}
