# Anki Audio And Sync Plan

Last updated: 2026-06-18

This document defines the next Anki scope after text note creation and
dictionary image media export.

Implementation status as of 2026-06-18: Slice 5A word-audio settings and
`{audio}` preview boundary are implemented. Audio download/storage, local audio,
Sasayaki audio, and sync are not implemented.

## Current Baseline

- HSW can configure desktop AnkiConnect, preview fields, create text notes, and
  reject duplicates through `canAddNotesWithErrorDetail`.
- HSW can store dictionary image media through AnkiConnect `storeMediaFile`.
- HSW add-note flow now stores dictionary image media before note creation and
  renders stored filenames into `{dictionary-media}` fields.
- HSW Anki settings include a minimal word-audio boundary: enable flag, one
  editable source, download timeout, and `{audio}` template recognition.
- Real store-media runtime validation passed with a throwaway SVG media file.
- Real combined add-note-plus-dictionary-media validation with a normal
  media-bearing Yomitan dictionary is not verified because no suitable local
  dictionary zip is available.

## HSA Reference Summary

- HSA exposes Anki media through the backend boundary:
  `addMediaFromUri`, `addMediaFromBytes`, and `sync`.
- HSA field templates include `{audio}`, `{sasayaki-audio}`, and `{book-cover}`.
- HSA word audio settings support remote audio sources, local audio, autoplay,
  and playback mode. Android local audio uses app/private storage and Android
  URI/FileProvider behavior that should not be copied directly to Windows.
- HSA Sasayaki sentence audio is a separate reader/audiobook subsystem. It can
  export clipped cue audio for Anki, but it depends on playback metadata, cue
  matching, and Android Media3 export machinery.
- HSA force-sync runs only after a successful note add.

## Windows Direction

- Continue using desktop AnkiConnect as the only Windows Anki backend.
- Keep optional media failure non-fatal unless the failure indicates an unsafe
  local path, unsupported scheme, or blocked endpoint.
- Implement `{audio}` before `{sasayaki-audio}` because word audio can be scoped
  to lookup payload plus remote/local source resolution. Sasayaki needs a larger
  reader audio model that HSW does not yet have.
- Implement AnkiConnect `sync` only as an explicit user setting after add-note
  behavior remains stable; never force sync by default.
- Do not implement AnkiDroid providers, Android permissions, Android
  FileProvider, Media3, or Android local audio database flows.

## Implementation Slices

### Slice 5A: Word Audio Settings And Preview Boundary

Goal: add a minimal Windows word-audio configuration boundary without
downloading or storing audio.

Status: implemented on 2026-06-18.

Key changes:

- Extend Anki settings with:
  - `audioSources: { name, url, enabled }[]`
  - `audioEnabled: boolean`
  - `audioDownloadTimeoutMs: number`
- Default source should stay conservative and editable. If no default is chosen,
  leave `{audio}` empty.
- Add `{audio}` as a known token in field templates and previews.
- Show whether a selected lookup payload has enough data for audio:
  expression, reading, enabled source, and Anki endpoint.
- Do not call remote URLs or `storeMediaFile` in this slice.

Acceptance:

- Existing text and dictionary-media notes are unchanged.
- Configured note types with an audio-ish field can default to `{audio}`.
- `{audio}` previews as empty until a later slice resolves audio.
- Settings persist and survive app restart.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:anki-connect`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`

### Slice 5B: Remote Word Audio Fetch And Store

Goal: resolve one enabled remote audio source, store it through AnkiConnect, and
render `[sound:filename]` into `{audio}`.

Key changes:

- Add Rust command `anki_store_remote_audio(endpoint, request)`.
- Accept only configured HTTP/HTTPS templates expanded from lookup expression
  and reading; reject file paths, localhost-private expansion surprises, and
  unsupported schemes unless explicitly configured later.
- Enforce timeout and size limits.
- Support practical audio MIME/extensions: mp3, ogg/opus, wav, m4a/aac.
- Return `{ filename, warnings }`; missing audio returns warnings and no
  filename.
- Frontend add-note flow stores audio before `anki_add_note`, like dictionary
  media.

Acceptance:

- `{audio}` field contains `[sound:...]` after successful storage.
- Missing audio does not block text note creation.
- Hard network or unsupported-type failures are visible but scoped to Anki add.
- Duplicate behavior remains unchanged.

Validation:

- Rust unit tests for template expansion, endpoint/source rejection, MIME
  handling, timeout/error mapping, and AnkiConnect response parsing.
- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`
- Optional ignored real AnkiConnect test with a tiny local HTTP fixture.

### Slice 5C: Local Word Audio

Goal: add Windows local audio lookup without importing HSA Android database or
URI behavior directly.

Key changes:

- Define a Windows local audio index format under Tauri app data, or import a
  user-selected folder/index as a separate explicit design.
- Resolve by expression/reading with the same HSA preference: exact reading
  match first, then source order.
- Restrict reads to the configured local audio root.
- Store matching audio through the same AnkiConnect media path as remote audio.

Acceptance:

- Local audio can be enabled/disabled independently from remote sources.
- Missing local audio is non-fatal.
- Unsafe path traversal cannot read outside the configured local root.

Validation:

- Rust tests for index parsing, matching order, MIME handling, and path safety.
- Frontend settings/probe checks for enable/disable and fallback behavior.

### Slice 5D: Optional AnkiConnect Sync

Goal: optionally call AnkiConnect `sync` after a successful addNote.

Key changes:

- Add `forceSyncAfterAdd: boolean` to Anki settings, default `false`.
- Add Rust command or extend add-note result path to call AnkiConnect `sync`
  only after `addNote` returns success.
- Sync failure should not rewrite the note result from added to failed; show a
  secondary warning.

Acceptance:

- Default behavior never syncs.
- When enabled, sync runs only after successful note creation.
- Duplicate or failed note creation does not sync.

Validation:

- Rust tests for sync request handling.
- `npm run check`
- `npm run build`
- `npm run check:anki-connect`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- `cd src-tauri; cargo check`

### Slice 5E: Sasayaki Sentence Audio Evaluation

Goal: evaluate sentence-audio export only after HSW has a reader audio/Sasayaki
model.

Status: blocked by missing HSW Sasayaki playback/cue subsystem.

Do not implement in the Anki path first. HSA's `{sasayaki-audio}` depends on
cue matching, playback source management, clipping/export, and reader controls.
HSW should first decide whether Sasayaki itself is in scope for Windows.

## Recommended Next Step

Implement Slice 5B next. It should add remote word-audio fetch/store while
preserving the current behavior where `{audio}` remains empty if no audio is
resolved.
