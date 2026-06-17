# Hoshi Reader Windows Agent TODO

Last updated: 2026-06-18

This file is the short operational handoff for future agents. Keep detailed state in `docs/PROJECT_STATUS.md` and lookup-specific slice details in `docs/LOOKUP_ROADMAP.md`.

## Maintenance Rules

- Keep this file short and actionable.
- Record only current priorities, active blockers, and durable validation requirements.
- Do not paste debug transcripts, long investigation notes, or per-commit history here.
- When completing a documented slice, update the smallest relevant line in the same commit.
- If this file overlaps with another `docs/` file, keep the detailed content in the focused doc and link to it here.
- Do not modify reference projects under `reference/` or `third_party/hoshidicts`.

## Current Priorities

1. Treat the current reader lookup implementation slices in `docs/LOOKUP_ROADMAP.md` as complete.
   - Slice 6 in `docs/REAL_LOOKUP_VALIDATION_PLAN.md` is complete, including a passing VS developer-shell linked build.
   - Slice 7 in `docs/REAL_LOOKUP_VALIDATION_PLAN.md` is complete, including a real JMdict Yomitan import, manifest verification, and linked runtime lookup check.
   - Slice 8 in `docs/REAL_LOOKUP_VALIDATION_PLAN.md` is complete, including direct Tauri file-dialog import and reader popup lookup with real EPUB/dictionary data.
   - Slice 9 in `docs/REAL_LOOKUP_VALIDATION_PLAN.md` is complete, including `MK3Fix0213.zip` Windows compatibility import and linked runtime lookup.
   - Slice 10 in `docs/REAL_LOOKUP_VALIDATION_PLAN.md` is complete, including source-title mapping for compatibility imports.
   - Dictionary management UI is complete at the minimal bookshelf-panel level.
   - Reader visual regression coverage now has a minimal automated probe for pagination geometry, final-page alignment, image rendering, Shift-hover lookup selection, Shift-hover tiny-movement dedupe, plain mouse selection not opening lookup, narrow-window overflow, Ctrl chapter navigation, and page-boundary chapter navigation.
   - Lookup popup regression coverage now has a minimal automated probe for all visible popup states, glossary Shift hover nested lookup stack behavior, child close parent preservation, parent-scroll child dismissal, result metadata, long-result scrolling, disabled Anki boundary, and narrow-window overflow.
   - Dictionary media popup coverage now verifies lazy image load success, unavailable media, non-Tauri fallback, and image sizing constraints.
   - Dictionary management UI coverage now has a minimal automated probe for empty/loading/error/ready states, counts, enable/order controls, actions, and narrow-window overflow.
   - Bookshelf/import hardening is complete for staged EPUB imports, duplicate EPUB reuse, missing app-owned EPUB errors, dictionary replacement preservation, import busy guards, and bookshelf Forget cleanup.
   - Final linked real dictionary validation with local `MK3Fix0213.zip` passed on 2026-06-12: `dict_id=93e8e532b599ba4a`, `term=140821`, `media=0`, `lookup_results=2`.
   - Anki HSA/Windows alignment is documented in `docs/ANKI_HSA_WINDOWS_ALIGNMENT.md`; AnkiConnect readiness/configuration, field preview, minimal duplicate-check/add-note plumbing, and real AnkiConnect runtime add-note validation are complete.
2. Treat the storage/model migration as complete at the JSON-store level: reading progress, recent books, and session now live in Tauri app data `reading/state.json`, with one-time legacy `localStorage` import and browser fallback.
3. Next recommended product area: Anki word-audio settings boundary, Slice 5A in `docs/ANKI_AUDIO_SYNC_PLAN.md`; still do not claim combined add-note-plus-dictionary-media runtime verification until a media-bearing Yomitan dictionary is available.
4. Before reader layout changes, re-check `docs/reader-layout-baseline.md`.
5. Keep `docs/PROJECT_STATUS.md` accurate when implementation facts change.

## Active Blockers

- Compatibility imports that bypass legacy zip/media filename encoding issues intentionally skip media entries, so `MK3Fix0213.zip` imports with `mediaCount=0`.
- Runtime validation with a normal media-bearing Yomitan dictionary is still blocked pending a suitable local zip; 2026-06-16 checks found only `OALDPE10.zip` with `mediaCount=0` and unsuitable MK3 compatibility media.

## Required Validation

- Documentation-only changes: `git diff --check`
- Frontend changes: `npm run check`
- Frontend production changes: `npm run build`
- AnkiConnect panel probe changes: `npm run check:anki-connect`
- Dictionary management probe changes: `npm run check:dictionary-management`
- Lookup popup probe changes: `npm run check:lookup-popup`
- Reader visual probe changes: `npm run check:reader-visual`
- Rust/backend changes: `cd src-tauri; cargo check`
- Rust library tests when touching storage, EPUB, sanitizer, or dictionary logic: `cd src-tauri; cargo test --lib`
- Real desktop Anki add-note validation: from `src-tauri`, set `HSW_ANKI_RUNTIME_VALIDATE=1`, then run `cargo test --lib validates_real_ankiconnect_add_note_and_duplicate_check -- --ignored --nocapture`
- Real desktop Anki store-media validation: from `src-tauri`, set `HSW_ANKI_RUNTIME_VALIDATE=1`, then run `cargo test --lib validates_real_ankiconnect_store_dictionary_media -- --ignored --nocapture`
- Linked real dictionary validation: VS developer shell with `RUSTFLAGS=--cfg hoshi_dicts_linked`, `CARGO_TARGET_DIR=target-linked-check`, `HSW_REAL_YOMITAN_ZIP=<local dictionary zip>`, then `cargo test --lib imports_real_yomitan_zip_and_loads_runtime -- --ignored --nocapture`

## Do Not Start Without A Slice

- Settings.
- Sync.
- Anki audio/sync implementation outside `docs/ANKI_AUDIO_SYNC_PLAN.md` slices.
- Sasayaki/audio.
- Release packaging.
- Broad UI redesign.
