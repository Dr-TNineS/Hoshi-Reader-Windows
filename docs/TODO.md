# Hoshi Reader Windows Agent TODO

Last updated: 2026-06-29

This file is the short operational handoff for future agents. Keep detailed
state in `docs/PROJECT_STATUS.md`, architecture facts in
`docs/ARCHITECTURE.md`, validation policy in `docs/VALIDATION.md`, and
feature-specific slice history in the matching roadmap or plan.

## Maintenance Rules

- Keep this file short and actionable.
- Record only current priorities, active blockers, and handoff notes needed to
  pick the next slice.
- Do not paste debug transcripts, long investigation notes, completed slice
  history, per-commit history, or durable validation command lists here.
- When completing a documented slice, update the smallest relevant line in the
  same commit.
- If this file overlaps with another `docs/` file, keep the detailed content in
  the focused doc and link to it here.
- Do not modify reference projects under `reference/` or
  `third_party/hoshidicts` unless a task explicitly covers those inputs.

## Current Priorities

- No active implementation slice is currently selected in this handoff.
- For lookup/dictionary work, start from the relevant current feature plan:
  `docs/LOOKUP_ROADMAP.md`, `docs/REAL_LOOKUP_VALIDATION_PLAN.md`,
  `docs/DICTIONARY_POPUP_HSA_ALIGNMENT.md`,
  `docs/DICTIONARY_POPUP_DESKTOP_ALIGNMENT_PLAN.md`, or
  `docs/DICTIONARY_SETTINGS_HSA_ALIGNMENT_PLAN.md`.
- For Anki, media, audio, sync, or Sasayaki work, start from
  `docs/ANKI_HSA_WINDOWS_ALIGNMENT.md`, `docs/ANKI_MEDIA_EXPORT_PLAN.md`, or
  `docs/ANKI_AUDIO_SYNC_PLAN.md`.
- Before reader layout changes, re-check `docs/reader-layout-baseline.md` and
  `docs/READER_ENTRY_CHARACTERIZATION.md`.
- Keep `docs/PROJECT_STATUS.md` accurate when implementation status, known
  issues, risk areas, or not-verified runtime coverage changes.

## Active Blockers

- Old MK3 imports that decoded `gaiji/bs一.svg` or `gaiji/ws一.svg` as
  `gaiji/bsһ.svg` / `gaiji/wsһ.svg` still need reimport after the documented
  MK3 compatibility work.
- Some real runtime coverage remains `not verified`; check
  `docs/PROJECT_STATUS.md` before claiming real dictionary, Anki, media, audio,
  sync, package, or Tauri playback validation.

## Required Validation

Use `docs/VALIDATION.md` for the current validation matrix. If an active slice
needs extra validation beyond that guide, record only that slice-specific
addition here or in the relevant feature plan.

## Do Not Start Without A Slice

- Settings beyond currently documented settings plans.
- Sync.
- Anki audio/sync implementation outside `docs/ANKI_AUDIO_SYNC_PLAN.md`.
- Sasayaki/audio beyond the documented route.
- Release packaging.
- Broad UI redesign.
