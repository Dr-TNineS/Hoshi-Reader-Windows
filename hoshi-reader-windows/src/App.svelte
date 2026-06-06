<script lang="ts">
  import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { resolveChapterAssets } from "./lib/epub-assets";
  import Reader from "./lib/reader/Reader.svelte";
  import {
    bookRecordKey,
    bookRecordPath,
    clearSession,
    clampUnit,
    loadBooks,
    loadSession,
    mergeLibraryBooks,
    saveReadingProgress,
  } from "./lib/storage";
  import { findChapterIndex, flattenToc } from "./lib/toc";
  import type { EpubMeta, ReaderProgress, ReaderSelection } from "./lib/types";
  import type { BookLocator, BookRecord, LibraryBookRecord } from "./lib/storage";

  function clampChapter(chapter: number, total: number): number {
    return Math.max(0, Math.min(chapter, Math.max(0, total - 1)));
  }

  let view = $state<"bookshelf" | "reader">("bookshelf");
  let meta = $state<EpubMeta | null>(null);
  let chapterHtml = $state("");
  let chapterIndex = $state(0);
  let currentBookLocator = $state<BookLocator | null>(null);
  let books = $state<BookRecord[]>(loadBooks());
  let startAtEnd = $state(false);
  let readerInitialProgress = $state(0);
  let currentReaderProgress = $state<ReaderProgress | null>(null);
  let readerSelection = $state<ReaderSelection | null>(null);
  let showToc = $state(false);
  let error = $state("");
  let debug = $state("");
  let triedRestore = false;
  let triedLibraryLoad = false;

  let tocEntries = $derived(meta ? flattenToc(meta.toc, meta) : []);
  let chapterBookInfo = $derived(meta?.book_info.chapter_info[chapterIndex] ?? null);

  // Restore the last reader session once on page load. Returning to the shelf
  // should stay on the shelf, so this effect is intentionally one-shot.
  $effect(() => {
    if (triedRestore) return;
    triedRestore = true;

    const session = loadSession();
    if (session && view === "bookshelf" && isTauriRuntime()) {
      (async () => {
        try {
          await openBookLocator(session, session.chapter, "Restoring...", session.chapterProgress ?? 0);
          debug = "Restored";
        } catch (e) {
          clearSession();
          error = String(e);
          debug = "Restore failed";
        }
      })();
    }
  });

  $effect(() => {
    if (triedLibraryLoad) return;
    triedLibraryLoad = true;
    if (!isTauriRuntime()) return;

    (async () => {
      try {
        const libraryBooks = await invoke<LibraryBookRecord[]>("library_list_books");
        books = mergeLibraryBooks(books, libraryBooks);
      } catch (e) {
        console.warn("Library list failed", e);
      }
    })();
  });

  function saveProgress(
    locator: BookLocator,
    bookMeta: EpubMeta,
    chapter: number,
    progress: ReaderProgress | null = currentReaderProgress,
    chapterProgressFallback = 0,
  ) {
    books = saveReadingProgress(books, locator, bookMeta, chapter, progress, chapterProgressFallback);
  }

  async function openBookLocator(locator: BookLocator, chapter = 0, status = "Opening...", chapterProgress = 0) {
    error = "";
    debug = status;
    if (!isTauriRuntime()) {
      error = "Not inside Tauri. Use `npx tauri dev`.";
      debug = "Browser";
      return;
    }

    currentBookLocator = locator;
    if (locator.bookId) {
      meta = await invoke<EpubMeta>("library_open_book", { bookId: locator.bookId });
    } else if (locator.path) {
      meta = await invoke<EpubMeta>("epub_open", { path: locator.path });
    } else {
      throw new Error("Book record has no library id or file path.");
    }
    const safeChapter = clampChapter(chapter, meta.spine.length);
    await loadChapter(safeChapter, chapterProgress);
    saveProgress(locator, meta, safeChapter, null, chapterProgress);
    view = "reader";
  }

  async function openBookPath(path: string, chapter = 0, status = "Opening...", chapterProgress = 0) {
    await openBookLocator({ path }, chapter, status, chapterProgress);
  }

  async function openBook() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (!selected) {
        debug = "Cancelled";
        return;
      }
      debug = "Importing...";
      const imported = await invoke<LibraryBookRecord>("library_import_epub", { sourcePath: selected });
      await openBookLocator({
        bookId: imported.bookId,
        sourcePath: imported.sourcePath,
        libraryPath: imported.libraryPath,
      }, 0);
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function continueBook(book: BookRecord) {
    try {
      startAtEnd = false;
      await openBookLocator(book, book.chapter, "Loading...", book.chapterProgress ?? 0);
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function loadChapter(idx: number, chapterProgress = 0) {
    if (!meta || !isTauriRuntime()) return;

    try {
      readerSelection = null;
      const safeIndex = clampChapter(idx, meta.spine.length);
      readerInitialProgress = clampUnit(chapterProgress);
      currentReaderProgress = null;
      const [rawHtml, chapterPath] = await Promise.all([
        invoke<string>("epub_read_chapter", { spineIndex: safeIndex }),
        invoke<string | null>("epub_get_chapter_path", { spineIndex: safeIndex }),
      ]);
      chapterHtml = resolveChapterAssets(rawHtml, chapterPath);
      chapterIndex = safeIndex;
      if (currentBookLocator) saveProgress(currentBookLocator, meta, safeIndex, null, readerInitialProgress);
      debug = `Ch${safeIndex + 1}/${meta.spine.length}`;
    } catch (e) {
      error = String(e);
    }
  }

  async function jumpToChapter(idx: number) {
    startAtEnd = false;
    readerSelection = null;
    showToc = false;
    await loadChapter(idx, 0);
  }

  async function navigateReaderHref(href: string) {
    if (!meta) return;

    const idx = findChapterIndex(meta, href);
    if (idx === null) {
      debug = "Link target not found";
      return;
    }

    startAtEnd = false;
    readerSelection = null;
    showToc = false;
    await loadChapter(idx, 0);
  }

  function prevChapter() {
    if (chapterIndex > 0) {
      startAtEnd = true;
      readerSelection = null;
      loadChapter(chapterIndex - 1, 1);
    }
  }

  function prevChapterDirect() {
    if (chapterIndex > 0) {
      startAtEnd = false;
      readerSelection = null;
      loadChapter(chapterIndex - 1, 0);
    }
  }

  function nextChapter() {
    startAtEnd = false;
    readerSelection = null;
    if (meta && chapterIndex < meta.spine.length - 1) loadChapter(chapterIndex + 1, 0);
  }

  function handleReaderProgress(progress: ReaderProgress) {
    if (!meta || !currentBookLocator || progress.chapterIndex !== chapterIndex) return;
    currentReaderProgress = progress;
    saveProgress(currentBookLocator, meta, chapterIndex, progress);
  }

  function progressLabel(book: BookRecord): string {
    if (book.totalChapters <= 0) return "No chapters";
    if ((book.totalCharacters ?? 0) > 0) {
      return `Ch.${book.chapter + 1}/${book.totalChapters} | ${book.bookReadChars ?? 0}/${book.totalCharacters}c | ${(book.percent ?? 0).toFixed(2)}%`;
    }
    return `Ch.${book.chapter + 1}/${book.totalChapters}`;
  }

  function openedLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

  function closeReaderSelection() {
    window.getSelection()?.removeAllRanges();
    readerSelection = null;
  }

  function backToShelf() {
    closeReaderSelection();
    view = "bookshelf";
  }

  function toggleToc() {
    closeReaderSelection();
    showToc = !showToc;
  }

  function popupStyle(selection: ReaderSelection): string {
    const width = 280;
    const height = 132;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const maxTop = Math.max(44, window.innerHeight - height - 48);
    const left = Math.max(margin, Math.min(maxLeft, selection.rect.x + selection.rect.width / 2 - width / 2));
    const below = selection.rect.y + selection.rect.height + 10;
    const above = selection.rect.y - height - 10;
    const topCandidate = below <= maxTop ? below : above;
    const top = Math.max(44, Math.min(maxTop, topCandidate));

    return `left:${left}px;top:${top}px;width:${width}px`;
  }

</script>

<main class="app">
  {#if view === "bookshelf"}
    <section class="bookshelf">
      <div class="shelf-head">
        <div>
          <h1>Hoshi Reader</h1>
          <p class="subtitle">Lightweight Japanese EPUB Reader</p>
        </div>
        <button class="ob" onclick={openBook}>Open EPUB</button>
      </div>

      {#if error}<p class="err">{error}</p>{/if}

      <div class="recent">
        <h2>Recent Books</h2>
        {#if books.length === 0}
          <p class="empty">No recent books yet.</p>
        {:else}
          <div class="book-list">
            {#each books as book (bookRecordKey(book))}
              <button class="book-row" onclick={() => continueBook(book)}>
                <span class="book-title">{book.title}</span>
                <span class="book-meta">{progressLabel(book)} | {openedLabel(book.lastOpened)}</span>
                <span class="book-path">{bookRecordPath(book)}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <p class="keys">arrow:page | Ctrl+arrow:chapter | Esc:shelf</p>
    </section>
  {:else}
    <Reader
      content={chapterHtml}
      {chapterIndex}
      totalChapters={meta?.spine.length ?? 0}
      onPrevChapter={prevChapter}
      onPrevChapterDirect={prevChapterDirect}
      onNextChapter={nextChapter}
      onNavigateHref={navigateReaderHref}
      onBackToShelf={backToShelf}
      initialProgress={readerInitialProgress}
      chapterStartChars={chapterBookInfo?.current_total ?? 0}
      totalBookChars={meta?.book_info.character_count ?? 0}
      onProgressChange={handleReaderProgress}
      onSelectionChange={(selection: ReaderSelection | null) => readerSelection = selection}
      {startAtEnd}
    />
    {#if readerSelection}
      <aside class="lookup-pop" style={popupStyle(readerSelection)}>
        <div class="lookup-head">
          <span>Lookup</span>
          <button aria-label="Close lookup" onclick={closeReaderSelection}>Close</button>
        </div>
        <p class="lookup-text">{readerSelection.text}</p>
        <p class="lookup-state">Dictionary backend not ready.</p>
      </aside>
    {/if}
    {#if showToc}
      <aside class="toc-panel">
        <div class="toc-head">
          <h2>Contents</h2>
          <button onclick={() => showToc = false}>Close</button>
        </div>
        {#if tocEntries.length === 0}
          <p class="empty">No table of contents.</p>
        {:else}
          <div class="toc-list">
            {#each tocEntries as entry}
              <button
                class="toc-row"
                class:active={entry.chapterIndex === chapterIndex}
                disabled={entry.chapterIndex === null}
                style={`--level:${entry.level}`}
                onclick={() => entry.chapterIndex !== null && jumpToChapter(entry.chapterIndex)}
              >
                {entry.label}
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    {/if}
    <div class="ctrls">
      <button onclick={prevChapterDirect}>Prev Ch</button>
      <span>Ch.{chapterIndex + 1}/{meta?.spine.length ?? 0}</span>
      <button onclick={nextChapter}>Next Ch</button>
      <button onclick={toggleToc}>TOC</button>
      <button onclick={backToShelf}>Esc</button>
    </div>
  {/if}
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: #202124; color: #e8eaed; font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .app { width: 100vw; height: 100vh; }
  .bookshelf { width: min(920px, calc(100vw - 48px)); height: 100vh; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .shelf-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  h1 { font-size: 32px; font-weight: 300; letter-spacing: 4px; color: #fff; }
  h2 { font-size: 13px; font-weight: 600; color: #9aa0a6; text-transform: uppercase; }
  .subtitle { margin-top: 6px; color: #9aa0a6; font-size: 14px; }
  .ob { flex-shrink: 0; padding: 10px 22px; font-size: 14px; background: #3b8f78; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  .ob:hover { background: #46a187; }
  .err { color: #ff8a80; font-size: 13px; white-space: pre-wrap; }
  .recent { display: flex; flex-direction: column; gap: 10px; min-height: 240px; }
  .empty { padding: 28px 0; color: #80868b; font-size: 13px; }
  .book-list { display: flex; flex-direction: column; gap: 8px; max-height: 54vh; overflow-y: auto; padding-right: 4px; }
  .book-row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; padding: 12px 14px; text-align: left; background: #2b2d31; color: inherit; border: 1px solid #3c4043; border-radius: 6px; cursor: pointer; }
  .book-row:hover { background: #32363b; border-color: #5f6368; }
  .book-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; color: #f1f3f4; }
  .book-meta { white-space: nowrap; font-size: 12px; color: #9aa0a6; }
  .book-path { grid-column: 1 / -1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #80868b; }
  .keys { margin-top: 2px; font-size: 12px; color: #6f7479; }
  .toc-panel { position: fixed; top: 28px; right: 18px; bottom: 44px; z-index: 110; width: min(380px, calc(100vw - 36px)); display: flex; flex-direction: column; background: #202124; border: 1px solid #3c4043; border-radius: 6px; box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45); }
  .toc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #3c4043; }
  .toc-head button { padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .toc-list { display: flex; flex-direction: column; overflow-y: auto; padding: 8px; }
  .toc-row { width: 100%; padding: 8px 10px 8px calc(10px + var(--level) * 16px); text-align: left; background: transparent; color: #d7d9dc; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toc-row:hover { background: #303134; }
  .toc-row.active { background: #315c50; color: #fff; }
  .toc-row:disabled { color: #686d72; cursor: default; }
  .toc-row:disabled:hover { background: transparent; }
  .lookup-pop { position: fixed; z-index: 125; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: #23262a; color: #e8eaed; border: 1px solid #4b5056; border-radius: 6px; box-shadow: 0 14px 38px rgba(0, 0, 0, 0.42); }
  .lookup-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #9aa0a6; font-size: 11px; text-transform: uppercase; }
  .lookup-head button { flex-shrink: 0; padding: 3px 8px; background: #33383e; color: #d7d9dc; border: 1px solid #555c64; border-radius: 3px; cursor: pointer; font-size: 11px; text-transform: none; }
  .lookup-text { color: #fff; font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; max-height: 54px; overflow: hidden; }
  .lookup-state { color: #b7bcc3; font-size: 12px; line-height: 1.35; }
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: #111; border-top: 1px solid #333; z-index: 100; }
  .ctrls button { padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: #444; }
  .ctrls span { font-size: 12px; color: #888; }
</style>
