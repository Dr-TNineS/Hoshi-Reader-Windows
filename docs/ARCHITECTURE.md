# HSW Current Architecture

Last updated: 2026-06-29

This document records current architecture facts for Hoshi Reader Windows. It
is not a future plan, task log, or completion ledger. Current implementation
status, known issues, and not-verified items live in `docs/PROJECT_STATUS.md`.
Future refactor direction lives in `docs/ARCHITECTURE_REFACTORING.md`.

## App Shape

- HSW is a Windows desktop app built with Svelte 5, TypeScript, Vite, Tauri 2,
  and Rust.
- `src/App.svelte` owns the top-level bookshelf/reader flow. Feature-specific
  state should live in the matching feature boundary or existing controller
  rather than accumulating as cross-component booleans in `App.svelte`.
- Bookshelf panels cover Library, Dictionary Search, Dictionaries, Anki,
  Appearance, Advanced, and Shortcuts. `BookshelfView.activePanel` is the panel
  source of truth.
- Bits UI is used for selected headless primitives such as tabs, switches,
  selects, dropdown menus, toggle groups, dialogs, and tooltips. Existing
  keyboard, focus, portal, and dismissal behavior should be preserved when
  extending those controls.

## Storage And Data

- App-owned data lives under Tauri app data. The UI should not depend directly
  on raw local paths, temporary extraction paths, or assumed directory layout.
- EPUB imports are copied to `library/books/<book_id>/book.epub`; the library
  manifest records app-owned book metadata. `book_id` is based on EPUB content
  hash.
- Reading state, recent books, progress, and session restore live in
  `reading/state.json`. Browser `localStorage` remains a non-Tauri fallback and
  one-time legacy migration source.
- Imported dictionaries are app-owned under `dictionaries/`; the dictionary
  manifest records role entries for Term, Frequency, and Pitch. One imported
  dictionary may appear in multiple roles while sharing import data.
- Anki settings live in app data `anki/settings.json`. AnkiConnect endpoints are
  restricted to localhost/127.0.0.1 HTTP.
- Sasayaki data is per book under `library/books/<bookId>/Sasayaki`. Copied
  audio remains app-owned; linked external audio is authorized narrowly and is
  never deleted by bookshelf Forget.

## Frontend And Command Boundary

- User-visible behavior should cross layers through explicit frontend state,
  typed Tauri command payloads, shared TypeScript/Rust model shapes, and
  actionable error states.
- New Tauri commands should have narrow responsibilities, validated parameters,
  and UI-safe errors. Do not expose unfiltered local paths, Rust debug text, or
  native exceptions directly to visible UI.
- File import, copying, deletion, manifest writes, path containment, and native
  resource access belong behind Rust command/storage boundaries rather than
  Svelte component side effects.

## Reader

- Reader rendering is Svelte-owned DOM with Japanese vertical paginated layout
  using CSS columns, measured through reader viewport/container dimensions and
  `scrollTop`.
- Spine/chapter structure remains the internal load/navigation unit, while the
  visible chrome presents whole-book character progress and percentage.
- Reader layout, chapter navigation, TOC, selection, lookup popup, Sasayaki cue
  presentation, and reading progress each need an explicit state owner. Avoid
  coupling them through accidental DOM side effects.
- Pagination, DOM measurement, image load/reflow, SVG/gaiji/block images,
  chapter boundaries, final-page alignment, keyboard navigation, focus restore,
  and narrow-window behavior are high-risk reader areas.

## Dictionary And Lookup

- Dictionary import, manifest roles, enabled/order state, native runtime,
  lookup results, popup rendering, dictionary media, and dictionary styles form
  one chain. Changing one link requires checking adjacent data shapes.
- hoshidicts is built from `third_party/hoshidicts` through the Rust bridge when
  the Windows C++ toolchain is available. Treat `third_party/hoshidicts` as
  third-party input unless a task explicitly covers bridge or upstream sync.
- Lookup popup states must remain distinct: loading, no dictionary, engine
  unavailable, empty, error, and ready.
- Selection capture, lookup invocation, result rendering, nested glossary
  lookup, media/style loading, audio actions, and Anki payload construction are
  separate boundaries even when rendered in the same popup.

## Anki, Audio, And Settings

- Anki configuration, note payload rendering, field templates, dictionary media
  export, word audio, Sasayaki audio, duplicate handling, and post-add sync are
  independent boundaries.
- Lookup popup add-note actions are available only when endpoint, deck, note
  type, field configuration, and backend readiness are complete.
- Media and audio failures must preserve the documented semantics: ordinary
  missing optional media/audio may return warnings and continue, while unsafe
  paths, unsupported types, oversized responses, tampered sidecars, and unsafe
  endpoints block the operation.
- Settings should expose user-needed behavior only. Defaults, damaged/legacy
  fallback, persistence location, immediate effect, and startup restore behavior
  must be understood before changing a setting.
