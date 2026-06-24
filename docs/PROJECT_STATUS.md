# Hoshi Reader Windows Project Status

Last updated: 2026-06-24

This file records current implementation facts for `hoshi-reader-windows`. It is not an agent rule file, product roadmap, or substitute for checking the current code.

Facts that cannot be confirmed from current code should be marked `unknown` or `not verified`.

## Current Scope

- Main project: `hoshi-reader-windows`.
- Platform target: Windows desktop through Tauri.
- Stack: Tauri 2, Svelte 5, TypeScript, Vite, Rust.
- Primary path: bookshelf -> import EPUB -> open reader -> select text -> lookup.
- Imported EPUB files are copied into the app-owned library under Tauri app data.
- EPUB import supports selecting one or more files and returns to the bookshelf after import; users open imported books from the bookshelf row.
- Reading progress and session state are persisted in Tauri app data under `reading/state.json`.
- Browser `localStorage` remains a non-Tauri fallback and one-time legacy migration source.
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
  - EPUB import copies the detected cover image to `library/books/<book_id>/cover.<ext>` when available and records `coverPath`.
  - EPUB import uses a staging directory and verifies the copied EPUB before writing the manifest.
  - Re-importing identical EPUB content reuses the same app-owned record when the library file still exists.
  - New records open by `book_id` rather than original source path.
  - Opening an app-owned record with a missing `book.epub` returns a scoped re-import error for that book.
  - Bookshelf records can be forgotten through an in-app confirmation; app-owned records also remove the imported EPUB copy and manifest entry without touching the original source EPUB, while legacy records remove only the bookshelf state.
- Bookshelf:
  - `BookshelfView.activePanel` is the single source of truth for Library, Dictionaries, Anki, Appearance, Advanced, and Shortcuts panel selection; App no longer mirrors panel visibility booleans.
  - Recent books render as a cover grid with EPUB cover, progress bar, percent, and title when cover data is available.
  - EPUB import entry.
  - Minimal Appearance panel with HSA-aligned Light and Dark reader themes using a single-select Bits UI ToggleGroup with roving keyboard focus.
  - Advanced panel with a default-on option to reopen the last reading session at startup.
  - Bits UI provides the first headless UI primitives for the Advanced switch and dictionary Tabs, enabled switches, and delete confirmation dialog; shared CSS variables define non-invasive control tokens without changing Reader layout styles.
  - Appearance and Advanced settings state is coordinated by a Svelte 5 runes controller in `src/lib/state/settings.svelte.ts`; persistence remains delegated to the existing appearance and Advanced storage modules.
  - Dictionaries settings persist HSA core options in the same settings controller: scan non-Japanese text, max results, scan length, low-RAM dictionary import, collapse mode, expand-first dictionary, collapsed dictionaries, compact glossaries, expression tags, harmonic frequency, deduplicate pitch accents, and compact pitch accents.
  - The Advanced startup preference is stored locally in browser `localStorage`.
  - Read-only Shortcuts panel listing the currently implemented Reader keyboard and mouse shortcuts by feature group.
  - Resume from saved progress.
  - Tauri startup attempts to restore the last reader session when the Advanced startup option is enabled; disabling it leaves startup on the bookshelf without clearing the saved session.
  - Importing an EPUB without opening it does not replace the saved reader session used by Advanced startup restore.
  - Tauri reading state stores recent books, progress, and session in `reading/state.json`.
  - Existing `localStorage` recent books/session are merged into reading state once on startup.
  - Legacy path-only records remain compatible when the original file still exists.
- Reader:
  - Japanese vertical paginated reading layout.
  - CSS column-based pagination using `.rv.clientHeight`, `.rct.scrollHeight`, and `scrollTop`.
  - Previous/next page and chapter navigation.
  - Keyboard arrow navigation and Ctrl/Meta chapter navigation.
  - Escape clears an active selection first, then closes the TOC, then returns to shelf.
  - Nonmodal TOC drawer keeps reader controls available, restores trigger focus on close/jump, and supports internal chapter-link navigation.
  - EPUB asset URL rewriting.
  - Basic image load/reflow handling, SVG cover replacement, gaiji image handling, and block image handling.
  - Reader progress based on visible text position.
  - Reader chrome aligns with HSA by showing whole-book character progress and percentage instead of exposing spine chapter counts or per-spine page counts; spine remains the internal load/navigation unit while TOC remains a directory view.
  - Reader character counting uses the HSA matchable-codepoint rule for frontend DOM progress and Rust EPUB book metadata.
- Reader visual probe fixture and `npm run check:reader-visual` cover baseline pagination geometry, final-page alignment, block image rendering, HSA-aligned progress counting at chapter boundaries, Shift-hover and left-click lookup selection, per-frame latest-coordinate coalescing, DOM character-position dedupe, sub-8px adjacent-character lookup, pending-frame cancellation, pending/matched highlight timing, plain mouse drag selection not opening lookup, narrow-window overflow, Ctrl chapter navigation, and page-boundary chapter navigation.
- Reader TOC probe fixture and `npm run check:reader-toc` cover trigger semantics, initial/restored focus, nonmodal interaction, Escape priority, chapter jumps, and narrow-window bounds.
- Reader selection and popup:
  - Captures selected reader text with rect and chapter index.
  - Supports Shift hover lookup trigger.
  - Supports holding Shift while moving the pointer to continuously rescan/select new text. Pointer movement is coalesced to the latest coordinate once per animation frame and deduped by DOM text node plus character offset; there is no fixed pixel threshold or debounce delay.
  - Supports left-click lookup selection in reader text and popup glossary text; plain mouse drag selection does not open the lookup popup.
  - Lookup-triggered highlights use HSA-style CSS Highlight gray highlighting instead of the native blue browser selection; they remain hidden while lookup is pending and reveal only the first result's `matched` Unicode character range. Light mode uses `rgba(160,160,160,0.32)` and dark mode uses `rgba(255,255,255,0.32)`; user-driven text selection remains separate.
  - Popup prefers left/right side placement beside the selected text, with top/bottom fallback.
  - Popup outer sizing is user-configurable from Appearance: width `100...700` (default `320`), height `100...800` (default `250`), and content scale `0.8...1.5` (default `1.0`). Oversized settings shrink only for the current reader viewport and do not overwrite persisted values.
  - Popup content uses the Windows Japanese sans-serif stack (`Yu Gothic UI`, `Meiryo`, `Segoe UI`) with upstream-aligned expression, reading, glossary, metadata, and pitch size tiers. Content scale affects result typography, spacing, tags, actions, and media limits without changing the outer frame or desktop popup header.
  - Debug lookup timing records cover frontend request/first-frame/style/media stages and Rust lock/native lookup stages; the current local before/after baseline is recorded in `docs/LOOKUP_PERFORMANCE_BASELINE.md`.
  - Lookup uses a 32-entry in-memory LRU that also deduplicates concurrent identical requests; dictionary mutations clear lookup and style caches.
  - Lookup passes configured max results and scan length to Rust lookup; changing either setting clears cached lookup results and reloads active popups.
  - Reader and popup glossary selection honor configured scan length and can skip non-Japanese scan starts when `scanNonJapaneseText` is disabled.
  - Enabled term-dictionary styles are prewarmed after dictionary state becomes ready, popup style loads run in parallel, and popup results use one-pass view models for match/rules/frequency/pitch/glossary rendering.
  - Popup distinguishes loading, no dictionary, engine unavailable, empty, error, and ready states.
  - Popup renders the full backend lookup result set, up to the configured backend max results, with expression, reading, source dictionary, matched/deinflected text, rules, HSA-style frequency/pitch metadata groups, grouped glossary content, dictionary media, and scoped dictionary `styles.css`.
  - Popup consumes supported HSA dictionary rendering settings: collapse all/expand all/custom dictionary groups, expand first dictionary, compact glossary layout, expression tags, harmonic frequency, deduplicated pitch positions, and compact pitch layout.
  - Dictionary media loads lazily inside popup glossary content; loaded, unavailable, non-Tauri fallback, and Yomitan `type: "image"` gaiji SVG states are covered by the lookup popup probe.
  - Popup glossary text supports frame-coalesced Shift hover nested lookup as a popup stack: root lookup stays open, child popups anchor to glossary text, the parent owns the pending selection range, the child result narrows it to the first `matched` range, closing a child preserves the parent, and parent scroll closes children.
  - Popup has a disabled Anki boundary affordance and can build a typed lookup-to-Anki payload from the selected result and current book/chapter context.
  - Lookup popup probe and `npm run check:lookup-popup` cover popup states, frame-coalesced glossary Shift hover, pending/matched parent highlighting, stale child-result rejection, child close parent preservation, parent-scroll child dismissal, redirect history, scoped dictionary CSS behavior, fixed/default/maximum/narrow sizing, upstream typography tiers, scale `1.0`/`1.5`, long-result internal scrolling, HSA-style header action/frequency/pitch layout, dictionary media including `tag: "img"` and `type: "image"` records, disabled Anki/audio boundaries, import/close actions, and narrow-window overflow.
  - Popup clears on page/chapter changes, TOC jumps, shelf return, close, and Escape.
- Dictionary backend:
  - `dict_status` returns structured dictionary status: ready, no dictionaries, engine unavailable, or error.
  - `dict_lookup` command exists.
  - `dictionary_list` returns imported dictionaries from the manifest.
  - `dictionary_media` and `dictionary_styles` expose imported dictionary media and `styles.css` to the popup through read-only commands. `dictionary_media` reads hoshidicts packed `media.idx`/`media.bin` first, falls back to legacy extracted files, and validates paths before either lookup.
  - On startup, dictionary state reads enabled term, frequency, and pitch role entries from the manifest.
  - Dictionary enabled/order/delete changes are persisted and rebuild dictionary runtime state.
  - Imported dictionary manifest entries are role-based: a single imported dictionary can appear as separate Term, Frequency, and Pitch entries that share one import id and app-owned directory.
  - Dictionary manifest lives at app data `dictionaries/manifest.json`.
  - Valid imported hoshidicts term directories contain `.hoshidicts_1`, `index.json`, `hash.table`, and `blobs.bin`.
  - `build.rs` attempts to compile/link `third_party/hoshidicts` and the current C API bridge when CMake/C++ tools exist.
  - `HSW_HOSHIDICTS_DIR` can override the default local hoshidicts path.
  - Bookshelf has a minimal `Import Dictionary` entry for Yomitan `.zip` files.
  - Bookshelf has a minimal dictionary management panel for Term/Frequency/Pitch categories, refreshing status, enabling/disabling role entries, changing per-category order, deleting an imported dictionary from all categories, and editing HSA-style Lookup, Import, Collapse Dictionaries, and Behaviour settings.
  - Dictionary management uses one in-app delete confirmation that describes app-owned cleanup without touching the original zip; ordering buttons expose themed hover/focus tooltips. The probe and `npm run check:dictionary-management` cover empty/loading/error/ready states, category tab click/keyboard navigation, visible counts, enable switches, order controls and tooltip boundaries, delete confirmation/cancel/focus restoration, import/refresh actions, Escape dismissal, and narrow-window overflow.
  - Dictionary import uses zip content hash as stable `dict_id` and records successful imports in the manifest.
  - Dictionary import creates Term/Frequency/Pitch manifest role entries only when the native import reports positive `termCount`, `freqCount`, or `pitchCount`; imports with no detected roles fail with a clear dictionary-type detection error.
  - Legacy manifest entries with explicit roles remain compatible, while legacy entries with no role and zero counts no longer invent a synthetic Term role.
  - Low-RAM dictionary import is wired from the Dictionaries settings panel to the hoshidicts import API when the linked backend is available.
  - Dictionary import uses staging directories and preserves an existing dictionary dir if replacement fails.
  - `DictResult` includes rules, source dictionary, frequency entries, and pitch entries.
  - Local VS Build Tools, MSVC, Windows SDK, VS-bundled CMake, and VS-bundled Ninja can drive the hoshidicts CMake configure path from a VS developer shell.
  - VS developer-shell linked `cargo check` passes with hoshidicts linked.
  - Linked backend validation imported a real JMdict English Yomitan zip, wrote the dictionary manifest, loaded the runtime backend, and returned real results for `lookup("学校")`.
  - Direct Tauri file-dialog import was verified with `jitendex-yomitan.zip`; the reader popup rendered real Jitendex results for text selected from a real `かがみの孤城` EPUB.
  - Dictionary importer exceptions from the C bridge are surfaced through the Rust command path instead of collapsing to only `Dictionary import failed.`
  - `MK3Fix0213.zip` imports on Windows through a compatibility retry path that skips legacy-encoded media entries, preserves the original manifest title, and loads real lookup results.
  - Windows compatibility imports preflight zips with non-ASCII non-core media paths and go directly to lookup-safe import when needed; lookup-safe temporary zips are stored without compression to avoid long CPU-bound recompression stalls.
  - Final linked validation on 2026-06-12 ran `imports_real_yomitan_zip_and_loads_runtime` against local `MK3Fix0213.zip`: `dict_id=93e8e532b599ba4a`, `term=140821`, `media=0`, and `lookup_results=2`.
  - MK3 compatibility import performance validation on 2026-06-18 with local `MK3Fix0213.zip` completed in about 24 seconds in the linked ignored Rust test; before switching the lookup-safe temp zip to stored entries, the safe-zip creation step alone took about 187 seconds.
  - Lookup responses map compatibility-import internal ASCII titles back to manifest titles for result, glossary, frequency, and pitch source labels.
- Anki:
  - Deck and note-type controls use the shared Bits UI Select primitive; field-template token pickers use the shared Bits UI DropdownMenu primitive with themed portal content kept inside the application overlay root; Word Audio enablement uses the shared Bits UI Switch.
  - Lookup popup keeps the Anki affordance disabled until endpoint, deck, note type, and fields are configured.
  - Bookshelf now has a minimal AnkiConnect readiness/configuration panel for endpoint editing, connection testing, deck/note-type fetch, deck selection, note-type selection, field template editing, and note field preview.
  - Anki field templates include HSA-aligned exact-name defaults for Lapis, Kiku, and Senren; unmapped known-model fields keep HSA's blank behavior, and custom model names do not inherit these presets.
  - Field template rows include a HSA-style `{}` picker for supported template tokens, including `{furigana-plain}` and imported dictionary-specific `{single-glossary-...}` options; choosing `-` clears the field.
  - Anki glossary field rendering normalizes Yomitan structured-content JSON through the same safe HTML renderer used by the popup, so note fields do not expose raw structured JSON.
  - Reader-origin Anki payloads keep lookup text and sentence context separate: lookup still uses the hovered token, while `{sentence}` receives the source paragraph text with the matched term bolded; `{furigana-plain}` and `{pitch-accent-positions}` render in HSA-compatible field shapes.
  - Configured lookup popup results expose a HSA-style compact Anki add button; note creation still renders fields from the current `LookupAnkiPayload`.
  - Configured lookup popup results can call Rust `anki_add_note`; Rust performs `canAddNotesWithErrorDetail` before `addNote` and returns added/duplicate/error states.
  - Real desktop Anki runtime validation passed on 2026-06-18 with AnkiConnect v6 on `127.0.0.1:8765`: the ignored Rust validation test created a throwaway deck/model, added one note through HSW `anki_add_note`, verified duplicate handling on the second add, and attempted cleanup.
  - Rust/Tauri stores Anki settings in app data `anki/settings.json` and restricts AnkiConnect endpoints to localhost/127.0.0.1 HTTP.
  - `npm run check:anki-connect` covers Anki panel empty/error/connected/ready states, action wiring, pointer/keyboard selections, field template edits, HSA-aligned Lapis defaults, exact-name preset matching, token menu choices including `{furigana-plain}`, and Select/Menu viewport boundaries without narrow-window overflow.
  - `npm run check:lookup-popup` covers configured compact Anki add action, bolded sentence-context rendering, dictionary-specific glossary handlebars, unknown handlebars rendering empty, added/duplicate/error UI states, rendered note shape including furigana and pitch-position fields, and the unconfigured disabled Anki boundary.
  - First Anki media-export scope is tracked in `docs/ANKI_MEDIA_EXPORT_PLAN.md`; dictionary image media references are extracted from lookup glossary content, `{dictionary-media}` previews render deterministic HTML, and add-note flow stores dictionary media before note creation.
  - Rust `anki_store_dictionary_media` stores imported dictionary image media through AnkiConnect `storeMediaFile`; missing media returns warnings, while unsafe paths and unsupported types are blocked.
  - `npm run check:lookup-popup` covers Anki media store success, missing-media warnings with text-card creation, and hard media-store failure without note creation.
  - Real AnkiConnect store-media runtime validation passed on 2026-06-18 with a throwaway SVG media file.
  - Anki word-audio settings store an enable flag, ordered remote sources, timeout, autoplay, and the future Interrupt/Duck/Mix coordination mode.
  - Remote word audio resolves `{term}` and `{reading}` against enabled public HTTP/HTTPS sources in saved order, enforces redirect/address/timeout/format/size boundaries, stores successful audio through AnkiConnect, and renders `[sound:filename]` through `{audio}`.
  - Ordinary remote-audio failures show warnings and preserve text-note creation; unsafe targets and oversized responses block the current add operation.
  - `npm run check:lookup-popup` covers remote-audio success, missing/unsupported warnings, security failure, no-audio-field and missing-expression behavior.
  - Sasayaki audio and sync remain planned in `docs/ANKI_AUDIO_SYNC_PLAN.md`.
  - HSA-compatible local audio database import is implemented under app data `audio/android.db`, with staged replacement, SQLite/schema validation, app-owned storage, source ordering, reading-first matching, and blob-only MP3/Opus/OGG loading.
  - Local audio is attempted before remote audio for Anki fields; local misses and ordinary read warnings fall back to the configured remote source without blocking text-note creation.
  - Local audio import/removal, enable state, source ordering, matching, fallback, and narrow-window UI are covered by Rust and frontend probes.
  - Anki settings include a default-off post-add sync option. A successful note remains `added` when AnkiConnect sync fails, with the failure returned and displayed as a secondary warning; duplicate and failed note creation do not sync.
  - Anki settings v2 includes editable whitespace-separated tags, allow-duplicates, Collection/Deck/Deck Root duplicate scope, and all-note-type checking. Rust maps these to AnkiConnect note options and skips the blocking preflight when duplicates are allowed.
  - Anki settings include default-off compact glossary card CSS. `{book-cover}` resolves only an app-owned `bookId` through the Rust library manifest, validates containment/signature/size, stores deterministic cover media, and renders the stored image filename.
  - The media pipeline stores dictionary images, then book cover, then word audio before rendering and addNote. Duplicate notes may leave shared content-hash media; HSW does not automatically delete it.
  - Remote word-audio sources have stable ids and support add/remove/edit/enable/reorder. Export tries local audio first, then every enabled remote source in saved order; ordinary warnings fall through and security errors stop immediately.
  - Anki export and popup playback now share the Rust local-first/ordered-remote word-audio resolver. Popup audio supports play, stop, logical request cancellation, lookup cleanup, and optional autoplay through a content-hash cache bounded to 20 files and 50 MiB.
  - A pure-Rust audio clipping capability decodes MP3 and WAV and emits deterministic 16-bit PCM cue WAV bytes. It enforces a 60-second clip limit, a 64 MiB output limit, bounded channel/sample-rate shapes, and clear corrupt/out-of-range errors; development/release tests cover exact timing, long sources, and Unicode paths.
  - Per-book Sasayaki data lives under `library/books/<bookId>/Sasayaki`. The versioned sidecar initializes cue/match/playback state, SRT is normalized and copied as UTF-8, and verified MP3/WAV audio is either linked externally or copied into app storage.
  - Sasayaki import validates the manifest-owned book directory, audio codec, SRT extension/UTF-8/timing marker/size, stages the complete replacement, and restores old data if installation fails. Removal and bookshelf Forget delete only app-owned Sasayaki data; linked external audio is never deleted.
  - Sasayaki SRT import now strictly validates positive increasing cue numbers, timing ranges/order, and non-empty text. Matching uses the reader-visible HSA-compatible character filter, skips navigation/non-linear/guide-TOC spine items, searches cues forward within a bounded persisted window, rejects chapter-crossing matches, and stores stable `chapterIndex + start + length` results.
  - Manual cue corrections are book-owned sidecar records, validated against matchable chapter bounds, reapplied during rematch, and removable without discarding automatic results. Sidecar rewrites stage and roll back the previous JSON on installation failure.
  - The bookshelf Sasayaki panel shows match coverage, unmatched/matched/corrected cues, the first 100 cue records, bounded rematch controls, and manual correction coordinates. Playback and reader highlighting remain deferred. The bookshelf probe covers action wiring, correction coordinates, and external-file protection; wide and 520px checks passed without horizontal overflow.

## Not Implemented Or Not Verified

- No durable database; app-owned library metadata and reading state are still JSON.
- Anki combined add-note-plus-media runtime validation with a real media-bearing dictionary is not verified; real remote-audio-plus-AnkiConnect, real HSA local-audio database, real popup word-audio playback, real clipped-audio Anki playback, real Sasayaki audiobook/SRT import, and real post-add sync runtime validation are also not verified. AAC/M4A and OGG/Opus clipping are not verified.
- No full settings surface; Appearance, Advanced startup behavior, dictionary popup sizing/scale, and core HSA dictionary settings are implemented. HSA profile-scoped settings, recommended dictionary downloads, automatic updates, dictionary default tab, and custom CSS are not implemented.
- No verified app-owned cover thumbnail cache.
- Runtime validation with a normal media-bearing Yomitan dictionary is not verified; on 2026-06-16, `HSW_MEDIA_YOMITAN_ZIP` was unset, `OALDPE10.zip` had `mediaCount=0`, and `MK3Fix0213.zip` remained unsuitable because compatibility import intentionally skipped media. Packed-media command tests now cover `media.idx`/`media.bin` reads, but full popup runtime validation with a media-preserving import is still not verified.
- Portable package build and five-second executable launch smoke validation passed on 2026-06-24; installer and broader release validation are not verified.

## Known Issues

- Legacy path-only bookshelf records may fail if the original EPUB is moved, renamed, or deleted.
- Legacy `localStorage` reading state is imported once and left in place; it is not deleted after migration.
- On shells without CMake/C++ build tools in `PATH`, the hoshidicts backend and importer remain unavailable.
- On this machine, linked hoshidicts checks require a VS developer shell or equivalent `PATH` containing CMake and MSVC tools.
- Without imported dictionaries in the app data manifest, `dict_status` reports `noDictionaries`.
- Compatibility dictionary imports that hit Windows code-page failures may still lack packed media files, so affected dictionaries such as the current app-data `MK3Fix0213.zip` import can remain media-unavailable until reimported with `media.idx`/`media.bin`.
- Reader layout correctness for arbitrary EPUBs is not fully verified.
- Real multi-book runtime validation of HSA-aligned reader character progress remains not verified.
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
  - Reading progress/session depend on reading state JSON.
  - Legacy bookshelf records still depend on original EPUB paths.
- Future dictionary integration:
  - Real lookup depends on hoshidicts build/link success and imported dictionary data.
  - Real lookup validation is tracked in `docs/REAL_LOOKUP_VALIDATION_PLAN.md`.

## Validation Commands

- Documentation-only changes: `git diff --check`
- Frontend/type changes: `npm run check`
- Frontend production build: `npm run build`
- AnkiConnect panel regression probe: `npm run check:anki-connect`
- Bookshelf shell and confirmation regression probe: `npm run check:bookshelf`
- Dictionary management regression probe: `npm run check:dictionary-management`
- Appearance ToggleGroup and Advanced settings controller probe: `npm run check:settings-state`
- Lookup popup regression probe: `npm run check:lookup-popup`
- Reader TOC regression probe: `npm run check:reader-toc`
- Lookup cache regression probe: `npm run check:lookup-performance`
- Reader visual regression probe: `npm run check:reader-visual`
- Rust command/backend changes: `cd src-tauri; cargo check`
- Rust tests: `cd src-tauri; cargo test --lib`
- Real desktop Anki add-note validation: from `src-tauri`, set `HSW_ANKI_RUNTIME_VALIDATE=1`, then run `cargo test --lib validates_real_ankiconnect_add_note_and_duplicate_check -- --ignored --nocapture`
- Real desktop Anki store-media validation: from `src-tauri`, set `HSW_ANKI_RUNTIME_VALIDATE=1`, then run `cargo test --lib validates_real_ankiconnect_store_dictionary_media -- --ignored --nocapture`
- Linked real dictionary validation: run from a VS developer shell with `RUSTFLAGS=--cfg hoshi_dicts_linked`, `CARGO_TARGET_DIR=target-linked-check`, `HSW_REAL_YOMITAN_ZIP=<local dictionary zip>`, then `cargo test --lib imports_real_yomitan_zip_and_loads_runtime -- --ignored --nocapture`
- Tauri runtime check: `cmd /c npx.cmd tauri dev`

## Related Docs

- `docs/TODO.md`
- `docs/LOOKUP_ROADMAP.md`
- `docs/REAL_LOOKUP_VALIDATION_PLAN.md`
- `docs/ANKI_HSA_WINDOWS_ALIGNMENT.md`
- `docs/ANKI_MEDIA_EXPORT_PLAN.md`
- `docs/ANKI_AUDIO_SYNC_PLAN.md`
- `docs/READER_ENTRY_CHARACTERIZATION.md`
- `docs/reader-layout-baseline.md`
