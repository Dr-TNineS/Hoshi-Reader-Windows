<script lang="ts">
  import BookshelfView from "./BookshelfView.svelte";
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
</script>

<main class="probe" data-ui-portal-root>
  <BookshelfView
    {books}
    readerAppearance={{ theme: "dark" }}
    readerThemeLabels={{ light: "Light", dark: "Dark" }}
    advancedSettings={{ reopenLastBookOnStartup: true }}
    onOpenBook={() => {}}
    onContinueBook={() => {}}
    onForgetBook={(book) => forgetEvents = [...forgetEvents, book.bookId ?? book.path ?? "unknown"]}
    onSetReaderTheme={() => {}}
    onSetReopenLastBookOnStartup={() => {}}
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
  <div class="probe-state" data-forget-events={forgetEvents.join(",")} aria-hidden="true"></div>
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
