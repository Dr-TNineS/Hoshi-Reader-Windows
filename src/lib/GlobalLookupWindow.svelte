<script lang="ts">
  import { invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import {
    currentMonitor,
    cursorPosition,
    getCurrentWindow,
    LogicalPosition,
    LogicalSize,
    monitorFromPoint,
  } from "@tauri-apps/api/window";
  import { open } from "@tauri-apps/plugin-dialog";
  import { onMount } from "svelte";
  import { extractDictionaryMediaReferences } from "./anki-field-renderer";
  import { loadDictionarySettings } from "./dictionary-settings";
  import { dictionaryBatchStatusLabel } from "./dictionary-import-status";
  import { clearDictionaryStyleCache } from "./dictionary-style-cache";
  import { runDictionaryLookup } from "./dictionary-lookup-executor";
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import LookupPopupLayer, { type LookupPopupItem } from "./LookupPopupLayer.svelte";
  import { resultDictionaryLabel, type LookupState } from "./lookup-popup";
  import { loadLookupPopupSettings, type LookupPopupSettings } from "./lookup-popup-settings";
  import { LookupResultCache } from "./lookup-result-cache";
  import { createDictionarySearchState } from "./state/dictionary-search-state.svelte";
  import { createSettingsState } from "./state/settings.svelte";
  import type {
    DictImportBatchSummary,
    DictResult,
    DictionaryStatus,
    LookupAnkiPayload,
    ReaderSelection,
  } from "./types";

  interface GlobalLookupPayload {
    requestId: number;
    source: string;
    text: string | null;
    error: string | null;
  }

  const WINDOW_PADDING = 24;
  const WINDOW_CURSOR_OFFSET = 16;
  const rootPopupId = "root";
  const settings = createSettingsState();
  const searchState = createDictionarySearchState();
  const lookupResultCache = new LookupResultCache<DictResult>(32);
  const dictionarySettings = loadDictionarySettings();
  let popupSettings = $state<LookupPopupSettings>(loadLookupPopupSettings());
  let globalWindowStyle = $derived([
    settings.appearanceVars,
    `--global-lookup-popup-width:${popupSettings.width}px`,
    `--global-lookup-popup-height:${popupSettings.height}px`,
    `--global-lookup-popup-scale:${popupSettings.scale}`,
  ].join(";"));
  let windowFrameSync = 0;
  let status = $state("Waiting for selected text...");
  let error = $state("");
  let frame: HTMLElement | null = null;
  let bounds = $state<{ left: number; top: number; right: number; bottom: number } | null>(null);

  function syncBounds() {
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
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

  function refreshPopupSettings() {
    popupSettings = loadLookupPopupSettings();
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  async function syncWindowFrame(nextSettings: LookupPopupSettings): Promise<boolean> {
    if (!isTauriRuntime()) return true;
    const syncId = ++windowFrameSync;
    const width = nextSettings.width + WINDOW_PADDING;
    const height = nextSettings.height + WINDOW_PADDING;
    try {
      const currentWindow = getCurrentWindow();
      await currentWindow.setSize(new LogicalSize(width, height));

      const cursor = await cursorPosition();
      let monitor = await monitorFromPoint(cursor.x, cursor.y);
      if (!monitor) monitor = await currentMonitor();
      if (monitor) {
        const workLeft = monitor.workArea.position.x;
        const workTop = monitor.workArea.position.y;
        const workRight = workLeft + monitor.workArea.size.width;
        const workBottom = workTop + monitor.workArea.size.height;
        const physicalWidth = Math.round(width * monitor.scaleFactor);
        const physicalHeight = Math.round(height * monitor.scaleFactor);
        const x = clamp(cursor.x + WINDOW_CURSOR_OFFSET, workLeft, Math.max(workLeft, workRight - physicalWidth));
        const y = clamp(cursor.y + WINDOW_CURSOR_OFFSET, workTop, Math.max(workTop, workBottom - physicalHeight));
        await currentWindow.setPosition(new LogicalPosition(x / monitor.scaleFactor, y / monitor.scaleFactor));
      }

      if (syncId === windowFrameSync) requestAnimationFrame(syncBounds);
      return true;
    } catch (e) {
      console.warn("Cannot resize global lookup window.", e);
      return false;
    }
  }

  async function presentAfterFrameSync() {
    refreshPopupSettings();
    if (!isTauriRuntime()) return;
    if (!(await syncWindowFrame(popupSettings))) return;
    try {
      await invoke("global_lookup_show_window");
      requestAnimationFrame(syncBounds);
    } catch (e) {
      error = String(e);
    }
  }

  function rootResultsScrollTop(): number {
    return frame?.querySelector<HTMLElement>(".lookup-results")?.scrollTop ?? 0;
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

  async function lookupStatus(): Promise<DictionaryStatus> {
    return invoke<DictionaryStatus>("dict_status");
  }

  async function executeLookup(text: string, requestId: number, isCurrent: () => boolean) {
    return runDictionaryLookup({
      text,
      requestId,
      settings: dictionarySettings,
      isCurrent,
      lookupStatus,
      lookup: (nextText, nextRequestId, nextSettings) => invoke<DictResult[]>("dict_lookup", {
        text: nextText,
        requestId: nextRequestId,
        maxResults: nextSettings.maxResults,
        scanLength: nextSettings.scanLength,
      }),
      cache: lookupResultCache,
      fallbackStatus: lookupStatus,
    });
  }

  async function lookupRoot(text: string) {
    const query = text.trim();
    if (!query) {
      searchState.clearForBlankSubmit();
      status = "Select text in another app and press the global lookup shortcut.";
      error = "Selected text is empty.";
      return;
    }
    error = "";
    status = "Looking up selected text...";
    const requestId = searchState.nextRequestId();
    searchState.query = query;
    searchState.beginRootSearch(query, requestId);
    const lookup = await executeLookup(query, requestId, () => searchState.rootRequestId === requestId);
    if (!lookup || searchState.rootRequestId !== requestId) return;
    searchState.commitRootLookup(lookup.state, lookup.results, lookup.error);
    status = "";
  }

  function applyPayload(payload: GlobalLookupPayload | null | undefined) {
    if (!payload) return;
    refreshPopupSettings();
    if (payload.text?.trim()) {
      void lookupRoot(payload.text);
      return;
    }
    searchState.clearForBlankSubmit();
    status = "Select text in another app and press the global lookup shortcut.";
    error = payload.error ?? "No selected text was available.";
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
    const childId = `global-lookup-popup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (parentId === rootPopupId) {
      searchState.childPopups = [createChildPopup(childId, selection, requestId)];
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
    if (id === rootPopupId) {
      searchState.clearForBlankSubmit();
      status = "Waiting for selected text...";
      error = "";
      return;
    }
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
      sasayakiCueId: null,
      sasayakiAudioFilename: null,
      coverFilename: null,
      sourceBook: { title: "Global Lookup" },
      sourceChapter: {
        chapterIndex: 0,
        chapterNumber: 0,
        totalChapters: 0,
        idref: "global-lookup",
      },
    };
  }

  async function importDictionary() {
    if (!isTauriRuntime()) {
      status = "";
      error = "Dictionary import requires Tauri runtime.";
      return;
    }
    try {
      error = "";
      status = "Importing dictionaries...";
      const selected = await open({
        multiple: true,
        filters: [{ name: "Yomitan Dictionary", extensions: ["zip"] }],
      });
      if (!selected) {
        status = "Dictionary import cancelled.";
        return;
      }
      const zipPaths = Array.isArray(selected) ? selected : [selected];
      if (zipPaths.length === 0) {
        status = "Dictionary import cancelled.";
        return;
      }
      const summary = await invoke<DictImportBatchSummary>("dictionary_import_yomitan_zips", {
        zipPaths,
        lowRam: dictionarySettings.lowRamDictionaryImport,
      });
      clearDictionaryStyleCache();
      lookupResultCache.clear();
      status = dictionaryBatchStatusLabel(summary);
    } catch (e) {
      status = "";
      error = String(e);
    }
  }

  onMount(() => {
    let unlisten: UnlistenFn | null = null;
    const handleStorage = () => refreshPopupSettings();
    window.addEventListener("storage", handleStorage);
    syncBounds();
    if (!isTauriRuntime()) {
      error = "Global selected-text lookup requires Tauri runtime.";
      return () => window.removeEventListener("storage", handleStorage);
    }
    void (async () => {
      try {
        applyPayload(await invoke<GlobalLookupPayload | null>("global_lookup_take_pending"));
        unlisten = await listen<GlobalLookupPayload>("global-lookup-request", (event) => {
          applyPayload(event.payload);
          void presentAfterFrameSync();
        });
        await presentAfterFrameSync();
      } catch (e) {
        error = String(e);
      }
    })();
    return () => {
      window.removeEventListener("storage", handleStorage);
      void unlisten?.();
    };
  });

</script>

<svelte:window onresize={syncBounds} />

<main
  class="global-lookup-window"
  data-ui-portal-root
  data-theme={settings.readerAppearance.theme}
  style={globalWindowStyle}
>
  <section class="popup-shell" bind:this={frame} use:observeBounds data-popup-id={rootPopupId}>
    {#if status || error}
      <div class="status-stack" aria-live="polite">
        {#if status}<p class="message status-message">{status}</p>{/if}
        {#if error}<p class="message error-message">{error}</p>{/if}
      </div>
    {/if}

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
        onClose={closePopup}
        onImportDictionary={importDictionary}
        onNestedLookup={openChildLookup}
        onRedirectLookup={handleRedirectLookup}
        onScrolled={(popupId) => clearPopupChildren(popupId, true)}
        onNavigateHistory={handleNavigateHistory}
        canNavigateBack={searchState.rootHistoryBack.length > 0}
        canNavigateForward={searchState.rootHistoryForward.length > 0}
        {dictionarySettings}
        ankiSettings={null}
        ankiTitle={() => "Payload prepared for Global Lookup"}
        buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(searchState.rootSelection!, result, resultIndex)}
        onStoreAnkiMedia={async () => ({ stored: [], warnings: [] })}
        onStoreAnkiBookCover={async () => ({ filename: null, warnings: [] })}
        onStoreAnkiWordAudio={async () => ({ filename: null, warnings: [] })}
        onPrepareWordAudio={async () => ({ cachePath: null, mimeType: null, sourceName: null, warnings: [] })}
        onAddAnkiNote={async () => ({ status: "error", noteId: null, message: "Anki is not configured.", warnings: [] })}
        presentation="popup"
        scale={popupSettings.scale}
      />
    {:else}
      <div class="idle-popup" aria-hidden="true"></div>
    {/if}
  </section>

  <LookupPopupLayer
    popups={searchState.childPopups}
    {popupSettings}
    {dictionarySettings}
    ankiSettings={null}
    onClose={closePopup}
    onImportDictionary={importDictionary}
    onNestedLookup={openChildLookup}
    onRedirectLookup={handleRedirectLookup}
    onScrolled={(popupId) => clearPopupChildren(popupId, true)}
    onNavigateHistory={handleNavigateHistory}
    onPopupPointerDown={(popupId) => clearPopupChildren(popupId)}
    ankiTitle={() => "Payload prepared for Global Lookup"}
    {buildAnkiPayload}
    onStoreAnkiMedia={async () => ({ stored: [], warnings: [] })}
    onStoreAnkiBookCover={async () => ({ filename: null, warnings: [] })}
    onStoreAnkiWordAudio={async () => ({ filename: null, warnings: [] })}
    onStoreAnkiSasayakiAudio={async () => ({ filename: null, warnings: ["Sasayaki audio is not available from Global Lookup."] })}
    onPrepareWordAudio={async () => ({ cachePath: null, mimeType: null, sourceName: null, warnings: [] })}
    sasayakiPlaying={false}
    sasayakiAvailable={false}
    onSasayakiAction={() => {}}
    onAddAnkiNote={async () => ({ status: "error", noteId: null, message: "Anki is not configured.", warnings: [] })}
    {bounds}
  />
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow: hidden; font-family: "Segoe UI", sans-serif; background: var(--app-bg, #f2e2c9); }
  .global-lookup-window {
    --app-bg: #f2e2c9;
    --app-text: #332a1b;
    --app-muted: #5c5448;
    --app-surface: #f8f0e2;
    --app-border: #d8c5a5;
    --app-control: #f8f0e2;
    --app-control-hover: #ead9bd;
    --app-primary: #7a5d2d;
    --app-error: #9a3412;
    --app-status: #5f6f3a;
    --app-shadow: rgba(80, 53, 22, 0.2);
    --reader-body-font: "Yu Mincho", "Hiragino Mincho Pro", "MS Mincho", serif;
    width: min(100vw, calc(var(--global-lookup-popup-width, 360px) + 24px));
    height: min(100vh, calc(var(--global-lookup-popup-height, 320px) + 24px));
    display: flex;
    flex-direction: column;
    padding: 12px;
    background: var(--app-bg, #f2e2c9);
    color: var(--app-text, #332a1b);
    overflow: hidden;
  }
  .popup-shell { min-width: 0; min-height: 0; flex: 0 0 auto; width: min(var(--global-lookup-popup-width, 360px), calc(100vw - 24px)); height: min(var(--global-lookup-popup-height, 320px), calc(100vh - 24px)); display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--app-surface, #f8f0e2); color: var(--app-text, #332a1b); border: 1px solid var(--app-border, #d8c5a5); border-radius: 6px; box-shadow: 0 14px 38px var(--app-shadow, rgba(80, 53, 22, 0.2)); overflow: hidden; --popup-scale: var(--global-lookup-popup-scale, 1); }
  .status-stack { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; }
  .message { padding: 8px 10px; border: 1px solid var(--app-border, #d8c5a5); border-radius: 8px; font-size: 12px; line-height: 1.35; }
  .status-message { color: var(--app-status, #5f6f3a); background: color-mix(in srgb, var(--app-status, #5f6f3a) 10%, var(--app-bg, #f2e2c9)); }
  .error-message { color: var(--app-error, #9a3412); background: color-mix(in srgb, var(--app-error, #9a3412) 10%, var(--app-bg, #f2e2c9)); }
  .idle-popup { flex: 1 1 auto; min-height: 0; }
</style>
