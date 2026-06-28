<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import { defaultDictionarySettings, type DictionarySettings } from "./dictionary-settings";
  import { lookupPopupStyle } from "./lookup-popup-position";
  import type { LookupState } from "./lookup-popup";
  import { defaultLookupPopupSettings, type LookupPopupSettings } from "./lookup-popup-settings";
  import type {
    AnkiAddNoteResult,
    AnkiDictionaryMediaRef,
    AnkiNoteRequest,
    AnkiSettings,
    AnkiStoreMediaResult,
    AnkiStoreBookCoverResult,
    AnkiStoreRemoteAudioResult,
    AnkiStoreSasayakiAudioResult,
    DictResult,
    LookupAnkiPayload,
    WordAudioPlaybackResult,
    WordAudioResolveRequest,
    ReaderSelection,
    SasayakiPlaybackCue,
  } from "./types";

  type SasayakiPopupAction = "replayCue" | "togglePlayback" | "playForward";

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
    selectionHighlightCount: number;
    selectionHighlightSignal: number;
    historyBack: LookupPopupHistoryEntry[];
    historyForward: LookupPopupHistoryEntry[];
    restoreScrollTop: number;
    restoreScrollSignal: number;
    sasayakiCue?: SasayakiPlaybackCue | null;
  };

  let {
    rootPopup = null,
    popups = [],
    ankiSettings = null,
    popupSettings = defaultLookupPopupSettings,
    dictionarySettings = defaultDictionarySettings,
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
    onStoreAnkiSasayakiAudio,
    onPrepareWordAudio,
    onWordAudioPlaybackStart,
    onWordAudioPlaybackEnd,
    sasayakiPlaying = false,
    sasayakiAvailable = false,
    onSasayakiAction,
    onAddAnkiNote,
    bounds = null,
  }: {
    rootPopup?: LookupPopupItem | null;
    popups?: LookupPopupItem[];
    ankiSettings?: AnkiSettings | null;
    popupSettings?: LookupPopupSettings;
    dictionarySettings?: DictionarySettings;
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
    onStoreAnkiSasayakiAudio: (bookId: string, cueId: string, sentence: string) => Promise<AnkiStoreSasayakiAudioResult>;
    onPrepareWordAudio: (request: WordAudioResolveRequest) => Promise<WordAudioPlaybackResult>;
    onWordAudioPlaybackStart?: () => number | void;
    onWordAudioPlaybackEnd?: (coordinationId: number | void) => void;
    sasayakiPlaying?: boolean;
    sasayakiAvailable?: boolean;
    onSasayakiAction?: (popupId: string, action: SasayakiPopupAction) => void;
    onAddAnkiNote: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
    bounds?: { left: number; top: number; right: number; bottom: number } | null;
  } = $props();

  let viewportWidth = $state(window.innerWidth);
  let viewportHeight = $state(window.innerHeight);

  function readerBottomBoundary(): number {
    if (bounds) return bounds.bottom;
    const controls = document.querySelector<HTMLElement>(".ctrls");
    const readerViewport = document.querySelector<HTMLElement>(".rv");
    const controlsTop = controls?.getBoundingClientRect().top ?? window.innerHeight;
    const readerBottom = readerViewport?.getBoundingClientRect().bottom ?? window.innerHeight;
    return Math.min(window.innerHeight, controlsTop, readerBottom);
  }

  function syncViewport() {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
  }

  function popupStyle(selection: ReaderSelection): string {
    const bottom = Math.min(viewportHeight, readerBottomBoundary());
    const left = bounds?.left ?? 0;
    const right = bounds?.right ?? viewportWidth;
    const top = bounds?.top;
    const size = {
      width: Math.max(1, Math.min(popupSettings.width, right - left - 24)),
      height: Math.max(1, Math.min(popupSettings.height, bottom - (top ?? 44))),
    };
    const position = lookupPopupStyle(selection, size, {
      width: viewportWidth,
      bottom,
      left,
      right,
      top,
    });
    return `${position};width:${size.width}px;height:${size.height}px;--popup-scale:${popupSettings.scale}`;
  }
</script>

<svelte:window onresize={syncViewport} />

{#if rootPopup}
  <section class="lookup-root-frame" data-popup-id={rootPopup.id}>
    <LookupPopupContent
      popupId={rootPopup.id}
      requestId={rootPopup.requestId}
      selection={rootPopup.selection}
      state={rootPopup.state}
      error={rootPopup.error}
      results={rootPopup.results}
      clearSelectionSignal={rootPopup.clearSelectionSignal}
      selectionHighlightCount={rootPopup.selectionHighlightCount}
      selectionHighlightSignal={rootPopup.selectionHighlightSignal}
      onClose={onClose}
      onImportDictionary={onImportDictionary}
      onNestedLookup={onNestedLookup}
      onRedirectLookup={onRedirectLookup}
      onScrolled={onScrolled}
      onNavigateHistory={onNavigateHistory}
      canNavigateBack={rootPopup.historyBack.length > 0}
      canNavigateForward={rootPopup.historyForward.length > 0}
      restoreScrollTop={rootPopup.restoreScrollTop}
      restoreScrollSignal={rootPopup.restoreScrollSignal}
      {dictionarySettings}
      ankiTitle={(result, resultIndex) => ankiTitle(rootPopup.selection, result, resultIndex)}
      {ankiSettings}
      buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(rootPopup.selection, result, resultIndex)}
      onStoreAnkiMedia={onStoreAnkiMedia}
      onStoreAnkiBookCover={onStoreAnkiBookCover}
      onStoreAnkiWordAudio={onStoreAnkiWordAudio}
      onStoreAnkiSasayakiAudio={onStoreAnkiSasayakiAudio}
      onPrepareWordAudio={onPrepareWordAudio}
      onWordAudioPlaybackStart={onWordAudioPlaybackStart}
      onWordAudioPlaybackEnd={onWordAudioPlaybackEnd}
      sasayakiCue={rootPopup.sasayakiCue ?? null}
      {sasayakiPlaying}
      sasayakiAvailable={false}
      onSasayakiAction={onSasayakiAction}
      onAddAnkiNote={onAddAnkiNote}
      presentation="page"
      scale={popupSettings.scale}
    />
  </section>
{/if}

{#each popups as popup, popupIndex (popup.id)}
  <aside
    class="lookup-pop"
    data-popup-id={popup.id}
    onpointerdown={() => onPopupPointerDown(popup.id)}
    style={`${popupStyle(popup.selection)};--popup-z:${125 + popupIndex}`}
  >
    <LookupPopupContent
      popupId={popup.id}
      requestId={popup.requestId}
      selection={popup.selection}
      state={popup.state}
      error={popup.error}
      results={popup.results}
      clearSelectionSignal={popup.clearSelectionSignal}
      selectionHighlightCount={popup.selectionHighlightCount}
      selectionHighlightSignal={popup.selectionHighlightSignal}
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
      {dictionarySettings}
      ankiTitle={(result, resultIndex) => ankiTitle(popup.selection, result, resultIndex)}
      {ankiSettings}
      buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(popup.selection, result, resultIndex)}
      onStoreAnkiMedia={onStoreAnkiMedia}
      onStoreAnkiBookCover={onStoreAnkiBookCover}
      onStoreAnkiWordAudio={onStoreAnkiWordAudio}
      onStoreAnkiSasayakiAudio={onStoreAnkiSasayakiAudio}
      onPrepareWordAudio={onPrepareWordAudio}
      onWordAudioPlaybackStart={onWordAudioPlaybackStart}
      onWordAudioPlaybackEnd={onWordAudioPlaybackEnd}
      sasayakiCue={popup.sasayakiCue ?? null}
      {sasayakiPlaying}
      {sasayakiAvailable}
      onSasayakiAction={onSasayakiAction}
      onAddAnkiNote={onAddAnkiNote}
      scale={popupSettings.scale}
    />
  </aside>
{/each}

<style>
  .lookup-root-frame { min-width: 0; min-height: 0; flex: 1 1 auto; display: flex; flex-direction: column; overflow: hidden; }
  .lookup-pop { position: fixed; z-index: var(--popup-z); display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; background: var(--app-surface); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 14px 38px var(--app-shadow); overflow: hidden; }
</style>
