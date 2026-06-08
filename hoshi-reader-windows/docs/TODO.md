# Hoshi Reader Windows Agent TODO

Last updated: 2026-06-08

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
   - Next recommended work: decide whether to prioritize the `MK3Fix0213.zip` Windows import encoding failure, dictionary management UI, or reader visual regression coverage.
2. Preserve the bookshelf/import/reader/session main path described in `docs/READER_ENTRY_CHARACTERIZATION.md`.
3. Before reader layout changes, re-check `docs/reader-layout-baseline.md`.
4. Keep `docs/PROJECT_STATUS.md` accurate when implementation facts change.

## Active Blockers

- `MK3Fix0213.zip` fails in the linked importer on Windows with `No mapping for the Unicode character exists in the target multi-byte code page`; importer error text is now surfaced, but compatibility is not fixed.
- Reader behavior still lacks automated visual regression coverage.

## Required Validation

- Documentation-only changes: `git diff --check`
- Frontend changes: `npm run check`
- Frontend production changes: `npm run build`
- Rust/backend changes: `cd src-tauri; cargo check`
- Rust library tests when touching storage, EPUB, sanitizer, or dictionary logic: `cd src-tauri; cargo test --lib`

## Do Not Start Without A Slice

- Settings.
- Sync.
- Anki card creation.
- Sasayaki/audio.
- Release packaging.
- Broad UI redesign.
