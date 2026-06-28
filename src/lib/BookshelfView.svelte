<script lang="ts">
  import AnkiConnectPanel from "./AnkiConnectPanel.svelte";
  import BookCoverImage from "./BookCoverImage.svelte";
  import SasayakiBookPanel from "./SasayakiBookPanel.svelte";
  import type { AnkiAudioSource, AnkiSettings, DictionaryManifestEntry, DictionaryStatus, LocalAudioStatus, SasayakiCueItem, SasayakiStatus } from "./types";
  import AppearancePanel from "./AppearancePanel.svelte";
  import type { ReaderAppearance, ReaderAppearanceColorField, ReaderInterfaceTheme, ReaderTheme } from "./appearance";
  import type { DictionarySettings } from "./dictionary-settings";
  import type { LookupPopupSettings } from "./lookup-popup-settings";
  import DictionaryManagementPanel from "./DictionaryManagementPanel.svelte";
  import DictionarySearchView, { type DictionarySearchActions } from "./DictionarySearchView.svelte";
  import ShortcutsPanel from "./ShortcutsPanel.svelte";
  import AdvancedPanel from "./AdvancedPanel.svelte";
  import type { AdvancedSettings } from "./advanced-settings";
  import type { DictionarySearchState } from "./state/dictionary-search-state.svelte";
  import { bookRecordKey, type BookRecord } from "./storage";
  import ConfirmDialog from "./ui/ConfirmDialog.svelte";

  let {
    books,
    error = "",
    dictionaryStatus = "",
    dictionaryBusy = false,
    bookImportBusy = false,
    readerAppearance,
    readerThemeLabels,
    advancedSettings,
    lookupPopupSettings,
    dictionarySettings,
    dictionaryList = [],
    dictionaryListStatus = null,
    dictionaryListError = "",
    dictionarySearchState,
    dictionarySearchActions,
    ankiSettings = null,
    ankiEndpointDraft = "http://127.0.0.1:8765",
    ankiStatus = "",
    ankiError = "",
    ankiBusy = false,
    ankiTemplateOptions = [],
    localAudioStatus = { imported: false, sizeBytes: null, sources: [] },
    onOpenBook,
    onContinueBook,
    onForgetBook,
    onSetReaderTheme,
    onSetReaderInterface,
    onSetReaderAppearanceColor,
    onSetReopenLastBookOnStartup,
    onSetLookupPopupWidth,
    onSetLookupPopupHeight,
    onSetLookupPopupScale,
    onDictionarySettingsChange,
    onRefreshDictionaries,
    onImportDictionary,
    onImportDictionaryFolder,
    onUpdateDictionaries = () => {},
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
    onSetAnkiForceSyncAfterAdd = (_enabled: boolean) => {},
    onSetAnkiNoteOptions = (_tags: string, _allowDuplicates: boolean, _duplicateScope: AnkiSettings["duplicateScope"], _checkAllModels: boolean) => {},
    onSetAnkiCompactGlossaries = (_enabled: boolean) => {},
    onSetWordAudioPlaybackOptions = (_autoplay: boolean, _mode: AnkiSettings["audioPlaybackMode"]) => {},
    onSetAnkiLocalAudioEnabled = (_enabled: boolean) => {},
    onImportLocalAudio = () => {},
    onRemoveLocalAudio = () => {},
    onMoveLocalAudioSource = (_source: string, _direction: -1 | 1) => {},
    sasayakiBookId = null,
    sasayakiStatus = null,
    sasayakiCues = [],
    sasayakiMessage = "",
    sasayakiError = "",
    sasayakiBusy = false,
    onLoadSasayaki = (_book: BookRecord) => {},
    onImportSasayaki = (_book: BookRecord, _copyAudio: boolean) => {},
    onRemoveSasayaki = (_book: BookRecord) => {},
    onRematchSasayaki = (_book: BookRecord, _searchWindow: number) => {},
    onCorrectSasayakiCue = (_book: BookRecord, _cueId: string, _chapterIndex: number, _start: number, _length: number) => {},
    onClearSasayakiCorrection = (_book: BookRecord, _cueId: string) => {},
  }: {
    books: BookRecord[];
    error?: string;
    dictionaryStatus?: string;
    dictionaryBusy?: boolean;
    bookImportBusy?: boolean;
    readerAppearance: ReaderAppearance;
    readerThemeLabels: Record<ReaderTheme, string>;
    advancedSettings: AdvancedSettings;
    lookupPopupSettings: LookupPopupSettings;
    dictionarySettings: DictionarySettings;
    dictionaryList?: DictionaryManifestEntry[];
    dictionaryListStatus?: DictionaryStatus | null;
    dictionaryListError?: string;
    dictionarySearchState: DictionarySearchState;
    dictionarySearchActions: DictionarySearchActions;
    ankiSettings?: AnkiSettings | null;
    ankiEndpointDraft?: string;
    ankiStatus?: string;
    ankiError?: string;
    ankiBusy?: boolean;
    ankiTemplateOptions?: string[];
    localAudioStatus?: LocalAudioStatus;
    onOpenBook: () => void;
    onContinueBook: (book: BookRecord) => void;
    onForgetBook: (book: BookRecord) => void;
    onSetReaderTheme: (theme: ReaderTheme) => void;
    onSetReaderInterface: (theme: ReaderInterfaceTheme) => void;
    onSetReaderAppearanceColor: (field: ReaderAppearanceColorField, color: string) => void;
    onSetReopenLastBookOnStartup: (enabled: boolean) => void;
    onSetLookupPopupWidth: (width: number) => void;
    onSetLookupPopupHeight: (height: number) => void;
    onSetLookupPopupScale: (scale: number) => void;
    onDictionarySettingsChange: (update: Partial<DictionarySettings>) => void;
    onRefreshDictionaries: () => void;
    onImportDictionary: () => void;
    onImportDictionaryFolder: () => void;
    onUpdateDictionaries?: () => void;
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
    onSetAnkiForceSyncAfterAdd?: (enabled: boolean) => void;
    onSetAnkiNoteOptions?: (tags: string, allowDuplicates: boolean, duplicateScope: AnkiSettings["duplicateScope"], checkAllModels: boolean) => void;
    onSetAnkiCompactGlossaries?: (enabled: boolean) => void;
    onSetWordAudioPlaybackOptions?: (autoplay: boolean, mode: AnkiSettings["audioPlaybackMode"]) => void;
    onSetAnkiLocalAudioEnabled?: (enabled: boolean) => void;
    onImportLocalAudio?: () => void;
    onRemoveLocalAudio?: () => void;
    onMoveLocalAudioSource?: (source: string, direction: -1 | 1) => void;
    sasayakiBookId?: string | null;
    sasayakiStatus?: SasayakiStatus | null;
    sasayakiCues?: SasayakiCueItem[];
    sasayakiMessage?: string;
    sasayakiError?: string;
    sasayakiBusy?: boolean;
    onLoadSasayaki?: (book: BookRecord) => void;
    onImportSasayaki?: (book: BookRecord, copyAudio: boolean) => void;
    onRemoveSasayaki?: (book: BookRecord) => void;
    onRematchSasayaki?: (book: BookRecord, searchWindow: number) => void;
    onCorrectSasayakiCue?: (book: BookRecord, cueId: string, chapterIndex: number, start: number, length: number) => void;
    onClearSasayakiCorrection?: (book: BookRecord, cueId: string) => void;
  } = $props();

  type ShelfPanel = "library" | "dictionary" | "dictionaries" | "anki" | "appearance" | "advanced" | "shortcuts";

  let activePanel = $state<ShelfPanel>("library");
  let failedCoverKeys = $state<Set<string>>(new Set());
  let selectedSasayakiBook = $state<BookRecord | null>(null);

  const navItems: { id: ShelfPanel; label: string; detail: string; marker: string }[] = [
    { id: "library", label: "Library", detail: "Recent EPUBs", marker: "LI" },
    { id: "dictionary", label: "Dictionary", detail: "Search terms", marker: "DS" },
    { id: "dictionaries", label: "Dictionaries", detail: "Lookup imports", marker: "DI" },
    { id: "anki", label: "Anki", detail: "AnkiConnect", marker: "AN" },
    { id: "appearance", label: "Appearance", detail: "Reader theme", marker: "AP" },
    { id: "advanced", label: "Advanced", detail: "Startup behavior", marker: "AD" },
    { id: "shortcuts", label: "Shortcuts", detail: "Keyboard and mouse", marker: "SC" },
  ];

  function panelTitle(panel: ShelfPanel): string {
    return navItems.find((item) => item.id === panel)?.label ?? "Library";
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

  function forgetDescription(book: BookRecord): string {
    return book.bookId
      ? "This removes the book from the bookshelf and deletes the app-owned EPUB copy. The original EPUB file is not touched."
      : "This removes the legacy book record from the bookshelf. The original EPUB file is not touched.";
  }

  function ensurePanel(panel: ShelfPanel) {
    activePanel = panel;
    if (panel === "dictionary") dictionarySearchState.requestFocus();
  }

  function showSasayaki(book: BookRecord) {
    selectedSasayakiBook = book;
    onLoadSasayaki(book);
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
                        <BookCoverImage coverPath={book.coverPath} onFailure={() => markCoverFailed(book)} />
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
                  <ConfirmDialog
                    title={`Forget ${book.title || "this book"}?`}
                    description={forgetDescription(book)}
                    confirmLabel="Forget"
                    triggerAriaLabel={`Forget ${book.title || "book"}`}
                    triggerVariant="book-overlay"
                    onConfirm={() => onForgetBook(book)}
                  >
                    {#snippet trigger()}Forget{/snippet}
                  </ConfirmDialog>
                  {#if book.bookId}
                    <button
                      class="sasayaki-trigger"
                      aria-label={`Configure Sasayaki for ${book.title || "book"}`}
                      onclick={() => showSasayaki(book)}
                    >
                      Audio
                    </button>
                  {/if}
                </article>
              {/each}
            </div>
          {/if}
          {#if selectedSasayakiBook?.bookId}
            <SasayakiBookPanel
              book={selectedSasayakiBook}
              status={sasayakiBookId === selectedSasayakiBook.bookId ? sasayakiStatus : null}
              cues={sasayakiBookId === selectedSasayakiBook.bookId ? sasayakiCues : []}
              message={sasayakiBookId === selectedSasayakiBook.bookId ? sasayakiMessage : ""}
              error={sasayakiBookId === selectedSasayakiBook.bookId ? sasayakiError : ""}
              busy={sasayakiBookId === selectedSasayakiBook.bookId && sasayakiBusy}
              onClose={() => selectedSasayakiBook = null}
              onImport={(copyAudio) => onImportSasayaki(selectedSasayakiBook!, copyAudio)}
              onRemove={() => onRemoveSasayaki(selectedSasayakiBook!)}
              onRematch={(searchWindow) => onRematchSasayaki(selectedSasayakiBook!, searchWindow)}
              onCorrect={(cueId, chapterIndex, start, length) => onCorrectSasayakiCue(selectedSasayakiBook!, cueId, chapterIndex, start, length)}
              onClearCorrection={(cueId) => onClearSasayakiCorrection(selectedSasayakiBook!, cueId)}
            />
          {/if}
        </div>
      </section>
    {:else if activePanel === "dictionary"}
      <DictionarySearchView
        searchState={dictionarySearchState}
        actions={dictionarySearchActions}
        {dictionarySettings}
        popupSettings={lookupPopupSettings}
        {ankiSettings}
        active={activePanel === "dictionary"}
      />
    {:else if activePanel === "dictionaries"}
      <DictionaryManagementPanel
        dictionaries={dictionaryList}
        status={dictionaryListStatus}
        error={dictionaryListError}
        busy={dictionaryBusy}
        onRefresh={onRefreshDictionaries}
        onImport={onImportDictionary}
        onImportFolder={onImportDictionaryFolder}
        onUpdate={onUpdateDictionaries}
        onSetEnabled={onSetDictionaryEnabled}
        onMove={onMoveDictionary}
        onRemove={onRemoveDictionaryImport}
        settings={dictionarySettings}
        onSettingsChange={onDictionarySettingsChange}
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
        onSetForceSyncAfterAdd={onSetAnkiForceSyncAfterAdd}
        onSetNoteOptions={onSetAnkiNoteOptions}
        onSetCompactGlossaries={onSetAnkiCompactGlossaries}
        onSetWordAudioPlaybackOptions={onSetWordAudioPlaybackOptions}
        {localAudioStatus}
        onSetLocalAudioEnabled={onSetAnkiLocalAudioEnabled}
        onImportLocalAudio={onImportLocalAudio}
        onRemoveLocalAudio={onRemoveLocalAudio}
        onMoveLocalAudioSource={onMoveLocalAudioSource}
      />
    {:else if activePanel === "appearance"}
      <AppearancePanel
        appearance={readerAppearance}
        themeLabels={readerThemeLabels}
        onThemeChange={onSetReaderTheme}
        onInterfaceChange={onSetReaderInterface}
        onAppearanceColorChange={onSetReaderAppearanceColor}
        popupSettings={lookupPopupSettings}
        onPopupWidthChange={onSetLookupPopupWidth}
        onPopupHeightChange={onSetLookupPopupHeight}
        onPopupScaleChange={onSetLookupPopupScale}
      />
    {:else if activePanel === "advanced"}
      <AdvancedPanel
        settings={advancedSettings}
        onReopenLastBookOnStartupChange={onSetReopenLastBookOnStartup}
      />
    {:else if activePanel === "shortcuts"}
      <ShortcutsPanel />
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
  .book-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 160px)); gap: 20px; align-items: start; padding-bottom: 24px; }
  .book-card { position: relative; min-width: 0; }
  .sasayaki-trigger { position: absolute; top: 8px; left: 8px; min-height: 28px; padding: 5px 8px; background: color-mix(in srgb, var(--app-bg) 82%, transparent); color: var(--app-text); border: 1px solid color-mix(in srgb, var(--app-border) 80%, transparent); border-radius: 7px; cursor: pointer; font-size: 12px; opacity: 0; transition: opacity 120ms ease, background 120ms ease; }
  .book-card:hover .sasayaki-trigger, .sasayaki-trigger:focus-visible { opacity: 1; }
  .sasayaki-trigger:hover { background: var(--app-control-hover); }
  .sasayaki-trigger:focus-visible { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  .book-open { width: 100%; min-width: 0; display: flex; flex-direction: column; gap: 8px; padding: 0; text-align: left; background: transparent; color: inherit; border: none; cursor: pointer; }
  .book-open:hover .book-cover { border-color: var(--app-muted); background: var(--app-surface-hover); }
  .book-cover { position: relative; width: 100%; aspect-ratio: 0.709; display: flex; align-items: center; justify-content: center; overflow: hidden; padding: 3px; background: color-mix(in srgb, var(--app-control) 72%, var(--app-bg)); color: var(--app-muted); border: 1px solid var(--app-border); border-radius: 7px; box-shadow: 0 8px 22px color-mix(in srgb, #000 20%, transparent); font-size: 13px; font-weight: 700; line-height: 1.2; transition: border-color 120ms ease, background 120ms ease; }
  .book-cover :global(img) { width: 100%; height: 100%; object-fit: contain; display: block; background: color-mix(in srgb, var(--app-control) 55%, transparent); border-radius: 6px; }
  .book-cover span { padding: 8px; overflow-wrap: anywhere; text-align: center; }
  .book-progress-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; }
  .book-progress { height: 5px; min-width: 0; overflow: hidden; background: var(--app-border); border-radius: 999px; }
  .book-progress span { display: block; width: var(--progress); height: 100%; background: var(--app-primary); border-radius: inherit; }
  .book-percent { color: var(--app-muted); font-size: 13px; font-weight: 650; line-height: 1; }
  .book-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text); font-size: 15px; line-height: 1.35; }
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
    .book-grid { grid-template-columns: repeat(auto-fill, minmax(min(160px, 100%), 160px)); gap: 18px 14px; }
    .empty-state { grid-template-columns: 1fr; }
    .sasayaki-trigger { opacity: 1; }
  }
</style>
