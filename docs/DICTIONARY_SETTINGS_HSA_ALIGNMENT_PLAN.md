# Dictionary Settings HSA Alignment Plan

Last updated: 2026-06-23

## Goal

Align HSW's dictionary import classification and core Dictionaries settings with
Hoshi Reader Android (HSA), while preserving HSW's Windows/Tauri storage shape.

## Non-goals

- Do not copy HSA's physical `Dictionaries/Term`, `Frequency`, and `Pitch`
  directory duplication model.
- Do not implement recommended dictionary downloads, automatic updates, profile
  scoped dictionary settings, dictionary default tab, or custom CSS in this
  slice set.
- Do not modify `reference/Hoshi-Reader-Android` or `third_party/hoshidicts`.

## Preconditions

- Use `reference/Hoshi-Reader-Android` as the read-only HSA reference.
- Keep HSW's app-owned imported dictionary root and manifest role entries as the
  source of truth.
- Re-check the current HSW Rust command, manifest, frontend settings, reader
  selection, and popup rendering boundaries before implementation.

## Slices

| Slice | Status | Goal | Acceptance | Validation |
| --- | --- | --- | --- | --- |
| 1 | Complete | Import/model parity | New imports create only positive-count Term/Frequency/Pitch role entries; zero detected roles fail clearly; legacy manifest records stay compatible without inventing zero-count Term rows | `cargo test --lib`, VS developer-shell `cargo check` |
| 2 | Complete | Core dictionary settings persistence | HSA core defaults and clamps persist in HSW settings state: lookup, import, collapse, and rendering behavior options | `npm run check:settings-state`, `npm run check` |
| 3 | Complete | Dictionaries panel settings UI | Dictionaries panel exposes HSA-style Lookup, Import, Collapse Dictionaries, and Behaviour controls while preserving existing role tabs/actions | `npm run check:dictionary-management`, narrow viewport probe |
| 4 | Complete | Lookup/popup consumption | Lookup uses configured max results/scan length; scan-non-Japanese gates selection where equivalent; supported collapse/compact/tag/frequency/pitch settings affect popup rendering | `npm run check:lookup-popup`, `npm run check` |
| 5 | Complete | Status/docs/commit | Project docs reflect implemented state, validation results are recorded, and changes are committed without unrelated files | `git diff --check`, relevant checks |

## Completion Notes

- Implemented on 2026-06-23.
- HSW keeps one app-owned imported dictionary directory per archive and uses
  manifest role entries for Term/Frequency/Pitch.
- Dictionary import classification follows HSA count detection: positive
  `termCount`, `freqCount`, and `pitchCount` create role entries; zero detected
  roles fail with `Failed to detect dictionary type.`.
- Core dictionary settings persist in HSW local settings state with HSA defaults
  and clamps: max results `16` clamped `1..50`, scan length `16` clamped
  `1..64`, compact glossaries on, compact pitch accents on, and collapse mode
  expand-all.
- Popup rendering consumes supported settings for collapse mode, expression
  tags, compact glossary/pitch layout, harmonic frequency, and pitch
  deduplication. HSA profile-scoped settings, recommended downloads, automatic
  updates, default dictionary tab, and custom CSS remain non-goals.

## Validation Results

- `git diff --check`
- `npm run check`
- `npm run check:settings-state`
- `npm run check:dictionary-management`
- `npm run check:lookup-popup`
- `npm run build`
- `cd src-tauri; cargo test --lib`
- VS developer-shell `cargo check`

## HSA Reference Facts

- HSA detects dictionary type from native import counts: `termCount > 0`,
  `freqCount > 0`, and `pitchCount > 0`.
- A single archive can be represented in multiple dictionary types.
- Frequency and pitch dictionaries are type-specific and are not term fallback
  dictionaries.
- Core HSA dictionary settings include scan non-Japanese text, max results,
  scan length, low memory import, collapse mode, expand first dictionary,
  custom collapsed dictionaries, compact glossaries, expression tags, harmonic
  frequency, deduplicate pitch accents, and compact pitch accents.
