# Anki Audio And Sync Plan

Last updated: 2026-06-21

This document defines the next Anki scope after text note creation and
dictionary image media export.

Implementation status as of 2026-06-21: Slice 5A word-audio settings, Slice 5B
remote word-audio fetch/store, Slice 5C HSA-compatible local word audio, and
Slice 5D optional AnkiConnect sync are implemented. Sasayaki audio is not
implemented.

## Current Baseline

- HSW can configure desktop AnkiConnect, preview fields, create text notes, and
  reject duplicates through `canAddNotesWithErrorDetail`.
- HSW can store dictionary image media through AnkiConnect `storeMediaFile`.
- HSW add-note flow now stores dictionary image media before note creation and
  renders stored filenames into `{dictionary-media}` fields.
- HSW Anki settings include a minimal word-audio boundary: enable flag, one
  editable source, download timeout, and `{audio}` template recognition.
- HSW resolves the first enabled public HTTP/HTTPS word-audio source, stores
  supported audio through AnkiConnect, and renders `[sound:filename]` into
  `{audio}`. Ordinary source failures remain non-fatal; unsafe or oversized
  responses block the add operation.
- HSW can import an HSA-compatible `android.db`, order its audio sources, match
  reading before source priority, and fall back to remote audio when local
  audio is unavailable.
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
  FileProvider, Media3, or Android URI/provider flows; HSW reads compatible
  database content through Windows-native SQLite code.

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

Status: implemented on 2026-06-21. Automated Rust and lookup-popup validation
passes; real remote-source-plus-AnkiConnect runtime validation is not verified.

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

Goal: add Windows local audio lookup by importing the HSA-compatible SQLite
database while excluding Android URI/provider behavior.

Status: implemented on 2026-06-21 using the HSA-compatible SQLite database
shape while keeping Android URI/provider behavior out of HSW. Automated Rust,
Anki panel, and lookup-popup validation passes; a real HSA database runtime
import is not verified.

Key changes:

- Import the HSA-compatible SQLite database into app data `audio/android.db`
  through staged replacement and validate its required tables/columns.
- Resolve by expression/reading with the same HSA preference: exact reading
  match first, then source order.
- Read audio only from the imported database's `android.data` blobs; never
  resolve database `file` values as filesystem paths.
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

Status: implemented on 2026-06-21. Automated Rust, Anki panel, lookup popup,
and production build validation passes; real sync runtime validation is not
verified.

Key changes:

- Add `forceSyncAfterAdd: boolean` to Anki settings, default `false`.
- Extend the add-note result with secondary warnings and call AnkiConnect
  `sync` only after `addNote` returns success.
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

### Slice 5E: Tags And Duplicate Request Policy

Goal: align the note request with HSA's configurable tags and AnkiConnect
duplicate options.

Key changes:

- Add editable tags, allow duplicates, all-model checking, and Collection,
  Deck, or Deck Root duplicate scopes.
- Skip the blocking duplicate preflight when duplicates are allowed.
- Generate exact AnkiConnect `allowDuplicate`, `duplicateScope`, and
  `duplicateScopeOptions` values.
- Introduce the versioned settings normalizer used by later settings slices.

### Slice 5F: Compact Glossary And Book Cover

Goal: align exported glossary presentation and implement `{book-cover}`.

Key changes:

- Add default-off compact glossary styling for exported Anki HTML.
- Accept only `bookId` from the frontend; resolve the cover through the
  app-owned library manifest in Rust.
- Validate the resolved path, signature, type, and size, then store a stable
  `hsw_cover_<hash>.<ext>` filename.
- Keep ordinary missing-cover failures non-fatal and security violations hard.
- Do not add an `embedMedia` toggle: configured AnkiConnect media remains
  embedded, matching HSA's effective behavior.

### Slice 5G: Multiple Remote Audio Sources

Goal: finish the remote source model and ordered fallback behavior.

Key changes:

- Give each remote source a stable id and support add, remove, edit, enable,
  and reorder actions.
- Resolve local audio first, then each enabled remote source in saved order.
- Continue after ordinary source warnings, stop after the first hit, and abort
  immediately on a security error.
- Migrate legacy sources without relying on editable names or array indexes.

### Slice 5H: Shared Word Audio Resolver And Playback

Goal: enable popup playback without duplicating the Anki export resolver.

Key changes:

- Move local-first and remote-fallback resolution into a shared Rust
  `WordAudioResolver` that returns verified bytes, type, digest, source, and
  warnings.
- Use the same resolver for Anki media storage and bounded temporary playback
  cache output.
- Enable the popup play/stop action, cancellation, lookup cleanup, and
  autoplay. Persist playback mode for Slice 5N.

### Slice 5I-0: Audio Clipping Capability Spike

Goal: prove the Windows-native clipping stack before building Sasayaki UI.

Key changes:

- Test MP3, M4A/AAC, OGG/Opus, and WAV decoding plus deterministic WAV cue
  output in development, release, and packaged environments.
- Validate timing, limits, corrupt input, long files, Unicode paths, and real
  AnkiConnect playback.
- Prefer a pure Rust stack and do not assume a system FFmpeg installation.
- Require verified MP3 and WAV support before Slice 5I. Unsupported AAC or
  Opus combinations remain explicitly out of scope until proven.

### Slice 5I: Sasayaki Sidecar And Import

Goal: establish book-owned Sasayaki metadata and safe audio/SRT import.

Key changes:

- Address Sasayaki data by `bookId`, never by an arbitrary frontend path.
- Store audio location or an optional app-owned copy, UTF-8 SRT, cues, match
  data, and playback state in a per-book sidecar.
- Use staged validation and atomic replacement; deleting a book removes only
  app-owned Sasayaki data.
- Accept only formats verified by Slice 5I-0.

### Slice 5J: Cue Parsing, Matching, And Correction

Goal: map subtitle cues onto stable EPUB chapter text positions.

Key changes:

- Validate SRT numbering, time ranges, and text and assign stable cue ids.
- Port HSA text normalization and ordered matching to
  `chapterIndex + offset + length`.
- Show match rate and unmatched cues and provide rematch and manual correction.
- Cover ruby, Japanese punctuation, repeated sentences, DOM node boundaries,
  and chapter boundaries.

### Slice 5K: Sasayaki Playback

Goal: add the first reader audiobook playback loop.

Key changes:

- Add play/pause, progress, cue/seconds navigation, rate, and delay controls.
- Persist and restore the source, position, rate, and delay.
- Support relinking a missing external source and correct teardown across
  chapter, book, shelf, session restore, and application lifecycle changes.

### Slice 5L: Cue Presentation And Reader Coordination

Goal: connect the active cue to vertical pagination without changing layout
measurements.

Key changes:

- Highlight the active cue without introducing reflow.
- Support automatic page/chapter navigation, auto-scroll, and auto-pause.
- Add skip behavior and light/dark cue colors.
- Revalidate normal pages, final pages, image pages, chapter boundaries, and
  narrow windows.

### Slice 5M: Sasayaki Sentence Audio Export

Goal: implement `{sasayaki-audio}` from the current matched cue.

Key changes:

- Pass only `bookId + cueId` from lookup; resolve paths and time ranges from the
  Rust-owned sidecar.
- Clip using the Slice 5I-0 stack, write deterministic WAV, store
  `hsw_sasayaki_<hash>.wav`, and render `[sound:filename]`.
- Keep missing/unmatched/ordinary decoding failures non-fatal; reject tampered
  sidecars, path escapes, invalid ranges, and oversized output.

### Slice 5N: Word And Sasayaki Playback Coordination

Goal: complete the HSA-visible word-audio playback modes inside HSW.

Key changes:

- Interrupt pauses and conditionally resumes Sasayaki, Duck temporarily lowers
  its volume, and Mix plays both.
- Apply the same rules to autoplay and handle rapid lookups, failures, manual
  pauses, chapter changes, and shutdown.
- Coordinate HSW audio only; do not promise Windows-wide audio focus control.

### Slice 5O: Runtime Validation And Alignment Closure

Goal: validate the complete chain against real data and record remaining facts
without overstating them.

Key changes:

- Exercise tags, duplicate scopes, cover media, multiple sources, a real HSA
  database, playback, Sasayaki clipping, and sync with real AnkiConnect.
- Verify the final order: dictionary images, cover, word audio, Sasayaki audio,
  render, duplicate/addNote, optional sync.
- Compare HSA defaults, status text, warnings, hard errors, and fallback
  behavior. Mark unavailable fixture coverage as `not verified`.

## Media Ordering Tradeoff

HSW stores optional media before duplicate checking and `addNote`. A duplicate
may therefore leave an unreferenced content-hash media file in Anki. HSW does
not delete it automatically because another note may already share that file.

## Roadmap Maintenance

- `docs/ANKI_AUDIO_SYNC_PLAN.md` is the durable source for the full Slice
  5A-5O route.
- `docs/TODO.md` names only the current or next executable slice.
- After each slice, update its status here, move TODO to the next slice, and
  revise only unimplemented slices when runtime findings require it.

## Recommended Next Step

Implement Slice 5E tags and duplicate-request policy. Keep the post-add sync
setting default-off and preserve successful note status when sync fails.
