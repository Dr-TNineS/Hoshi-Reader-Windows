<script lang="ts">
  import BookshelfView from "./BookshelfView.svelte";
  import { defaultDictionarySettings } from "./dictionary-settings";
  import { createDictionarySearchState } from "./state/dictionary-search-state.svelte";
  import type { BookRecord } from "./storage";

  const books: BookRecord[] = [
    {
      bookId: "owned-book",
      sourcePath: "C:/Books/Owned Book.epub",
      libraryPath: "C:/AppData/library/owned-book/book.epub",
      title: "Owned Book",
      chapter: 2,
      totalChapters: 10,
      lastOpened: 2,
      percent: 24.5,
    },
    {
      path: "C:/Books/Legacy Book.epub",
      title: "Legacy Book",
      chapter: 1,
      totalChapters: 5,
      lastOpened: 1,
      percent: 10,
    },
  ];

  let forgetEvents = $state<string[]>([]);
  let sasayakiEvents = $state<string[]>([]);
  const dictionarySearchState = createDictionarySearchState();
</script>

<main class="probe" data-ui-portal-root>
  <BookshelfView
    {books}
    readerAppearance={{ theme: "dark" }}
    readerThemeLabels={{ light: "Light", dark: "Dark", sepia: "Sepia" }}
    advancedSettings={{ reopenLastBookOnStartup: true }}
    lookupPopupSettings={{ width: 320, height: 250, scale: 1 }}
    dictionarySettings={defaultDictionarySettings}
    {dictionarySearchState}
    dictionarySearchActions={{
      lookupStatus: async () => ({ status: "noDictionaries", message: "No probe dictionaries.", loadedCount: 0, importedCount: 0 }),
      lookup: async () => [],
      onImportDictionary: () => {},
    }}
    onOpenBook={() => {}}
    onContinueBook={() => {}}
    onForgetBook={(book) => forgetEvents = [...forgetEvents, book.bookId ?? book.path ?? "unknown"]}
    sasayakiBookId="owned-book"
    sasayakiStatus={{
      configured: true,
      audioStorage: "external",
      audioFileName: "星の音.wav",
      audioExtension: "wav",
      audioSizeBytes: 8192,
      audioAvailable: true,
      subtitleFileName: "星の音.srt",
      subtitleSizeBytes: 1024,
      cueCount: 3,
      matchedCount: 2,
      unmatchedCount: 1,
      correctedCount: 1,
      matchRate: 66.6667,
      lastPosition: 0,
      delay: 0,
      rate: 1,
    }}
    sasayakiCues={[
      {
        id: "1",
        startTime: 0,
        endTime: 1.25,
        text: "学校です。",
        matched: true,
        corrected: false,
        chapterIndex: 1,
        start: 0,
        length: 4,
      },
      {
        id: "2",
        startTime: 1.25,
        endTime: 2.5,
        text: "見つからない字幕",
        matched: false,
        corrected: false,
        chapterIndex: null,
        start: null,
        length: null,
      },
      {
        id: "3",
        startTime: 2.5,
        endTime: 4,
        text: "手動で直した字幕",
        matched: true,
        corrected: true,
        chapterIndex: 2,
        start: 8,
        length: 7,
      },
    ]}
    sasayakiMessage="Sasayaki audio and subtitles are ready to match."
    onLoadSasayaki={(book) => sasayakiEvents = [...sasayakiEvents, `load:${book.bookId}`]}
    onImportSasayaki={(book, copyAudio) => sasayakiEvents = [...sasayakiEvents, `${copyAudio ? "copy" : "link"}:${book.bookId}`]}
    onRemoveSasayaki={(book) => sasayakiEvents = [...sasayakiEvents, `remove:${book.bookId}`]}
    onRematchSasayaki={(book, window) => sasayakiEvents = [...sasayakiEvents, `match:${book.bookId}:${window}`]}
    onCorrectSasayakiCue={(book, cueId, chapter, start, length) => sasayakiEvents = [...sasayakiEvents, `correct:${book.bookId}:${cueId}:${chapter}:${start}:${length}`]}
    onClearSasayakiCorrection={(book, cueId) => sasayakiEvents = [...sasayakiEvents, `clear:${book.bookId}:${cueId}`]}
    onSetReaderTheme={() => {}}
    onSetReopenLastBookOnStartup={() => {}}
    onSetLookupPopupWidth={() => {}}
    onSetLookupPopupHeight={() => {}}
    onSetLookupPopupScale={() => {}}
    onDictionarySettingsChange={() => {}}
    onRefreshDictionaries={() => {}}
    onImportDictionary={() => {}}
    onImportDictionaryFolder={() => {}}
    onSetDictionaryEnabled={() => {}}
    onMoveDictionary={() => {}}
    onRemoveDictionaryImport={() => {}}
    onAnkiEndpointChange={() => {}}
    onPingAnkiConnect={() => {}}
    onFetchAnkiConfig={() => {}}
    onSaveAnkiSettings={() => {}}
    onSelectAnkiDeck={() => {}}
    onSelectAnkiNoteType={() => {}}
    onSetAnkiFieldTemplate={() => {}}
    onSetAnkiAudioConfig={() => {}}
  />
  <div
    class="probe-state"
    data-forget-events={forgetEvents.join(",")}
    data-sasayaki-events={sasayakiEvents.join(",")}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { overflow: hidden; font-family: "Segoe UI", sans-serif; }
  .probe {
    --app-bg: #000000;
    --app-text: #ffffff;
    --app-muted: #999999;
    --app-surface: #121212;
    --app-surface-hover: #1d1d1d;
    --app-border: #333333;
    --app-control: #1b1b1b;
    --app-control-hover: #262626;
    --app-primary: #d0bcff;
    --app-primary-hover: #c1a9fb;
    --app-error: #ffb4ab;
    --app-status: #cce8d5;
    --app-shadow: rgba(0, 0, 0, 0.48);
  }
  .probe-state { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
