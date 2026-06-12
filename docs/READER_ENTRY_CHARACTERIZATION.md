# HSW Reader Entry Characterization

Last updated: 2026-06-12

This checklist records the durable behavior baseline for the HSW bookshelf, EPUB import, reader entry, reader exit, and session restore path.

Use this before and after changes that touch bookshelf state, app-owned EPUB import, reader open/close, progress saving, or session restore.

## Main Path

- From an empty or existing bookshelf, `Open EPUB` opens the system file picker.
- Selecting an EPUB imports it into the app-owned library.
- Imported EPUBs are copied to Tauri app data under `library/books/<book_id>/book.epub`.
- The imported book opens in Reader immediately after import.
- The reader renders the selected chapter and reports progress.
- Returning to the shelf preserves the recent book row and progress.

## Legacy Book Records

- Legacy path-only recent-book records remain supported.
- Opening a legacy record uses the original file path.
- If the original file is missing, opening should fail with a visible error and must not affect app-owned library records.
- Successfully opening or progressing a legacy record should not silently migrate it unless a dedicated migration slice says so.

## Session Restore

- On Tauri startup, HSW attempts to restore the last saved reader session once.
- A valid app-owned session opens by `bookId`.
- A valid legacy session opens by original path.
- Failed restore clears the stale session and leaves the user on the shelf with an error.
- Returning to the shelf should stay on the shelf; restore should not immediately reopen the book again.
- Existing browser `localStorage` session data is a one-time migration source for Tauri reading state.

## Reader Exit And Navigation

- Escape returns from Reader to Bookshelf.
- Reader chrome back action returns through the same close path as Escape.
- TOC jumps clear any active selection popup.
- Internal chapter links navigate to the matched spine entry when possible.
- Previous/next chapter navigation saves progress against the active book locator.

## Progress Persistence

- Reader progress includes chapter index, chapter progress, chapter read chars, book read chars, total book chars, and percent.
- In Tauri, progress is saved to app data `reading/state.json`.
- Outside Tauri, `localStorage` remains the browser fallback.
- Bookshelf rows show chapter progress and character/percentage progress when total character count is available.
- Reopening a book should land close to the saved chapter progress.

## Lookup Interaction Baseline

- Selecting reader text produces `text`, `rect`, and `chapterIndex`.
- Shift hover can select short text at the pointer position.
- Holding Shift while moving the pointer updates the selected text without requiring key release.
- Lookup popup clears on Escape, page/chapter changes, TOC jumps, shelf return, and close.
- Popup placement should avoid covering the selected text column when side space is available.

## Validation Checklist

- Import EPUB from an empty shelf and enter Reader.
- Return to shelf and confirm the book row and progress are present.
- Reopen the imported book and confirm progress restore.
- Restart the Tauri app and confirm a valid session restores once.
- Move or delete the original EPUB after app-owned import and confirm the app-owned record still opens.
- Try a legacy path-only record with a missing file and confirm the error is contained.
- Select text in Reader and confirm popup display/clear behavior.
- Use Shift hover and continuous Shift movement to confirm selection updates.

## Related Docs

- `docs/PROJECT_STATUS.md`
- `docs/LOOKUP_ROADMAP.md`
- `docs/reader-layout-baseline.md`
