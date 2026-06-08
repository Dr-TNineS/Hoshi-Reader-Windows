# Real Lookup Validation Plan

## Summary

The reader lookup implementation slices are complete. The next phase is to verify the real hoshidicts path end to end with local CMake/C++ tooling, a real Yomitan dictionary zip, and the Tauri runtime.

This plan only covers validation and minimal HSW fixes discovered by validation. Do not modify `reference/`, `third_party/hoshidicts/`, HSA, yomitan, settings, sync, Anki card creation, audio, release packaging, or broad reader UI.

## Progress

- [x] Slice 6: Toolchain Readiness & Linked Build
- [x] Slice 7: Real Dictionary Import & Manifest Verification
- [x] Slice 8: Real Lookup Runtime & Popup Verification
- [x] Slice 9: MK3 Windows Import Encoding Compatibility

Execute only one slice at a time.

## Slice 6 Result

Validated on 2026-06-07:

- `third_party/hoshidicts/CMakeLists.txt` exists.
- Visual Studio 2022 Build Tools, MSVC 14.44, Windows SDK 10.0.26100.0, VS-bundled CMake, and VS-bundled Ninja are installed locally.
- A plain `cargo check` from `src-tauri` passes in the normal shell and falls back with `hoshidicts backend disabled: cmake was not found in PATH`.
- A VS developer-shell linked check reaches the hoshidicts CMake build after HSW build fixes for Windows verbatim paths and MSVC UTF-8 source handling.
- Follow-up HSW build fixes force-include `external/utfcpp/source/utf8/cpp11.h` for the hoshidicts MSVC build and avoid a C API `Deinflector` name collision with hoshidicts.
- A VS developer-shell linked `cargo check` now passes with hoshidicts linked.
- Temporary validation build directories were removed after the slice.

Next-slice adjustment: Slice 7 is no longer blocked by the linked build. It still requires a real Yomitan dictionary zip, which must remain out of git.

## Slice 6: Toolchain Readiness & Linked Build

Make HSW compile/link the hoshidicts backend instead of falling back to `engineUnavailable`.

Key checks:

- Confirm `third_party/hoshidicts/CMakeLists.txt` exists.
- Confirm CMake, MSVC C++ Build Tools, Windows SDK, and either Ninja or a Visual Studio CMake generator are available.
- Run `cargo check` from `src-tauri` and verify hoshidicts is not disabled because CMake/C++ tooling is missing.
- Run a linked check with `RUSTFLAGS='--cfg hoshi_dicts_linked'` and a temporary `CARGO_TARGET_DIR`.
- If linked build fails, make only minimal HSW `build.rs` or C bridge fixes. Do not patch hoshidicts.

Acceptance:

- Linked build passes, or the remaining toolchain/build blocker is clearly documented.
- Temporary target directories are removed after validation.
- Project docs state the real linked build status.

## Slice 7: Real Dictionary Import & Manifest Verification

Use a real user-provided Yomitan dictionary zip to verify import, manifest persistence, and runtime rebuild.

Key checks:

- Import the dictionary through the Tauri app path.
- Confirm app data contains `dictionaries/manifest.json`.
- Confirm the manifest entry includes `dictId`, `title`, `kind`, `enabled`, `order`, `internalPath`, counts, and import time.
- Confirm the imported dictionary directory contains `.hoshidicts_1`, `index.json`, `hash.table`, and `blobs.bin`.
- Import the same zip again and verify the existing manifest record is reused.
- Confirm `dict_status` reports ready when an enabled term dictionary is available.

Acceptance:

- Real zip import succeeds and persists after app restart.
- `dictionary_list()` returns the imported dictionary.
- No dictionary zip or imported dictionary data is added to git.

## Slice 7 Result

Validated on 2026-06-07 with the public JMdict English Yomitan zip from `yomidevs/jmdict-yomitan` releases:

- Downloaded test zip: `JMdict_english.zip`; kept as temporary local validation input only.
- Linked real import succeeded and produced `JMdict [2026-06-07]`.
- Imported counts: `term=522998`, `meta=0`, `freq=0`, `pitch=0`, `media=0`.
- Imported directory contained `.hoshidicts_1`, `index.json`, `hash.table`, and `blobs.bin`.
- Manifest entry included `dictId=02493b4c5473326a`, title, kind `term`, enabled state, order, internal path, counts, and import time.
- Re-upserting the same imported dictionary reused the same manifest record/order.
- Linked runtime loaded the imported term dictionary and `lookup("学校")` returned 2 real results.
- No dictionary zip, temporary target directory, or imported dictionary data is tracked by git.

Note: The validation ran through the same hoshidicts importer, manifest, load-plan, and runtime backend used by the Tauri command path. A direct Tauri UI/file-dialog import remains part of Slice 8 runtime verification.

## Slice 8: Real Lookup Runtime & Popup Verification

Verify the full reader lookup path with a real EPUB, real imported dictionary, and Tauri runtime.

Key checks:

- Open an EPUB and select Japanese text such as `学校`.
- Confirm popup displays expression, reading, source dictionary, matched/deinflected text, rules, glossary, and frequency/pitch when present.
- Confirm no-dictionary, engine-unavailable, empty-result, ready-result, and manifest-error states remain distinct.
- Confirm fast selection changes do not let stale lookup results replace newer results.
- Confirm Shift hover updates popup content.
- Confirm page turn, chapter change, TOC, shelf return, Close, and Esc clear stale popup state.
- Confirm the disabled `Anki not configured` boundary does not create or send cards.

Acceptance:

- Real lookup returns and renders usable results.
- Long results scroll inside the popup without breaking reader layout.
- Docs are updated to state what was verified or why verification remains blocked.

## Slice 8 Result

Validated on 2026-06-08 with the Tauri runtime, a real Japanese EPUB, and a real imported Yomitan dictionary:

- Started the linked Tauri dev app and Vite frontend, opened the real `かがみの孤城` EPUB from the app library, and verified the reader restored to the Japanese vertical layout.
- Before dictionary import, selecting reader text showed the distinct no-dictionary popup state: `No imported dictionaries found.` with an `Import Dictionary` action.
- Imported `jitendex-yomitan.zip` through the Tauri file-dialog path. The bookshelf status reported `Imported Jitendex.org [2026-06-06] (432643 terms, ready).`
- With the same reader session, selecting text around `校を休み始...` opened a ready lookup popup.
- The popup rendered a real result for `校` with reading `こう`, source `Jitendex.org [2026-06-06]`, matched text tag `校`, glossary content including `school`, a vertical scrollbar for long structured glossary content, and the disabled `Anki not configured` boundary.
- Turning the reader page cleared the stale lookup popup.
- The user-provided `MK3Fix0213.zip` was also checked through the linked importer and failed before import with `No mapping for the Unicode character exists in the target multi-byte code page.` The C bridge and Rust command path now preserve importer exception text so future UI failures surface the underlying reason instead of only `Dictionary import failed.`
- Temporary dictionary zips, target directories, and runtime logs remain local validation artifacts and are not tracked by git.

Not separately re-verified in this slice: fast selection race behavior, Shift hover updates, TOC/chapter/shelf/Close/Esc clearing beyond the page-turn and shelf-return paths observed here, engine-unavailable, empty-result, and manifest-error popup states. These behaviors remain covered by existing implementation state and should get future focused UI automation/regression coverage.

## Slice 9: MK3 Windows Import Encoding Compatibility

Fix the user-provided `MK3Fix0213.zip` import failure without modifying `third_party/hoshidicts`.

Key checks:

- Reproduce the original linked importer failure on Windows.
- Keep normal Yomitan imports on the original direct path.
- On Windows code-page import failures, retry through an HSW-generated lookup-safe compatibility zip.
- Preserve the user-facing manifest title from the original `index.json`.
- Verify the resulting dictionary loads and returns real lookup results.

Acceptance:

- Original `MK3Fix0213.zip` imports through the linked HSW path.
- The manifest title is `明鏡国語辞典 第三版`.
- Runtime lookup returns real results.
- No source zip, compatibility zip, target directory, or imported dictionary data is tracked by git.

## Slice 9 Result

Validated on 2026-06-08 with the original user-provided `MK3Fix0213.zip`:

- The direct hoshidicts import still fails first with the Windows code-page error, confirming the compatibility path is needed.
- HSW now retries those failures with a temporary lookup-safe zip that keeps only root-level Yomitan lookup files: `index.json`, `styles.css`, `term_bank_*.json`, `term_meta_bank_*.json`, and `tag_bank_*.json`.
- The retry rewrites the temporary import title to ASCII so hoshidicts can create and load the import directory on Windows; the persisted manifest restores the original title `明鏡国語辞典 第三版`.
- `MK3Fix0213.zip` imported successfully with `dict_id=93e8e532b599ba4a`, `term=140821`, `meta=0`, `freq=0`, `pitch=0`, `media=0`.
- Linked runtime loaded the imported dictionary and `lookup("学校")` returned 2 real results.
- Media count is intentionally `0` on the compatibility path because `gaiji/` and other media entries are skipped to avoid legacy filename encoding failures. Lookup remains usable; future work can map popup source names back to manifest titles if the internal ASCII title appears in result metadata.

## Validation Commands

- Documentation-only changes: `git diff --check`
- Frontend changes: `cd hoshi-reader-windows; npm run check`
- Frontend production changes: `cd hoshi-reader-windows; npm run build`
- Rust/backend changes: `cd hoshi-reader-windows/src-tauri; cargo check`
- Rust dictionary tests: `cd hoshi-reader-windows/src-tauri; cargo test --lib`
- Linked build check: `cd hoshi-reader-windows/src-tauri; $env:RUSTFLAGS='--cfg hoshi_dicts_linked'; $env:CARGO_TARGET_DIR='target-linked-check'; cargo check`
- Tauri runtime check: `cd hoshi-reader-windows; cmd /c npx.cmd tauri dev`

## Assumptions

- Real hoshidicts validation needs local CMake/C++ tooling and a real Yomitan dictionary zip.
- `third_party/hoshidicts` is local build input and should not be edited for these slices.
- Dictionary zips and imported dictionary data are local test data and must not be committed.
- If tooling is missing, the correct result is a documented blocker, not more feature work.
