# HSW Reader Lookup Remaining Slice Plan

## Summary

Current completed work includes Reader selection capture, Shift hover continuous selection, popup side placement, minimal `dict_status` / `dict_lookup`, and a Yomitan zip import entry.

The remaining goal is to move the lookup feature package from "minimally callable" to "manageable, verifiable, and ready for a later Anki slice".

This plan only continues the HSW Windows implementation. Do not modify HSA, `hoshidicts`, or other reference projects.

## Progress

- [x] Slice 1: Dictionary Status & Manifest
- [x] Slice 2: Query Rebuild & Dictionary Types
- [x] Slice 3: Real Lookup Result Shape
- [x] Slice 4: Popup Result UX
- [x] Slice 5: Anki Boundary Prep

Execute only one slice at a time.

## How to use this file with Codex

- Ask Codex to implement exactly one named slice from this file.
- Before implementation, Codex should inspect the current repo state and confirm that the requested slice still matches the code.
- Codex should not execute multiple slices in one turn unless the user explicitly updates this roadmap.
- Codex should keep changes scoped to the selected slice.
- Codex must not modify reference projects.
- Codex must not implement settings, sync, actual Anki card creation, Sasayaki/audio, or Android-only flows from this roadmap.
- After each slice, Codex should update the Progress section only if the slice is completed and verified.

## Slice 1: Dictionary Status & Manifest

Upgrade the current `bool dict_status` and import-directory-only model into a manageable dictionary model.

Key changes:

- Add `DictionaryStatus`: `ready | noDictionaries | engineUnavailable | error`, with message, loaded count, and imported count.
- Add app data `dictionaries/manifest.json`, recording `dictId`, title, kind, enabled, order, internal path, counts, and last imported time.
- Make `dictionary_import_yomitan_zip` write the manifest after successful import; repeated import of the same zip reuses the existing record.
- Add `dictionary_list()`, returning dictionaries from the manifest.
- On startup, read enabled dictionaries from the manifest; missing manifest returns empty, corrupt manifest returns a clear error without panic.

Completion:

- Frontend can distinguish no dictionaries, engine unavailable, manifest error, and ready states.
- Imported dictionaries can be listed after app restart.
- Current no-CMake environment still compiles and reports engine unavailable.

Tests:

- `cargo test --lib` covers missing/corrupt manifest, list, and import record behavior.
- `cargo check`
- `npm run check`
- `npm run build`

## Slice 2: Query Rebuild & Dictionary Types

Change lookup engine loading from scanning all hoshidicts term directories to rebuilding the query from enabled manifest entries.

Key changes:

- Make `DictState::initialize` read the manifest and load only `enabled=true` dictionaries.
- Mark imported dictionaries by kind based on hoshidicts counts: term, freq, pitch. For v1, the same imported directory may be usable as term/frequency/pitch source when counts exist.
- Load dictionaries through the matching C API: term uses `dict_query_add_term_dict`, freq uses `dict_query_add_freq_dict`, pitch uses `dict_query_add_pitch_dict`.
- Add `dictionary_set_enabled(dict_id, enabled)` and `dictionary_set_order(dict_ids)`, rebuilding query after changes.
- Keep UI minimal: backend commands and visible status only, not a settings page.

Completion:

- Enabled/order changes affect the next lookup.
- No enabled term dictionary produces a no-dictionaries state or equivalent.
- Frequency/pitch dictionaries can be loaded with term lookup; frontend display is left for the next slice.

Tests:

- Rust tests cover enabled filtering, order sorting, and term/freq/pitch grouping.
- `RUSTFLAGS='--cfg hoshi_dicts_linked' cargo check`
- `cargo check`
- `cargo test --lib`

## Slice 3: Real Lookup Result Shape

Expand `dict_lookup` return data to include the core HSA lookup result information.

Key changes:

- Add `rules`, `dictionary`, `frequencies`, and `pitches` to `DictResult`.
- Extend the C API bridge so hoshidicts `TermResult.frequencies` and `TermResult.pitches` are returned to Rust as JSON.
- Parse frequency/pitch JSON in Rust and keep a minimal structure: dictionary name, frequency display/value, pitch positions, and transcriptions.
- Keep `maxResults=16` and `scanLength=16`.
- Keep frontend display minimal; do not attempt full HSA styling in this slice.

Completion:

- With a real term dictionary, expression, reading, and glossary return normally.
- With frequency/pitch dictionaries, lookup results include displayable fields.
- No dictionary, engine unavailable, and lookup errors return clear states without fake results.

Tests:

- `cargo check`
- `cargo test --lib`
- `RUSTFLAGS='--cfg hoshi_dicts_linked' cargo check`
- In an environment with CMake and a real dictionary, manually verify `dict_lookup("学校")`.

## Slice 4: Popup Result UX

Turn the current minimal result shell into a stable reader lookup popup.

Key changes:

- Show loading, no dictionary, engine unavailable, empty, error, and result states.
- Display expression, reading, matched/deinflected, glossary, frequency, and pitch in a minimal readable layout.
- Constrain long results with internal scrolling; keep current side placement and narrow-window fallback.
- Prevent stale lookup results from replacing newer selection results.
- In no-dictionary state, provide an import dictionary entry; do not add a settings page.

Completion:

- Empty dictionary state prompts dictionary import.
- Engine unavailable state explains the build/tooling issue.
- With an imported real dictionary, selected text shows real lookup results.
- Shift hover continuous movement updates popup content.
- Page turn, chapter change, TOC, shelf return, and Esc leave no stale popup.

Tests:

- `npm run check`
- `npm run build`
- Manual checks for empty dictionary, engine unavailable, real results, long results, edge selections, and continuous Shift hover.

## Slice 5: Anki Boundary Prep

Reserve an Anki integration boundary without implementing Anki sync or card creation.

Key changes:

- Add frontend `LookupAnkiPayload` type with selected text, result id/index, expression, reading, glossary, source book, and source chapter.
- Add popup-local `buildAnkiPayload(result)` helper, but do not call any Anki backend.
- Keep Anki action hidden by default. If shown, it must be disabled and clearly say "Anki not configured".
- Do not integrate AnkiDroid Intent, Android-only flows, sync, settings, or audio systems.

Completion:

- Lookup result to Anki payload boundary is stable.
- UI does not pretend Anki is usable.
- A later Anki slice can reuse the payload type.

Tests:

- `npm run check`
- `npm run build`
- If a pure helper is added, cover it with a minimal type-level or unit test.

## Assumptions

- Implement manifest/config first, then result shape, then popup UX.
- The current machine may not have CMake/C++ toolchain. Real hoshidicts lookup and zip import end-to-end validation requires a suitable toolchain and a real dictionary zip.
- The default local hoshidicts checkout path is `third_party/hoshidicts`; `HSW_HOSHIDICTS_DIR` may override it.
- Do not modify HSA, `hoshidicts`, `hibiki-windows-x64`, or `yomitan`.
- Do not automatically scan user disks, migrate old dictionary paths, or delete user data.
- Do not implement settings, sync, actual Anki card creation, Sasayaki/audio, or Android-only features in these slices.
