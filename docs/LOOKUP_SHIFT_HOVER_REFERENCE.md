# Shift Hover Lookup Reference

## Summary

This document records the read-only comparison of Hibiki's Shift+hover lookup behavior against Hoshi Reader Windows.

The goal is not to copy Hibiki's Flutter/WebView architecture. HSW already owns the reader DOM in Svelte, so the useful parts are the interaction model, throttling rules, selection algorithm details, and popup-layer behavior.

No code in the Hibiki reference project should be modified from this plan.

## Reference Source

Reference project inspected:

- `D:\hibiki_code\hibiki`

Main Hibiki files:

- `hibiki\lib\src\pages\implementations\reader_hibiki_page.dart`
- `hibiki\lib\src\reader\reader_selection_scripts.dart`
- `hibiki\lib\src\reader\reader_selection_data.dart`
- `tools\browser-extension\vendor\popup.js`
- `tools\browser-extension\vendor\selection.js`

Main HSW files for comparison:

- `D:\Hoshi-Reader-Windows\src\lib\reader\Reader.svelte`
- `D:\Hoshi-Reader-Windows\src\App.svelte`
- `D:\Hoshi-Reader-Windows\src\lib\LookupPopupContent.svelte`
- `D:\Hoshi-Reader-Windows\src\lib\lookup-popup.ts`

## Hibiki Reader Flow

Hibiki renders EPUB content inside a WebView, so the reader page injects JavaScript and bridges selection events back to Flutter.

Observed flow:

1. `ReaderSelectionScripts.source()` is injected into the reader WebView.
2. Reader setup JavaScript listens for `mousemove`.
3. If `event.shiftKey` is false, it resets the last hover position and exits.
4. If Shift is held, it compares the new mouse position against `_shiftHoverLastX/Y`.
5. Movement below `dx * dx + dy * dy < 64` is ignored.
6. Larger movement calls Flutter's `onShiftHover(x, y)` handler.
7. The Dart handler calls `_selectTextAt(x, y)`.
8. `_selectTextAt` evaluates `window.hoshiSelection.selectText(x, y, 400)` inside the WebView.
9. The selection script resolves the text hit at the coordinates, expands it into a lookup term, computes a selection rectangle, and dispatches the text selection path.
10. Flutter searches the dictionary and displays the popup anchored to the selection rect.

The same `_selectTextAt` path is also used for Shift+tap / tap-to-highlight behavior, subject to settings.

## Hibiki Selection Details

The reader selection script is more than a simple browser selection wrapper.

Important behaviors:

- It ignores links for lookup selection.
- It uses `document.caretPositionFromPoint` when available.
- It falls back to scanning text nodes and character ranges when caret hit-testing is insufficient.
- It rejects furigana text nodes and prefers base text.
- For non-Japanese hits, it expands left to the token start before scanning forward.
- It scans forward until a delimiter or maximum length is reached.
- It collects sentence context separately from the lookup term.
- It returns selection metadata such as selected text, sentence, rectangle, and normalized offsets.
- It highlights the selected text with CSS Highlights when supported, with a wrapper fallback.

The HSW equivalent currently lives in `Reader.svelte` as `selectTextFromPoint(...)`, with DOM hit-testing, token expansion, range creation, and popup selection callback.

## Popup Recursive Lookup

Hibiki also supports Shift+hover inside dictionary popup content.

Observed flow:

1. The popup page injects its own `selection.js`.
2. `popup.js` listens for `mousemove`.
3. Holding Shift and moving more than the same distance threshold calls `window.hoshiSelection.selectText(e.clientX, e.clientY, 20)`.
4. Popup `selection.js` calls Flutter's `textSelected` handler with the selected text and rect.
5. Flutter opens a deeper/nested popup anchored to the word selected inside the parent popup.

This is separate from reader-body lookup. It is relevant only after HSW wants recursive lookup inside popup glossary text.

### Hibiki Popup Files

The relevant popup-side files are:

- `tools\browser-extension\vendor\popup.html`
- `tools\browser-extension\vendor\popup.js`
- `tools\browser-extension\vendor\popup.css`
- `tools\browser-extension\vendor\selection.js`
- `hibiki\lib\src\pages\implementations\dictionary_popup_webview.dart`
- `hibiki\lib\src\pages\implementations\dictionary_popup_layer.dart`

Popup responsibilities are split across two layers:

- The WebView document renders dictionary entries and handles text hit-testing inside glossary content.
- The Flutter popup layer manages popup placement, nested popup stack behavior, and global dismissal.

### Hibiki Popup Event Flow

Observed popup flow:

1. Flutter creates a popup WebView with prebuilt popup JSON.
2. Popup HTML loads `popup.js`, `popup.css`, and `selection.js`.
3. `popup.js` renders entries, glossary groups, tags, structured content, and dictionary styles.
4. `popup.js` listens for clicks inside `.glossary-content`.
5. A click on glossary text calls `window.hoshiSelection.selectText(e.clientX, e.clientY, 20)`.
6. `popup.js` also listens for `mousemove`; when Shift is held and movement exceeds the 8px threshold, it calls the same selection path.
7. `selection.js` resolves the word under the popup coordinate and calls Flutter handler `textSelected(text, rect)`.
8. Flutter translates the popup-local rect to global screen coordinates.
9. The dictionary popup layer opens a child popup anchored near that selected word.

This means popup lookup is not a special dictionary backend call. It reuses the same dictionary search pipeline, but the selection origin is popup glossary content instead of reader body text.

### Popup Rect Translation

Hibiki has specific code for nested popup placement because the selected word is inside a WebView embedded within a native popup surface.

The key idea:

- The rect returned by `selection.js` is local to the popup WebView document.
- The actual popup is offset by header controls, borders, and any app UI scale.
- `dictionary_popup_layer.dart` asks the rendered WebView's `RenderBox` to map local coordinates to global coordinates.
- The child popup uses that global rect as its anchor.

HSW does not need this exact Flutter transform machinery because popup content is normal Svelte DOM in the same window. For HSW, `Range.getBoundingClientRect()` already returns viewport coordinates. That is a useful simplification.

### Popup Selection Rules

The popup selection rules differ from reader selection in two ways:

- Popup scan length is shorter: Hibiki uses `20` characters inside popup glossary content, while reader body selection uses `400`.
- Popup selection is constrained to definition/glossary content and avoids controls such as headers, tags, links, and buttons.

HSW should preserve that distinction. Lookup inside definitions should feel lightweight and should not accidentally trigger from action buttons, close buttons, dictionary tags, or import controls.

### Popup Rendering Reference

Hibiki's popup renderer is much richer than HSW's current `LookupPopupContent.svelte`.

Important behaviors to reference, but not wholesale copy:

- Group entries by dictionary/result structure.
- Render structured glossary content with Yomitan-like tag handling.
- Wrap structured-content tables in a scrollable table container.
- Preserve dictionary-provided styles carefully.
- Keep popup content internally scrollable.
- Keep controls outside the glossary hit-testing area.
- Avoid raw JSON display for structured content.

HSW already covers the most urgent structured-content issue through `renderGlossaryContent(...)`. The next popup work should focus on interaction and containment rather than another broad renderer rewrite.

## Popup Barrier Hover

Hibiki has an extra native-layer behavior for the popup dismiss barrier.

When a popup is open, the overlay/barrier may intercept hover events before they reach the reader WebView. Hibiki handles this by listening for hover on the dismiss barrier. If Shift is physically pressed and movement passes the same threshold, it calls `_selectTextAt(...)` again using the barrier-local coordinates.

This preserves the "hold Shift and keep moving across text" behavior even while a popup is visible.

This is the most directly useful difference for HSW if the current lookup popup ever blocks continued Shift+hover selection.

## HSW Current State

HSW already has the core interaction:

- `Reader.svelte` tracks Shift key state.
- `handlePointerMove` records the latest pointer position.
- While Shift is held, `scheduleShiftHoverLookup()` delays and then calls `selectTextFromPoint(lastPointer.x, lastPointer.y)`.
- `selectTextFromPoint(...)` resolves the character at the point, expands through text nodes, creates browser selection ranges, computes the selection rect, and calls `onSelectionChange(...)`.
- `App.svelte` receives the selection and calls `dict_lookup`.

The current HSW model is simpler than Hibiki:

- It combines a short timer with Hibiki-style 8px movement-distance thresholding.
- It dedupes repeated lookup callbacks for the same selected text and rounded anchor rect.
- It does not have a dedicated popup/barrier hover pass-through path.
- It supports stacked recursive lookup inside popup glossary text: Shift-hover opens child popups, closing a child keeps the parent, and parent scroll closes children.
- It uses the browser's visible selection instead of a CSS Highlights based custom highlight layer.

## Suggested Migration Plan

Implement these only if lookup interaction hardening becomes the active slice.

### Slice 1: Reader Shift Hover Stability

Goal: make current Shift+hover feel closer to Hibiki without changing popup architecture.

Implementation status: implemented in HSW. Reader Shift-hover uses an 8px movement threshold, resets hover state when Shift is released or the pointer leaves the reader viewport, and dedupes repeated lookup callbacks for the same selected text/anchor.

Key changes:

- Add last-hover coordinate tracking to `Reader.svelte`.
- Ignore Shift hover movement below an 8px equivalent threshold, matching Hibiki's `dx * dx + dy * dy < 64`.
- Reset last-hover coordinates when Shift is released or pointer leaves reader content.
- Avoid re-running lookup for the same text hit when the selected text and rect are unchanged.
- Keep the existing timer only if it still improves feel after the movement threshold; otherwise prefer threshold-based triggering.

Validation:

- Hold Shift and move slowly across adjacent Japanese text.
- Confirm popup updates only when crossing meaningful character positions.
- Confirm Shift release stops lookup.
- Confirm ordinary mouse movement and text selection are unchanged.
- Run `npm run check` and `npm run build`.

### Slice 2: Popup Does Not Block Continued Reader Lookup

Goal: preserve continuous Shift+hover when the lookup popup is visible.

Key changes:

- Inspect whether `.lookup-pop` currently intercepts pointer movement over text that should remain selectable.
- If it blocks reader hover, add a controlled pass-through path rather than making the popup globally pointer-transparent.
- Possible approaches:
  - Add a document-level `pointermove` listener while reader is mounted and route Shift+hover coordinates to reader selection when outside actionable popup controls.
  - Or add a small overlay-aware handler in `App.svelte` that forwards Shift+hover events to `Reader.svelte` through a bound method.
- Keep popup buttons, scrollbars, and links usable.
- Do not let hover over popup controls trigger reader-body lookup.

Validation:

- Open a lookup popup, keep Shift held, and move to nearby reader text.
- Confirm lookup updates without requiring popup close.
- Confirm popup Close, Import, and future Anki controls remain clickable.
- Confirm narrow-window popup placement still works.
- Run `npm run check`, `npm run build`, and `npm run check:lookup-popup`.

### Slice 3: Recursive Popup Lookup

Goal: allow Shift+hover inside rendered glossary text to look up nested terms.

Implementation status: implemented in HSW as stacked nested lookup. Shift+hover inside popup glossary text selects the word under the pointer and opens a child popup anchored to that glossary word.

Key changes:

- Keep stacked child popups as the default recursive lookup behavior.
- Keep text hit-testing constrained to glossary content, not controls.
- Keep reusing the same `ReaderSelection` lookup path so stale-result protection remains centralized.
- Anchor child popup placement to the selected glossary word rect.
- Avoid lookup loops when hovering the same glossary term.

Validation:

- Hover Shift over Japanese text inside a dictionary definition.
- Confirm nested lookup stack behavior is clear.
- Confirm long structured glossary scrolling still works.
- Confirm popup result rendering remains safe and does not execute arbitrary HTML.

### Slice 4: Popup Result Structure Parity

Goal: selectively improve HSW popup readability using Hibiki's popup organization, without porting the whole vendor renderer.

Key changes:

- Keep `LookupPopupContent.svelte` as the owner of HSW popup UI.
- Keep `renderGlossaryContent(...)` as the safe structured-content renderer boundary.
- Add result sections only when data exists: tags, frequencies, pitches, glossary, and source dictionary.
- Make glossary blocks the only nested-lookup hit-test region.
- Keep action controls visually and semantically separate from selectable glossary text.
- Keep long dictionary entries scrollable inside the popup, not by expanding the popup beyond the viewport.

Validation:

- Verify plain string glossary and structured-content glossary.
- Verify long definitions, nested lists, tables, ruby, and links.
- Verify no raw JSON appears.
- Verify nested lookup hit-testing ignores buttons and tags.
- Run `npm run check`, `npm run build`, and `npm run check:lookup-popup`.

## Non-Goals

- Do not port Hibiki's Flutter WebView bridge into HSW.
- Do not replace HSW reader pagination as part of this plan.
- Do not copy vendor popup code wholesale.
- Do not implement Anki, sync, Sasayaki/audio, or settings as part of Shift hover hardening.
- Do not modify `D:\hibiki_code\hibiki`.

## Open Questions

- Should HSW keep timer-based hover delay, switch fully to movement-threshold triggering, or combine both?
- Should HSW eventually add popup history/back-forward controls like HSA, or keep the current stack-only behavior?
- Should HSW introduce CSS Highlights for reader lookup highlight, or keep browser selection until a real layout issue demands the change?
