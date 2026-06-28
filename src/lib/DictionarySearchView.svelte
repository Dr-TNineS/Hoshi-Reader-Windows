<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import LookupPopupLayer, { type LookupPopupItem } from "./LookupPopupLayer.svelte";
  import { buildDictionarySearchAnkiPayload } from "./dictionary-search-anki";
  import { defaultDictionarySettings, type DictionarySettings } from "./dictionary-settings";
  import { runDictionaryLookup } from "./dictionary-lookup-executor";
  import type { LookupResultCache } from "./lookup-result-cache";
  import type { LookupState } from "./lookup-popup";
  import type { DictionarySearchState } from "./state/dictionary-search-state.svelte";
  import type {
    AnkiAddNoteResult,
    AnkiDictionaryMediaRef,
    AnkiNoteRequest,
    AnkiSettings,
    AnkiStoreBookCoverResult,
    AnkiStoreMediaResult,
    AnkiStoreRemoteAudioResult,
    DictResult,
    DictionaryStatus,
    LookupAnkiPayload,
    ReaderSelection,
    WordAudioPlaybackResult,
    WordAudioResolveRequest,
  } from "./types";

  export interface DictionarySearchActions {
    lookupStatus: () => Promise<DictionaryStatus>;
    lookup: (text: string, requestId: number, settings: Pick<DictionarySettings, "maxResults" | "scanLength">) => Promise<DictResult[]>;
    fallbackStatus?: () => Promise<DictionaryStatus>;
    onStatusInvalidated?: () => void;
    onImportDictionary: () => void;
    cache?: LookupResultCache<DictResult>;
    onStoreAnkiMedia?: (media: AnkiDictionaryMediaRef[]) => Promise<AnkiStoreMediaResult>;
    onStoreAnkiBookCover?: (bookId: string) => Promise<AnkiStoreBookCoverResult>;
    onStoreAnkiWordAudio?: (request: WordAudioResolveRequest) => Promise<AnkiStoreRemoteAudioResult>;
    onPrepareWordAudio?: (request: WordAudioResolveRequest) => Promise<WordAudioPlaybackResult>;
    onAddAnkiNote?: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
  }

  let {
    searchState,
    actions,
    dictionarySettings = defaultDictionarySettings,
    ankiSettings = null,
    active = true,
  }: {
    searchState: DictionarySearchState;
    actions: DictionarySearchActions;
    dictionarySettings?: DictionarySettings;
    ankiSettings?: AnkiSettings | null;
    active?: boolean;
  } = $props();

  const rootPopupId = "dictionary-search-root";
  let searchInput: HTMLInputElement | null = null;
  let pageShell: HTMLElement | null = null;
  let bounds = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);

  function syncBounds() {
    if (!pageShell) return;
    const rect = pageShell.getBoundingClientRect();
    bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  function focusSearch(select = true) {
    requestAnimationFrame(() => {
      searchInput?.focus();
      if (select) searchInput?.select();
    });
  }

  $effect(() => {
    if (!active) return;
    searchState.focusSignal;
    focusSearch();
  });

  function rootResultsScrollTop(): number {
    return pageShell?.querySelector<HTMLElement>(".lookup-results")?.scrollTop ?? 0;
  }

  function popupResultsScrollTop(id: string): number {
    if (id === rootPopupId) return rootResultsScrollTop();
    const popup = [...document.querySelectorAll<HTMLElement>(".lookup-pop")]
      .find((element) => element.dataset.popupId === id);
    return popup?.querySelector<HTMLElement>(".lookup-results")?.scrollTop ?? 0;
  }

  function firstLookupMatchCount(results: DictResult[]): number {
    return Array.from(results[0]?.matched ?? "").length;
  }

  async function executeLookup(text: string, requestId: number, isCurrent: () => boolean) {
    return runDictionaryLookup({
      text,
      requestId,
      settings: dictionarySettings,
      isCurrent,
      lookupStatus: actions.lookupStatus,
      lookup: actions.lookup,
      cache: actions.cache,
      onStatusInvalidated: actions.onStatusInvalidated,
      fallbackStatus: actions.fallbackStatus,
    });
  }

  async function submitSearch() {
    const text = searchState.query.trim();
    if (!text) {
      searchState.clearForBlankSubmit();
      focusSearch(false);
      return;
    }

    const requestId = searchState.nextRequestId();
    searchState.beginRootSearch(text, requestId);
    const lookup = await executeLookup(text, requestId, () => searchState.rootRequestId === requestId);
    if (!lookup || searchState.rootRequestId !== requestId) return;
    searchState.commitRootLookup(lookup.state, lookup.results, lookup.error);
  }

  function clearQuery() {
    searchState.query = "";
    focusSearch(false);
  }

  function updateChildPopup(id: string, update: Partial<LookupPopupItem>) {
    searchState.childPopups = searchState.childPopups.map((popup) => popup.id === id ? { ...popup, ...update } : popup);
  }

  function popupIndex(id: string): number {
    return searchState.childPopups.findIndex((popup) => popup.id === id);
  }

  function createChildPopup(id: string, selection: ReaderSelection, requestId: number): LookupPopupItem {
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
      sasayakiCue: null,
    };
  }

  async function lookupChild(popupId: string, selection: ReaderSelection, requestId: number, highlightOwnerId: string | null = null) {
    const isCurrent = () => searchState.childPopups.some((popup) => popup.id === popupId && popup.requestId === requestId);
    const lookup = await executeLookup(selection.text, requestId, isCurrent);
    if (!lookup || !isCurrent()) return;
    const highlightCount = firstLookupMatchCount(lookup.results);
    searchState.childPopups = searchState.childPopups.map((popup) => {
      if (popup.id === popupId) {
        return { ...popup, state: lookup.state, error: lookup.error, results: lookup.results };
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
  }

  function openChildLookup(parentId: string, selection: ReaderSelection) {
    const requestId = searchState.nextRequestId();
    const childId = `dictionary-popup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (parentId === rootPopupId) {
      searchState.childPopups = [
        createChildPopup(childId, selection, requestId),
      ];
      void lookupChild(childId, selection, requestId);
      return;
    }

    const index = popupIndex(parentId);
    if (index < 0) return;
    searchState.childPopups = [
      ...searchState.childPopups.slice(0, index + 1).map((popup, popupIndex) => (
        popupIndex === index
          ? { ...popup, selectionHighlightCount: 0, selectionHighlightSignal: popup.selectionHighlightSignal + 1 }
          : popup
      )),
      createChildPopup(childId, selection, requestId),
    ];
    void lookupChild(childId, selection, requestId, parentId);
  }

  function closePopup(id: string) {
    const index = popupIndex(id);
    if (index < 0) return;
    searchState.invalidateRequests();
    searchState.childPopups = searchState.childPopups
      .slice(0, index)
      .map((popup, popupIndex) => (
        popupIndex === index - 1
          ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 }
          : popup
      ));
  }

  function clearPopupChildren(parentId: string, clearParentSelection = true) {
    if (parentId === rootPopupId) {
      searchState.childPopups = [];
      return;
    }
    const index = popupIndex(parentId);
    if (index < 0) return;
    searchState.childPopups = searchState.childPopups
      .slice(0, index + 1)
      .map((popup, popupIndex) => (
        clearParentSelection && popupIndex === index
          ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 }
          : popup
      ));
  }

  async function redirectRoot(selection: ReaderSelection) {
    const text = selection.text.trim();
    if (!text) return;
    const requestId = searchState.nextRequestId();
    searchState.pushRootRedirect(text, requestId, rootResultsScrollTop());
    const lookup = await executeLookup(text, requestId, () => searchState.rootRequestId === requestId);
    if (!lookup || searchState.rootRequestId !== requestId) return;
    searchState.commitRootLookup(lookup.state, lookup.results, lookup.error);
  }

  function redirectChild(popupId: string, selection: ReaderSelection) {
    const index = popupIndex(popupId);
    if (index < 0) return;
    const popup = searchState.childPopups[index];
    const requestId = searchState.nextRequestId();
    const scrollTop = popupResultsScrollTop(popupId);
    const redirectedSelection = {
      ...selection,
      rect: popup.selection.rect,
      anchorRect: popup.selection.anchorRect,
    };
    searchState.childPopups = searchState.childPopups
      .slice(0, index + 1)
      .map((item, itemIndex) => (
        itemIndex === index
          ? {
              ...item,
              selection: redirectedSelection,
              state: "loading" as LookupState,
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
    void lookupChild(popupId, redirectedSelection, requestId);
  }

  function handleRedirectLookup(popupId: string, selection: ReaderSelection) {
    if (popupId === rootPopupId) {
      void redirectRoot(selection);
      return;
    }
    redirectChild(popupId, selection);
  }

  function navigateRootHistory(direction: "back" | "forward") {
    searchState.restoreRootHistory(direction, rootResultsScrollTop());
  }

  function navigateChildHistory(popupId: string, direction: "back" | "forward") {
    const index = popupIndex(popupId);
    if (index < 0) return;
    const popup = searchState.childPopups[index];
    const from = direction === "back" ? popup.historyBack : popup.historyForward;
    if (from.length === 0) return;
    const current = { selection: popup.selection, scrollTop: popupResultsScrollTop(popupId) };
    const target = from[from.length - 1];
    const requestId = searchState.nextRequestId();
    searchState.childPopups = searchState.childPopups
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
    void lookupChild(popupId, target.selection, requestId);
  }

  function handleNavigateHistory(popupId: string, direction: "back" | "forward") {
    if (popupId === rootPopupId) navigateRootHistory(direction);
    else navigateChildHistory(popupId, direction);
  }

  function handleScrolled(popupId: string) {
    clearPopupChildren(popupId, true);
  }

  function ankiTitle(result: DictResult, resultIndex: number): string {
    return `Payload prepared for ${buildDictionarySearchAnkiPayload(searchState.lastQuery || searchState.query, result, resultIndex).sourceBook.title}`;
  }

  function buildAnkiPayload(result: DictResult, resultIndex: number): LookupAnkiPayload {
    return buildDictionarySearchAnkiPayload(searchState.lastQuery || searchState.query, result, resultIndex);
  }

  function observeBounds(node: HTMLElement) {
    syncBounds();
    const observer = new ResizeObserver(syncBounds);
    observer.observe(node);
    return {
      destroy() {
        observer.disconnect();
      },
    };
  }
</script>

<svelte:window onresize={syncBounds} />

<section class="dictionary-search" class:active bind:this={pageShell} data-dictionary-search onintrostart={syncBounds}>
  <header class="dictionary-search-head">
    <form class="dictionary-search-bar" role="search" onsubmit={(event) => { event.preventDefault(); void submitSearch(); }}>
      <span class="search-icon" aria-hidden="true">S</span>
      <input
        bind:this={searchInput}
        value={searchState.query}
        disabled={searchState.rootState === "loading"}
        aria-label="Dictionary search"
        placeholder="Search"
        autocomplete="off"
        oninput={(event) => searchState.query = event.currentTarget.value}
        onfocus={() => syncBounds()}
      />
      {#if searchState.query}
        <button class="clear-search" type="button" aria-label="Clear search" onclick={clearQuery}>x</button>
      {/if}
    </form>
  </header>

  <section class="dictionary-search-results" data-popup-id={rootPopupId} aria-label="Dictionary results" use:observeBounds>
    {#if searchState.rootSelection}
      <LookupPopupContent
        popupId={rootPopupId}
        requestId={searchState.rootRequestId}
        selection={searchState.rootSelection}
        state={searchState.rootState}
        error={searchState.rootError}
        results={searchState.rootResults}
        clearSelectionSignal={searchState.rootClearSelectionSignal}
        restoreScrollTop={searchState.rootRestoreScrollTop}
        restoreScrollSignal={searchState.rootRestoreScrollSignal}
        onClose={() => {}}
        onImportDictionary={actions.onImportDictionary}
        onNestedLookup={openChildLookup}
        onRedirectLookup={handleRedirectLookup}
        onScrolled={handleScrolled}
        onNavigateHistory={handleNavigateHistory}
        canNavigateBack={searchState.rootHistoryBack.length > 0}
        canNavigateForward={searchState.rootHistoryForward.length > 0}
        {dictionarySettings}
        {ankiSettings}
        {ankiTitle}
        {buildAnkiPayload}
        onStoreAnkiMedia={actions.onStoreAnkiMedia}
        onStoreAnkiBookCover={actions.onStoreAnkiBookCover}
        onStoreAnkiWordAudio={actions.onStoreAnkiWordAudio}
        onPrepareWordAudio={actions.onPrepareWordAudio}
        onAddAnkiNote={actions.onAddAnkiNote}
        presentation="page"
      />
    {:else}
      <div class="dictionary-search-idle" aria-hidden="true"></div>
    {/if}
  </section>

  <LookupPopupLayer
    popups={searchState.childPopups}
    popupSettings={{ width: 360, height: 320, scale: 1 }}
    {dictionarySettings}
    {ankiSettings}
    onClose={closePopup}
    onImportDictionary={actions.onImportDictionary}
    onNestedLookup={openChildLookup}
    onRedirectLookup={handleRedirectLookup}
    onScrolled={handleScrolled}
    onNavigateHistory={handleNavigateHistory}
    onPopupPointerDown={(popupId) => clearPopupChildren(popupId)}
    ankiTitle={(_selection, result, resultIndex) => ankiTitle(result, resultIndex)}
    buildAnkiPayload={(_selection, result, resultIndex) => buildAnkiPayload(result, resultIndex)}
    onStoreAnkiMedia={actions.onStoreAnkiMedia ?? (async () => ({ stored: [], warnings: [] }))}
    onStoreAnkiBookCover={actions.onStoreAnkiBookCover ?? (async () => ({ filename: null, warnings: [] }))}
    onStoreAnkiWordAudio={actions.onStoreAnkiWordAudio ?? (async () => ({ filename: null, warnings: [] }))}
    onStoreAnkiSasayakiAudio={async () => ({ filename: null, warnings: ["Sasayaki audio is not available from Dictionary Search."] })}
    onPrepareWordAudio={actions.onPrepareWordAudio ?? (async () => ({ cachePath: null, mimeType: null, sourceName: null, warnings: [] }))}
    sasayakiPlaying={false}
    sasayakiAvailable={false}
    onSasayakiAction={() => {}}
    onAddAnkiNote={actions.onAddAnkiNote ?? (async () => ({ status: "error", noteId: null, message: "Anki is not configured.", warnings: [] }))}
    {bounds}
  />
</section>

<style>
  .dictionary-search { position: relative; min-width: 0; min-height: 0; height: 100%; display: flex; flex-direction: column; background: var(--app-bg); color: var(--app-text); overflow: hidden; }
  .dictionary-search-head { position: sticky; top: 0; z-index: 20; flex: 0 0 auto; padding: 10px 0 12px; background: var(--app-bg); border-bottom: 1px solid var(--app-border); }
  .dictionary-search-bar { min-width: 0; height: 54px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 0 14px 0 18px; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 12px; }
  .search-icon { color: var(--app-muted); font-size: 22px; line-height: 1; }
  .dictionary-search-bar input { min-width: 0; width: 100%; background: transparent; color: var(--app-text); border: 0; outline: 0; font: inherit; font-size: 18px; line-height: 1.3; }
  .dictionary-search-bar input::placeholder { color: var(--app-muted); }
  .dictionary-search-bar input:disabled { opacity: 0.72; }
  .clear-search { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--app-muted); border: 0; border-radius: 6px; cursor: pointer; font-size: 24px; line-height: 1; }
  .clear-search:hover { background: var(--app-control); color: var(--app-text); }
  .dictionary-search-results { min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; padding-top: 10px; overflow: hidden; }
  .dictionary-search-idle { flex: 1 1 auto; }
  @media (max-width: 640px) {
    .dictionary-search-head { padding-top: 2px; }
    .dictionary-search-bar { height: 50px; border-radius: 10px; }
    .dictionary-search-bar input { font-size: 16px; }
  }
</style>

