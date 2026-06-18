<script lang="ts">
  import AnkiConnectPanel from "./AnkiConnectPanel.svelte";
  import type { AnkiAudioSource, AnkiSettings, DictionaryManifestEntry, DictionaryStatus } from "./types";
  import AppearancePanel from "./AppearancePanel.svelte";
  import type { ReaderAppearance, ReaderTheme } from "./appearance";
  import DictionaryManagementPanel from "./DictionaryManagementPanel.svelte";
  import { bookRecordKey, bookRecordPath, type BookRecord } from "./storage";

  let {
    books,
    error = "",
    dictionaryStatus = "",
    dictionaryBusy = false,
    bookImportBusy = false,
    showAppearancePanel = false,
    readerAppearance,
    readerThemeLabels,
    showDictionaryManager = false,
    dictionaryList = [],
    dictionaryListStatus = null,
    dictionaryListError = "",
    showAnkiPanel = false,
    ankiSettings = null,
    ankiEndpointDraft = "http://127.0.0.1:8765",
    ankiStatus = "",
    ankiError = "",
    ankiBusy = false,
    ankiTemplateOptions = [],
    onToggleAnkiPanel,
    onToggleAppearancePanel,
    onToggleDictionaryManager,
    onOpenBook,
    onContinueBook,
    onForgetBook,
    onSetReaderTheme,
    onRefreshDictionaries,
    onImportDictionary,
    onImportDictionaryFolder,
    onSetDictionaryEnabled,
    onMoveDictionary,
    onRemoveDictionaryImport,
    onAnkiEndpointChange,
    onPingAnkiConnect,
    onFetchAnkiConfig,
    onSaveAnkiSettings,
    onSelectAnkiDeck,
    onSelectAnkiNoteType,
    onSetAnkiFieldTemplate,
    onSetAnkiAudioConfig,
  }: {
    books: BookRecord[];
    error?: string;
    dictionaryStatus?: string;
    dictionaryBusy?: boolean;
    bookImportBusy?: boolean;
    showAppearancePanel?: boolean;
    readerAppearance: ReaderAppearance;
    readerThemeLabels: Record<ReaderTheme, string>;
    showDictionaryManager?: boolean;
    dictionaryList?: DictionaryManifestEntry[];
    dictionaryListStatus?: DictionaryStatus | null;
    dictionaryListError?: string;
    showAnkiPanel?: boolean;
    ankiSettings?: AnkiSettings | null;
    ankiEndpointDraft?: string;
    ankiStatus?: string;
    ankiError?: string;
    ankiBusy?: boolean;
    ankiTemplateOptions?: string[];
    onToggleAnkiPanel: () => void;
    onToggleAppearancePanel: () => void;
    onToggleDictionaryManager: () => void;
    onOpenBook: () => void;
    onContinueBook: (book: BookRecord) => void;
    onForgetBook: (book: BookRecord) => void;
    onSetReaderTheme: (theme: ReaderTheme) => void;
    onRefreshDictionaries: () => void;
    onImportDictionary: () => void;
    onImportDictionaryFolder: () => void;
    onSetDictionaryEnabled: (dictionary: DictionaryManifestEntry, enabled: boolean) => void;
    onMoveDictionary: (dictionary: DictionaryManifestEntry, direction: -1 | 1) => void;
    onRemoveDictionaryImport: (dictionary: DictionaryManifestEntry) => void;
    onAnkiEndpointChange: (endpoint: string) => void;
    onPingAnkiConnect: () => void;
    onFetchAnkiConfig: () => void;
    onSaveAnkiSettings: () => void;
    onSelectAnkiDeck: (deck: string) => void;
    onSelectAnkiNoteType: (noteType: string) => void;
    onSetAnkiFieldTemplate: (field: string, template: string) => void;
    onSetAnkiAudioConfig: (audioEnabled: boolean, audioSources: AnkiAudioSource[], audioDownloadTimeoutMs: number) => void;
  } = $props();

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
</script>

<section class="bookshelf">
  <div class="shelf-head">
    <div>
      <h1>Hoshi Reader</h1>
      <p class="subtitle">Lightweight Japanese EPUB Reader</p>
    </div>
    <div class="head-actions">
      <button class="secondary-action" onclick={onToggleAnkiPanel}>
        Anki
      </button>
      <button class="secondary-action" onclick={onToggleAppearancePanel}>
        Appearance
      </button>
      <button class="secondary-action" onclick={onToggleDictionaryManager}>
        Dictionaries
      </button>
      <button class="ob" disabled={bookImportBusy} onclick={onOpenBook}>
        {bookImportBusy ? "Importing..." : "Open EPUB"}
      </button>
    </div>
  </div>

  {#if error}<p class="err">{error}</p>{/if}
  {#if dictionaryStatus}<p class="dict-status">{dictionaryStatus}</p>{/if}

  {#if showAppearancePanel}
    <AppearancePanel
      appearance={readerAppearance}
      themeLabels={readerThemeLabels}
      onThemeChange={onSetReaderTheme}
    />
  {/if}

  {#if showDictionaryManager}
    <DictionaryManagementPanel
      dictionaries={dictionaryList}
      status={dictionaryListStatus}
      error={dictionaryListError}
      busy={dictionaryBusy}
      onRefresh={onRefreshDictionaries}
      onImport={onImportDictionary}
      onImportFolder={onImportDictionaryFolder}
      onSetEnabled={onSetDictionaryEnabled}
      onMove={onMoveDictionary}
      onRemove={onRemoveDictionaryImport}
    />
  {/if}

  {#if showAnkiPanel}
    <AnkiConnectPanel
      settings={ankiSettings}
      endpoint={ankiEndpointDraft}
      status={ankiStatus}
      error={ankiError}
      busy={ankiBusy}
      handlebarOptions={ankiTemplateOptions}
      onEndpointChange={onAnkiEndpointChange}
      onPing={onPingAnkiConnect}
      onFetch={onFetchAnkiConfig}
      onSave={onSaveAnkiSettings}
      onSelectDeck={onSelectAnkiDeck}
      onSelectNoteType={onSelectAnkiNoteType}
      onSetFieldTemplate={onSetAnkiFieldTemplate}
      onSetAudioConfig={onSetAnkiAudioConfig}
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
            <button class="book-open" onclick={() => onContinueBook(book)}>
              <span class="book-title">{book.title}</span>
              <span class="book-meta">{progressLabel(book)} | {openedLabel(book.lastOpened)}</span>
              <span class="book-path">{bookRecordPath(book)}</span>
            </button>
            <button class="book-forget" title="Forget book" onclick={() => onForgetBook(book)}>Forget</button>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <p class="keys">arrow:page | Ctrl+arrow:chapter | Esc:shelf</p>
</section>

<style>
  .bookshelf { width: min(920px, calc(100vw - 48px)); height: 100vh; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .shelf-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  h1 { font-size: 32px; font-weight: 300; letter-spacing: 4px; color: var(--app-text); }
  h2 { font-size: 13px; font-weight: 600; color: var(--app-muted); text-transform: uppercase; }
  .subtitle { margin-top: 6px; color: var(--app-muted); font-size: 14px; }
  .head-actions { flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
  .ob { flex-shrink: 0; padding: 10px 22px; font-size: 14px; background: var(--app-primary); color: var(--app-bg); border: none; border-radius: 4px; cursor: pointer; }
  .ob:hover { background: var(--app-primary-hover); }
  .secondary-action { flex-shrink: 0; padding: 10px 16px; font-size: 14px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 4px; cursor: pointer; }
  .secondary-action:hover { background: var(--app-control-hover); }
  .ob:disabled,
  .secondary-action:disabled { color: #858b91; cursor: default; opacity: 0.72; }
  .ob:disabled:hover { background: var(--app-primary); }
  .secondary-action:disabled:hover { background: var(--app-control); }
  .err { color: var(--app-error); font-size: 13px; white-space: pre-wrap; }
  .dict-status { color: var(--app-status); font-size: 13px; white-space: pre-wrap; }
  .recent { display: flex; flex-direction: column; gap: 10px; min-height: 240px; }
  .empty { padding: 28px 0; color: var(--app-muted); font-size: 13px; }
  .book-list { display: flex; flex-direction: column; gap: 8px; max-height: 54vh; overflow-y: auto; padding-right: 4px; }
  .book-row { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: stretch; gap: 8px; background: var(--app-surface); color: inherit; border: 1px solid var(--app-border); border-radius: 6px; }
  .book-row:hover { background: var(--app-surface-hover); border-color: var(--app-muted); }
  .book-open { min-width: 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; padding: 12px 14px; text-align: left; background: transparent; color: inherit; border: none; cursor: pointer; }
  .book-forget { align-self: center; margin-right: 8px; padding: 5px 9px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .book-forget:hover { background: var(--app-control-hover); color: var(--app-text); }
  .book-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; color: var(--app-text); }
  .book-meta { white-space: nowrap; font-size: 12px; color: var(--app-muted); }
  .book-path { grid-column: 1 / -1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: var(--app-muted); }
  .keys { margin-top: 2px; font-size: 12px; color: var(--app-muted); }
  @media (max-width: 640px) {
    .bookshelf { width: min(100vw - 32px, 920px); }
    .shelf-head { align-items: stretch; flex-direction: column; gap: 14px; }
    .head-actions { flex-wrap: wrap; }
    .head-actions button { flex: 1 1 148px; }
  }
</style>
