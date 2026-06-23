<script lang="ts">
  import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
  import { ankiDictionaryMediaRefs, buildAnkiNoteRequest, isAnkiPreviewConfigured, payloadWithStoredBookCover, payloadWithStoredDictionaryMedia, payloadWithStoredRemoteAudio, renderAnkiFieldPreview } from "./anki-field-renderer";
  import { defaultDictionarySettings, type DictionarySettings } from "./dictionary-settings";
  import { loadCachedDictionaryStyles, type DictionaryStyleResource } from "./dictionary-style-cache";
  import { scopeDictionaryCss, type LookupPitchGroup, type LookupState } from "./lookup-popup";
  import { createLookupPopupViewModels, popupResultDictionaries } from "./lookup-popup-view-model";
  import { clearLookupHighlight, POPUP_LOOKUP_HIGHLIGHT, setLookupHighlightRange } from "./lookup-highlight";
  import { markLookupPerformance } from "./lookup-performance";
  import { popupSelectionPrefixRange, popupTextHitAtPoint, selectPopupTextFromHit, selectPopupTextFromPoint, type PopupTextHit, type PopupTextSelection } from "./popup-selection";
  import type { AnkiAddNoteResult, AnkiDictionaryMediaRef, AnkiFieldPreview, AnkiNoteRequest, AnkiSettings, AnkiStoreBookCoverResult, AnkiStoreMediaResult, AnkiStoreRemoteAudioResult, DictResult, LookupAnkiPayload, ReaderSelection, WordAudioPlaybackResult, WordAudioResolveRequest } from "./types";

  let {
    popupId,
    requestId = 0,
    selection,
    state: lookupState,
    error = "",
    results = [],
    clearSelectionSignal = 0,
    selectionHighlightCount = 0,
    selectionHighlightSignal = 0,
    onClose = () => {},
    onImportDictionary = () => {},
    onNestedLookup = () => {},
    onRedirectLookup = () => {},
    onScrolled = () => {},
    onNavigateHistory = () => {},
    canNavigateBack = false,
    canNavigateForward = false,
    restoreScrollTop = 0,
    restoreScrollSignal = 0,
    dictionarySettings = defaultDictionarySettings,
    loadDictionaryStyles,
    loadDictionaryMediaResource,
    ankiTitle = () => "Payload prepared for current book",
    ankiSettings = null,
    buildAnkiPayload,
    onStoreAnkiMedia,
    onStoreAnkiBookCover,
    onStoreAnkiWordAudio,
    onPrepareWordAudio,
    onAddAnkiNote,
  }: {
    popupId: string;
    requestId?: number;
    selection: ReaderSelection;
    state: LookupState;
    error?: string;
    results?: DictResult[];
    clearSelectionSignal?: number;
    selectionHighlightCount?: number;
    selectionHighlightSignal?: number;
    onClose?: (popupId: string) => void;
    onImportDictionary?: () => void;
    onNestedLookup?: (popupId: string, selection: ReaderSelection) => void;
    onRedirectLookup?: (popupId: string, selection: ReaderSelection) => void;
    onScrolled?: (popupId: string) => void;
    onNavigateHistory?: (popupId: string, direction: "back" | "forward") => void;
    canNavigateBack?: boolean;
    canNavigateForward?: boolean;
    restoreScrollTop?: number;
    restoreScrollSignal?: number;
    dictionarySettings?: DictionarySettings;
    loadDictionaryStyles?: (dictionary: string) => Promise<DictionaryStyleResource>;
    loadDictionaryMediaResource?: (dictionary: string, path: string) => Promise<DictionaryMediaResource>;
    ankiTitle?: (result: DictResult, resultIndex: number) => string;
    ankiSettings?: AnkiSettings | null;
    buildAnkiPayload?: (result: DictResult, resultIndex: number) => LookupAnkiPayload;
    onStoreAnkiMedia?: (media: AnkiDictionaryMediaRef[]) => Promise<AnkiStoreMediaResult>;
    onStoreAnkiBookCover?: (bookId: string) => Promise<AnkiStoreBookCoverResult>;
    onStoreAnkiWordAudio?: (request: WordAudioResolveRequest) => Promise<AnkiStoreRemoteAudioResult>;
    onPrepareWordAudio?: (request: WordAudioResolveRequest) => Promise<WordAudioPlaybackResult>;
    onAddAnkiNote?: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
  } = $props();

  let shiftHoverPoint: { x: number; y: number } | null = null;
  let shiftHoverFrame: number | null = null;
  let lastShiftHoverHit: PopupTextHit | null = null;
  let activeSelectionRange: Range | null = null;
  let lastAppliedSelectionHighlightCount = -1;
  let suppressNextScrollAfterNestedLookup = false;
  let previousClearSelectionSignal: number | null = null;
  let previousRestoreScrollSignal: number | null = null;
  let contentRoot: HTMLDivElement | null = null;
  let dictionaryStyleCss = $state("");
  let ankiPreviewKey = $state("");
  let ankiActionKey = $state("");
  let ankiActionState = $state<"idle" | "adding" | "added" | "duplicate" | "error">("idle");
  let ankiActionMessage = $state("");
  let ankiMediaWarnings = $state<string[]>([]);
  let ankiAudioHint = $state("");
  let wordAudioKey = $state("");
  let wordAudioState = $state<"idle" | "loading" | "playing" | "error">("idle");
  let wordAudioMessage = $state("");
  let wordAudioElement: HTMLAudioElement | null = null;
  let wordAudioRequestGeneration = 0;
  let lastAutoplayKey = "";
  let styleRequestId = 0;
  let firstPaintRequestId = 0;
  const styleTag = "style";
  const canPreviewAnki = $derived(isAnkiPreviewConfigured(ankiSettings) && Boolean(buildAnkiPayload));
  const popupSelectionOptions = $derived({
    maxLength: dictionarySettings.scanLength,
    scanNonJapaneseText: dictionarySettings.scanNonJapaneseText,
  });
  const renderedResults = $derived(createLookupPopupViewModels(results, {
    harmonicFrequency: dictionarySettings.harmonicFrequency,
    deduplicatePitchAccents: dictionarySettings.deduplicatePitchAccents,
  }));

  interface DictionaryMediaResource {
    mimeType: string;
    dataBase64: string;
  }

  function cancelShiftHoverFrame() {
    if (shiftHoverFrame === null) return;
    window.cancelAnimationFrame(shiftHoverFrame);
    shiftHoverFrame = null;
  }

  function resetShiftHover() {
    cancelShiftHoverFrame();
    shiftHoverPoint = null;
    lastShiftHoverHit = null;
  }

  function clearActiveSelectionRange() {
    activeSelectionRange?.detach();
    activeSelectionRange = null;
    lastAppliedSelectionHighlightCount = -1;
    clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
  }

  function applySelectionHighlight(characterCount: number) {
    if (!activeSelectionRange || characterCount === lastAppliedSelectionHighlightCount) return;
    if (characterCount <= 0) {
      clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
      lastAppliedSelectionHighlightCount = 0;
      return;
    }
    const prefix = popupSelectionPrefixRange(activeSelectionRange, characterCount);
    if (!prefix) {
      clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
      lastAppliedSelectionHighlightCount = characterCount;
      return;
    }
    setLookupHighlightRange(POPUP_LOOKUP_HIGHLIGHT, prefix);
    prefix.detach();
    lastAppliedSelectionHighlightCount = characterCount;
  }

  function activatePopupSelection(result: PopupTextSelection) {
    clearActiveSelectionRange();
    activeSelectionRange = result.range;
    lastAppliedSelectionHighlightCount = 0;
    clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
  }

  function suppressImmediateNestedLookupScroll() {
    suppressNextScrollAfterNestedLookup = true;
    requestAnimationFrame(() => {
      suppressNextScrollAfterNestedLookup = false;
    });
  }

  $effect(() => {
    return () => {
      resetShiftHover();
      clearActiveSelectionRange();
    };
  });

  $effect(() => {
    if (previousClearSelectionSignal === null) {
      previousClearSelectionSignal = clearSelectionSignal;
      return;
    }
    if (clearSelectionSignal === previousClearSelectionSignal) return;
    previousClearSelectionSignal = clearSelectionSignal;
    window.getSelection()?.removeAllRanges();
    clearActiveSelectionRange();
    resetShiftHover();
  });

  $effect(() => {
    selectionHighlightSignal;
    applySelectionHighlight(selectionHighlightCount);
  });

  $effect(() => {
    if (lookupState !== "ready" || !contentRoot) return;

    const frame = window.requestAnimationFrame(() => {
      if (requestId > 0 && firstPaintRequestId !== requestId) {
        firstPaintRequestId = requestId;
        markLookupPerformance(requestId, "first-paint", { resultCount: results.length });
      }
      hydrateDictionaryMedia(contentRoot);
    });
    return () => window.cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (lookupState !== "ready") {
      clearActiveSelectionRange();
      dictionaryStyleCss = "";
      ankiPreviewKey = "";
      ankiActionKey = "";
      ankiActionState = "idle";
      ankiActionMessage = "";
      ankiMediaWarnings = [];
      ankiAudioHint = "";
      return;
    }

    const dictionaries = popupResultDictionaries(renderedResults);
    const nextStyleRequestId = ++styleRequestId;
    void loadScopedDictionaryStyles(dictionaries, nextStyleRequestId, requestId);
  });

  $effect(() => {
    if (previousRestoreScrollSignal === null) {
      previousRestoreScrollSignal = restoreScrollSignal;
      return;
    }
    if (restoreScrollSignal === previousRestoreScrollSignal || lookupState !== "ready" || !contentRoot) return;
    previousRestoreScrollSignal = restoreScrollSignal;

    const frame = window.requestAnimationFrame(() => {
      const results = contentRoot?.querySelector<HTMLElement>(".lookup-results");
      if (results) results.scrollTop = restoreScrollTop;
    });
    return () => window.cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (!contentRoot) return;
    const root = contentRoot;
    root.addEventListener("click", handleGlossaryClick);
    return () => root.removeEventListener("click", handleGlossaryClick);
  });

  function handleGlossaryPointerMove(event: PointerEvent) {
    if (!event.shiftKey) {
      resetShiftHover();
      return;
    }

    shiftHoverPoint = { x: event.clientX, y: event.clientY };
    if (shiftHoverFrame !== null) return;
    shiftHoverFrame = window.requestAnimationFrame(() => {
      shiftHoverFrame = null;
      if (!shiftHoverPoint) return;
      const { x, y } = shiftHoverPoint;
      const hit = popupTextHitAtPoint(x, y, popupSelectionOptions);
      if (!hit) {
        lastShiftHoverHit = null;
        return;
      }
      if (lastShiftHoverHit?.node === hit.node && lastShiftHoverHit.offset === hit.offset) return;
      lastShiftHoverHit = hit;
      const result = selectPopupTextFromHit(hit, x, y, selection.chapterIndex, popupSelectionOptions);
      if (!result) return;
      const nestedSelection = result.selection;
      activatePopupSelection(result);
      suppressImmediateNestedLookupScroll();
      onNestedLookup(popupId, nestedSelection);
    });
  }

  function handleResultsScroll() {
    if (suppressNextScrollAfterNestedLookup) {
      suppressNextScrollAfterNestedLookup = false;
      return;
    }
    onScrolled(popupId);
  }

  function handleGlossaryClick(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-lookup-redirect]")
      : null;
    if (!target) {
      if (event.button !== 0) return;
      const result = selectPopupTextFromPoint(event.clientX, event.clientY, selection.chapterIndex, popupSelectionOptions);
      if (!result) return;

      activatePopupSelection(result);
      suppressImmediateNestedLookupScroll();
      onNestedLookup(popupId, result.selection);
      return;
    }

    const text = target.dataset.lookupRedirect?.trim() || target.textContent?.trim() || "";
    if (!text) return;
    event.preventDefault();

    const rect = target.getBoundingClientRect();
    onRedirectLookup(popupId, {
      text,
      chapterIndex: selection.chapterIndex,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      anchorRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }

  function hydrateDictionaryMedia(root: HTMLElement | null) {
    if (!root) return;
    const placeholders = [
      ...root.querySelectorAll<HTMLElement>(".gloss-media-placeholder[data-media-path][data-media-dictionary]"),
    ].filter((placeholder) => !placeholder.dataset.mediaStatus);

    if (placeholders.length === 0) return;
    if (!("IntersectionObserver" in window)) {
      for (const placeholder of placeholders) void hydrateDictionaryMediaPlaceholder(placeholder);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const placeholder = entry.target as HTMLElement;
        observer.unobserve(placeholder);
        void hydrateDictionaryMediaPlaceholder(placeholder);
      }
    }, { rootMargin: "160px" });

    for (const placeholder of placeholders) {
      placeholder.dataset.mediaStatus = "pending";
      observer.observe(placeholder);
    }
  }

  async function hydrateDictionaryMediaPlaceholder(placeholder: HTMLElement) {
    const dictionary = placeholder.dataset.mediaDictionary ?? "";
    const path = placeholder.dataset.mediaPath ?? "";
    if (!dictionary || !path) return;

    const originalLabel = placeholder.textContent?.trim() || "Dictionary media";
    placeholder.dataset.mediaStatus = "loading";
    placeholder.classList.add("gloss-media-placeholder-loading");
    placeholder.textContent = "Loading media...";
    try {
      const resource = await loadDictionaryMedia(dictionary, path);
      if (!placeholder.isConnected) return;

      const image = document.createElement("img");
      image.className = "gloss-media-image";
      image.alt = originalLabel;
      image.src = `data:${resource.mimeType};base64,${resource.dataBase64}`;
      placeholder.replaceChildren(image);
      placeholder.dataset.mediaStatus = "loaded";
      placeholder.classList.remove("gloss-media-placeholder-loading");
      placeholder.classList.add("gloss-media-placeholder-loaded");
      if (requestId > 0) markLookupPerformance(requestId, "first-media-ready", { dictionary, path });
    } catch {
      if (!placeholder.isConnected) return;
      placeholder.textContent = "Media unavailable";
      placeholder.dataset.mediaStatus = "error";
      placeholder.classList.remove("gloss-media-placeholder-loading");
      placeholder.classList.add("gloss-media-placeholder-error");
    }
  }

  async function loadDictionaryMedia(dictionary: string, path: string): Promise<DictionaryMediaResource> {
    if (loadDictionaryMediaResource) return loadDictionaryMediaResource(dictionary, path);
    if (!isTauri()) throw new Error("Dictionary media requires Tauri runtime.");
    return invoke<DictionaryMediaResource>("dictionary_media", { dictionary, path });
  }

  async function loadScopedDictionaryStyles(dictionaries: string[], scopedStyleRequestId: number, lookupRequestId: number) {
    if (dictionaries.length === 0) {
      dictionaryStyleCss = "";
      if (lookupRequestId > 0) markLookupPerformance(lookupRequestId, "styles-ready", { dictionaryCount: 0 });
      return;
    }

    const resources = await Promise.allSettled(dictionaries.map((dictionary) => (
      loadDictionaryStyles?.(dictionary) ?? loadCachedDictionaryStyles(dictionary)
    )));
    if (scopedStyleRequestId !== styleRequestId) return;
    const chunks = resources.flatMap((resource) => (
      resource.status === "fulfilled" && resource.value.css.trim()
        ? [scopeDictionaryCss(resource.value.css, popupId)]
        : []
    ));
    if (scopedStyleRequestId === styleRequestId) {
      dictionaryStyleCss = chunks.filter(Boolean).join("\n");
      if (lookupRequestId > 0) markLookupPerformance(lookupRequestId, "styles-ready", { dictionaryCount: dictionaries.length });
    }
  }

  async function addAnki(result: DictResult, resultIndex: number, key: string) {
    if (!buildAnkiPayload || !canPreviewAnki || !onAddAnkiNote || ankiActionState === "adding") return;
    const payload = buildAnkiPayload(result, resultIndex);

    ankiPreviewKey = key;
    const previewFields = renderAnkiFieldPreview(payload, ankiSettings);
    ankiAudioHint = audioBoundaryHint(payload, previewFields);
    ankiActionKey = key;
    ankiActionState = "adding";
    ankiActionMessage = "Adding note...";
    ankiMediaWarnings = [];
    try {
      const storeResult = await storeAnkiMediaForPayload(payload);
      if (ankiActionKey !== key) return;
      let notePayload = storeResult
        ? payloadWithStoredDictionaryMedia(payload, storeResult.stored)
        : payload;
      ankiMediaWarnings = storeResult?.warnings ?? [];
      let notePreviewFields = renderAnkiFieldPreview(notePayload, ankiSettings);
      const coverResult = await storeAnkiCoverForPayload(notePayload, notePreviewFields);
      if (ankiActionKey !== key) return;
      if (coverResult) {
        notePayload = payloadWithStoredBookCover(notePayload, coverResult.filename);
        ankiMediaWarnings = [...ankiMediaWarnings, ...coverResult.warnings];
        notePreviewFields = renderAnkiFieldPreview(notePayload, ankiSettings);
      }
      const audioResult = await storeAnkiAudioForPayload(notePayload, notePreviewFields);
      if (ankiActionKey !== key) return;
      if (audioResult) {
        notePayload = payloadWithStoredRemoteAudio(notePayload, audioResult.filename);
        ankiMediaWarnings = [...ankiMediaWarnings, ...audioResult.warnings];
        notePreviewFields = renderAnkiFieldPreview(notePayload, ankiSettings);
      }
      ankiAudioHint = audioResult?.warnings.length
        ? "Word audio was not stored; this note will be added without audio."
        : audioBoundaryHint(notePayload, notePreviewFields);
      const note = buildAnkiNoteRequest(notePayload, ankiSettings);
      if (!note) return;
      const result = await onAddAnkiNote(note);
      if (ankiActionKey !== key) return;
      ankiMediaWarnings = [...ankiMediaWarnings, ...result.warnings];
      ankiActionState = result.status === "added" ? "added" : "duplicate";
      ankiActionMessage = result.message;
    } catch (error) {
      if (ankiActionKey !== key) return;
      ankiActionState = "error";
      ankiActionMessage = String(error);
    }
  }

  async function storeAnkiMediaForPayload(payload: LookupAnkiPayload): Promise<AnkiStoreMediaResult | null> {
    if (!onStoreAnkiMedia || payload.media.length === 0) return null;
    return onStoreAnkiMedia(ankiDictionaryMediaRefs(payload.media));
  }

  function handleWindowKeyUp(event: KeyboardEvent) {
    if (event.key === "Shift") resetShiftHover();
  }

  async function storeAnkiCoverForPayload(
    payload: LookupAnkiPayload,
    fields: AnkiFieldPreview[],
  ): Promise<AnkiStoreBookCoverResult | null> {
    if (!fields.some((field) => field.template.toLowerCase().includes("{book-cover}"))) return null;
    const bookId = payload.sourceBook.bookId?.trim();
    if (!bookId || !onStoreAnkiBookCover) return null;
    return onStoreAnkiBookCover(bookId);
  }

  async function storeAnkiAudioForPayload(
    payload: LookupAnkiPayload,
    fields: AnkiFieldPreview[],
  ): Promise<AnkiStoreRemoteAudioResult | null> {
    if (!ankiSettings?.audioEnabled || !payload.expression.trim()) return null;
    if (!fields.some((field) => field.template.toLowerCase().includes("{audio}"))) return null;
    if (!onStoreAnkiWordAudio) return null;
    return onStoreAnkiWordAudio(wordAudioResolveRequest(payload.expression, payload.reading));
  }

  function wordAudioResolveRequest(expression: string, reading: string): WordAudioResolveRequest {
    return {
      expression,
      reading,
      localAudioEnabled: ankiSettings?.localAudioEnabled ?? false,
      sources: ankiSettings?.audioSources ?? [],
      timeoutMs: ankiSettings?.audioDownloadTimeoutMs ?? 5000,
    };
  }

  function canPlayWordAudio(result: DictResult): boolean {
    const hasSource = Boolean(ankiSettings?.localAudioEnabled) || Boolean(ankiSettings?.audioSources.some((source) => source.enabled && source.url.trim()));
    return Boolean(ankiSettings?.audioEnabled && hasSource && result.expression.trim() && onPrepareWordAudio);
  }

  function stopWordAudio(message = "") {
    wordAudioRequestGeneration += 1;
    if (wordAudioElement) {
      wordAudioElement.pause();
      wordAudioElement.src = "";
      wordAudioElement.load();
      wordAudioElement = null;
    }
    wordAudioKey = "";
    wordAudioState = "idle";
    wordAudioMessage = message;
  }

  async function toggleWordAudio(result: DictResult, key: string) {
    if (wordAudioKey === key && (wordAudioState === "loading" || wordAudioState === "playing")) {
      stopWordAudio("Word audio stopped.");
      return;
    }
    if (!canPlayWordAudio(result) || !onPrepareWordAudio) return;
    stopWordAudio();
    const generation = wordAudioRequestGeneration;
    wordAudioKey = key;
    wordAudioState = "loading";
    wordAudioMessage = "Resolving word audio...";
    try {
      const resolved = await onPrepareWordAudio(wordAudioResolveRequest(result.expression, result.reading));
      if (generation !== wordAudioRequestGeneration || wordAudioKey !== key) return;
      const warningText = resolved.warnings.join(" ");
      if (!resolved.cachePath) {
        wordAudioState = "error";
        wordAudioMessage = warningText || "No word audio was found.";
        return;
      }
      const source = resolved.cachePath.startsWith("data:") || resolved.cachePath.startsWith("blob:")
        ? resolved.cachePath
        : convertFileSrc(resolved.cachePath);
      const audio = new Audio(source);
      wordAudioElement = audio;
      audio.onended = () => {
        if (wordAudioElement !== audio) return;
        wordAudioElement = null;
        wordAudioKey = "";
        wordAudioState = "idle";
        wordAudioMessage = warningText || `Played word audio${resolved.sourceName ? ` from ${resolved.sourceName}` : ""}.`;
      };
      audio.onerror = () => {
        if (wordAudioElement !== audio) return;
        wordAudioElement = null;
        wordAudioState = "error";
        wordAudioMessage = "Word audio could not be played.";
      };
      await audio.play();
      if (generation !== wordAudioRequestGeneration || wordAudioElement !== audio) {
        audio.pause();
        return;
      }
      wordAudioState = "playing";
      wordAudioMessage = warningText || `Playing word audio${resolved.sourceName ? ` from ${resolved.sourceName}` : ""}.`;
    } catch (error) {
      if (generation !== wordAudioRequestGeneration) return;
      wordAudioState = "error";
      wordAudioMessage = String(error);
    }
  }

  $effect(() => {
    const lifecycleKey = `${popupId}:${requestId}:${selection.text}`;
    void lifecycleKey;
    return () => stopWordAudio();
  });

  $effect(() => {
    const first = renderedResults[0];
    const autoplayKey = first ? `${popupId}:${requestId}:${first.key}` : "";
    if (lookupState === "ready" && ankiSettings?.audioAutoplay && first && autoplayKey !== lastAutoplayKey) {
      lastAutoplayKey = autoplayKey;
      queueMicrotask(() => void toggleWordAudio(first.result, first.key));
    }
  });

  function audioBoundaryHint(payload: LookupAnkiPayload, fields: AnkiFieldPreview[]): string {
    if (!fields.some((field) => field.template.toLowerCase().includes("{audio}"))) return "";
    const source = ankiSettings?.audioSources.find((item) => item.enabled && item.url.trim());
    if (!ankiSettings?.audioEnabled || (!ankiSettings.localAudioEnabled && !source)) return "Word audio token present; no enabled audio source is configured.";
    if (!payload.expression.trim()) return "Word audio token present; this lookup has no expression to resolve.";
    if (payload.audioFilename) return `Word audio stored as ${payload.audioFilename}.`;
    return "Word audio will be fetched when this note is added.";
  }

  function ankiButtonLabel(key: string): string {
    if (ankiActionKey !== key) return canPreviewAnki ? "Add to Anki" : "Anki not configured";
    if (ankiActionState === "adding") return "Adding...";
    if (ankiActionState === "added") return "Added";
    if (ankiActionState === "duplicate") return "Duplicate";
    if (ankiActionState === "error") return "Anki error";
    return canPreviewAnki ? "Add to Anki" : "Anki not configured";
  }

  function ankiButtonIcon(key: string): string {
    if (ankiActionKey !== key) return canPreviewAnki ? "+" : "-";
    if (ankiActionState === "adding") return "...";
    if (ankiActionState === "added" || ankiActionState === "duplicate") return "ok";
    if (ankiActionState === "error") return "!";
    return canPreviewAnki ? "+" : "-";
  }

  function pitchLevel(position: number, index: number, total: number): "high" | "low" {
    if (total <= 1) return position === 0 ? "low" : "high";
    if (position === 0) return index === 0 ? "low" : "high";
    if (position === 1) return index === 0 ? "high" : "low";
    return index > 0 && index < position ? "high" : "low";
  }

  function nextPitchLevel(position: number, index: number, total: number): "high" | "low" | "none" {
    if (index >= total - 1) return "none";
    return pitchLevel(position, index + 1, total);
  }

  function pitchPositionLabel(position: number): string {
    return `pitch ${position}`;
  }

  function hasPitchVisual(group: LookupPitchGroup, moras: string[]): boolean {
    return moras.length > 0 && group.positions.length > 0;
  }

  function glossaryGroupOpen(dictionary: string, groupIndex: number): boolean {
    if (dictionarySettings.collapseMode === "expandAll") return true;
    if (dictionarySettings.expandFirstDictionary && groupIndex === 0) return true;
    if (dictionarySettings.collapseMode === "collapseAll") return false;
    return !dictionarySettings.collapsedDictionaries.includes(dictionary);
  }
</script>

<svelte:window onkeyup={handleWindowKeyUp} onblur={resetShiftHover} />

<svelte:head>
  <svelte:element this={styleTag}>{dictionaryStyleCss}</svelte:element>
</svelte:head>

<div
  class="lookup-content"
  class:compact-glossaries={dictionarySettings.compactGlossaries}
  class:compact-pitch={dictionarySettings.compactPitchAccents}
  bind:this={contentRoot}
>
  <div class="lookup-head">
    <span>Lookup</span>
    <div class="lookup-head-actions">
      <button aria-label="Back" title="Back" disabled={!canNavigateBack} onclick={() => onNavigateHistory(popupId, "back")}>&lt;</button>
      <button aria-label="Forward" title="Forward" disabled={!canNavigateForward} onclick={() => onNavigateHistory(popupId, "forward")}>&gt;</button>
      <button aria-label="Close lookup" onclick={() => onClose(popupId)}>Close</button>
    </div>
  </div>
  {#if lookupState === "loading"}
    <p class="lookup-state">Looking up...</p>
  {:else if lookupState === "noDictionaries"}
    <div class="lookup-state-block">
      <p class="lookup-state">{error}</p>
      <button class="lookup-action" onclick={onImportDictionary}>Import Dictionary</button>
    </div>
  {:else if lookupState === "engineUnavailable"}
    <p class="lookup-state">{error}</p>
  {:else if lookupState === "error"}
    <p class="lookup-state">{error}</p>
  {:else if lookupState === "empty"}
    <p class="lookup-state">No dictionary results for "{selection.text}".</p>
  {:else if lookupState === "ready"}
    <div class="lookup-results" onscroll={handleResultsScroll}>
      {#each renderedResults as rendered}
        <section class="lookup-result">
          <div class="lookup-result-head">
            <div class="lookup-expression-wrap">
              <span class="lookup-expression">{rendered.result.expression}</span>
              {#if rendered.result.reading && rendered.result.reading !== rendered.result.expression}
                <span class="lookup-reading">{rendered.result.reading}</span>
              {/if}
            </div>
            <div class="lookup-header-actions" aria-label="Lookup actions">
              <button
                class:ready={canPlayWordAudio(rendered.result)}
                class:playing={wordAudioKey === rendered.key && wordAudioState === "playing"}
                class="lookup-action-slot lookup-audio"
                disabled={!canPlayWordAudio(rendered.result)}
                title={canPlayWordAudio(rendered.result) ? (wordAudioKey === rendered.key ? "Stop word audio" : "Play word audio") : "No enabled word audio source"}
                aria-label={wordAudioKey === rendered.key && (wordAudioState === "loading" || wordAudioState === "playing") ? "Stop audio" : "Play audio"}
                onclick={() => toggleWordAudio(rendered.result, rendered.key)}
              >
                <span aria-hidden="true">{wordAudioKey === rendered.key && wordAudioState === "loading" ? "..." : wordAudioKey === rendered.key && wordAudioState === "playing" ? "■" : "A"}</span>
              </button>
              <button
                class:ready={canPreviewAnki}
                class:added={ankiActionKey === rendered.key && ankiActionState === "added"}
                class:duplicate={ankiActionKey === rendered.key && ankiActionState === "duplicate"}
                class:error={ankiActionKey === rendered.key && ankiActionState === "error"}
                class="lookup-action-slot lookup-anki"
                disabled={!canPreviewAnki || ankiActionState === "adding"}
                title={canPreviewAnki ? ankiButtonLabel(rendered.key) : ankiTitle(rendered.result, rendered.resultIndex)}
                aria-label={ankiButtonLabel(rendered.key)}
                onclick={() => addAnki(rendered.result, rendered.resultIndex, rendered.key)}
              >
                <span aria-hidden="true">{ankiButtonIcon(rendered.key)}</span>
              </button>
            </div>
          </div>
          {#if wordAudioKey === rendered.key && wordAudioMessage}
            <p class:error={wordAudioState === "error"} class="word-audio-status">{wordAudioMessage}</p>
          {/if}
          {#if rendered.match || rendered.rules.length > 0 || rendered.frequencies.length > 0 || rendered.pitches.length > 0}
            <div class="entry-tags">
              {#if rendered.match || rendered.rules.length > 0}
                <div class="lookup-tags">
                  {#if rendered.match}
                    <span class="lookup-tag">{rendered.match}</span>
                  {/if}
                  {#each rendered.rules as rule}
                    <span class="lookup-tag">{rule}</span>
                  {/each}
                </div>
              {/if}
              {#if rendered.frequencies.length > 0}
                <div class="frequency-row" aria-label="Frequency dictionaries">
                  {#each rendered.frequencies as frequency}
                    <span class="frequency-group">
                      <span class="frequency-dict-label">{frequency.dictionary}</span>
                      <span class="frequency-values">{frequency.values.join(", ")}</span>
                    </span>
                  {/each}
                </div>
              {/if}
              {#if rendered.pitches.length > 0}
                <div class="pitch-list" aria-label="Pitch dictionaries">
                  {#each rendered.pitches as pitch}
                    <div class="pitch-group">
                      <span class="pitch-dict-label">{pitch.dictionary}</span>
                      {#if hasPitchVisual(pitch, rendered.pitchMoras)}
                        <ul class="pitch-entries">
                          {#each pitch.positions as position}
                            <li>
                              <span class="pitch-visual" aria-label={pitchPositionLabel(position)}>
                                {#each rendered.pitchMoras as mora, moraIndex}
                                  <span class="pronunciation-mora" data-pitch={pitchLevel(position, moraIndex, rendered.pitchMoras.length)} data-next-pitch={nextPitchLevel(position, moraIndex, rendered.pitchMoras.length)}>
                                    <span class="pronunciation-mora-line"></span>
                                    <span>{mora}</span>
                                  </span>
                                {/each}
                              </span>
                              <span class="pitch-position">[{position}]</span>
                            </li>
                          {/each}
                        </ul>
                      {:else if pitch.positions.length > 0}
                        <ul class="pitch-entries">
                          {#each pitch.positions as position}
                            <li><span class="pitch-position">{pitchPositionLabel(position)}</span></li>
                          {/each}
                        </ul>
                      {/if}
                      {#if pitch.transcriptions.length > 0}
                        <ul class="pitch-entries transcription-entries">
                          {#each pitch.transcriptions as transcription}
                            <li>{transcription}</li>
                          {/each}
                        </ul>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
          {#each rendered.glossaryGroups as group, groupIndex}
            <details class="lookup-glossary-group" open={glossaryGroupOpen(group.dictionary, groupIndex)}>
              <summary class="lookup-glossary-dict">{group.dictionary}</summary>
              {#if dictionarySettings.showExpressionTags && group.termTags.length > 0}
                <div class="lookup-tags">
                  {#each group.termTags as tag}
                    <span class="lookup-tag">{tag}</span>
                  {/each}
                </div>
              {/if}
              <ol class="lookup-glossary-list">
                {#each group.entries as entry}
                  <li class="lookup-glossary">
                    {#if entry.definitionTagList.length > 0}
                      <div class="lookup-tags">
                        {#each entry.definitionTagList as tag}
                          <span class="lookup-tag">{tag}</span>
                        {/each}
                      </div>
                    {/if}
                    <div
                      class="lookup-glossary-content"
                      role="group"
                      aria-label="Lookup glossary text"
                      onpointermove={handleGlossaryPointerMove}
                      onpointerleave={resetShiftHover}
                    >{@html entry.html}</div>
                  </li>
                {/each}
              </ol>
            </details>
          {/each}
          {#if ankiPreviewKey === rendered.key}
            <section class="anki-preview" aria-label="Anki field preview">
              {#if ankiAudioHint}
                <p class="anki-action-message warn">{ankiAudioHint}</p>
              {/if}
              {#if ankiActionKey === ankiPreviewKey && ankiActionMessage}
                <p class:ok={ankiActionState === "added"} class:warn={ankiActionState === "duplicate"} class:bad={ankiActionState === "error"} class="anki-action-message">
                  {ankiActionMessage}
                </p>
              {/if}
              {#if ankiActionKey === ankiPreviewKey && ankiMediaWarnings.length > 0}
                {#each ankiMediaWarnings as warning}
                  <p class="anki-action-message warn">{warning}</p>
                {/each}
              {/if}
            </section>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .word-audio-status { margin: calc(2px * var(--popup-scale, 1)) 0 0; color: var(--app-status, #cce8d5); font-size: calc(11px * var(--popup-scale, 1)); line-height: 1.35; }
  .word-audio-status.error { color: var(--app-error, #ffb4ab); }
  .lookup-content { display: flex; flex: 1 1 auto; flex-direction: column; gap: 8px; width: 100%; height: 100%; min-width: 0; min-height: 0; font-family: "Yu Gothic UI", "Meiryo", "Segoe UI", sans-serif; }
  .lookup-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--app-muted, #999999); font-size: 11px; text-transform: uppercase; }
  .lookup-head-actions { display: flex; align-items: center; gap: 4px; }
  .lookup-head button { flex-shrink: 0; min-width: 24px; padding: 3px 7px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 3px; cursor: pointer; font-size: 11px; text-transform: none; }
  .lookup-head button:disabled { color: var(--app-muted, #999999); cursor: not-allowed; opacity: 0.62; }
  .lookup-state-block { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .lookup-state { color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .lookup-action { padding: 5px 10px; background: var(--app-primary, #d0bcff); color: var(--app-bg, #000); border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .lookup-action:hover { background: var(--app-primary-hover, #c1a9fb); }
  .lookup-results { display: flex; flex: 1 1 auto; flex-direction: column; gap: calc(8px * var(--popup-scale, 1)); min-height: 0; overflow-y: auto; padding-right: calc(2px * var(--popup-scale, 1)); scrollbar-width: none; -ms-overflow-style: none; }
  .lookup-results::-webkit-scrollbar { display: none; }
  .lookup-result { display: flex; flex-direction: column; gap: calc(5px * var(--popup-scale, 1)); padding-top: calc(8px * var(--popup-scale, 1)); border-top: 1px solid var(--app-border, #333333); min-width: 0; }
  .lookup-result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(8px * var(--popup-scale, 1)); min-width: 0; padding-top: calc(2px * var(--popup-scale, 1)); }
  .lookup-expression-wrap { display: flex; align-items: baseline; flex-wrap: wrap; gap: calc(4px * var(--popup-scale, 1)) calc(8px * var(--popup-scale, 1)); min-width: 0; color: var(--app-text, #fff); line-height: 1.25; overflow-wrap: anywhere; }
  .lookup-expression { min-width: 0; font-size: calc(26px * var(--popup-scale, 1)); line-height: 1.22; overflow-wrap: anywhere; }
  .lookup-reading { color: var(--app-muted, #999999); font-size: calc(13px * var(--popup-scale, 1)); overflow-wrap: anywhere; }
  .lookup-header-actions { display: flex; flex-shrink: 0; align-items: center; gap: calc(6px * var(--popup-scale, 1)); margin-left: auto; }
  .lookup-action-slot { display: inline-flex; align-items: center; justify-content: center; width: calc(28px * var(--popup-scale, 1)); height: calc(28px * var(--popup-scale, 1)); padding: 0; background: transparent; color: var(--app-text, #fff); border: 0; border-radius: calc(14px * var(--popup-scale, 1)); cursor: pointer; font-size: calc(16px * var(--popup-scale, 1)); line-height: 1; user-select: none; }
  .lookup-action-slot:disabled { color: var(--app-muted, #999999); cursor: not-allowed; opacity: 0.5; }
  .lookup-action-slot.ready { color: #d8eadf; background: #24352f; }
  .lookup-action-slot.ready:hover { background: #2c4038; }
  .lookup-action-slot.added { color: #9ad5b5; background: #22352d; }
  .lookup-action-slot.duplicate { color: #ffd89b; background: #3a3021; }
  .lookup-action-slot.error { color: #ffb4ac; background: #3b2626; }
  .lookup-action-slot span { transform: translateY(calc(-1px * var(--popup-scale, 1))); }
  .entry-tags { display: flex; flex-direction: column; gap: calc(3px * var(--popup-scale, 1)); margin-top: calc(-2px * var(--popup-scale, 1)); user-select: none; }
  .lookup-tags { display: flex; flex-wrap: wrap; gap: calc(4px * var(--popup-scale, 1)); }
  .lookup-tag { max-width: 100%; padding: calc(2px * var(--popup-scale, 1)) calc(6px * var(--popup-scale, 1)); background: var(--app-control, #1b1b1b); color: var(--app-primary, #d0bcff); border: 1px solid var(--app-border, #333333); border-radius: calc(4px * var(--popup-scale, 1)); font-size: calc(11px * var(--popup-scale, 1)); line-height: 1.25; overflow-wrap: anywhere; }
  .frequency-row { display: flex; flex-wrap: wrap; gap: calc(3px * var(--popup-scale, 1)); margin-top: calc(1px * var(--popup-scale, 1)); }
  .frequency-group { display: inline-flex; max-width: 100%; overflow: hidden; border: 1px solid #77aaeb; border-radius: calc(4px * var(--popup-scale, 1)); font-size: calc(11px * var(--popup-scale, 1)); line-height: 1; }
  .frequency-dict-label { flex-shrink: 0; max-width: calc(120px * var(--popup-scale, 1)); padding: calc(4px * var(--popup-scale, 1)); overflow: hidden; background: #4f78bd; color: #fff; text-overflow: ellipsis; white-space: nowrap; }
  .frequency-values { min-width: 0; padding: calc(4px * var(--popup-scale, 1)); color: var(--app-text, #fff); overflow-wrap: anywhere; }
  .pitch-list { display: flex; flex-direction: column; gap: calc(5px * var(--popup-scale, 1)); margin-top: calc(2px * var(--popup-scale, 1)); color: var(--app-text, #fff); font-size: calc(13px * var(--popup-scale, 1)); line-height: 1.35; }
  .pitch-group { display: flex; flex-direction: column; align-items: flex-start; gap: calc(2px * var(--popup-scale, 1)); min-width: 0; }
  .pitch-dict-label { max-width: 100%; padding: calc(2px * var(--popup-scale, 1)) calc(4px * var(--popup-scale, 1)); background: #6f7fca; color: #fff; border-radius: calc(4px * var(--popup-scale, 1)); line-height: 1.15; overflow-wrap: anywhere; }
  .pitch-entries { margin: 0; padding: 0; list-style: circle inside; }
  .pitch-entries li { margin-top: calc(2px * var(--popup-scale, 1)); }
  .transcription-entries { color: var(--app-muted, #999999); }
  .pitch-visual { display: inline-flex; align-items: flex-end; margin-right: calc(4px * var(--popup-scale, 1)); vertical-align: bottom; }
  .pronunciation-mora { position: relative; display: inline-flex; flex-direction: column; align-items: center; min-width: 1.05em; padding-top: calc(6px * var(--popup-scale, 1)); color: var(--app-text, #fff); font-size: calc(13px * var(--popup-scale, 1)); line-height: 1.1; }
  .pronunciation-mora-line { position: absolute; top: calc(2px * var(--popup-scale, 1)); left: 0; right: 0; height: 1px; background: transparent; }
  .pronunciation-mora[data-pitch="high"] .pronunciation-mora-line { background: var(--app-muted, #999999); }
  .pronunciation-mora[data-pitch="high"][data-next-pitch="low"] .pronunciation-mora-line::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    width: 1px;
    height: calc(9px * var(--popup-scale, 1));
    background: var(--app-muted, #999999);
  }
  .pronunciation-mora[data-pitch="low"][data-next-pitch="high"] .pronunciation-mora-line::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    width: 1px;
    height: calc(9px * var(--popup-scale, 1));
    background: var(--app-muted, #999999);
  }
  .pitch-position { color: var(--app-muted, #999999); font-size: calc(11px * var(--popup-scale, 1)); }
  .lookup-glossary { display: flex; flex-direction: column; gap: calc(2px * var(--popup-scale, 1)); color: var(--app-text, #fff); font-size: calc(14px * var(--popup-scale, 1)); line-height: 1.4; overflow-wrap: anywhere; }
  .lookup-glossary-group { display: flex; flex-direction: column; gap: calc(4px * var(--popup-scale, 1)); }
  .lookup-glossary-group[open] { display: flex; }
  .lookup-glossary-dict { color: var(--app-status, #cce8d5); font-size: calc(10px * var(--popup-scale, 1)); cursor: pointer; }
  .lookup-glossary-list { margin: 0; padding-left: 1.25em; }
  .lookup-glossary-list > li { margin: calc(4px * var(--popup-scale, 1)) 0; }
  .lookup-glossary-content { min-width: 0; font-size: calc(15px * var(--popup-scale, 1)); line-height: 1.4; }
  .compact-glossaries .lookup-glossary { gap: calc(1px * var(--popup-scale, 1)); line-height: 1.28; }
  .compact-glossaries .lookup-glossary-list > li { margin: calc(2px * var(--popup-scale, 1)) 0; }
  .compact-glossaries .lookup-glossary-content { font-size: calc(14px * var(--popup-scale, 1)); line-height: 1.32; }
  .compact-pitch .pitch-list { gap: calc(2px * var(--popup-scale, 1)); font-size: calc(12px * var(--popup-scale, 1)); }
  .compact-pitch .pitch-group { flex-direction: row; align-items: center; flex-wrap: wrap; gap: calc(4px * var(--popup-scale, 1)); }
  .compact-pitch .pitch-entries li { display: inline-flex; margin: 0 calc(5px * var(--popup-scale, 1)) 0 0; }
  .lookup-glossary-content :global(.structured-content) { display: inline; }
  .lookup-glossary-content :global(ul),
  .lookup-glossary-content :global(ol) { padding-left: 1.25em; margin: calc(3px * var(--popup-scale, 1)) 0; }
  .lookup-glossary-content :global(li) { margin: calc(2px * var(--popup-scale, 1)) 0; }
  .lookup-glossary-content :global(table) { max-width: 100%; table-layout: auto; border-collapse: collapse; }
  .lookup-glossary-content :global(th),
  .lookup-glossary-content :global(td) { padding: calc(3px * var(--popup-scale, 1)) calc(5px * var(--popup-scale, 1)); border: 1px solid var(--app-border, #333333); vertical-align: top; }
  .lookup-glossary-content :global(th) { background: var(--app-control, #1b1b1b); font-weight: 600; }
  .lookup-glossary-content :global(.gloss-sc-table-container) { display: block; max-width: 100%; overflow-x: auto; }
  .lookup-glossary-content :global(a) { color: var(--app-primary, #d0bcff); }
  .lookup-glossary-content :global(a[data-lookup-redirect]) { border-bottom: 1px dotted currentColor; cursor: pointer; text-decoration: none; }
  .lookup-glossary-content :global(rt) { color: var(--app-muted, #999999); font-size: 0.72em; }
  .lookup-glossary-content :global(.gloss-media-placeholder) { display: inline-block; max-width: 100%; padding: calc(4px * var(--popup-scale, 1)) calc(7px * var(--popup-scale, 1)); border: 1px dashed var(--app-border, #333333); border-radius: calc(4px * var(--popup-scale, 1)); color: var(--app-muted, #999999); background: var(--app-control, #1b1b1b); font-size: calc(11px * var(--popup-scale, 1)); }
  .lookup-glossary-content :global(.gloss-media-placeholder-loading) { color: var(--app-text, #fff); border-color: var(--app-muted, #999999); }
  .lookup-glossary-content :global(.gloss-media-placeholder-loaded) { display: block; padding: calc(2px * var(--popup-scale, 1)); border-style: solid; }
  .lookup-glossary-content :global(.gloss-media-placeholder-error) { color: var(--app-error, #ffb4ab); border-color: var(--app-error, #ffb4ab); }
  .lookup-glossary-content :global(.gloss-media-image) { display: block; max-width: 100%; max-height: calc(180px * var(--popup-scale, 1)); object-fit: contain; }
  .anki-preview { display: flex; flex-direction: column; gap: calc(4px * var(--popup-scale, 1)); padding: calc(6px * var(--popup-scale, 1)) calc(8px * var(--popup-scale, 1)); background: var(--app-bg, #000); border: 1px solid var(--app-border, #333333); border-radius: calc(4px * var(--popup-scale, 1)); }
  .anki-action-message { margin: 0; font-size: calc(11px * var(--popup-scale, 1)); line-height: 1.35; overflow-wrap: anywhere; }
  .anki-action-message.ok { color: #9ad5b5; }
  .anki-action-message.warn { color: #ffd89b; }
  .anki-action-message.bad { color: #ffb4ac; }
</style>
