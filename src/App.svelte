<script lang="ts">
  import { convertFileSrc, invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { ankiHandlebarOptions, applyKnownNoteTypeDefaultsIfUnmapped, extractDictionaryMediaReferences, upsertFieldTemplate } from "./lib/anki-field-renderer";
  import BookshelfView from "./lib/BookshelfView.svelte";
  import {
    readerThemeLabels,
  } from "./lib/appearance";
  import { clearDictionaryStyleCache, preloadCachedDictionaryStyles } from "./lib/dictionary-style-cache";
  import { beginLookupPerformance, discardLookupPerformance, markLookupPerformance } from "./lib/lookup-performance";
  import { LookupResultCache } from "./lib/lookup-result-cache";
  import { dictionaryBatchStatusLabel } from "./lib/dictionary-import-status";
  import { resolveChapterAssets } from "./lib/epub-assets";
  import LookupPopupLayer, { type LookupPopupItem } from "./lib/LookupPopupLayer.svelte";
  import { resultDictionaryLabel, type LookupState } from "./lib/lookup-popup";
  import { clearLookupHighlight, READER_LOOKUP_HIGHLIGHT } from "./lib/lookup-highlight";
  import Reader from "./lib/reader/Reader.svelte";
  import ReaderControls from "./lib/ReaderControls.svelte";
  import SasayakiPlayerPanel from "./lib/SasayakiPlayerPanel.svelte";
  import {
    clampPlaybackTime,
    cuePresentationAtTime,
    sasayakiSkipTarget,
    shouldAutoPauseSasayaki,
  } from "./lib/sasayaki-playback";
  import { createSettingsState } from "./lib/state/settings.svelte";
  import {
    buildReadingProgressUpdate,
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
  import TocPanel from "./lib/TocPanel.svelte";
  import type {
    AnkiConnectionStatus,
    AnkiAddNoteResult,
    AnkiAudioSource,
    AnkiDictionaryMediaRef,
    AnkiNoteRequest,
    AnkiSettings,
    AnkiStoreMediaResult,
    AnkiStoreBookCoverResult,
    AnkiStoreRemoteAudioResult,
    AnkiStoreSasayakiAudioResult,
    WordAudioPlaybackResult,
    WordAudioResolveRequest,
    DictImportBatchSummary,
    DictResult,
    DictionaryManifestEntry,
    DictionaryStatus,
    EpubMeta,
    LookupAnkiPayload,
    LocalAudioStatus,
    ReaderProgress,
    ReaderSelection,
    SasayakiCueItem,
    SasayakiCuePage,
    SasayakiPlaybackCue,
    SasayakiPlaybackSession,
    SasayakiSkipAction,
    SasayakiStatus,
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
  let readerLookupHighlightCount = $state(0);
  let readerLookupHighlightSignal = $state(0);
  let lookupPopups = $state<LookupPopupItem[]>([]);
  const settings = createSettingsState();
  let lookupRequestId = 0;
  let showToc = $state(false);
  let error = $state("");
  let dictionaryStatus = $state("");
  let dictionaryList = $state<DictionaryManifestEntry[]>([]);
  let dictionaryListStatus = $state<DictionaryStatus | null>(null);
  let dictionaryListError = $state("");
  let dictionaryBusy = $state(false);
  let ankiSettings = $state<AnkiSettings | null>(null);
  let ankiEndpointDraft = $state("http://127.0.0.1:8765");
  let ankiStatus = $state("");
  let ankiError = $state("");
  let ankiBusy = $state(false);
  let localAudioStatus = $state<LocalAudioStatus>({ imported: false, sizeBytes: null, sources: [] });
  let sasayakiBookId = $state<string | null>(null);
  let sasayakiStatus = $state<SasayakiStatus | null>(null);
  let sasayakiCues = $state<SasayakiCueItem[]>([]);
  let sasayakiMessage = $state("");
  let sasayakiError = $state("");
  let sasayakiBusy = $state(false);
  let sasayakiBusyBookId = $state<string | null>(null);
  let sasayakiRequestId = 0;
  let sasayakiPlayback = $state<SasayakiPlaybackSession | null>(null);
  let sasayakiPlaybackOpen = $state(false);
  let sasayakiPlaying = $state(false);
  let sasayakiCurrentTime = $state(0);
  let sasayakiDuration = $state(0);
  let sasayakiPlaybackError = $state("");
  let sasayakiAudio: HTMLAudioElement | null = null;
  let sasayakiPlaybackBookId: string | null = null;
  let sasayakiLastSavedAt = 0;
  let sasayakiSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let sasayakiSuppressPauseSave = false;
  let sasayakiSaveChain: Promise<void> = Promise.resolve();
  let sasayakiActiveCue = $state<SasayakiPlaybackCue | null>(null);
  let sasayakiCueReveal = $state(false);
  let sasayakiCueSignal = $state(0);
  let sasayakiHasPlayedOnce = false;
  let sasayakiPausedByLookup = false;
  let sasayakiLookupResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let sasayakiCueNavigationRun = 0;
  let bookImportBusy = $state(false);
  let debug = $state("");
  let triedStartup = false;
  let triedDictionaryList = false;
  let triedAnkiSettings = false;
  let progressSaveVersion = 0;
  let cachedReadyDictionaryStatus: DictionaryStatus | null = null;
  let lookupSettingsCacheKey = "";
  const lookupResultCache = new LookupResultCache<DictResult>(32);

  let tocEntries = $derived(meta ? flattenToc(meta.toc, meta) : []);
  let chapterBookInfo = $derived(meta?.book_info.chapter_info[chapterIndex] ?? null);
  let ankiTemplateOptions = $derived(ankiHandlebarOptions(dictionaryList.map((dictionary) => dictionary.title)));

  // Initialize persisted reading state once. Returning to the shelf should stay
  // on the shelf, so session restore remains intentionally one-shot.
  $effect(() => {
    if (triedStartup) return;
    triedStartup = true;
    if (!isTauriRuntime()) return;
    const shouldReopenLastBook = settings.advancedSettings.reopenLastBookOnStartup;

    (async () => {
      try {
        const readingState = await importLegacyReadingState(true);
        books = await mergeCurrentLibraryBooks(readingState.books);

        const session = readingState.session;
        if (shouldReopenLastBook && session && view === "bookshelf") {
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
    void refreshLocalAudioStatus();
  });

  $effect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void getCurrentWindow().onCloseRequested(async (event) => {
      event.preventDefault();
      await stopSasayakiPlayback(true);
      await getCurrentWindow().destroy();
    }).then((next) => {
      if (disposed) next();
      else unlisten = next;
    });
    return () => {
      disposed = true;
      unlisten?.();
      teardownSasayakiAudio();
    };
  });

  $effect(() => {
    const nextKey = `${settings.dictionarySettings.maxResults}:${settings.dictionarySettings.scanLength}`;
    if (!lookupSettingsCacheKey) {
      lookupSettingsCacheKey = nextKey;
      return;
    }
    if (nextKey === lookupSettingsCacheKey) return;
    lookupSettingsCacheKey = nextKey;
    invalidateDictionaryLookupCaches();
    reloadLookupPopups();
  });

  function saveProgress(
    locator: BookLocator,
    bookMeta: EpubMeta,
    chapter: number,
    progress: ReaderProgress | null = currentReaderProgress,
    chapterProgressFallback = 0,
  ) {
    const existingBook = books.find((book) => (
      locator.bookId
        ? book.bookId === locator.bookId
        : book.path === locator.path
    ));
    const update = buildReadingProgressUpdate(
      { ...locator, coverPath: locator.coverPath ?? existingBook?.coverPath },
      bookMeta,
      chapter,
      progress,
      chapterProgressFallback,
    );
    books = upsertReadingProgressBook(books, update.record);
    const saveVersion = ++progressSaveVersion;
    void persistReadingProgress(update.record, update.session, isTauriRuntime())
      .then(async (savedBooks) => {
        if (saveVersion !== progressSaveVersion) return;
        books = await mergeCurrentLibraryBooks(savedBooks);
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

    if (sasayakiPlaybackBookId && sasayakiPlaybackBookId !== locator.bookId) {
      await stopSasayakiPlayback(true);
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
    await prepareSasayakiPlayback(locator.bookId ?? null);
  }

  async function openBookPath(path: string, chapter = 0, status = "Opening...", chapterProgress = 0) {
    await openBookLocator({ path }, chapter, status, chapterProgress);
  }

  async function mergeCurrentLibraryBooks(readingBooks: BookRecord[]): Promise<BookRecord[]> {
    if (!isTauriRuntime()) return readingBooks;
    const libraryBooks = await invoke<LibraryBookRecord[]>("library_list_books");
    return mergeLibraryBooks(readingBooks, libraryBooks);
  }

  async function refreshLibraryBooks() {
    books = await mergeCurrentLibraryBooks(books);
  }

  function fileNameForStatus(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  function epubImportStatus(importedCount: number, totalCount: number, failures: string[]): string {
    if (failures.length === 0) {
      return importedCount === 1 ? "Imported 1 EPUB." : `Imported ${importedCount} EPUBs.`;
    }

    const failureDetails = failures.map((failure) => `- ${failure}`).join("\n");
    return `Imported ${importedCount} of ${totalCount} EPUBs.\nFailed:\n${failureDetails}`;
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
        multiple: true,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (!selected) {
        debug = "Import cancelled.";
        return;
      }

      const sourcePaths = Array.isArray(selected) ? selected : [selected];
      if (sourcePaths.length === 0) {
        debug = "Import cancelled.";
        return;
      }

      debug = sourcePaths.length === 1 ? "Importing..." : `Importing ${sourcePaths.length} EPUBs...`;
      error = "";
      const importedBooks: LibraryBookRecord[] = [];
      const failures: string[] = [];
      for (const sourcePath of sourcePaths) {
        try {
          const imported = await invoke<LibraryBookRecord>("library_import_epub", { sourcePath });
          importedBooks.push(imported);
        } catch (e) {
          failures.push(`${fileNameForStatus(sourcePath)}: ${String(e)}`);
        }
      }

      await refreshLibraryBooks();
      const status = epubImportStatus(importedBooks.length, sourcePaths.length, failures);
      debug = failures.length === 0 ? status : "Import finished with errors.";
      if (failures.length > 0) error = status;
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
    try {
      progressSaveVersion += 1;
      if (book.bookId && isTauriRuntime()) {
        await invoke<LibraryBookRecord[]>("library_forget_book", { bookId: book.bookId });
      }
      const readingBooks = await forgetReadingBook(book, isTauriRuntime());
      books = await mergeCurrentLibraryBooks(readingBooks);
      if (book.bookId && sasayakiBookId === book.bookId) {
        sasayakiRequestId += 1;
        sasayakiBookId = null;
        sasayakiStatus = null;
        sasayakiCues = [];
        sasayakiMessage = "";
        sasayakiError = "";
      }
      error = "";
      debug = "Forgot book";
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function loadSasayaki(book: BookRecord) {
    if (!book.bookId) return;
    const requestId = ++sasayakiRequestId;
    sasayakiBookId = book.bookId;
    sasayakiStatus = null;
    sasayakiCues = [];
    sasayakiMessage = "Loading Sasayaki status...";
    sasayakiError = "";
    if (!isTauriRuntime()) {
      sasayakiMessage = "";
      sasayakiError = "Sasayaki setup requires Tauri runtime.";
      return;
    }
    try {
      const next = await invoke<SasayakiStatus>("sasayaki_status", { bookId: book.bookId });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      sasayakiMessage = sasayakiStatus.configured
        ? "Sasayaki audio and subtitles are ready to match."
        : "Choose linked or copied audio, then select its UTF-8 SRT subtitles.";
      if (next.configured) {
        const page = await invoke<SasayakiCuePage>("sasayaki_list_cues", {
          bookId: book.bookId,
          offset: 0,
          limit: 100,
        });
        if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
        sasayakiCues = page.items;
      }
    } catch (e) {
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    }
  }

  async function importSasayaki(book: BookRecord, copyAudio: boolean) {
    if (!book.bookId || sasayakiBusy) return;
    if (!isTauriRuntime()) {
      sasayakiError = "Sasayaki import requires Tauri runtime.";
      return;
    }
    let requestId: number | null = null;
    try {
      const audio = await open({
        multiple: false,
        filters: [{ name: "Sasayaki audio", extensions: ["m4b", "mp3", "wav"] }],
      });
      if (!audio || Array.isArray(audio)) return;
      const srt = await open({
        multiple: false,
        filters: [{ name: "Sasayaki subtitles", extensions: ["srt"] }],
      });
      if (!srt || Array.isArray(srt)) return;

      requestId = ++sasayakiRequestId;
      sasayakiBookId = book.bookId;
      sasayakiBusy = true;
      sasayakiBusyBookId = book.bookId;
      sasayakiError = "";
      sasayakiMessage = copyAudio
        ? "Copying and validating Sasayaki audio and subtitles..."
        : "Linking and validating Sasayaki audio and subtitles...";
      const next = await invoke<SasayakiStatus>("sasayaki_import", {
        bookId: book.bookId,
        audioSourcePath: audio,
        srtSourcePath: srt,
        copyAudio,
      });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      sasayakiCues = [];
      sasayakiMessage = copyAudio
        ? "Copied Sasayaki audio and subtitles into app storage."
        : "Linked the external audiobook and copied its subtitles into app storage.";
    } catch (e) {
      if (
        sasayakiBookId !== book.bookId
        || (requestId !== null && requestId !== sasayakiRequestId)
      ) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    } finally {
      if (sasayakiBusyBookId === book.bookId) {
        sasayakiBusy = false;
        sasayakiBusyBookId = null;
      }
    }
  }

  async function refreshSasayakiCues(book: BookRecord) {
    if (!book.bookId || !isTauriRuntime()) return;
    const page = await invoke<SasayakiCuePage>("sasayaki_list_cues", {
      bookId: book.bookId,
      offset: 0,
      limit: 100,
    });
    if (sasayakiBookId === book.bookId) sasayakiCues = page.items;
  }

  async function rematchSasayaki(book: BookRecord, searchWindow: number) {
    if (!book.bookId || sasayakiBusy || !isTauriRuntime()) return;
    const requestId = ++sasayakiRequestId;
    sasayakiBusy = true;
    sasayakiBusyBookId = book.bookId;
    sasayakiError = "";
    sasayakiMessage = "Matching subtitle cues to this EPUB...";
    try {
      const next = await invoke<SasayakiStatus>("sasayaki_rematch", {
        bookId: book.bookId,
        searchWindow,
      });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      await refreshSasayakiCues(book);
      sasayakiMessage = `Matched ${next.matchedCount} of ${next.cueCount} cues.`;
    } catch (e) {
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    } finally {
      if (sasayakiBusyBookId === book.bookId) {
        sasayakiBusy = false;
        sasayakiBusyBookId = null;
      }
    }
  }

  async function correctSasayakiCue(
    book: BookRecord,
    cueId: string,
    chapterIndex: number,
    start: number,
    length: number,
  ) {
    if (!book.bookId || sasayakiBusy || !isTauriRuntime()) return;
    const requestId = ++sasayakiRequestId;
    sasayakiBusy = true;
    sasayakiBusyBookId = book.bookId;
    sasayakiError = "";
    sasayakiMessage = `Saving correction for cue ${cueId}...`;
    try {
      const next = await invoke<SasayakiStatus>("sasayaki_correct_cue", {
        bookId: book.bookId,
        cueId,
        chapterIndex,
        start,
        length,
      });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      await refreshSasayakiCues(book);
      sasayakiMessage = `Saved correction for cue ${cueId}.`;
    } catch (e) {
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    } finally {
      if (sasayakiBusyBookId === book.bookId) {
        sasayakiBusy = false;
        sasayakiBusyBookId = null;
      }
    }
  }

  async function clearSasayakiCorrection(book: BookRecord, cueId: string) {
    if (!book.bookId || sasayakiBusy || !isTauriRuntime()) return;
    const requestId = ++sasayakiRequestId;
    sasayakiBusy = true;
    sasayakiBusyBookId = book.bookId;
    sasayakiError = "";
    sasayakiMessage = `Clearing correction for cue ${cueId}...`;
    try {
      const next = await invoke<SasayakiStatus>("sasayaki_clear_correction", {
        bookId: book.bookId,
        cueId,
      });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      await refreshSasayakiCues(book);
      sasayakiMessage = `Cleared correction for cue ${cueId}.`;
    } catch (e) {
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    } finally {
      if (sasayakiBusyBookId === book.bookId) {
        sasayakiBusy = false;
        sasayakiBusyBookId = null;
      }
    }
  }

  async function removeSasayaki(book: BookRecord) {
    if (!book.bookId || sasayakiBusy) return;
    if (!isTauriRuntime()) {
      sasayakiError = "Sasayaki removal requires Tauri runtime.";
      return;
    }
    const requestId = ++sasayakiRequestId;
    sasayakiBookId = book.bookId;
    sasayakiBusy = true;
    sasayakiBusyBookId = book.bookId;
    sasayakiError = "";
    sasayakiMessage = "Removing app-owned Sasayaki data...";
    try {
      const next = await invoke<SasayakiStatus>("sasayaki_remove", { bookId: book.bookId });
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiStatus = next;
      sasayakiCues = [];
      if (sasayakiPlaybackBookId === book.bookId) {
        await stopSasayakiPlayback(false);
        sasayakiPlayback = null;
        sasayakiPlaybackBookId = null;
      }
      sasayakiMessage = "Removed Sasayaki data. Linked external audio was not deleted.";
    } catch (e) {
      if (requestId !== sasayakiRequestId || sasayakiBookId !== book.bookId) return;
      sasayakiMessage = "";
      sasayakiError = String(e);
    } finally {
      if (sasayakiBusyBookId === book.bookId) {
        sasayakiBusy = false;
        sasayakiBusyBookId = null;
      }
    }
  }

  async function prepareSasayakiPlayback(bookId: string | null) {
    teardownSasayakiAudio();
    sasayakiPlaybackBookId = bookId;
    sasayakiPlayback = null;
    sasayakiPlaybackOpen = false;
    sasayakiCurrentTime = 0;
    sasayakiDuration = 0;
    sasayakiPlaybackError = "";
    sasayakiActiveCue = null;
    sasayakiCueReveal = false;
    sasayakiCueSignal += 1;
    sasayakiHasPlayedOnce = false;
    sasayakiPausedByLookup = false;
    if (sasayakiLookupResumeTimer) {
      clearTimeout(sasayakiLookupResumeTimer);
      sasayakiLookupResumeTimer = null;
    }
    sasayakiCueNavigationRun += 1;
    if (!bookId || !isTauriRuntime()) return;
    try {
      const session = await invoke<SasayakiPlaybackSession>("sasayaki_prepare_playback", { bookId });
      if (sasayakiPlaybackBookId !== bookId) return;
      sasayakiPlayback = session;
      sasayakiCurrentTime = session.lastPosition;
      syncSasayakiCuePresentation(false);
    } catch (e) {
      if (sasayakiPlaybackBookId === bookId) sasayakiPlaybackError = String(e);
    }
  }

  function teardownSasayakiAudio() {
    if (!sasayakiAudio) {
      sasayakiPlaying = false;
      sasayakiActiveCue = null;
      sasayakiCueReveal = false;
      sasayakiCueSignal += 1;
      return;
    }
    sasayakiAudio.onloadedmetadata = null;
    sasayakiAudio.ontimeupdate = null;
    sasayakiAudio.onplay = null;
    sasayakiAudio.onpause = null;
    sasayakiAudio.onended = null;
    sasayakiAudio.onerror = null;
    sasayakiSuppressPauseSave = true;
    sasayakiAudio.pause();
    sasayakiAudio.src = "";
    sasayakiAudio.load();
    sasayakiAudio = null;
    sasayakiPlaying = false;
    sasayakiSuppressPauseSave = false;
    sasayakiActiveCue = null;
    sasayakiCueReveal = false;
    sasayakiCueSignal += 1;
  }

  function syncSasayakiCuePresentation(forceReveal: boolean) {
    const session = sasayakiPlayback;
    const presentation = session
      ? cuePresentationAtTime(
          session.cues,
          sasayakiCurrentTime,
          session.delay,
          chapterIndex,
          session.autoScroll,
          sasayakiHasPlayedOnce,
          forceReveal,
        )
      : { cue: null, reveal: false, chapterToLoad: null };
    const { cue, reveal, chapterToLoad } = presentation;
    const cueChanged = cue?.id !== sasayakiActiveCue?.id;
    if (!cueChanged && !forceReveal && reveal === sasayakiCueReveal) return;

    sasayakiActiveCue = cue;
    sasayakiCueReveal = reveal;
    sasayakiCueSignal += 1;

    if (!cue || chapterToLoad === null) return;
    const run = ++sasayakiCueNavigationRun;
    startAtEnd = false;
    closeReaderSelection();
    void loadChapter(
      chapterToLoad,
      0,
      () => run === sasayakiCueNavigationRun && sasayakiActiveCue?.id === cue.id,
    ).then(() => {
      if (run !== sasayakiCueNavigationRun || sasayakiActiveCue?.id !== cue.id) return;
      sasayakiCueSignal += 1;
    });
  }

  function ensureSasayakiAudio(): HTMLAudioElement | null {
    if (sasayakiAudio) return sasayakiAudio;
    if (!sasayakiPlayback?.audioPath) return null;
    const audio = new Audio(convertFileSrc(sasayakiPlayback.audioPath));
    audio.preload = "metadata";
    audio.playbackRate = sasayakiPlayback.rate;
    audio.onloadedmetadata = () => {
      if (sasayakiAudio !== audio) return;
      sasayakiDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const restored = clampPlaybackTime(sasayakiPlayback?.lastPosition ?? 0, sasayakiDuration);
      audio.currentTime = restored;
      sasayakiCurrentTime = restored;
      syncSasayakiCuePresentation(false);
    };
    audio.ontimeupdate = () => {
      if (sasayakiAudio !== audio) return;
      sasayakiCurrentTime = audio.currentTime;
      syncSasayakiCuePresentation(false);
      if (Date.now() - sasayakiLastSavedAt >= 5000) scheduleSasayakiPlaybackSave();
    };
    audio.onplay = () => {
      if (sasayakiAudio === audio) {
        sasayakiPlaying = true;
        sasayakiHasPlayedOnce = true;
        syncSasayakiCuePresentation(true);
      }
    };
    audio.onpause = () => {
      if (sasayakiAudio !== audio) return;
      sasayakiPlaying = false;
      sasayakiCurrentTime = audio.currentTime;
      if (!sasayakiSuppressPauseSave) scheduleSasayakiPlaybackSave(true);
    };
    audio.onended = () => {
      if (sasayakiAudio !== audio) return;
      sasayakiPlaying = false;
      sasayakiCurrentTime = audio.duration;
      syncSasayakiCuePresentation(false);
      scheduleSasayakiPlaybackSave(true);
    };
    audio.onerror = () => {
      if (sasayakiAudio !== audio) return;
      sasayakiPlaying = false;
      sasayakiPlaybackError = "Sasayaki audio could not be played. Relink the audiobook if it moved or changed.";
    };
    sasayakiAudio = audio;
    return audio;
  }

  function scheduleSasayakiPlaybackSave(immediate = false) {
    if (sasayakiSaveTimer) clearTimeout(sasayakiSaveTimer);
    if (immediate) {
      sasayakiSaveTimer = null;
      void saveSasayakiPlayback();
      return;
    }
    sasayakiSaveTimer = setTimeout(() => {
      sasayakiSaveTimer = null;
      void saveSasayakiPlayback();
    }, 250);
  }

  function saveSasayakiPlayback(): Promise<void> {
    const next = sasayakiSaveChain.then(() => persistSasayakiPlayback());
    sasayakiSaveChain = next.catch(() => {});
    return next;
  }

  async function persistSasayakiPlayback() {
    const bookId = sasayakiPlaybackBookId;
    const session = sasayakiPlayback;
    if (!bookId || !session?.configured || !isTauriRuntime()) return;
    const lastPosition = clampPlaybackTime(sasayakiAudio?.currentTime ?? sasayakiCurrentTime, sasayakiDuration);
    try {
      const saved = await invoke<SasayakiPlaybackSession>("sasayaki_save_playback", {
        bookId,
        lastPosition,
        delay: session.delay,
        rate: session.rate,
        autoScroll: session.autoScroll,
        autoPause: session.autoPause,
        skipAction: session.skipAction,
      });
      if (sasayakiPlaybackBookId !== bookId) return;
      sasayakiPlayback = saved;
      sasayakiLastSavedAt = Date.now();
    } catch (e) {
      if (sasayakiPlaybackBookId === bookId) sasayakiPlaybackError = String(e);
    }
  }

  async function stopSasayakiPlayback(save: boolean) {
    if (sasayakiLookupResumeTimer) {
      clearTimeout(sasayakiLookupResumeTimer);
      sasayakiLookupResumeTimer = null;
    }
    sasayakiPausedByLookup = false;
    if (sasayakiSaveTimer) {
      clearTimeout(sasayakiSaveTimer);
      sasayakiSaveTimer = null;
    }
    if (sasayakiAudio) {
      sasayakiCurrentTime = sasayakiAudio.currentTime;
      sasayakiAudio.onpause = null;
      sasayakiSuppressPauseSave = true;
      sasayakiAudio.pause();
      sasayakiSuppressPauseSave = false;
    }
    if (save) await saveSasayakiPlayback();
    teardownSasayakiAudio();
    sasayakiPlaybackOpen = false;
  }

  async function toggleSasayakiPlayback() {
    if (sasayakiPlaying) {
      sasayakiPausedByLookup = false;
      if (sasayakiLookupResumeTimer) {
        clearTimeout(sasayakiLookupResumeTimer);
        sasayakiLookupResumeTimer = null;
      }
      sasayakiAudio?.pause();
      return;
    }
    const audio = ensureSasayakiAudio();
    if (!audio) return;
    sasayakiPlaybackError = "";
    try {
      await audio.play();
    } catch (e) {
      sasayakiPlaybackError = String(e);
    }
  }

  function seekSasayaki(seconds: number, revealCue = true) {
    const target = clampPlaybackTime(seconds, sasayakiDuration);
    const audio = ensureSasayakiAudio();
    if (audio) audio.currentTime = target;
    sasayakiCurrentTime = target;
    syncSasayakiCuePresentation(revealCue);
    scheduleSasayakiPlaybackSave(true);
  }

  function skipSasayaki(seconds: number) {
    seekSasayaki(sasayakiCurrentTime + seconds);
  }

  function applySasayakiSkip(direction: -1 | 1) {
    if (!sasayakiPlayback) return;
    const target = sasayakiSkipTarget(
      sasayakiPlayback.cues,
      sasayakiCurrentTime,
      sasayakiPlayback.delay,
      sasayakiPlayback.skipAction,
      direction,
    );
    if (target !== null) seekSasayaki(target, true);
  }

  function setSasayakiRate(rate: number) {
    if (!sasayakiPlayback) return;
    const normalized = Math.max(0.5, Math.min(2, rate));
    sasayakiPlayback = { ...sasayakiPlayback, rate: normalized };
    if (sasayakiAudio) sasayakiAudio.playbackRate = normalized;
    scheduleSasayakiPlaybackSave();
  }

  function setSasayakiDelay(delay: number) {
    if (!sasayakiPlayback) return;
    sasayakiPlayback = { ...sasayakiPlayback, delay: Math.max(-2, Math.min(2, delay)) };
    syncSasayakiCuePresentation(false);
    scheduleSasayakiPlaybackSave();
  }

  function setSasayakiAutoScroll(autoScroll: boolean) {
    if (!sasayakiPlayback) return;
    sasayakiPlayback = { ...sasayakiPlayback, autoScroll };
    syncSasayakiCuePresentation(autoScroll);
    scheduleSasayakiPlaybackSave();
  }

  function setSasayakiAutoPause(autoPause: boolean) {
    if (!sasayakiPlayback) return;
    sasayakiPlayback = { ...sasayakiPlayback, autoPause };
    if (!autoPause) sasayakiPausedByLookup = false;
    scheduleSasayakiPlaybackSave();
  }

  function setSasayakiSkipAction(skipAction: SasayakiSkipAction) {
    if (!sasayakiPlayback) return;
    sasayakiPlayback = { ...sasayakiPlayback, skipAction };
    scheduleSasayakiPlaybackSave();
  }

  function pauseSasayakiForLookup() {
    if (!sasayakiPlayback || !shouldAutoPauseSasayaki(sasayakiPlayback.autoPause, sasayakiPlaying) || !sasayakiAudio) return;
    if (sasayakiLookupResumeTimer) {
      clearTimeout(sasayakiLookupResumeTimer);
      sasayakiLookupResumeTimer = null;
    }
    sasayakiPausedByLookup = true;
    sasayakiAudio.pause();
  }

  function resumeSasayakiAfterLookup() {
    if (!sasayakiPausedByLookup) return;
    if (sasayakiLookupResumeTimer) clearTimeout(sasayakiLookupResumeTimer);
    sasayakiLookupResumeTimer = setTimeout(() => {
      sasayakiLookupResumeTimer = null;
      if (!sasayakiPausedByLookup) return;
      sasayakiPausedByLookup = false;
      const audio = ensureSasayakiAudio();
      if (!audio) return;
      void audio.play().catch((e) => {
        sasayakiPlaybackError = String(e);
      });
    }, 0);
  }

  async function relinkSasayakiAudio() {
    const bookId = sasayakiPlaybackBookId;
    if (!bookId || !isTauriRuntime()) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "Sasayaki audio", extensions: ["m4b", "mp3", "wav"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const session = await invoke<SasayakiPlaybackSession>("sasayaki_relink_audio", {
        bookId,
        audioSourcePath: selected,
      });
      if (sasayakiPlaybackBookId !== bookId) return;
      teardownSasayakiAudio();
      sasayakiPlayback = session;
      sasayakiCurrentTime = session.lastPosition;
      syncSasayakiCuePresentation(false);
      sasayakiPlaybackError = "";
    } catch (e) {
      sasayakiPlaybackError = String(e);
    }
  }

  async function loadChapter(
    idx: number,
    chapterProgress = 0,
    shouldCommit: () => boolean = () => true,
  ) {
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
      if (!shouldCommit()) return;
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
    closeToc();
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
    closeToc(false);
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

  async function refreshDictionaries() {
    if (!isTauriRuntime()) {
      dictionaryListError = "Dictionary management requires Tauri runtime.";
      return;
    }

    invalidateDictionaryLookupCaches();
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      const [entries, status] = await Promise.all([
        invoke<DictionaryManifestEntry[]>("dictionary_list"),
        invoke<DictionaryStatus>("dict_status"),
      ]);
      dictionaryList = entries;
      dictionaryListStatus = status;
      cacheReadyDictionaryStatus(status);
      warmDictionaryStyles(entries, status);
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
      audioEnabled: false,
      localAudioEnabled: false,
      audioSources: defaultAnkiAudioSources(),
      audioDownloadTimeoutMs: 5000,
      forceSyncAfterAdd: false,
      tags: "hoshi-reader",
      allowDuplicates: false,
      checkDuplicatesAcrossAllModels: false,
      duplicateScope: "collection",
      compactGlossaries: false,
      audioAutoplay: false,
      audioPlaybackMode: "interrupt",
      lastFetchedAt: null,
    };
  }

  function defaultAnkiAudioSources(): AnkiAudioSource[] {
    return [{ id: "default", name: "Default", url: "", enabled: false }];
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
      const mapped = { ...settings, fieldMappings: applyKnownNoteTypeDefaultsIfUnmapped(settings) };
      const next = await invoke<AnkiSettings>("anki_save_settings", { settings: mapped });
      ankiSettings = next;
      ankiEndpointDraft = next.endpoint;
      ankiStatus = `Fetched ${next.decks.length} decks and ${next.noteTypes.length} note types.`;
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
    const next = { ...changed, fieldMappings: applyKnownNoteTypeDefaultsIfUnmapped(changed) };
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

  async function setAnkiAudioConfig(audioEnabled: boolean, audioSources: AnkiAudioSource[], audioDownloadTimeoutMs: number) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = {
      ...base,
      audioEnabled,
      audioSources,
      audioDownloadTimeoutMs,
    };
    await saveAnkiSettings();
  }

  async function setAnkiLocalAudioEnabled(enabled: boolean) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = { ...base, localAudioEnabled: enabled };
    await saveAnkiSettings();
  }

  async function setAnkiForceSyncAfterAdd(enabled: boolean) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = { ...base, forceSyncAfterAdd: enabled };
    await saveAnkiSettings();
  }

  async function setAnkiNoteOptions(
    tags: string,
    allowDuplicates: boolean,
    duplicateScope: AnkiSettings["duplicateScope"],
    checkDuplicatesAcrossAllModels: boolean,
  ) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = { ...base, tags, allowDuplicates, duplicateScope, checkDuplicatesAcrossAllModels };
    await saveAnkiSettings();
  }

  async function setAnkiCompactGlossaries(enabled: boolean) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = { ...base, compactGlossaries: enabled };
    await saveAnkiSettings();
  }

  async function setWordAudioPlaybackOptions(audioAutoplay: boolean, audioPlaybackMode: AnkiSettings["audioPlaybackMode"]) {
    if (ankiBusy) return;
    const base = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft };
    ankiSettings = { ...base, audioAutoplay, audioPlaybackMode };
    await saveAnkiSettings();
  }

  async function refreshLocalAudioStatus() {
    if (!isTauriRuntime()) return;
    try {
      localAudioStatus = await invoke<LocalAudioStatus>("anki_local_audio_status");
    } catch (e) {
      ankiError = String(e);
    }
  }

  async function importLocalAudio() {
    if (!isTauriRuntime() || ankiBusy) return;
    const selected = await open({
      multiple: false,
      filters: [{ name: "HSA Local Audio Database", extensions: ["db"] }],
    });
    if (!selected || Array.isArray(selected)) return;
    ankiBusy = true;
    ankiError = "";
    ankiStatus = "Importing local audio database...";
    try {
      localAudioStatus = await invoke<LocalAudioStatus>("anki_import_local_audio", { databasePath: selected });
      const next = {
        ...(ankiSettings ?? defaultAnkiSettings()),
        endpoint: ankiEndpointDraft,
        audioEnabled: true,
        localAudioEnabled: true,
      };
      ankiSettings = await invoke<AnkiSettings>("anki_save_settings", { settings: next });
      ankiStatus = `Imported local audio database with ${localAudioStatus.sources.length} sources.`;
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  async function removeLocalAudio() {
    if (!isTauriRuntime() || ankiBusy) return;
    ankiBusy = true;
    ankiError = "";
    try {
      localAudioStatus = await invoke<LocalAudioStatus>("anki_remove_local_audio");
      const next = { ...(ankiSettings ?? defaultAnkiSettings()), endpoint: ankiEndpointDraft, localAudioEnabled: false };
      ankiSettings = await invoke<AnkiSettings>("anki_save_settings", { settings: next });
      ankiStatus = "Removed local audio database.";
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  async function moveLocalAudioSource(source: string, direction: -1 | 1) {
    if (ankiBusy) return;
    const order = localAudioStatus.sources.map((item) => item.name);
    const index = order.indexOf(source);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    ankiBusy = true;
    try {
      localAudioStatus = await invoke<LocalAudioStatus>("anki_set_local_audio_source_order", { sourceOrder: order });
    } catch (e) {
      ankiError = String(e);
    } finally {
      ankiBusy = false;
    }
  }

  function closeReaderSelection() {
    const shouldResumeSasayaki = sasayakiPausedByLookup;
    window.getSelection()?.removeAllRanges();
    clearLookupHighlight(READER_LOOKUP_HIGHLIGHT);
    readerSelection = null;
    readerLookupHighlightCount = 0;
    readerLookupHighlightSignal += 1;
    lookupPopups = [];
    lookupRequestId += 1;
    if (shouldResumeSasayaki) resumeSasayakiAfterLookup();
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

  function invalidateDictionaryLookupCaches() {
    cachedReadyDictionaryStatus = null;
    lookupResultCache.clear();
    clearDictionaryStyleCache();
  }

  function warmDictionaryStyles(entries: DictionaryManifestEntry[], status: DictionaryStatus | null) {
    if (status?.status !== "ready") return;
    const dictionaries = entries
      .filter((entry) => entry.enabled && entry.role === "term" && entry.termCount > 0)
      .map((entry) => entry.title);
    void preloadCachedDictionaryStyles(dictionaries);
  }

  function cacheReadyDictionaryStatus(status: DictionaryStatus) {
    cachedReadyDictionaryStatus = status.status === "ready" ? status : null;
  }

  async function lookupDictionaryStatus(): Promise<DictionaryStatus> {
    if (cachedReadyDictionaryStatus) return cachedReadyDictionaryStatus;
    const status = await invoke<DictionaryStatus>("dict_status");
    cacheReadyDictionaryStatus(status);
    return status;
  }

  function firstLookupMatchCount(results: DictResult[]): number {
    return Array.from(results[0]?.matched ?? "").length;
  }

  function buildAnkiPayload(selection: ReaderSelection, result: DictResult, resultIndex: number): LookupAnkiPayload {
    return {
      selectedText: selection.text,
      sentence: selection.sentence ?? selection.text,
      sentenceOffset: selection.sentenceOffset,
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
      audioFilename: null,
      sasayakiCueId: sasayakiActiveCue?.chapterIndex === selection.chapterIndex
        ? sasayakiActiveCue.id
        : null,
      sasayakiAudioFilename: null,
      coverFilename: null,
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

      invalidateDictionaryLookupCaches();
      dictionaryBusy = true;
      dictionaryStatus = "Importing dictionaries...";
      const selected = await open({
        multiple: true,
        filters: [{ name: "Yomitan Dictionary", extensions: ["zip"] }],
      });
      if (!selected) {
        dictionaryStatus = "Dictionary import cancelled.";
        return;
      }

      const zipPaths = Array.isArray(selected) ? selected : [selected];
      if (zipPaths.length === 0) {
        dictionaryStatus = "Dictionary import cancelled.";
        return;
      }

      const summary = await invoke<DictImportBatchSummary>("dictionary_import_yomitan_zips", {
        zipPaths,
        lowRam: settings.dictionarySettings.lowRamDictionaryImport,
      });
      dictionaryStatus = dictionaryBatchStatusLabel(summary);
      await refreshDictionaries();
      reloadLookupPopups();
    } catch (e) {
      dictionaryStatus = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  async function importDictionaryFolder() {
    if (dictionaryBusy) return;
    try {
      if (!isTauriRuntime()) {
        dictionaryStatus = "Dictionary folder import requires Tauri runtime.";
        return;
      }

      invalidateDictionaryLookupCaches();
      dictionaryBusy = true;
      dictionaryStatus = "Importing dictionaries from folder...";
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (!selected || Array.isArray(selected)) {
        dictionaryStatus = "Dictionary folder import cancelled.";
        return;
      }

      const summary = await invoke<DictImportBatchSummary>("dictionary_import_yomitan_folder", {
        folderPath: selected,
        lowRam: settings.dictionarySettings.lowRamDictionaryImport,
      });
      dictionaryStatus = dictionaryBatchStatusLabel(summary);
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

  async function storeAnkiBookCover(bookId: string): Promise<AnkiStoreBookCoverResult> {
    if (!isTauriRuntime()) throw new Error("Anki book cover storage requires Tauri runtime.");
    const endpoint = ankiSettings?.endpoint;
    if (!endpoint) throw new Error("Anki endpoint is not configured.");
    return invoke<AnkiStoreBookCoverResult>("anki_store_book_cover", { endpoint, bookId });
  }

  async function storeAnkiWordAudio(request: WordAudioResolveRequest): Promise<AnkiStoreRemoteAudioResult> {
    if (!isTauriRuntime()) throw new Error("Anki word audio storage requires Tauri runtime.");
    const endpoint = ankiSettings?.endpoint;
    if (!endpoint) throw new Error("Anki endpoint is not configured.");
    return invoke<AnkiStoreRemoteAudioResult>("anki_store_word_audio", { endpoint, request });
  }

  async function prepareWordAudio(request: WordAudioResolveRequest): Promise<WordAudioPlaybackResult> {
    if (!isTauriRuntime()) throw new Error("Word audio playback requires Tauri runtime.");
    return invoke<WordAudioPlaybackResult>("word_audio_prepare_playback", { request });
  }

  async function setDictionaryEnabled(dictionary: DictionaryManifestEntry, enabled: boolean) {
    invalidateDictionaryLookupCaches();
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      const status = await invoke<DictionaryStatus>("dictionary_set_enabled", { dictId: dictionary.dictId, enabled });
      dictionaryListStatus = status;
      cacheReadyDictionaryStatus(status);
      await refreshDictionaries();
      reloadLookupPopups();
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  async function moveDictionary(dictionary: DictionaryManifestEntry, direction: -1 | 1) {
    const role = dictionary.role;
    const roleDictionaries = dictionaryList.filter((entry) => entry.role === role);
    const currentIndex = roleDictionaries.findIndex((entry) => entry.dictId === dictionary.dictId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= roleDictionaries.length) return;

    const reordered = [...roleDictionaries];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    invalidateDictionaryLookupCaches();
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      dictionaryList = await invoke<DictionaryManifestEntry[]>("dictionary_set_order", {
        role,
        dictIds: reordered.map((entry) => entry.dictId),
      });
      dictionaryListStatus = await invoke<DictionaryStatus>("dict_status");
      cacheReadyDictionaryStatus(dictionaryListStatus);
      warmDictionaryStyles(dictionaryList, dictionaryListStatus);
      reloadLookupPopups();
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  async function removeDictionaryImport(dictionary: DictionaryManifestEntry) {
    const title = dictionary.title || "this dictionary";
    invalidateDictionaryLookupCaches();
    dictionaryBusy = true;
    dictionaryListError = "";
    try {
      dictionaryList = await invoke<DictionaryManifestEntry[]>("dictionary_remove_import", {
        importId: dictionary.importId,
      });
      dictionaryListStatus = await invoke<DictionaryStatus>("dict_status");
      cacheReadyDictionaryStatus(dictionaryListStatus);
      warmDictionaryStyles(dictionaryList, dictionaryListStatus);
      dictionaryStatus = `Deleted ${title}.`;
      reloadLookupPopups();
    } catch (e) {
      dictionaryListError = String(e);
    } finally {
      dictionaryBusy = false;
    }
  }

  function backToShelf() {
    closeReaderSelection();
    void stopSasayakiPlayback(true);
    view = "bookshelf";
  }

  async function storeAnkiSasayakiAudio(
    bookId: string,
    cueId: string,
  ): Promise<AnkiStoreSasayakiAudioResult> {
    if (!isTauriRuntime()) throw new Error("Sasayaki audio storage requires Tauri runtime.");
    const endpoint = ankiSettings?.endpoint?.trim() || ankiEndpointDraft;
    return invoke<AnkiStoreSasayakiAudioResult>("anki_store_sasayaki_audio", {
      endpoint,
      bookId,
      cueId,
    });
  }

  function restoreTocTriggerFocus() {
    requestAnimationFrame(() => document.getElementById("reader-toc-trigger")?.focus());
  }

  function closeToc(restoreFocus = true) {
    if (!showToc) return;
    showToc = false;
    if (restoreFocus) restoreTocTriggerFocus();
  }

  function handleReaderEscape() {
    if (sasayakiPlaybackOpen) {
      closeSasayakiPlaybackPanel();
      return;
    }
    if (showToc) {
      closeToc();
      return;
    }
    backToShelf();
  }

  function toggleToc() {
    closeReaderSelection();
    if (showToc) closeToc();
    else showToc = true;
  }

  function closeSasayakiPlaybackPanel() {
    if (!sasayakiPlaybackOpen) return;
    sasayakiPlaybackOpen = false;
    requestAnimationFrame(() => document.getElementById("reader-sasayaki-trigger")?.focus());
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

  function createLookupPopup(
    id: string,
    selection: ReaderSelection,
    requestId: number,
  ): LookupPopupItem {
    beginLookupPerformance(requestId, id, selection.text, id === "root" ? "root" : "child");
    return {
      id,
      selection,
      state: "loading",
      error: "",
      results: [],
      requestId,
      clearSelectionSignal: 0,
      selectionHighlightCount: 0,
      selectionHighlightSignal: 0,
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
    if (lookupPopups.some((popup) => popup.id === "root")) readerLookupHighlightCount = 0;
    const reloaded: LookupPopupItem[] = lookupPopups.map((popup) => {
      const requestId = nextLookupRequestId();
      beginLookupPerformance(requestId, popup.id, popup.selection.text, "reload");
      return {
        ...popup,
        state: "loading",
        error: "",
        results: [],
        requestId,
        selectionHighlightCount: 0,
        selectionHighlightSignal: popup.selectionHighlightSignal + 1,
        clearSelectionSignal: popup.clearSelectionSignal + 1,
      };
    });
    lookupPopups = reloaded;
    for (const popup of reloaded) {
      void lookupSelection(
        popup.id,
        popup.selection,
        popup.requestId,
        null,
        popup.id === "root" && popup.selection === readerSelection,
      );
    }
  }

  function openRootLookup(selection: ReaderSelection) {
    const requestId = nextLookupRequestId();
    readerSelection = selection;
    readerLookupHighlightCount = 0;
    readerLookupHighlightSignal += 1;
    lookupPopups = [createLookupPopup("root", selection, requestId)];
    void lookupSelection("root", selection, requestId, null, true);
  }

  function openChildLookup(parentId: string, selection: ReaderSelection) {
    const index = popupIndex(parentId);
    if (index < 0) return;

    const childId = `popup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const requestId = nextLookupRequestId();
    lookupPopups = [
      ...lookupPopups.slice(0, index + 1).map((popup, popupIndex) => (
        popupIndex === index
          ? { ...popup, selectionHighlightCount: 0, selectionHighlightSignal: popup.selectionHighlightSignal + 1 }
          : popup
      )),
      createLookupPopup(childId, selection, requestId),
    ];
    void lookupSelection(childId, selection, requestId, parentId);
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

    pauseSasayakiForLookup();
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
    beginLookupPerformance(requestId, popupId, redirectedSelection.text, "redirect");

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
    beginLookupPerformance(requestId, popupId, target.selection.text, `history-${direction}`);
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

  async function lookupSelection(
    popupId: string,
    selection: ReaderSelection,
    requestId: number,
    highlightOwnerId: string | null = null,
    updateReaderHighlight = false,
  ) {
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
      markLookupPerformance(requestId, "status-start");
      const status = await lookupDictionaryStatus();
      markLookupPerformance(requestId, "status-ready", { status: status.status });
      if (!isCurrent()) return;
      if (status.status !== "ready") {
        updateLookupPopup(popupId, {
          state: lookupStateForStatus(status),
          error: lookupStatusMessage(status),
          results: [],
        });
        return;
      }

      const lookupRequest = lookupResultCache.get(
        selection.text,
        (text) => invoke<DictResult[]>("dict_lookup", {
          text,
          requestId,
          maxResults: settings.dictionarySettings.maxResults,
          scanLength: settings.dictionarySettings.scanLength,
        }),
      );
      markLookupPerformance(requestId, "invoke-start", { cacheHit: lookupRequest.cacheHit });
      const results = await lookupRequest.promise;
      markLookupPerformance(requestId, "invoke-end", { resultCount: results.length, cacheHit: lookupRequest.cacheHit });
      if (!isCurrent()) return;
      const highlightCount = firstLookupMatchCount(results);
      if (updateReaderHighlight) {
        readerLookupHighlightCount = highlightCount;
        readerLookupHighlightSignal += 1;
      }
      lookupPopups = lookupPopups.map((popup) => {
        if (popup.id === popupId) {
          return { ...popup, state: results.length > 0 ? "ready" : "empty", error: "", results };
        }
        if (highlightOwnerId && popup.id === highlightOwnerId) {
          return {
            ...popup,
            selectionHighlightCount: highlightCount,
            selectionHighlightSignal: popup.selectionHighlightSignal + 1,
          };
        }
        return popup;
      });
      markLookupPerformance(requestId, "state-committed", { resultCount: results.length });
    } catch (e) {
      if (!isCurrent()) return;
      cachedReadyDictionaryStatus = null;
      try {
        const status = await invoke<DictionaryStatus>("dict_status");
        if (!isCurrent()) return;
        cacheReadyDictionaryStatus(status);
        if (status.status !== "ready") {
          updateLookupPopup(popupId, {
            state: lookupStateForStatus(status),
            error: lookupStatusMessage(status),
            results: [],
          });
          return;
        }
      } catch {
        cachedReadyDictionaryStatus = null;
      }
      updateLookupPopup(popupId, {
        state: "error",
        error: String(e),
        results: [],
      });
    } finally {
      if (!isCurrent()) discardLookupPerformance(requestId);
    }
  }

</script>

<main class="app" data-ui-portal-root data-theme={settings.readerAppearance.theme} style={settings.appearanceVars}>
  {#if view === "bookshelf"}
    <BookshelfView
      {books}
      {error}
      {dictionaryStatus}
      {dictionaryBusy}
      {bookImportBusy}
      readerAppearance={settings.readerAppearance}
      {readerThemeLabels}
      advancedSettings={settings.advancedSettings}
      lookupPopupSettings={settings.lookupPopupSettings}
      dictionarySettings={settings.dictionarySettings}
      {dictionaryList}
      {dictionaryListStatus}
      {dictionaryListError}
      {ankiSettings}
      {ankiEndpointDraft}
      {ankiStatus}
      {ankiError}
      {ankiBusy}
      {ankiTemplateOptions}
      {localAudioStatus}
      {sasayakiBookId}
      {sasayakiStatus}
      {sasayakiCues}
      {sasayakiMessage}
      {sasayakiError}
      sasayakiBusy={sasayakiBusy && sasayakiBusyBookId === sasayakiBookId}
      onOpenBook={openBook}
      onContinueBook={continueBook}
      onForgetBook={forgetBook}
      onSetReaderTheme={settings.setReaderTheme}
      onSetReopenLastBookOnStartup={settings.setReopenLastBookOnStartup}
      onSetLookupPopupWidth={settings.setLookupPopupWidth}
      onSetLookupPopupHeight={settings.setLookupPopupHeight}
      onSetLookupPopupScale={settings.setLookupPopupScale}
      onDictionarySettingsChange={settings.updateDictionarySettings}
      onRefreshDictionaries={refreshDictionaries}
      onImportDictionary={importDictionary}
      onImportDictionaryFolder={importDictionaryFolder}
      onSetDictionaryEnabled={setDictionaryEnabled}
      onMoveDictionary={moveDictionary}
      onRemoveDictionaryImport={removeDictionaryImport}
      onAnkiEndpointChange={(endpoint) => ankiEndpointDraft = endpoint}
      onPingAnkiConnect={pingAnkiConnect}
      onFetchAnkiConfig={fetchAnkiConfig}
      onSaveAnkiSettings={saveAnkiSettings}
      onSelectAnkiDeck={selectAnkiDeck}
      onSelectAnkiNoteType={selectAnkiNoteType}
      onSetAnkiFieldTemplate={setAnkiFieldTemplate}
      onSetAnkiAudioConfig={setAnkiAudioConfig}
      onSetAnkiLocalAudioEnabled={setAnkiLocalAudioEnabled}
      onSetAnkiForceSyncAfterAdd={setAnkiForceSyncAfterAdd}
      onSetAnkiNoteOptions={setAnkiNoteOptions}
      onSetAnkiCompactGlossaries={setAnkiCompactGlossaries}
      onSetWordAudioPlaybackOptions={setWordAudioPlaybackOptions}
      onImportLocalAudio={importLocalAudio}
      onRemoveLocalAudio={removeLocalAudio}
      onMoveLocalAudioSource={moveLocalAudioSource}
      onLoadSasayaki={loadSasayaki}
      onImportSasayaki={importSasayaki}
      onRemoveSasayaki={removeSasayaki}
      onRematchSasayaki={rematchSasayaki}
      onCorrectSasayakiCue={correctSasayakiCue}
      onClearSasayakiCorrection={clearSasayakiCorrection}
    />
  {:else}
    <Reader
      content={chapterHtml}
      {chapterIndex}
      onPrevChapter={prevChapter}
      onPrevChapterDirect={prevChapterDirect}
      onNextChapter={nextChapter}
      onNavigateHref={navigateReaderHref}
      onBackToShelf={handleReaderEscape}
      initialProgress={readerInitialProgress}
      chapterStartChars={chapterBookInfo?.current_total ?? 0}
      totalBookChars={meta?.book_info.character_count ?? 0}
      appearancePalette={settings.appearancePalette}
      lookupHighlightCount={readerLookupHighlightCount}
      lookupHighlightSignal={readerLookupHighlightSignal}
      sasayakiCue={sasayakiActiveCue}
      sasayakiReveal={sasayakiCueReveal}
      {sasayakiCueSignal}
      scanLength={settings.dictionarySettings.scanLength}
      scanNonJapaneseText={settings.dictionarySettings.scanNonJapaneseText}
      onProgressChange={handleReaderProgress}
      onSelectionChange={handleReaderSelection}
      {startAtEnd}
    />
    <LookupPopupLayer
      popups={lookupPopups}
      popupSettings={settings.lookupPopupSettings}
      dictionarySettings={settings.dictionarySettings}
      {ankiSettings}
      onClose={closePopup}
      onImportDictionary={importDictionary}
      onNestedLookup={handleNestedPopupLookup}
      onRedirectLookup={handleRedirectPopupLookup}
      onScrolled={handlePopupScrolled}
      onNavigateHistory={handlePopupHistoryNavigation}
      onPopupPointerDown={clearPopupChildren}
      ankiTitle={lookupAnkiTitle}
      {buildAnkiPayload}
      onStoreAnkiMedia={storeAnkiMedia}
      onStoreAnkiBookCover={storeAnkiBookCover}
      onStoreAnkiWordAudio={storeAnkiWordAudio}
      onStoreAnkiSasayakiAudio={storeAnkiSasayakiAudio}
      onPrepareWordAudio={prepareWordAudio}
      onAddAnkiNote={addAnkiNote}
    />
    {#if showToc}
      <TocPanel
        entries={tocEntries}
        {chapterIndex}
        onClose={closeToc}
        onJumpToChapter={jumpToChapter}
      />
    {/if}
    <ReaderControls
      onPrevChapter={prevChapterDirect}
      onNextChapter={nextChapter}
      onToggleToc={toggleToc}
      onBackToShelf={backToShelf}
      onToggleSasayaki={() => sasayakiPlaybackOpen = !sasayakiPlaybackOpen}
      tocOpen={showToc}
      sasayakiOpen={sasayakiPlaybackOpen}
      sasayakiAvailable={Boolean(sasayakiPlayback?.configured)}
    />
    {#if sasayakiPlaybackOpen && sasayakiPlayback}
      <div id="sasayaki-player">
        <SasayakiPlayerPanel
          session={sasayakiPlayback}
          playing={sasayakiPlaying}
          currentTime={sasayakiCurrentTime}
          duration={sasayakiDuration}
          error={sasayakiPlaybackError}
          onClose={closeSasayakiPlaybackPanel}
          onToggle={toggleSasayakiPlayback}
          onSeek={seekSasayaki}
          onSkip={skipSasayaki}
          onRateChange={setSasayakiRate}
          onDelayChange={setSasayakiDelay}
          onAutoScrollChange={setSasayakiAutoScroll}
          onAutoPauseChange={setSasayakiAutoPause}
          onSkipActionChange={setSasayakiSkipAction}
          onSkipAction={applySasayakiSkip}
          onRelink={relinkSasayakiAudio}
        />
      </div>
    {/if}
  {/if}
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: var(--app-bg, #000); color: var(--app-text, #fff); font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .app { width: 100vw; height: 100vh; background: var(--app-bg); color: var(--app-text); }
</style>
