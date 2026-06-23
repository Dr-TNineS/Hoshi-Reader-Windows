# Dictionary Popup HSA Alignment

Last updated: 2026-06-16

This document records a read-only comparison of Hoshi Reader Android (HSA),
Hibiki, and current Hoshi Reader Windows (HSW) dictionary popup behavior.
HSA is the primary reference. Hibiki is only a secondary reference where HSA is
absent or where its behavior helps explain a desktop-specific interaction.

Do not modify `reference/` or `third_party/hoshidicts` from this document.

## Current HSW State

- HSW uses Svelte DOM popups rendered from `src/App.svelte` and
  `src/lib/LookupPopupContent.svelte`.
- Reader lookup opens from Windows-oriented `Shift + hover`, not HSA's
  single-tap reader lookup.
- Popup stack behavior is implemented: root popup remains open, glossary
  `Shift + hover` opens a child popup, closing a child preserves the parent,
  and parent scroll closes descendants.
- Popup states are implemented for loading, no dictionaries, engine
  unavailable, empty, error, and ready.
- Result rendering includes expression, reading, dictionary source,
  matched/deinflected/rules, grouped glossary entries, term/definition tags,
  structured content, dictionary media image loading, frequency, pitch, and a
  disabled Anki boundary.
- Imported dictionary `styles.css` can be loaded into the Svelte popup through a
  scoped sanitizer so dictionary CSS affects glossary content without styling
  reader or popup chrome.
- Same-popup cross-reference redirect history is implemented with popup-local
  Back/Forward controls and scroll restoration. `Shift + hover` recursive
  lookup remains a child-popup action.
- HSW does not yet support word audio, real Anki actions, or Sasayaki controls.

## HSA Reference Findings

HSA renders reader, Dictionary tab, and Process Text lookup popups through a
shared iframe-based popup system:

- `reader-popup-host.js` owns the popup layer inside the WebView document. It
  creates fixed-position popup shells, embeds iframe documents, renders action
  bars, tracks content readiness, manages root lookup highlight rendering, and
  forwards iframe messages to native code.
- `LookupPopupHtml` builds the iframe document. It injects popup CSS, selection
  JS, renderer JS, dictionary settings, dictionary styles, audio settings, Anki
  settings, custom CSS, and resource endpoints.
- `ReaderLookupPopupBridge` defines the native message surface for popup events:
  `textSelected`, `tapOutside`, `swipeDismiss`, `lookupRedirect`,
  `navigateBack`, `navigateForward`, `getEntry`, `openLink`, `playWordAudio`,
  `mineEntry`, `duplicateCheck`, `popupScrolled`, and content readiness.
- `LookupPopupStack` owns popup items and stack rules: close root clears all
  popups, close child preserves parent, parent scroll closes descendants, and
  selection clear signals are sent to the relevant iframe.
- `DictionaryImageRequestHandler` serves dictionary media through
  `https://appassets.androidplatform.net/image?dictionary=...&path=...` and
  the legacy `image://` scheme. It supports png, jpeg, gif, webp, avif, heic,
  and svg mime types.
- HSA's popup renderer is the behavior reference for HSW. It groups glossaries by
  dictionary, renders furigana, tags, pitch/frequency, structured content,
  dictionary media images, dictionary-specific CSS, collapsed dictionaries,
  compact glossary modes, action buttons, popup tap selection, lookup redirects,
  and iframe-local history.
- HSA history has two layers: native action bar counts are exposed by the host,
  while `popup.js` snapshots rendered DOM and scroll position for back/forward
  navigation after redirects.

Important HSA behavior that is product-relevant:

- Popup renderer should preserve structured glossary semantics, tables, ruby,
  dictionary grouping, tags, frequency/pitch, and dictionary media.
- Dictionary media is loaded lazily and should not block ordinary text results.
- Cross-reference/redirect lookup uses the same popup rather than always
  creating a new child popup, and back/forward restores previous popup content
  and scroll state.
- Popup action controls are real DOM buttons and must stay separate from
  selectable glossary text.
- Outside tap dismissal exists for Process Text host, but reader popup dismissal
  is more constrained. HSW should not blindly add outside-click-to-dismiss for
  reader popups.

Android/WebView-specific details that should not be copied directly to HSW:

- Android `WebView`, `WebResourceResponse`, `appassets.androidplatform.net`,
  `webkit.messageHandlers`, iframe sandboxing, Media3/Sasayaki bridges, and
  AnkiDroid flows are platform-specific.
- HSA single-tap reader lookup is Android-first. HSW should keep
  `Shift + hover` for the Windows reader unless a separate product decision
  changes that.
- HSA iframe host solves WebView/touch/rendering constraints. HSW already owns
  the popup DOM in Svelte, so iframe migration is optional architecture work,
  not a prerequisite for renderer/media/history parity.

## Hibiki Secondary Reference

Hibiki is useful mainly for desktop-style interaction details:

- It also separates reader selection from popup glossary selection.
- It uses Shift-hover movement thresholding for reader and popup glossary
  lookup.
- Child popups are anchored to glossary text rects and managed as a stack.
- It needs WebView-to-native coordinate translation; HSW does not, because
  Svelte DOM `Range.getBoundingClientRect()` already returns viewport
  coordinates.

Hibiki should not override HSA on renderer, dictionary media, or history when
HSA has a clear behavior.

## Recommendation

Do not migrate HSW to the HSA iframe host yet.

Reasoning:

- HSW has already implemented the important user-visible stack behavior in
  native Svelte DOM.
- The next missing features are renderer fidelity, dictionary media, and
  history/back-forward. All three can be implemented against the existing Svelte
  popup model without paying the cost of a full iframe host, message bridge, and
  asset protocol rewrite.
- Migrating to iframe host would force a second popup architecture before the
  actual user-visible gaps are closed. It would also duplicate HSA WebView
  concerns that are not natural in Tauri/Svelte.

Adopt HSA behavior first, not HSA architecture:

- Keep HSW popup stack in Svelte.
- Reuse HSA's behavioral contracts for renderer grouping, media URL semantics,
  redirect history, and action controls.
- Reconsider iframe host only if Svelte DOM rendering becomes unable to support
  dictionary CSS/media safely, or if future Dictionary tab / Process Text flows
  require a shared popup document.

Current note: HSW now supports a first-pass scoped dictionary `styles.css`
path. This is a safe subset for glossary styling, not a full HSA iframe/CSS
compatibility promise.

Current note: HSW also supports the Svelte popup dictionary media path through
lazy placeholders backed by the read-only `dictionary_media` Tauri command.
Automated popup probes cover successful image replacement, unavailable media,
and non-Tauri fallback behavior. Runtime validation with a normal media-bearing
Yomitan dictionary is still blocked/not verified; on 2026-06-16 no suitable
local media-bearing Yomitan zip was available.

Current note: Slice 2B is implemented at the command/probe level.
`dictionary_media` reads hoshidicts packed media from `media.idx`/`media.bin`
before falling back to extracted files, so media-preserving imports can render
gaiji SVG paths such as `gaiji/参考.svg`. Structured image detection also
recognizes Yomitan-style `type: "image"` records. Manual popup runtime
validation with a media-preserving 明鏡 import remains not verified because the
current local app-data 明鏡 import has no `media.idx`/`media.bin`.

Current note: Slice 2C is active. `MK3Fix0407.zip` stores `gaiji/...` media
filenames with a legacy non-UTF-8 encoding while term bank JSON references
normal UTF-8 paths. HSW must preserve those media files and normalize entry
names before hoshidicts import; old `mediaCount=0` imports must be reimported.

## Follow-Up Implementation Slices

### Slice 1: HSA-Style Renderer Parity

Goal: make HSW popup rendering closer to HSA while keeping Svelte DOM.

Key changes:

- Expand `DictResult` frontend shape only as needed to represent HSA-style
  glossary metadata: dictionary name, content, definition tags, term tags,
  rules, frequencies, pitches.
- Improve `renderGlossaryContent(...)` for HSA structured glossary behavior:
  tables, forms tables, ruby, image placeholders, inline/block tags, data
  attributes, title/lang, and safe links.
- Group glossary entries by dictionary and render dictionary headers/details
  rather than a flat first-three glossary list.
- Preserve current nested lookup hit-testing: only glossary content triggers
  recursive lookup; tags, headers, links, and controls do not.
- Keep Anki/audio buttons disabled or hidden in this slice.

Acceptance:

- Plain string glossary, structured glossary, tables, ruby, lists, tags,
  frequency, and pitch render without raw JSON.
- Long entries scroll inside the popup and do not resize the reader layout.
- Recursive lookup still works after renderer changes.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`

### Slice 2: Dictionary Media Resource Path

Status: implemented at the HSW Svelte popup level; real media-bearing dictionary
runtime validation remains manual/not verified.

Goal: support HSA-style dictionary media images when imported media exists.

Key changes:

- Add a Tauri command such as
  `dictionary_media(dictId, path) -> { mimeType, dataBase64 }`.
- Resolve `dictId` through `dictionaries/manifest.json`; reject absolute paths,
  empty paths, `..`, and canonicalized paths outside the dictionary directory.
- Support image mime types matching HSA where practical: png, jpg/jpeg, gif,
  webp, avif, heic, svg; unknown files return a clear error.
- Render media references from structured content as lazy image placeholders.
- Show a non-fatal missing-media placeholder for dictionaries with
  `mediaCount=0` or skipped compatibility media.

Acceptance:

- A dictionary media image renders in the popup when the file exists.
- Missing media does not break text lookup or recursive lookup.
- Path traversal attempts are rejected by Rust tests.
- Automated lookup popup checks verify loaded, unavailable, and non-Tauri media
  placeholder states.

Validation:

- `cd src-tauri; cargo check`
- `cd src-tauri; cargo test --lib`
- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- Manual runtime check with a dictionary containing media.

### Slice 2B: Packed Dictionary Media and Gaiji SVGs

Status: implemented on 2026-06-23.

Goal: render imported hoshidicts packed media such as 明鏡国語辞典 第三版
`gaiji/参考.svg` in the existing popup media path.

Key changes:

- Keep `dictionary_media(dictionary, path) -> { mimeType, dataBase64 }`.
- Validate media paths before lookup, then read from `media.idx`/`media.bin`
  when present and fall back to legacy extracted files.
- Match dictionaries by id/import id/manifest title and restored imported title.
- Recognize structured images from both `tag: "img" | "image"` and
  `type: "image"` records.
- Extend popup probes with a gaiji SVG fixture.

Acceptance:

- 明鏡 gaiji SVG media hydrates as an inline image instead of `Media unavailable`.
- Missing media remains non-fatal and text lookup still renders.
- Existing extracted media tests and popup probe behavior remain valid.

Validation:

- `cd src-tauri; cargo check`
- `cd src-tauri; cargo test --lib`
- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- Manual runtime check with 明鏡国語辞典 第三版 entry `声`: not verified; current
  local app-data import lacks `media.idx`/`media.bin`.

Completed validation on 2026-06-23:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- VS developer-shell `cd /d D:\Hoshi-Reader-Windows\src-tauri && cargo check`

### Slice 2C: Legacy ZIP Media Import

Status: active on 2026-06-23.

Goal: import MK3-style Yomitan ZIPs whose media filenames are stored with a
legacy encoding, so hoshidicts writes packed media keys matching UTF-8 glossary
paths such as `gaiji/参考1.svg`.

Key changes:

- Rewrite Windows compatibility import ZIPs with UTF-8 entry names before
  hoshidicts import.
- Preserve dictionary media entries instead of filtering compatibility ZIPs down
  to lookup JSON/CSS files.
- Keep `dictionary_media(dictionary, path)` and popup rendering unchanged.

Acceptance:

- `MK3Fix0407.zip` imports with `media.idx`/`media.bin` and nonzero media count.
- `gaiji/参考1.svg` and similar SVG paths render inline after reimport.
- Legacy unsafe ZIP paths are rejected before compatibility ZIP generation.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- `cd src-tauri; cargo test --lib`
- VS developer-shell linked check and ignored real MK3 import test.

### Slice 3: HSA-Style Redirect History

Goal: add back/forward history for same-popup redirects without replacing the
existing recursive popup stack.

Key changes:

- Add popup-local history state: current content, back stack, forward stack,
  scroll position, and a stable content key.
- Add small Back/Forward controls to the popup header when history exists.
- Add a redirect lookup path for HSA-style cross-reference links or explicit
  glossary redirects. Redirect updates the same popup and pushes the previous
  content onto that popup's history.
- Back/Forward affects only the current popup and closes descendants to avoid
  stale child anchors.
- Keep glossary `Shift + hover` recursive lookup as a child-popup action, not a
  same-popup redirect.

Acceptance:

- Redirect opens new results in the same popup and enables Back.
- Back restores previous results and scroll position; Forward restores the
  redirected result.
- Navigating history does not close the parent popup and does close stale
  descendants.
- Existing child-popup recursive lookup behavior remains unchanged.

Validation:

- `npm run check`
- `npm run build`
- `npm run check:lookup-popup`
- Manual runtime check with at least one redirect/cross-reference dictionary
  entry, if available.

## Deferred HSA Features

- Real Anki card creation, duplicate checking, and media export.
- Word audio and local/remote audio playback.
- Sasayaki popup controls and audiobook sentence audio.
- Dictionary settings UI for collapse modes, compact glossaries, compact pitch,
  and custom user CSS. Popup width, height, and content scale are implemented in
  the Windows Appearance panel through the desktop alignment route documented in
  `docs/DICTIONARY_POPUP_DESKTOP_ALIGNMENT_PLAN.md`.
- E-ink-specific underline/highlight parity.
- Dictionary tab and Process Text iframe popup hosts.

These should be planned as separate product slices after renderer/media/history
are stable.
