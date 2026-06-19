<script lang="ts">
  import { convertFileSrc } from "@tauri-apps/api/core";
  import AnkiConnectPanel from "./AnkiConnectPanel.svelte";
  import type { AnkiAudioSource, AnkiSettings, DictionaryManifestEntry, DictionaryStatus } from "./types";
  import AppearancePanel from "./AppearancePanel.svelte";
  import type { ReaderAppearance, ReaderTheme } from "./appearance";
  import DictionaryManagementPanel from "./DictionaryManagementPanel.svelte";
  import { bookRecordKey, type BookRecord } from "./storage";

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

  type ShelfPanel = "library" | "dictionaries" | "anki" | "appearance";

  let activePanel = $state<ShelfPanel>("library");
  let failedCoverKeys = $state<Set<string>>(new Set());

  const navItems: { id: ShelfPanel; label: string; detail: string; marker: string }[] = [
    { id: "library", label: "Library", detail: "Recent EPUBs", marker: "LI" },
    { id: "dictionaries", label: "Dictionaries", detail: "Lookup imports", marker: "DI" },
    { id: "anki", label: "Anki", detail: "AnkiConnect", marker: "AN" },
    { id: "appearance", label: "Appearance", detail: "Reader theme", marker: "AP" },
  ];

  function panelTitle(panel: ShelfPanel): string {
    return navItems.find((item) => item.id === panel)?.label ?? "Library";
  }

  function coverUrl(book: BookRecord): string {
    return book.coverPath ? convertFileSrc(book.coverPath) : "";
  }

  function coverFailed(book: BookRecord): boolean {
    return failedCoverKeys.has(bookRecordKey(book));
  }

  function markCoverFailed(book: BookRecord) {
    failedCoverKeys = new Set([...failedCoverKeys, bookRecordKey(book)]);
  }

  function progressPercent(book: BookRecord): number {
    const percent = book.percent ?? 0;
    if (!Number.isFinite(percent)) return 0;
    return Math.max(0, Math.min(percent, 100));
  }

  function progressLabel(book: BookRecord): string {
    return `${progressPercent(book).toFixed(1)}%`;
  }

  function ensurePanel(panel: ShelfPanel) {
    if (activePanel === panel) return;

    if (activePanel === "dictionaries" && showDictionaryManager) onToggleDictionaryManager();
    if (activePanel === "anki" && showAnkiPanel) onToggleAnkiPanel();
    if (activePanel === "appearance" && showAppearancePanel) onToggleAppearancePanel();

    activePanel = panel;

    if (panel === "dictionaries" && !showDictionaryManager) onToggleDictionaryManager();
    if (panel === "anki" && !showAnkiPanel) onToggleAnkiPanel();
    if (panel === "appearance" && !showAppearancePanel) onToggleAppearancePanel();
  }

</script>

<section class="bookshelf">
  <aside class="sidebar" aria-label="Bookshelf navigation">
    <div class="brand">
      <div class="brand-mark">HR</div>
      <div>
        <h1>Hoshi Reader</h1>
        <p>Windows</p>
      </div>
    </div>

    <nav class="side-nav">
      {#each navItems as item}
        <button
          class:active={activePanel === item.id}
          aria-current={activePanel === item.id ? "page" : undefined}
          onclick={() => ensurePanel(item.id)}
        >
          <span class="nav-marker" aria-hidden="true">{item.marker}</span>
          <span class="nav-copy">
            <span>{item.label}</span>
            <small>{item.detail}</small>
          </span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="panel-shell">
    <header class="panel-head">
      <div>
        <h2>{panelTitle(activePanel)}</h2>
      </div>
      {#if activePanel === "library"}
        <button class="open-epub head-open" disabled={bookImportBusy} onclick={onOpenBook}>
          {bookImportBusy ? "Importing..." : "Open EPUB"}
        </button>
      {/if}
    </header>

    <div class="status-stack" aria-live="polite">
      {#if error}<p class="message error-message">{error}</p>{/if}
      {#if dictionaryStatus}<p class="message status-message">{dictionaryStatus}</p>{/if}
    </div>

    {#if activePanel === "library"}
      <section class="library-panel">
        <div class="recent">
          <div class="section-head">
            <h3>Recent Books</h3>
          </div>
          {#if books.length === 0}
            <div class="empty-state">
              <div class="empty-mark">EPUB</div>
              <div>
                <p>No recent books yet.</p>
                <span>Use Open EPUB to import a book and start the reading flow.</span>
              </div>
            </div>
          {:else}
            <div class="book-grid">
              {#each books as book (bookRecordKey(book))}
                <article class="book-card">
                  <button class="book-open" onclick={() => onContinueBook(book)}>
                    <span class="book-cover" aria-hidden="true">
                      {#if book.coverPath && !coverFailed(book)}
                        <img src={coverUrl(book)} alt="" loading="lazy" onerror={() => markCoverFailed(book)} />
                      {:else}
                        <span>EPUB</span>
                      {/if}
                    </span>
                    <span class="book-progress-row">
                      <span class="book-progress" style={`--progress: ${progressPercent(book)}%`}>
                        <span></span>
                      </span>
                      <span class="book-percent">{progressLabel(book)}</span>
                    </span>
                    <span class="book-title">{book.title}</span>
                  </button>
                  <button class="book-forget" title="Forget book" onclick={() => onForgetBook(book)}>Forget</button>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    {:else if activePanel === "dictionaries"}
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
    {:else if activePanel === "anki"}
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
    {:else}
      <AppearancePanel
        appearance={readerAppearance}
        themeLabels={readerThemeLabels}
        onThemeChange={onSetReaderTheme}
      />
    {/if}
  </main>
</section>

<style>
  .bookshelf { width: 100vw; height: 100vh; display: grid; grid-template-columns: 248px minmax(0, 1fr); background: var(--app-bg); color: var(--app-text); overflow: hidden; }
  .sidebar { min-width: 0; display: flex; flex-direction: column; gap: 24px; padding: 22px 16px; background: color-mix(in srgb, var(--app-surface) 76%, var(--app-bg)); border-right: 1px solid var(--app-border); }
  .brand { min-width: 0; display: flex; align-items: center; gap: 12px; padding: 2px 4px 8px; }
  .brand-mark { width: 42px; height: 42px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background: var(--app-primary); color: var(--app-bg); border-radius: 8px; font-size: 13px; font-weight: 700; letter-spacing: 0; }
  h1 { font-size: 18px; font-weight: 650; color: var(--app-text); letter-spacing: 0; line-height: 1.2; }
  .brand p { margin-top: 2px; color: var(--app-muted); font-size: 12px; }
  .side-nav { display: flex; flex-direction: column; gap: 6px; }
  .side-nav button { width: 100%; min-width: 0; display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; padding: 9px 10px; text-align: left; background: transparent; color: var(--app-text); border: 1px solid transparent; border-radius: 8px; cursor: pointer; }
  .side-nav button:hover { background: var(--app-control); border-color: var(--app-border); }
  .side-nav button.active { background: var(--app-control-hover); border-color: var(--app-primary); }
  .nav-marker { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: var(--app-bg); color: var(--app-muted); border: 1px solid var(--app-border); border-radius: 8px; font-size: 11px; font-weight: 700; letter-spacing: 0; }
  .side-nav button.active .nav-marker { background: var(--app-primary); color: var(--app-bg); border-color: var(--app-primary); }
  .nav-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .nav-copy span, .nav-copy small { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-copy span { font-size: 14px; font-weight: 600; }
  .nav-copy small { color: var(--app-muted); font-size: 11px; }
  .open-epub { min-height: 40px; padding: 0 16px; background: var(--app-primary); color: var(--app-bg); border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 650; }
  .open-epub:hover:not(:disabled) { background: var(--app-primary-hover); }
  .open-epub:disabled { cursor: default; opacity: 0.7; }
  .panel-shell { min-width: 0; height: 100vh; display: flex; flex-direction: column; gap: 18px; padding: 30px clamp(24px, 4vw, 56px); overflow-y: auto; }
  .panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
  h2 { color: var(--app-text); font-size: 30px; font-weight: 650; letter-spacing: 0; line-height: 1.15; }
  .head-open { flex-shrink: 0; min-width: 132px; }
  .status-stack { display: flex; flex-direction: column; gap: 8px; }
  .message { padding: 10px 12px; border: 1px solid var(--app-border); border-radius: 8px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
  .error-message { color: var(--app-error); background: color-mix(in srgb, var(--app-error) 10%, var(--app-bg)); }
  .status-message { color: var(--app-status); background: color-mix(in srgb, var(--app-status) 10%, var(--app-bg)); }
  .library-panel { min-width: 0; display: flex; flex-direction: column; gap: 20px; }
  .recent { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
  .section-head { display: flex; align-items: end; justify-content: space-between; gap: 18px; }
  h3 { color: var(--app-text); font-size: 16px; font-weight: 650; letter-spacing: 0; }
  .empty-state { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 16px; align-items: center; min-height: 148px; padding: 22px; background: var(--app-surface); border: 1px dashed var(--app-border); border-radius: 8px; }
  .empty-mark { width: 80px; height: 112px; display: flex; align-items: center; justify-content: center; background: linear-gradient(160deg, var(--app-control), var(--app-bg)); color: var(--app-muted); border: 1px solid var(--app-border); border-radius: 6px; font-size: 12px; font-weight: 700; }
  .empty-state p { color: var(--app-text); font-size: 15px; font-weight: 650; }
  .empty-state span { display: block; margin-top: 5px; color: var(--app-muted); font-size: 13px; line-height: 1.4; }
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 184px)); gap: 22px 18px; align-items: start; padding-bottom: 24px; }
  .book-card { position: relative; min-width: 0; }
  .book-open { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 0; text-align: left; background: transparent; color: inherit; border: none; cursor: pointer; }
  .book-open:hover .book-cover { border-color: var(--app-muted); background: var(--app-surface-hover); }
  .book-cover { position: relative; width: 100%; aspect-ratio: 0.7; display: flex; align-items: center; justify-content: center; overflow: hidden; background: linear-gradient(155deg, var(--app-control), var(--app-bg)); color: var(--app-muted); border: 1px solid var(--app-border); border-radius: 8px; box-shadow: 0 8px 22px color-mix(in srgb, #000 20%, transparent); font-size: 13px; font-weight: 700; line-height: 1.2; transition: border-color 120ms ease, background 120ms ease; }
  .book-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .book-cover span { padding: 8px; overflow-wrap: anywhere; text-align: center; }
  .book-progress-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .book-progress { height: 5px; min-width: 0; overflow: hidden; background: var(--app-border); border-radius: 999px; }
  .book-progress span { display: block; width: var(--progress); height: 100%; background: var(--app-primary); border-radius: inherit; }
  .book-percent { color: var(--app-muted); font-size: 13px; font-weight: 650; line-height: 1; }
  .book-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text); font-size: 15px; line-height: 1.35; }
  .book-forget { position: absolute; top: 8px; right: 8px; min-height: 28px; padding: 0 8px; background: color-mix(in srgb, var(--app-bg) 82%, transparent); color: var(--app-text); border: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent); border-radius: 6px; cursor: pointer; font-size: 11px; opacity: 0; transition: opacity 120ms ease, background 120ms ease; }
  .book-card:hover .book-forget, .book-forget:focus-visible { opacity: 1; }
  .book-forget:hover { background: var(--app-control-hover); }
  @media (max-width: 760px) {
    .bookshelf { grid-template-columns: 74px minmax(0, 1fr); }
    .sidebar { padding: 14px 8px; gap: 18px; align-items: center; }
    .brand { padding: 0; }
    .brand div:not(.brand-mark), .nav-copy { display: none; }
    .side-nav button { grid-template-columns: 1fr; padding: 8px; }
    .nav-marker { margin: 0 auto; }
    .panel-shell { padding: 22px 16px; }
    .panel-head { flex-direction: column; }
    .head-open { width: 100%; }
    .section-head { align-items: start; flex-direction: column; gap: 4px; }
    .book-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 14px; }
    .book-forget { opacity: 1; }
    .empty-state { grid-template-columns: 1fr; }
  }
</style>
