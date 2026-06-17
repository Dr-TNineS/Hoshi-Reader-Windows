# Yomitan Reference Audit

Last updated: 2026-06-18

This audit records HSW areas that previously cited, borrowed from, or used
Yomitan as a behavior/design reference. Going forward, HSA is the required
behavior reference for popup, lookup, Anki, audio, and media planning. Yomitan
may remain only as dictionary-format/runtime-validation terminology.

## Summary

- `reference/yomitan` is removed as a local reference project.
- HSW keeps support for Yomitan-format dictionary zips and existing importer
  names such as `dictionary_import_yomitan_zip`.
- Behavior references should point to HSA source paths and contracts, not to
  Yomitan extension implementation.

## Affected Areas

| Area | Previous wording/source | Why it counted | HSA replacement source | Status |
| --- | --- | --- | --- | --- |
| Dictionary popup renderer / structured glossary rendering | `docs/DICTIONARY_POPUP_HSA_ALIGNMENT.md` described HSA `popup.js` as a "Yomitan-derived renderer" and planned "HSA/Yomitan structured content". | It framed renderer fidelity as partly sourced from Yomitan behavior rather than HSA user-visible behavior. | HSA popup bridge/renderer behavior: `LookupPopupHtml`, `LookupPopupStack`, `ReaderLookupPopupBridge`, and HSA popup assets under `reference/Hoshi-Reader-Android/app/src/main/assets/hoshi-web/popup/`. | Reworded to HSA-aligned popup renderer and HSA structured glossary behavior. Future renderer work should cite HSA behavior. |
| Dictionary popup CSS/media behavior | Earlier popup/media plans used Yomitan-style dictionary media/CSS language while discussing HSA parity. | Dictionary `styles.css` and media are a supported dictionary-format capability, but behavior parity should be judged against HSA popup handling. | HSA `DictionaryImageRequestHandler`, `LookupPopupHtml`, and popup CSS/resource handling. | Already compatible at HSW Svelte level; runtime media validation remains separate. Keep dictionary-format mentions only. |
| Lookup shift-hover popup rendering notes | `docs/LOOKUP_SHIFT_HOVER_REFERENCE.md` said "Yomitan-like tag handling". | It made Yomitan the named rendering behavior source in a lookup interaction reference doc. | HSA structured glossary rendering behavior; Hibiki remains only the desktop Shift-hover interaction reference. | Reworded to HSA structured glossary behavior. |
| Anki audio/media planning | `docs/ANKI_AUDIO_SYNC_PLAN.md` included a Yomitan reference-summary section for note media injection and audio behavior. | It made Yomitan a behavior/design input for future Anki audio slices. | HSA `AnkiRepository`, `AnkiBackend`, `AnkiConnectBackend`, `AudioSettings`, `AudioSourceResolver`, and Sasayaki boundaries. | Removed Yomitan reference summary. Future slices should follow HSA boundaries. |
| Reference project list | `reference/README.md` listed `yomitan` as an expected local reference project. | It invited future agents to inspect Yomitan directly as a local reference source. | HSA is the primary behavior reference; Hibiki remains a secondary desktop interaction reference where explicitly documented. | Removed from the local reference list. |

## Allowed Remaining Yomitan Mentions

The following are allowed because they describe data format, importer naming, or
historical validation facts rather than behavior/design reference:

- Yomitan-format dictionary zip support.
- `dictionary_import_yomitan_zip` and related Rust/FFI names.
- `HSW_REAL_YOMITAN_ZIP` validation environment variable.
- Real validation logs naming public dictionary zips such as
  `jitendex-yomitan.zip`.
- HSA source comments that mention Yomitan inside the ignored/read-only
  `reference/Hoshi-Reader-Android` project.

## Future Rule

When a future HSW slice needs popup, lookup, Anki, audio, media, or renderer
behavior guidance, use HSA first. Use Hibiki only for desktop interaction
details already identified as Windows-relevant. Do not re-add
`reference/yomitan` as a local reference project without a separate explicit
decision.

