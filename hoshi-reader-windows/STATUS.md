# Hoshi Reader Windows Status

This root file is a short index only. Detailed and durable project documentation lives under `docs/`.

If content would overlap between this file and a file under `docs/`, keep the detailed version under `docs/` and leave only a link here.

## Current Docs

- `docs/PROJECT_STATUS.md` - current implementation facts, not implemented areas, known issues, risk areas, and validation commands.
- `docs/TODO.md` - short operational handoff for future agents.
- `docs/LOOKUP_ROADMAP.md` - remaining reader lookup slices; execute only one slice at a time.
- `docs/READER_ENTRY_CHARACTERIZATION.md` - bookshelf/import/reader/session behavior baseline.
- `docs/reader-layout-baseline.md` - vertical reader pagination and layout measurement baseline.

## Current Priority

Continue the reader lookup package from `docs/LOOKUP_ROADMAP.md`, starting with the first incomplete slice unless the user chooses another slice.

## Validation Reminder

- Documentation-only changes: `git diff --check`
- Frontend changes: `npm run check`
- Rust/backend changes: `cd src-tauri; cargo check`
