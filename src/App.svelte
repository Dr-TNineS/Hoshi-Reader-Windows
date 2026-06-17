<script lang="ts">
  import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import AnkiConnectPanel from "./lib/AnkiConnectPanel.svelte";
  import { extractDictionaryMediaReferences, pruneFieldMappings, upsertFieldTemplate } from "./lib/anki-field-renderer";
  import DictionaryManagementPanel from "./lib/DictionaryManagementPanel.svelte";
  import { resolveChapterAssets } from "./lib/epub-assets";
  import LookupPopupContent from "./lib/LookupPopupContent.svelte";
  import { resultDictionaryLabel, type LookupState } from "./lib/lookup-popup";
  import { lookupPopupStyle } from "./lib/lookup-popup-position";
  import Reader from "./lib/reader/Reader.svelte";
  import {
    buildReadingProgressUpdate,
    bookRecordKey,
    bookRecordPath,
    clampUnit,
    clearReadingSession,
    forgetReadingBook,
    importLegacyReadingState,
    loadBooks,
    mergeLibraryBooks,
    persistReadingProgress,
    upsertReadingProgressBook,
  } from "./lib/storage";
  import { findChapterIndex, flattenToc } from "./lib/toc";
  import type {
    AnkiConnectionStatus,
    AnkiAddNoteResult,
    AnkiDictionaryMediaRef,
    AnkiNoteRequest,
    AnkiSettings,
    AnkiStoreMediaResult,
    DictImportSummary,
    DictResult,
    DictionaryManifestEntry,
    DictionaryStatus,
    EpubMeta,
    LookupAnkiPayload,
    ReaderProgress,
    ReaderSelection,
  } from "./lib/types";
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
  let lookupPopupSizes = $state<Record<string, { width: number; height: number }>>({});
  let lookupPopups = $state<LookupPopupItem[]>([]);
  let lookupRequestId = 0;
  let showToc = $state(false);
  let error = $state("");
  let dictionaryStatus = $state("");
  let showDictionaryManager = $state(false);
  let dictionaryList = $state<DictionaryManifestEntry[]>([]);
  let dictionaryListStatus = $state<DictionaryStatus | null>(null);
  let dictionaryListError = $state("");
  let dictionaryBusy = $state(false);
  let showAnkiPanel = $state(false);
  let ankiSettings = $state<AnkiSettings | null>(null);
  let ankiEndpointDraft = $state("http://127.0.0.1:8765");
  let ankiStatus = $state("");
  let ankiError = $state("");
  let ankiBusy = $state(false);
  let bookImportBusy = $state(false);
  let debug = $state("");
  let triedStartup = false;
  let triedDictionaryList = false;
  let triedAnkiSettings = false;
  let progressSaveVersion = 0;

  let tocEntries = $derived(meta ? flattenToc(meta.toc, meta) : []);
  let chapterBookInfo = $derived(meta?.book_info.chapter_info[chapterIndex] ?? null);

  interface LookupPopupHistoryEntry {
    selection: ReaderSelection;
    scrollTop: number;
  }

  interface LookupPopupItem {
    id: string;
    selection: ReaderSelection;
    state: LookupState;
    error: string;
    results: DictResult[];
    requestId: number;
    clearSelectionSignal: number;
    historyBack: LookupPopupHistoryEntry[];
    historyForward: LookupPopupHistoryEntry[];
    restoreScrollTop: number;
    restoreScrollSignal: number;
  }

  // Initialize persisted reading state once. Returning to the shelf should stay
  // on the shelf, so session restore remains intentionally one-shot.
  $effect(() => {
    if (triedStartup) return;
    triedStartup = true;
    if (!isTauriRuntime()) return;

    (async () => {
      try {
        const readingState = await importLegacyReadingState(true);
        books = readingState.books;
        const libraryBooks = await invoke<LibraryBookRecord[]>("library_list_books");
        books = mergeLibraryBooks(books, libraryBooks);

        const session = readingState.session;
        if (session && view === "bookshelf") {
          try {
            await openBookLocator(session, session.chapter, "Restoring...", session.chapterProgress ?? 0);
            debug = "Restored";
          } catch (e) {
            await clearReadingSession(true);
            error = String(e);
            debug = "Restore failed";
          }
        }
      } catch (e) {
        error = String(e);
        debug = "Startup state failed";
      }
    })();
  });

  $effect(() => {
    if (triedDictionaryList) return;
    triedDictionaryList = true;
    if (!isTauriRuntime()) return;
    void refreshDictionaries();
  });

  $effect(() => {
    if (triedAnkiSettings) return;
    triedAnkiSettings = true;
    if (!isTauriRuntime()) return;
    void loadAnkiSettings();
  });

  function saveProgress(
    locator: BookLocator,
    bookMeta: EpubMeta,
    chapter: number,
    progress: ReaderProgress | null = currentReaderProgress,
    chapterProgressFallback = 0,
  ) {
    const update = buildReadingProgressUpdate(locator, bookMeta, chapter, progress, chapterProgressFallback);
    books = upsertReadingProgressBook(books, update.record);
    const saveVersion = ++progressSaveVersion;
    void persistReadingProgress(update.record, update.session, isTauriRuntime())
      .then((savedBooks) => {
        if (saveVersion !== progressSaveVersion) return;
        books = savedBooks;
      })
      .catch((e) => {
        error = String(e);
      });
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

  async function refreshLibraryBooks() {
    if (!isTauriRuntime()) return;
    const libraryBooks = await invoke<LibraryBookRecord[]>("library_list_books");
    books = mergeLibraryBooks(books, libraryBooks);
  }

  async function openBook() {
    if (bookImportBusy) return;
    try {
      if (!isTauriRuntime()) {
        error = "EPUB import requires Tauri runtime.";
        debug = "Browser";
        return;
      }

      bookImportBusy = true;
      const selected = await open({
        multiple: false,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (!selected) {
        debug = "Import cancelled.";
        return;
      }
      debug = "Importing...";
      const imported = await invoke<LibraryBookRecord>("library_import_epub", { sourcePath: selected });
      await refreshLibraryBooks();
      await openBookLocator({
        bookId: imported.bookId,
        sourcePath: imported.sourcePath,
        libraryPath: imported.libraryPath,
      }, 0);
    } catch (e) {
      error = String(e);
      debug = "Err";
    } finally {
      bookImportBusy = false;
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

  async function forgetBook(book: BookRecord) {
    const title = book.title || "this book";
    const message = book.bookId
      ? `Forget "${title}" from the bookshelf?\n\nThe app-owned EPUB copy will be removed. The original EPUB file is not touched.`
      : `Forget "${title}" from the bookshelf?`;
    if (!window.confirm(message)) return;

    try {
      if (book.bookId && isTauriRuntime()) {
        await invoke<LibraryBookRecord[]>("library_forget_book", { bookId: book.bookId });
      }
      books = await forgetReadingBook(book, isTauriRuntime());
      error = "";
      debug = "Forgot book";
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function loadChapter(idx: number, chapterProgress = 0) {
    if (!meta || !isTauriRuntime()) return;

    try {
      closeReaderSelection();
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
    closeReaderSelection();
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
    closeReaderSelection();
    showToc = false;
    await loadChapter(idx, 0);
  }

  function prevChapter() {
    if (chapterIndex > 0) {
      startAtEnd = true;
      closeReaderSelection();
      loadChapter(chapterIndex - 1, 1);
    }
  }

  function prevChapterDirect() {
    if (chapterIndex > 0) {
      startAtEnd = false;
      closeReaderSelection();
      loadChapter(chapterIndex - 1, 0);
    }
  }

  function nextChapter() {
    startAtEnd = false;
    closeReaderSelection();
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

  async function refreshDictionaries() {
    if (!isTauriRuntime()) {
      dictionaryListError = "Dictionary management requires Tauri runtime.";
      return;
    }

    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      const [entries, status] = await Promise.all([
        invoke<DictionaryManifestEntry[]>("dictionary_list"),
        invoke<DictionaryStatus>("dict_status"),
      ]);
      dictionaryList = entries;
      dictionaryListStatus = status;
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  function defaultAnkiSettings(): AnkiSettings {
    return {
      version: 1,
      endpoint: "http://127.0.0.1:8765",
      selectedDeck: null,
      selectedNoteType: null,
      decks: [],
      noteTypes: [],
      fieldMappings: [],
      lastFetchedAt: null,
    };
  }

  async function loadAnkiSettings() {
    if (!isTauriRuntime()) {
      ankiError = "AnkiConnect settings require Tauri runtime.";
      return;
    }
    ankiError = "";
    try {
      const settings = await invoke<AnkiSettings>("anki_load_settings");
      ankiSettings = settings;
      ankiEndpointDraft = settings.endpoint;
    } catch (e) {
      ankiError = String(e);
    }
  }

  async function saveAnkiSettings() {
    if (!isTauriRuntime()) {
      ankiError = "AnkiConnect settings require Tauri runtime.";
      return;
    }
    if (ankiBusy) return;
    ankiBusy = true;
    ankiError = "";
    try {
      const next = await invoke<AnkiSettings>("anki_save_settings", {
        settings: { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft },
      });
      ankiSettings = next;
      ankiEndpointDraft = next.endpoint;
      ankiStatus = "AnkiConnect settings saved.";
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  async function pingAnkiConnect() {
    if (!isTauriRuntime()) {
      ankiError = "AnkiConnect requires Tauri runtime.";
      return;
    }
    if (ankiBusy) return;
    ankiBusy = true;
    ankiError = "";
    try {
      const status = await invoke<AnkiConnectionStatus>("anki_ping", { endpoint: ankiEndpointDraft });
      ankiStatus = status.version ? `${status.message} Version ${status.version}.` : status.message;
      if (!status.ok) ankiError = status.message;
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  async function fetchAnkiConfig() {
    if (!isTauriRuntime()) {
      ankiError = "AnkiConnect requires Tauri runtime.";
      return;
    }
    if (ankiBusy) return;
    ankiBusy = true;
    ankiError = "";
    try {
      const settings = await invoke<AnkiSettings>("anki_fetch_config", { endpoint: ankiEndpointDraft });
      ankiSettings = { ...settings, fieldMappings: pruneFieldMappings(settings) };
      ankiEndpointDraft = settings.endpoint;
      ankiStatus = `Fetched ${settings.decks.length} decks and ${settings.noteTypes.length} note types.`;
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  async function selectAnkiDeck(deck: string) {
    if (!deck || ankiBusy) return;
    const next = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft, selectedDeck: deck };
    ankiSettings = next;
    await saveAnkiSettings();
  }

  async function selectAnkiNoteType(noteType: string) {
    if (!noteType || ankiBusy) return;
    const changed = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft, selectedNoteType: noteType };
    const next = { ...changed, fieldMappings: pruneFieldMappings(changed) };
    ankiSettings = next;
    await saveAnkiSettings();
  }

  async function setAnkiFieldTemplate(field: string, template: string) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    const next = { ...base, fieldMappings: upsertFieldTemplate(base.fieldMappings, field, template) };
    ankiSettings = next;
    await saveAnkiSettings();
  }

  function closeReaderSelection() {
    window.getSelection()?.removeAllRanges();
    readerSelection = null;
    lookupPopups = [];
    lookupRequestId += 1;
  }

  function lookupStatusMessage(status: DictionaryStatus): string {
    if (status.status === "noDictionaries") return status.message || "No dictionaries are imported yet.";
    if (status.status === "engineUnavailable") {
      return status.message || "Dictionary engine unavailable. Check CMake/C++ tooling and hoshidicts linkage.";
    }
    return status.message || "Dictionary status could not be read.";
  }

  function lookupStateForStatus(status: DictionaryStatus): LookupState {
    if (status.status === "noDictionaries") return "noDictionaries";
    if (status.status === "engineUnavailable") return "engineUnavailable";
    if (status.status === "error") return "error";
    return "ready";
  }

  function buildAnkiPayload(selection: ReaderSelection, result: DictResult, resultIndex: number): LookupAnkiPayload {
    return {
      selectedText: selection.text,
      resultIndex,
      expression: result.expression,
      reading: result.reading,
      glossary: result.glossary,
      dictionary: resultDictionaryLabel(result),
      matched: result.matched,
      deinflected: result.deinflected,
      rules: result.rules,
      frequencies: result.frequencies,
      pitches: result.pitches,
      media: extractDictionaryMediaReferences(result.glossary),
      sourceBook: {
        title: meta?.title ?? null,
        bookId: currentBookLocator?.bookId,
        path: currentBookLocator?.path,
        sourcePath: currentBookLocator?.sourcePath,
        libraryPath: currentBookLocator?.libraryPath,
      },
      sourceChapter: {
        chapterIndex,
        chapterNumber: chapterIndex + 1,
        totalChapters: meta?.spine.length ?? 0,
        idref: meta?.spine[chapterIndex]?.idref ?? null,
      },
    };
  }

  async function importDictionary() {
    if (dictionaryBusy) return;
    try {
      if (!isTauriRuntime()) {
        dictionaryStatus = "Dictionary import requires Tauri runtime.";
        return;
      }

      dictionaryBusy = true;
      dictionaryStatus = "Importing dictionary...";
      const selected = await open({
        multiple: false,
        filters: [{ name: "Yomitan Dictionary", extensions: ["zip"] }],
      });
      if (!selected) {
        dictionaryStatus = "Dictionary import cancelled.";
        return;
      }

      const imported = await invoke<DictImportSummary>("dictionary_import_yomitan_zip", { zipPath: selected });
      const reused = imported.reused ? "Reused" : "Imported";
      const ready = imported.ready ? "ready" : "not ready";
      dictionaryStatus = `${reused} ${imported.title} (${imported.termCount} terms, ${ready}).`;
      await refreshDictionaries();
      reloadLookupPopups();
    } catch (e) {
      dictionaryStatus = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  function lookupAnkiTitle(selection: ReaderSelection, result: DictResult, resultIndex: number): string {
    return `Payload prepared for ${buildAnkiPayload(selection, result, resultIndex).sourceBook.title ?? "current book"}`;
  }

  async function addAnkiNote(note: AnkiNoteRequest): Promise<AnkiAddNoteResult> {
    if (!isTauriRuntime()) throw new Error("Anki note creation requires Tauri runtime.");
    return invoke<AnkiAddNoteResult>("anki_add_note", { note });
  }

  async function storeAnkiMedia(media: AnkiDictionaryMediaRef[]): Promise<AnkiStoreMediaResult> {
    if (!isTauriRuntime()) throw new Error("Anki media storage requires Tauri runtime.");
    const endpoint = ankiSettings?.endpoint;
    if (!endpoint) throw new Error("Anki endpoint is not configured.");
    return invoke<AnkiStoreMediaResult>("anki_store_dictionary_media", { endpoint, media });
  }

  async function setDictionaryEnabled(dictionary: DictionaryManifestEntry, enabled: boolean) {
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      const status = await invoke<DictionaryStatus>("dictionary_set_enabled", { dictId: dictionary.dictId, enabled });
      dictionaryListStatus = status;
      await refreshDictionaries();
      reloadLookupPopups();
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  async function moveDictionary(dictionary: DictionaryManifestEntry, direction: -1 | 1) {
    const currentIndex = dictionaryList.findIndex((entry) => entry.dictId === dictionary.dictId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= dictionaryList.length) return;

    const reordered = [...dictionaryList];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      dictionaryList = await invoke<DictionaryManifestEntry[]>("dictionary_set_order", {
        dictIds: reordered.map((entry) => entry.dictId),
      });
      dictionaryListStatus = await invoke<DictionaryStatus>("dict_status");
      reloadLookupPopups();
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  function backToShelf() {
    closeReaderSelection();
    view = "bookshelf";
  }

  function toggleToc() {
    closeReaderSelection();
    showToc = !showToc;
  }

  function updateLookupPopup(id: string, update: Partial<LookupPopupItem>) {
    lookupPopups = lookupPopups.map((popup) => popup.id === id ? { ...popup, ...update } : popup);
  }

  function popupIndex(id: string): number {
    return lookupPopups.findIndex((popup) => popup.id === id);
  }

  function nextLookupRequestId(): number {
    lookupRequestId += 1;
    return lookupRequestId;
  }

  function createLookupPopup(id: string, selection: ReaderSelection, requestId: number): LookupPopupItem {
    return {
      id,
      selection,
      state: "loading",
      error: "",
      results: [],
      requestId,
      clearSelectionSignal: 0,
      historyBack: [],
      historyForward: [],
      restoreScrollTop: 0,
      restoreScrollSignal: 0,
    };
  }

  function popupResultsScrollTop(id: string): number {
    const popup = [...document.querySelectorAll<HTMLElement>(".lookup-pop")]
      .find((element) => element.dataset.popupId === id);
    return popup?.querySelector<HTMLElement>(".lookup-results")?.scrollTop ?? 0;
  }

  function clearPopupChildren(parentId: string, clearParentSelection = true) {
    const index = popupIndex(parentId);
    if (index < 0) return;
    lookupPopups = lookupPopups
      .slice(0, index + 1)
      .map((popup, popupIndex) => (
        clearParentSelection && popupIndex === index
          ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 }
          : popup
      ));
  }

  function reloadLookupPopups() {
    const reloaded: LookupPopupItem[] = lookupPopups.map((popup) => {
      const requestId = nextLookupRequestId();
      return { ...popup, state: "loading", error: "", results: [], requestId };
    });
    lookupPopups = reloaded;
    for (const popup of reloaded) {
      void lookupSelection(popup.id, popup.selection, popup.requestId);
    }
  }

  function openRootLookup(selection: ReaderSelection) {
    const requestId = nextLookupRequestId();
    readerSelection = selection;
    lookupPopups = [createLookupPopup("root", selection, requestId)];
    void lookupSelection("root", selection, requestId);
  }

  function openChildLookup(parentId: string, selection: ReaderSelection) {
    const index = popupIndex(parentId);
    if (index < 0) return;

    const childId = `popup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const requestId = nextLookupRequestId();
    lookupPopups = [
      ...lookupPopups.slice(0, index + 1).map((popup, popupIndex) => (
        popupIndex === index ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 } : popup
      )),
      createLookupPopup(childId, selection, requestId),
    ];
    void lookupSelection(childId, selection, requestId);
  }

  function closePopup(id: string) {
    const index = popupIndex(id);
    if (index < 0) return;
    lookupRequestId += 1;
    if (index === 0) {
      closeReaderSelection();
      return;
    }

    lookupPopups = lookupPopups
      .slice(0, index)
      .map((popup, popupIndex) => (
        popupIndex === index - 1
          ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 }
          : popup
      ));
  }

  function handleReaderSelection(selection: ReaderSelection | null) {
    if (!selection) {
      closeReaderSelection();
      return;
    }

    openRootLookup(selection);
  }

  function handleNestedPopupLookup(parentId: string, selection: ReaderSelection) {
    openChildLookup(parentId, selection);
  }

  function handleRedirectPopupLookup(popupId: string, selection: ReaderSelection) {
    const index = popupIndex(popupId);
    if (index < 0) return;
    const popup = lookupPopups[index];
    const requestId = nextLookupRequestId();
    const scrollTop = popupResultsScrollTop(popupId);
    const redirectedSelection = {
      ...selection,
      rect: popup.selection.rect,
      anchorRect: popup.selection.anchorRect,
    };

    lookupPopups = lookupPopups
      .slice(0, index + 1)
      .map((item, itemIndex) => (
        itemIndex === index
          ? {
              ...item,
              selection: redirectedSelection,
              state: "loading",
              error: "",
              results: [],
              requestId,
              clearSelectionSignal: item.clearSelectionSignal + 1,
              historyBack: [...item.historyBack, { selection: item.selection, scrollTop }],
              historyForward: [],
              restoreScrollTop: 0,
              restoreScrollSignal: item.restoreScrollSignal + 1,
            }
          : item
      ));
    void lookupSelection(popupId, redirectedSelection, requestId);
  }

  function handlePopupHistoryNavigation(popupId: string, direction: "back" | "forward") {
    const index = popupIndex(popupId);
    if (index < 0) return;
    const popup = lookupPopups[index];
    const from = direction === "back" ? popup.historyBack : popup.historyForward;
    if (from.length === 0) return;

    const current = { selection: popup.selection, scrollTop: popupResultsScrollTop(popupId) };
    const target = from[from.length - 1];
    const requestId = nextLookupRequestId();
    lookupPopups = lookupPopups
      .slice(0, index + 1)
      .map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        return {
          ...item,
          selection: target.selection,
          state: "loading",
          error: "",
          results: [],
          requestId,
          clearSelectionSignal: item.clearSelectionSignal + 1,
          historyBack: direction === "back"
            ? item.historyBack.slice(0, -1)
            : [...item.historyBack, current],
          historyForward: direction === "back"
            ? [...item.historyForward, current]
            : item.historyForward.slice(0, -1),
          restoreScrollTop: target.scrollTop,
          restoreScrollSignal: item.restoreScrollSignal + 1,
        };
      });
    void lookupSelection(popupId, target.selection, requestId);
  }

  function handlePopupScrolled(parentId: string) {
    clearPopupChildren(parentId, true);
  }

  async function lookupSelection(popupId: string, selection: ReaderSelection, requestId: number) {
    const isCurrent = () => lookupPopups.some((popup) => popup.id === popupId && popup.requestId === requestId);
    if (!isTauriRuntime()) {
      if (!isCurrent()) return;
      updateLookupPopup(popupId, {
        state: "error",
        error: "Dictionary lookup requires Tauri runtime.",
        results: [],
      });
      return;
    }

    try {
      const status = await invoke<DictionaryStatus>("dict_status");
      if (!isCurrent()) return;
      if (status.status !== "ready") {
        updateLookupPopup(popupId, {
          state: lookupStateForStatus(status),
          error: lookupStatusMessage(status),
          results: [],
        });
        return;
      }

      const results = await invoke<DictResult[]>("dict_lookup", { text: selection.text });
      if (!isCurrent()) return;
      updateLookupPopup(popupId, {
        state: results.length > 0 ? "ready" : "empty",
        error: "",
        results,
      });
    } catch (e) {
      if (!isCurrent()) return;
      updateLookupPopup(popupId, {
        state: "error",
        error: String(e),
        results: [],
      });
    }
  }

  function readerBottomBoundary(): number {
    const controls = document.querySelector<HTMLElement>(".ctrls");
    const readerViewport = document.querySelector<HTMLElement>(".rv");
    const controlsTop = controls?.getBoundingClientRect().top ?? window.innerHeight;
    const readerBottom = readerViewport?.getBoundingClientRect().bottom ?? window.innerHeight;
    return Math.min(window.innerHeight, controlsTop, readerBottom);
  }

  function measureLookupPopup(node: HTMLElement, popupId: string) {
    let id = popupId;

    const sync = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextSize = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      const previous = lookupPopupSizes[id];
      if (previous?.width === nextSize.width && previous?.height === nextSize.height) return;
      lookupPopupSizes = { ...lookupPopupSizes, [id]: nextSize };
    };

    const observer = new ResizeObserver(sync);
    observer.observe(node);
    const frame = requestAnimationFrame(sync);

    return {
      update(nextId: string) {
        if (nextId === id) return;
        const { [id]: _removed, ...rest } = lookupPopupSizes;
        lookupPopupSizes = rest;
        id = nextId;
        sync();
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        const { [id]: _removed, ...rest } = lookupPopupSizes;
        lookupPopupSizes = rest;
      },
    };
  }

  function popupStyle(popupId: string, selection: ReaderSelection): string {
    const measuredSize = lookupPopupSizes[popupId];
    return lookupPopupStyle(selection, measuredSize ?? { width: 306, height: 154 }, {
      width: window.innerWidth,
      bottom: readerBottomBoundary(),
    });
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
        <div class="head-actions">
          <button class="secondary-action" onclick={() => showAnkiPanel = !showAnkiPanel}>
            Anki
          </button>
          <button class="secondary-action" onclick={() => showDictionaryManager = !showDictionaryManager}>
            Dictionaries
          </button>
          <button class="secondary-action" disabled={dictionaryBusy} onclick={importDictionary}>Import Dictionary</button>
          <button class="ob" disabled={bookImportBusy} onclick={openBook}>
            {bookImportBusy ? "Importing..." : "Open EPUB"}
          </button>
        </div>
      </div>

      {#if error}<p class="err">{error}</p>{/if}
      {#if dictionaryStatus}<p class="dict-status">{dictionaryStatus}</p>{/if}

      {#if showDictionaryManager}
        <DictionaryManagementPanel
          dictionaries={dictionaryList}
          status={dictionaryListStatus}
          error={dictionaryListError}
          busy={dictionaryBusy}
          onRefresh={refreshDictionaries}
          onImport={importDictionary}
          onSetEnabled={setDictionaryEnabled}
          onMove={moveDictionary}
        />
      {/if}

      {#if showAnkiPanel}
        <AnkiConnectPanel
          settings={ankiSettings}
          endpoint={ankiEndpointDraft}
          status={ankiStatus}
          error={ankiError}
          busy={ankiBusy}
          onEndpointChange={(endpoint) => ankiEndpointDraft = endpoint}
          onPing={pingAnkiConnect}
          onFetch={fetchAnkiConfig}
          onSave={saveAnkiSettings}
          onSelectDeck={selectAnkiDeck}
          onSelectNoteType={selectAnkiNoteType}
          onSetFieldTemplate={setAnkiFieldTemplate}
        />
      {/if}

      <div class="recent">
        <h2>Recent Books</h2>
        {#if books.length === 0}
          <p class="empty">No recent books yet.</p>
        {:else}
          <div class="book-list">
            {#each books as book (bookRecordKey(book))}
              <div class="book-row">
                <button class="book-open" onclick={() => continueBook(book)}>
                  <span class="book-title">{book.title}</span>
                  <span class="book-meta">{progressLabel(book)} | {openedLabel(book.lastOpened)}</span>
                  <span class="book-path">{bookRecordPath(book)}</span>
                </button>
                <button class="book-forget" title="Forget book" onclick={() => forgetBook(book)}>Forget</button>
              </div>
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
      onSelectionChange={handleReaderSelection}
      {startAtEnd}
    />
    {#each lookupPopups as popup, popupIndex (popup.id)}
      <aside
        class="lookup-pop"
        data-popup-id={popup.id}
        use:measureLookupPopup={popup.id}
        style={`${popupStyle(popup.id, popup.selection)};--popup-z:${125 + popupIndex}`}
      >
        <LookupPopupContent
          popupId={popup.id}
          selection={popup.selection}
          state={popup.state}
          error={popup.error}
          results={popup.results}
          clearSelectionSignal={popup.clearSelectionSignal}
          onClose={closePopup}
          onImportDictionary={importDictionary}
          onNestedLookup={handleNestedPopupLookup}
          onRedirectLookup={handleRedirectPopupLookup}
          onScrolled={handlePopupScrolled}
          onNavigateHistory={handlePopupHistoryNavigation}
          canNavigateBack={popup.historyBack.length > 0}
          canNavigateForward={popup.historyForward.length > 0}
          restoreScrollTop={popup.restoreScrollTop}
          restoreScrollSignal={popup.restoreScrollSignal}
          ankiTitle={(result, resultIndex) => lookupAnkiTitle(popup.selection, result, resultIndex)}
          ankiSettings={ankiSettings}
          buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(popup.selection, result, resultIndex)}
          onStoreAnkiMedia={storeAnkiMedia}
          onAddAnkiNote={addAnkiNote}
        />
      </aside>
    {/each}
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
  .head-actions { flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
  .ob { flex-shrink: 0; padding: 10px 22px; font-size: 14px; background: #3b8f78; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  .ob:hover { background: #46a187; }
  .secondary-action { flex-shrink: 0; padding: 10px 16px; font-size: 14px; background: #303134; color: #d7d9dc; border: 1px solid #555c64; border-radius: 4px; cursor: pointer; }
  .secondary-action:hover { background: #3a3d41; }
  .ob:disabled,
  .secondary-action:disabled { color: #858b91; cursor: default; opacity: 0.72; }
  .ob:disabled:hover { background: #3b8f78; }
  .secondary-action:disabled:hover { background: #303134; }
  .err { color: #ff8a80; font-size: 13px; white-space: pre-wrap; }
  .dict-status { color: #b7bcc3; font-size: 13px; white-space: pre-wrap; }
  .recent { display: flex; flex-direction: column; gap: 10px; min-height: 240px; }
  .empty { padding: 28px 0; color: #80868b; font-size: 13px; }
  .book-list { display: flex; flex-direction: column; gap: 8px; max-height: 54vh; overflow-y: auto; padding-right: 4px; }
  .book-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: 8px; background: #2b2d31; color: inherit; border: 1px solid #3c4043; border-radius: 6px; }
  .book-row:hover { background: #32363b; border-color: #5f6368; }
  .book-open { min-width: 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; padding: 12px 14px; text-align: left; background: transparent; color: inherit; border: none; cursor: pointer; }
  .book-forget { align-self: center; margin-right: 8px; padding: 5px 9px; background: #303134; color: #c5c9ce; border: 1px solid #555c64; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .book-forget:hover { background: #3a3d41; color: #fff; }
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
  .lookup-pop { position: fixed; z-index: var(--popup-z); display: flex; flex-direction: column; gap: 8px; max-height: min(520px, calc(100vh - 92px)); padding: 10px 12px; background: #23262a; color: #e8eaed; border: 1px solid #4b5056; border-radius: 6px; box-shadow: 0 14px 38px rgba(0, 0, 0, 0.42); overflow: hidden; }
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: #111; border-top: 1px solid #333; z-index: 100; }
  .ctrls button { padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: #444; }
  .ctrls span { font-size: 12px; color: #888; }
  @media (max-width: 640px) {
    .bookshelf { width: min(100vw - 32px, 920px); }
    .shelf-head { align-items: stretch; flex-direction: column; gap: 14px; }
    .head-actions { flex-wrap: wrap; }
    .head-actions button { flex: 1 1 148px; }
  }
</style>
