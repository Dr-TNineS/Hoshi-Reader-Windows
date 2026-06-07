# Hoshi Reader Windows Agent TODO

Last updated: 2026-06-07

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
   - Next recommended work: execute Slice 6 from `docs/REAL_LOOKUP_VALIDATION_PLAN.md`.
2. Preserve the bookshelf/import/reader/session main path described in `docs/READER_ENTRY_CHARACTERIZATION.md`.
3. Before reader layout changes, re-check `docs/reader-layout-baseline.md`.
4. Keep `docs/PROJECT_STATUS.md` accurate when implementation facts change.

## Active Blockers

- Real hoshidicts import/lookup validation is blocked on a local CMake/C++ toolchain and a real dictionary zip.
- Real lookup result UX still needs manual verification with linked hoshidicts and real dictionary data.
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
