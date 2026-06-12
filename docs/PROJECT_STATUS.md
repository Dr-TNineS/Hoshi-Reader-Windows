# Hoshi Reader Windows Project Status

Last updated: 2026-06-08

This file records current implementation facts for `hoshi-reader-windows`. It is not an agent rule file, product roadmap, or substitute for checking the current code.

Facts that cannot be confirmed from current code should be marked `unknown` or `not verified`.

## Current Scope

- Main project: `hoshi-reader-windows`.
- Platform target: Windows desktop through Tauri.
- Stack: Tauri 2, Svelte 5, TypeScript, Vite, Rust.
- Primary path: bookshelf -> import EPUB -> open reader -> select text -> lookup.
- Imported EPUB files are copied into the app-owned library under Tauri app data.
- Reading progress and session state still use browser `localStorage`.
- Local reference projects live under `reference/`; local hoshidicts build input lives under `third_party/hoshidicts`.

## Implemented

- Tauri application shell:
  - Resizable main window.
  - Dialog plugin.
  - Debug log plugin.
  - Asset protocol for temporary EPUB extraction paths.
- EPUB open/read:
  - File picker for `.epub`.
  - Temporary extraction and `rbook` metadata/chapter reading.
  - Title, cover href, manifest, spine, TOC, chapter path, and book character metadata.
  - EPUB CSS sanitizer with Rust tests.
- App-owned EPUB library:
  - `library_import_epub` copies EPUBs to `library/books/<book_id>/book.epub`.
  - `library/manifest.json` records app-owned books.
  - `book_id` is based on EPUB content hash.
  - Re-importing identical EPUB content reuses the same record.
  - New records open by `book_id` rather than original source path.
- Bookshelf:
  - Minimal recent-books list.
  - EPUB import entry.
  - Resume from saved progress.
  - Tauri startup attempts to restore the last reader session.
  - Legacy path-only records remain compatible when the original file still exists.
- Reader:
  - Japanese vertical paginated reading layout.
  - CSS column-based pagination using `.rv.clientHeight`, `.rct.scrollHeight`, and `scrollTop`.
  - Previous/next page and chapter navigation.
  - Keyboard arrow navigation and Ctrl/Meta chapter navigation.
  - Escape returns to shelf.
  - TOC overlay and internal chapter-link navigation.
  - EPUB asset URL rewriting.
  - Basic image load/reflow handling, SVG cover replacement, gaiji image handling, and block image handling.
  - Reader progress based on visible text position.
  - Reader visual probe fixture and `npm run check:reader-visual` cover baseline pagination geometry, final-page alignment, block image rendering, narrow-window overflow, Ctrl chapter navigation, and page-boundary chapter navigation.
- Reader selection and popup:
  - Captures selected reader text with rect and chapter index.
  - Supports Shift hover lookup trigger.
  - Supports holding Shift while moving the pointer to continuously rescan/select new text.
  - Popup prefers left/right side placement beside the selected text, with top/bottom fallback.
  - Popup distinguishes loading, no dictionary, engine unavailable, empty, error, and ready states.
  - Popup renders the current lookup result shape: expression, reading, source dictionary, matched/deinflected text, rules, glossary, frequency, and pitch.
  - Popup has a disabled Anki boundary affordance and can build a typed lookup-to-Anki payload from the selected result and current book/chapter context.
  - Popup clears on page/chapter changes, TOC jumps, shelf return, close, and Escape.
- Dictionary backend:
  - `dict_status` returns structured dictionary status: ready, no dictionaries, engine unavailable, or error.
  - `dict_lookup` command exists.
  - `dictionary_list` returns imported dictionaries from the manifest.
  - On startup, dictionary state reads enabled term dictionaries from the manifest.
  - Dictionary enabled/order changes are persisted and rebuild dictionary runtime state.
  - Enabled manifest entries load term, frequency, and pitch roles based on imported counts.
  - Dictionary manifest lives at app data `dictionaries/manifest.json`.
  - Valid imported hoshidicts term directories contain `.hoshidicts_1`, `index.json`, `hash.table`, and `blobs.bin`.
  - `build.rs` attempts to compile/link `third_party/hoshidicts` and the current C API bridge when CMake/C++ tools exist.
  - `HSW_HOSHIDICTS_DIR` can override the default local hoshidicts path.
  - Bookshelf has a minimal `Import Dictionary` entry for Yomitan `.zip` files.
  - Bookshelf has a minimal dictionary management panel for listing imported dictionaries, refreshing status, enabling/disabling dictionaries, and changing lookup order.
  - Dictionary import uses zip content hash as stable `dict_id` and records successful imports in the manifest.
  - `DictResult` includes rules, source dictionary, frequency entries, and pitch entries.
  - Local VS Build Tools, MSVC, Windows SDK, VS-bundled CMake, and VS-bundled Ninja can drive the hoshidicts CMake configure path from a VS developer shell.
  - VS developer-shell linked `cargo check` passes with hoshidicts linked.
  - Linked backend validation imported a real JMdict English Yomitan zip, wrote the dictionary manifest, loaded the runtime backend, and returned real results for `lookup("学校")`.
  - Direct Tauri file-dialog import was verified with `jitendex-yomitan.zip`; the reader popup rendered real Jitendex results for text selected from a real `かがみの孤城` EPUB.
  - Dictionary importer exceptions from the C bridge are surfaced through the Rust command path instead of collapsing to only `Dictionary import failed.`
  - `MK3Fix0213.zip` imports on Windows through a compatibility retry path that skips legacy-encoded media entries, preserves the original manifest title, and loads real lookup results.
  - Lookup responses map compatibility-import internal ASCII titles back to manifest titles for result, glossary, frequency, and pitch source labels.

## Not Implemented Or Not Verified

- No durable database; app-owned library metadata is still JSON.
- No real Anki integration; only the frontend payload boundary exists.
- No sync implementation.
- No settings or appearance panel.
- No verified app-owned cover thumbnail cache.
- No verified release packaging flow.

## Known Issues

- Legacy path-only bookshelf records may fail if the original EPUB is moved, renamed, or deleted.
- On shells without CMake/C++ build tools in `PATH`, the hoshidicts backend and importer remain unavailable.
- On this machine, linked hoshidicts checks require a VS developer shell or equivalent `PATH` containing CMake and MSVC tools.
- Without imported dictionaries in the app data manifest, `dict_status` reports `noDictionaries`.
- Compatibility dictionary imports that hit Windows code-page failures skip media entries, so affected dictionaries such as `MK3Fix0213.zip` currently import with `mediaCount=0`.
- Reader layout correctness for arbitrary EPUBs is not fully verified.
- Rust-side character counts and frontend DOM-based progress need further cross-validation.
- Cover/image rendering depends on temporary extraction path mapping and asset URL rewriting.
- Running the frontend outside Tauri only provides partial behavior because native EPUB commands require Tauri.

## Risk Areas

- Reader pagination and restore:
  - DOM measurement.
  - CSS columns.
  - `scrollTop` page movement.
  - Final-page tail alignment.
- Image load and reflow:
  - Covers.
  - SVG image replacement.
  - Gaiji/block image classification.
  - Late image loads changing page measurements.
- EPUB CSS sanitization:
  - Publisher CSS may contain layout-breaking rules not yet covered by tests.
  - Non-UTF-8 CSS handling is limited.
  - Inline style cleanup and Rust-side CSS file sanitization are separate paths.
- Asset and path handling:
  - EPUB assets depend on temporary extraction directories.
  - New app-owned books depend on copied EPUBs and manifest JSON.
  - Legacy bookshelf records still depend on original EPUB paths.
- Future dictionary integration:
  - Real lookup depends on hoshidicts build/link success and imported dictionary data.
  - Real lookup validation is tracked in `docs/REAL_LOOKUP_VALIDATION_PLAN.md`.

## Validation Commands

- Documentation-only changes: `git diff --check`
- Frontend/type changes: `npm run check`
- Frontend production build: `npm run build`
- Reader visual regression probe: `npm run check:reader-visual`
- Rust command/backend changes: `cd src-tauri; cargo check`
- Rust tests: `cd src-tauri; cargo test --lib`
- Tauri runtime check: `cmd /c npx.cmd tauri dev`

## Related Docs

- `docs/TODO.md`
- `docs/LOOKUP_ROADMAP.md`
- `docs/REAL_LOOKUP_VALIDATION_PLAN.md`
- `docs/READER_ENTRY_CHARACTERIZATION.md`
- `docs/reader-layout-baseline.md`
