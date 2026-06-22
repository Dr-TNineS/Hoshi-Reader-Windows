<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import { lookupPopupStyle } from "./lookup-popup-position";
  import type { LookupState } from "./lookup-popup";
  import type {
    AnkiAddNoteResult,
    AnkiDictionaryMediaRef,
    AnkiNoteRequest,
    AnkiSettings,
    AnkiStoreMediaResult,
    AnkiStoreBookCoverResult,
    AnkiStoreRemoteAudioResult,
    DictResult,
    LookupAnkiPayload,
    WordAudioPlaybackResult,
    WordAudioResolveRequest,
    ReaderSelection,
  } from "./types";

  type LookupPopupHistoryEntry = {
    selection: ReaderSelection;
    scrollTop: number;
  };

  export type LookupPopupItem = {
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
  };

  let {
    popups = [],
    ankiSettings = null,
    onClose,
    onImportDictionary,
    onNestedLookup,
    onRedirectLookup,
    onScrolled,
    onNavigateHistory,
    onPopupPointerDown,
    ankiTitle,
    buildAnkiPayload,
    onStoreAnkiMedia,
    onStoreAnkiBookCover,
    onStoreAnkiWordAudio,
    onPrepareWordAudio,
    onAddAnkiNote,
  }: {
    popups?: LookupPopupItem[];
    ankiSettings?: AnkiSettings | null;
    onClose: (popupId: string) => void;
    onImportDictionary: () => void;
    onNestedLookup: (popupId: string, selection: ReaderSelection) => void;
    onRedirectLookup: (popupId: string, selection: ReaderSelection) => void;
    onScrolled: (popupId: string) => void;
    onNavigateHistory: (popupId: string, direction: "back" | "forward") => void;
    onPopupPointerDown: (popupId: string) => void;
    ankiTitle: (selection: ReaderSelection, result: DictResult, resultIndex: number) => string;
    buildAnkiPayload: (selection: ReaderSelection, result: DictResult, resultIndex: number) => LookupAnkiPayload;
    onStoreAnkiMedia: (media: AnkiDictionaryMediaRef[]) => Promise<AnkiStoreMediaResult>;
    onStoreAnkiBookCover: (bookId: string) => Promise<AnkiStoreBookCoverResult>;
    onStoreAnkiWordAudio: (request: WordAudioResolveRequest) => Promise<AnkiStoreRemoteAudioResult>;
    onPrepareWordAudio: (request: WordAudioResolveRequest) => Promise<WordAudioPlaybackResult>;
    onAddAnkiNote: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
  } = $props();

  let lookupPopupSizes = $state<Record<string, { width: number; height: number }>>({});

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

{#each popups as popup, popupIndex (popup.id)}
  <aside
    class="lookup-pop"
    data-popup-id={popup.id}
    use:measureLookupPopup={popup.id}
    onpointerdown={() => onPopupPointerDown(popup.id)}
    style={`${popupStyle(popup.id, popup.selection)};--popup-z:${125 + popupIndex}`}
  >
    <LookupPopupContent
      popupId={popup.id}
      requestId={popup.requestId}
      selection={popup.selection}
      state={popup.state}
      error={popup.error}
      results={popup.results}
      clearSelectionSignal={popup.clearSelectionSignal}
      onClose={onClose}
      onImportDictionary={onImportDictionary}
      onNestedLookup={onNestedLookup}
      onRedirectLookup={onRedirectLookup}
      onScrolled={onScrolled}
      onNavigateHistory={onNavigateHistory}
      canNavigateBack={popup.historyBack.length > 0}
      canNavigateForward={popup.historyForward.length > 0}
      restoreScrollTop={popup.restoreScrollTop}
      restoreScrollSignal={popup.restoreScrollSignal}
      ankiTitle={(result, resultIndex) => ankiTitle(popup.selection, result, resultIndex)}
      {ankiSettings}
      buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(popup.selection, result, resultIndex)}
      onStoreAnkiMedia={onStoreAnkiMedia}
      onStoreAnkiBookCover={onStoreAnkiBookCover}
      onStoreAnkiWordAudio={onStoreAnkiWordAudio}
      onPrepareWordAudio={onPrepareWordAudio}
      onAddAnkiNote={onAddAnkiNote}
    />
  </aside>
{/each}

<style>
  .lookup-pop { position: fixed; z-index: var(--popup-z); display: flex; flex-direction: column; gap: 8px; max-height: min(520px, calc(100vh - 92px)); padding: 10px 12px; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 14px 38px var(--app-shadow); overflow: hidden; }
</style>
