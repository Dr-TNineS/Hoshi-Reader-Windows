# Anki Audio And Sync Plan

Last updated: 2026-06-24

This document defines the next Anki scope after text note creation and
dictionary image media export.

Implementation status as of 2026-06-24: Slices 5A-5K are implemented at the
documented validation level. Slice 5L is current. Slices 5M-5O are pending.
Real runtime coverage remains explicitly separate from automated validation.

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
- HSW has a pure-Rust Windows audio clipping capability for M4B/AAC-LC, MP3,
  and WAV input.
  It emits deterministic 16-bit PCM WAV cue bytes with bounded duration and
  output size. Generic M4A/raw AAC and OGG/Opus clipping remain unverified.
- HSW stores per-book Sasayaki sidecars under the app-owned library. M4B,
  MP3, and WAV
  audio can remain linked externally or be copied into app data, while UTF-8
  SRT is always copied. Status and removal are addressed by `bookId`.
- HSW strictly parses stable SRT cue numbers and timing ranges, matches filtered
  cue text forward through matchable EPUB spine items, and persists
  chapter/offset/length matches, the selected search window, and manual
  corrections. The bookshelf exposes coverage, unmatched cue inspection,
  rematch, and correction controls.
- HSW restores Sasayaki playback in the reader using an HTML audio lifecycle
  backed by a Rust playback session. Only the validated current audio file is
  added to Tauri's runtime asset scope. Position, 0.5-2.0 rate, and -2 to 2
  second cue delay persist; pause, progress seek, +/-10 seconds, cue navigation,
  relink, shelf/book change, session restore, and window-close teardown are
  wired without reader highlighting or automatic following.
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

| Slice | Status | Commit |
| --- | --- | --- |
| 5A-5C | Completed | See their individual status sections and repository history |
| 5D | Completed | `073690f` |
| 5E | Completed | `36ff38b` |
| 5F | Completed | `5d7c8f0` |
| 5G | Completed | `0e367ac` |
| 5H | Completed | `bb9a4b6` |
| 5I-0 | Completed | See repository history |
| 5I | Completed | See repository history |
| 5J | Completed | See repository history |
| 5K | Completed | See repository history |
| 5L | Current | Not started |
| 5M-5O | Pending | Not started |

Post-slice format extension on 2026-06-24: M4B/AAC-LC import, playback source
preparation, and deterministic cue clipping were enabled through Symphonia
`isomp4 + aac`. A real 368,936,202-byte, 12:22:43 M4B with chapters, cover, and
an auxiliary data track passed decode/clipping; the matching EPUB+SRT backend
pipeline imported 11,798 cues and matched 11,792 with 6 unmatched. Real Tauri
audio output remains `not verified`. Development and release M4B clipping,
126 Rust tests plus 3 ignored, Rust check, frontend check/build, bookshelf
probe, portable package build, and five-second package launch smoke passed.

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
verified. Commit: `073690f`.

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

Status: implemented on 2026-06-21. Settings v2 normalization, Rust request
coverage, Anki panel probes, lookup popup probes, and production build
validation pass. Real AnkiConnect validation of every duplicate scope is not
verified. Commit: `36ff38b`.

Key changes:

- Add editable tags, allow duplicates, all-model checking, and Collection,
  Deck, or Deck Root duplicate scopes.
- Skip the blocking duplicate preflight when duplicates are allowed.
- Generate exact AnkiConnect `allowDuplicate`, `duplicateScope`, and
  `duplicateScopeOptions` values.
- Introduce the versioned settings normalizer used by later settings slices.

### Slice 5F: Compact Glossary And Book Cover

Goal: align exported glossary presentation and implement `{book-cover}`.

Status: implemented on 2026-06-21 in `5d7c8f0`. Automated Rust, settings panel,
lookup popup, and production build validation pass. Real cover storage through
AnkiConnect is not verified.

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

Status: implemented on 2026-06-21 in `0e367ac`. Stable-id migration, source
management, ordered fallback, warning aggregation, and hard-error stop behavior
pass automated validation. Real multi-source runtime validation is not verified.

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

Status: implemented on 2026-06-24 with Symphonia MP3/WAV decoding and Hound
16-bit PCM WAV output. Development and release tests cover deterministic output,
exact frame timing, corrupt input, duration/output limits, a 120-second source,
and Unicode paths. The portable package built and its executable remained alive
in a launch smoke test. M4B/AAC-LC was verified in the later format extension;
generic M4A/raw AAC, OGG/Opus, and real Anki playback are `not verified`.

Key changes:

- Test MP3, M4A/AAC, OGG/Opus, and WAV decoding plus deterministic WAV cue
  output in development, release, and packaged environments.
- Validate timing, limits, corrupt input, long files, Unicode paths, and real
  AnkiConnect playback.
- Prefer a pure Rust stack and do not assume a system FFmpeg installation.
- Require verified MP3 and WAV support before Slice 5I. M4B/AAC-LC was proven
  by the later extension; generic M4A/raw AAC and Opus combinations remain out
  of scope until proven.

### Slice 5I: Sasayaki Sidecar And Import

Goal: establish book-owned Sasayaki metadata and safe audio/SRT import.

Status: implemented on 2026-06-24. HSW stores a versioned sidecar, normalized
UTF-8 SRT, empty cue/match data, and default playback state under the
app-owned book directory. Audio supports the M4B/MP3/WAV formats verified by
Slice 5I-0 and its later M4B extension, and persists either an external link or
an app-owned copy. Import
uses staging, atomic directory replacement, and rollback; removal and book
deletion remove only app-owned data. The bookshelf exposes per-book status,
link/copy import, unavailable external-source state, and removal without
matching or playback controls.

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

## Slice Execution Gates

The goal and implementation boundary for each slice are defined in its section
above. The table below is mandatory execution metadata; a slice is not complete
until its acceptance and validation entries are satisfied and recorded.

| Slice | Status | Boundary | Prerequisites | Acceptance | Validation |
| --- | --- | --- | --- | --- | --- |
| 5D | Completed (`073690f`) | Optional desktop AnkiConnect sync after add only; no background/cloud sync | Stable duplicate-check/addNote flow | Default-off; only successful add syncs; sync failure remains an added note with warning | Rust call-order/error tests; check, build, Anki panel and popup probes; VS `cargo test --lib` and `cargo check` |
| 5E | Completed (`36ff38b`) | Tags and AnkiConnect duplicate options only; media ordering unchanged | 5D result/warning shape | Tags persist; Collection/Deck/Deck Root options are exact; allow-duplicates skips preflight; legacy defaults load | Rust migration/request/preflight tests; check, build, panel/popup probes; VS Rust tests/check |
| 5F | Completed (`5d7c8f0`) | Compact exported glossary plus cover resolved in Rust only from app-owned `bookId`; no frontend path authority | 5E settings normalizer and existing media pipeline | Default-off compact HTML; referenced cover stores deterministically; missing warns; escape/forgery/oversize blocks; media-first orphan tradeoff remains documented | Passed: 89 Rust tests plus 3 ignored, Rust check, frontend check/build, panel and popup probes; real Anki cover runtime `not verified` |
| 5G | Completed (`0e367ac`) | Stable remote-source identity, UI management, and ordered export fallback; no playback | Committed 5F media pipeline | Stable ids survive edits/reorder/duplicate names; local then enabled remotes; ordinary miss continues, hit stops, security error aborts | Passed: 90 Rust tests plus 3 ignored, Rust check, frontend check/build, panel/popup source/order/fallback/security/narrow probes; real multi-source runtime `not verified` |
| 5H | Completed (`bb9a4b6`) | Shared Rust word resolver, bounded cache, button playback and autoplay; Sasayaki coordination deferred | 5G source model | Export and playback share local-first/ordered-remote selection; play/stop/logical cancellation/lookup cleanup are covered; autoplay failure is non-fatal | Passed: 93 Rust tests plus 3 ignored, Rust check, frontend check/build, Anki panel and popup playback/autoplay/resolver probes; real local/remote Tauri playback `not verified` |
| 5I-0 | Completed (2026-06-24) | Committed codec/clipping capability spike without UI; no unverified codec promise | Stable 5H word-audio path | MP3 and WAV pass deterministic cue-WAV output in dev/release/package; later M4B/AAC-LC extension is separately verified; real Anki result recorded or `not verified` | Passed: 7 original codec/timing/limit/corruption/long-source/Unicode tests in dev and release, 111 Rust tests plus 2 ignored, Rust check, frontend check/build, portable package build and launch smoke; later real M4B decode/clipping passed; generic M4A/raw AAC, OGG/Opus, and real Anki playback `not verified` |
| 5I | Completed (2026-06-24) | Per-book sidecar/import/status/removal only; no matching or playback | 5I-0 verifies MP3 and WAV minimum | Staged atomic audio/SRT import by `bookId`; external/copy modes persist; failure preserves old data; external originals are never deleted | Passed: 119 Rust tests plus 2 ignored, Rust check, frontend check/build, bookshelf status/import/removal probe, wide/520px visual and focus checks, portable package build and launch smoke; real audiobook/SRT import `not verified` |
| 5J | Completed (2026-06-24) | Cue parsing, matching, inspection, rematch and correction; no playback | 5I sidecar and SRT storage | Stable cue ids and chapter/offset/length matches persist; unmatched state and corrections survive; ruby/punctuation/repetition/boundaries pass fixtures | Passed: strict parser and matcher/correction Rust fixtures, 123 Rust tests plus 2 ignored, Rust check, frontend check/build, bookshelf matching/correction probe, wide/520px visual and overflow checks; real EPUB/audiobook/SRT characterization `not verified` |
| 5K | Completed (2026-06-24) | Sasayaki player lifecycle and controls; highlighting/following deferred | 5J stable cues | Playback/navigation/rate/delay work and restore; missing external audio relinks; lifecycle does not leak players | Passed: playback restore/value/relink Rust fixtures, 125 Rust tests plus 2 ignored, Rust check, frontend check/build, dedicated playback probe, reader visual and TOC probes, wide/520px overflow checks; a real backend M4B fixture is now available, but actual Tauri/WebView audio output remains `not verified` |
| 5L | Current | Cue presentation and reader coordination without replacing pagination | 5K playback events and 5J ranges | No layout shift; auto page/chapter/scroll/pause obey settings; reader baselines remain intact | Matcher-to-DOM tests, reader visual probe, playback-driven probes, manual vertical pagination checks |
| 5M | Pending | `{sasayaki-audio}` accepts `bookId + cueId`; Rust owns path/range; no arbitrary frontend time/path | 5I-0 clipping plus stable 5J-L cues | Deterministic WAV sound tag; ordinary no-cue/decode failures warn and create text cards; tampering/escape/range/oversize blocks; ordering is covered | Rust clip/store/security tests; popup ordering and warning/error probes; optional real Anki playback |
| 5N | Pending | Coordinate HSW-owned word and Sasayaki audio only; no Windows-wide focus | 5H word playback and 5K-L Sasayaki playback | Interrupt/Duck/Mix restore exact prior state; autoplay shares coordinator; rapid actions/failures/manual pause/navigation/shutdown are correct | Coordinator state-machine tests, rapid-action probes, manual Tauri playback for all modes |
| 5O | Pending | Runtime evidence and parity closure only; missing fixtures remain visible | 5F-5N committed at automated level | Full real pipeline order passes where fixtures exist; HSA defaults/states/failures have explicit parity results; gaps say `not verified` | All common checks, real Anki add/media/sync, real HSA DB/remote audio, packaged playback, Sasayaki end-to-end, `npm run package` |

Common checks mean `npm run check`, `npm run build`, the affected frontend
probes, VS developer-shell `cargo test --lib`, and VS developer-shell
`cargo check`. Reader changes additionally require `npm run check:reader-visual`.

## Recommended Next Step

Implement Slice 5L as the next committed slice. Connect active playback cues to
reader presentation and optional following without replacing the existing
pagination model; keep Anki cue export deferred.
