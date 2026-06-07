# Real Lookup Validation Plan

## Summary

The reader lookup implementation slices are complete. The next phase is to verify the real hoshidicts path end to end with local CMake/C++ tooling, a real Yomitan dictionary zip, and the Tauri runtime.

This plan only covers validation and minimal HSW fixes discovered by validation. Do not modify `reference/`, `third_party/hoshidicts/`, HSA, yomitan, settings, sync, Anki card creation, audio, release packaging, or broad reader UI.

## Progress

- [x] Slice 6: Toolchain Readiness & Linked Build
- [ ] Slice 7: Real Dictionary Import & Manifest Verification
- [ ] Slice 8: Real Lookup Runtime & Popup Verification

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
