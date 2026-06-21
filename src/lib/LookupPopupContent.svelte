<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { ankiDictionaryMediaRefs, buildAnkiNoteRequest, isAnkiPreviewConfigured, payloadWithStoredDictionaryMedia, payloadWithStoredRemoteAudio, renderAnkiFieldPreview } from "./anki-field-renderer";
  import { loadCachedDictionaryStyles, type DictionaryStyleResource } from "./dictionary-style-cache";
  import { scopeDictionaryCss, type LookupPitchGroup, type LookupState } from "./lookup-popup";
  import { createLookupPopupViewModels, popupResultDictionaries } from "./lookup-popup-view-model";
  import { clearLookupHighlight, POPUP_LOOKUP_HIGHLIGHT } from "./lookup-highlight";
  import { markLookupPerformance } from "./lookup-performance";
  import { selectPopupTextFromPoint } from "./popup-selection";
  import type { AnkiAddNoteResult, AnkiDictionaryMediaRef, AnkiFieldPreview, AnkiNoteRequest, AnkiRemoteAudioRequest, AnkiSettings, AnkiStoreMediaResult, AnkiStoreRemoteAudioResult, DictResult, LocalAudioStoreRequest, LocalAudioStoreResult, LookupAnkiPayload, ReaderSelection } from "./types";

  let {
    popupId,
    requestId = 0,
    selection,
    state: lookupState,
    error = "",
    results = [],
    clearSelectionSignal = 0,
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
    loadDictionaryStyles,
    loadDictionaryMediaResource,
    ankiTitle = () => "Payload prepared for current book",
    ankiSettings = null,
    buildAnkiPayload,
    onStoreAnkiMedia,
    onStoreAnkiRemoteAudio,
    onStoreAnkiLocalAudio,
    onAddAnkiNote,
  }: {
    popupId: string;
    requestId?: number;
    selection: ReaderSelection;
    state: LookupState;
    error?: string;
    results?: DictResult[];
    clearSelectionSignal?: number;
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
    loadDictionaryStyles?: (dictionary: string) => Promise<DictionaryStyleResource>;
    loadDictionaryMediaResource?: (dictionary: string, path: string) => Promise<DictionaryMediaResource>;
    ankiTitle?: (result: DictResult, resultIndex: number) => string;
    ankiSettings?: AnkiSettings | null;
    buildAnkiPayload?: (result: DictResult, resultIndex: number) => LookupAnkiPayload;
    onStoreAnkiMedia?: (media: AnkiDictionaryMediaRef[]) => Promise<AnkiStoreMediaResult>;
    onStoreAnkiRemoteAudio?: (request: AnkiRemoteAudioRequest) => Promise<AnkiStoreRemoteAudioResult>;
    onStoreAnkiLocalAudio?: (request: LocalAudioStoreRequest) => Promise<LocalAudioStoreResult>;
    onAddAnkiNote?: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
  } = $props();

  let shiftHoverLastX = -1;
  let shiftHoverLastY = -1;
  let lastNestedLookupKey = "";
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
  let styleRequestId = 0;
  let firstPaintRequestId = 0;
  const styleTag = "style";
  const canPreviewAnki = $derived(isAnkiPreviewConfigured(ankiSettings) && Boolean(buildAnkiPayload));
  const renderedResults = $derived(createLookupPopupViewModels(results));

  interface DictionaryMediaResource {
    mimeType: string;
    dataBase64: string;
  }

  function resetShiftHover() {
    shiftHoverLastX = -1;
    shiftHoverLastY = -1;
  }

  function suppressImmediateNestedLookupScroll() {
    suppressNextScrollAfterNestedLookup = true;
    requestAnimationFrame(() => {
      suppressNextScrollAfterNestedLookup = false;
    });
  }

  $effect(() => {
    return () => {
      requestAnimationFrame(() => {
        if (!document.querySelector(".lookup-pop")) clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
      });
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
    clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
    resetShiftHover();
    lastNestedLookupKey = "";
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
      clearLookupHighlight(POPUP_LOOKUP_HIGHLIGHT);
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

    const dx = event.clientX - shiftHoverLastX;
    const dy = event.clientY - shiftHoverLastY;
    if (dx * dx + dy * dy < 64) return;

    shiftHoverLastX = event.clientX;
    shiftHoverLastY = event.clientY;
    const nestedSelection = selectPopupTextFromPoint(event.clientX, event.clientY, selection.chapterIndex);
    if (!nestedSelection) return;

    const nestedKey = `${nestedSelection.text}:${Math.round(nestedSelection.rect.x)}:${Math.round(nestedSelection.rect.y)}`;
    if (nestedKey === lastNestedLookupKey) return;
    lastNestedLookupKey = nestedKey;
    suppressImmediateNestedLookupScroll();
    onNestedLookup(popupId, nestedSelection);
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
      const nestedSelection = selectPopupTextFromPoint(event.clientX, event.clientY, selection.chapterIndex);
      if (!nestedSelection) return;

      suppressImmediateNestedLookupScroll();
      onNestedLookup(popupId, nestedSelection);
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

  async function storeAnkiAudioForPayload(
    payload: LookupAnkiPayload,
    fields: AnkiFieldPreview[],
  ): Promise<AnkiStoreRemoteAudioResult | null> {
    if (!ankiSettings?.audioEnabled || !payload.expression.trim()) return null;
    if (!fields.some((field) => field.template.toLowerCase().includes("{audio}"))) return null;
    const warnings: string[] = [];
    if (ankiSettings.localAudioEnabled && onStoreAnkiLocalAudio) {
      const localResult = await onStoreAnkiLocalAudio({ expression: payload.expression, reading: payload.reading });
      warnings.push(...localResult.warnings);
      if (localResult.filename) return { filename: localResult.filename, warnings };
    }
    const source = ankiSettings.audioSources.find((item) => item.enabled && item.url.trim());
    if (!source || !onStoreAnkiRemoteAudio) return warnings.length > 0 ? { filename: null, warnings } : null;
    const remoteResult = await onStoreAnkiRemoteAudio({
      sourceName: source.name,
      urlTemplate: source.url,
      expression: payload.expression,
      reading: payload.reading,
      timeoutMs: ankiSettings.audioDownloadTimeoutMs,
    });
    return { filename: remoteResult.filename, warnings: [...warnings, ...remoteResult.warnings] };
  }

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
</script>

<svelte:head>
  <svelte:element this={styleTag}>{dictionaryStyleCss}</svelte:element>
</svelte:head>

<div class="lookup-content" bind:this={contentRoot}>
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
              <button class="lookup-action-slot lookup-audio" disabled title="Word audio playback is not implemented yet." aria-label="Play audio">
                <span aria-hidden="true">A</span>
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
            <details class="lookup-glossary-group" open={groupIndex === 0}>
              <summary class="lookup-glossary-dict">{group.dictionary}</summary>
              {#if group.termTags.length > 0}
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
  .lookup-content { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .lookup-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--app-muted, #999999); font-size: 11px; text-transform: uppercase; }
  .lookup-head-actions { display: flex; align-items: center; gap: 4px; }
  .lookup-head button { flex-shrink: 0; min-width: 24px; padding: 3px 7px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 3px; cursor: pointer; font-size: 11px; text-transform: none; }
  .lookup-head button:disabled { color: var(--app-muted, #999999); cursor: not-allowed; opacity: 0.62; }
  .lookup-state-block { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .lookup-state { color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .lookup-action { padding: 5px 10px; background: var(--app-primary, #d0bcff); color: var(--app-bg, #000); border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .lookup-action:hover { background: var(--app-primary-hover, #c1a9fb); }
  .lookup-results { display: flex; flex-direction: column; gap: 8px; max-height: min(360px, calc(100vh - 220px)); overflow-y: auto; padding-right: 2px; scrollbar-width: none; -ms-overflow-style: none; }
  .lookup-results::-webkit-scrollbar { display: none; }
  .lookup-result { display: flex; flex-direction: column; gap: 5px; padding-top: 8px; border-top: 1px solid var(--app-border, #333333); min-width: 0; }
  .lookup-result-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; min-width: 0; padding-top: 2px; }
  .lookup-expression-wrap { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; min-width: 0; color: var(--app-text, #fff); line-height: 1.25; overflow-wrap: anywhere; }
  .lookup-expression { min-width: 0; font-size: 20px; line-height: 1.22; overflow-wrap: anywhere; }
  .lookup-reading { color: var(--app-muted, #999999); font-size: 12px; overflow-wrap: anywhere; }
  .lookup-header-actions { display: flex; flex-shrink: 0; align-items: center; gap: 6px; margin-left: auto; }
  .lookup-action-slot { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; background: transparent; color: var(--app-text, #fff); border: 0; border-radius: 14px; cursor: pointer; font-size: 16px; line-height: 1; user-select: none; }
  .lookup-action-slot:disabled { color: var(--app-muted, #999999); cursor: not-allowed; opacity: 0.5; }
  .lookup-action-slot.ready { color: #d8eadf; background: #24352f; }
  .lookup-action-slot.ready:hover { background: #2c4038; }
  .lookup-action-slot.added { color: #9ad5b5; background: #22352d; }
  .lookup-action-slot.duplicate { color: #ffd89b; background: #3a3021; }
  .lookup-action-slot.error { color: #ffb4ac; background: #3b2626; }
  .lookup-action-slot span { transform: translateY(-1px); }
  .entry-tags { display: flex; flex-direction: column; gap: 3px; margin-top: -2px; user-select: none; }
  .lookup-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .lookup-tag { max-width: 100%; padding: 2px 6px; background: var(--app-control, #1b1b1b); color: var(--app-primary, #d0bcff); border: 1px solid var(--app-border, #333333); border-radius: 4px; font-size: 11px; line-height: 1.25; overflow-wrap: anywhere; }
  .frequency-row { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 1px; }
  .frequency-group { display: inline-flex; max-width: 100%; overflow: hidden; border: 1px solid #77aaeb; border-radius: 4px; font-size: 11px; line-height: 1; }
  .frequency-dict-label { flex-shrink: 0; max-width: 120px; padding: 4px; overflow: hidden; background: #4f78bd; color: #fff; text-overflow: ellipsis; white-space: nowrap; }
  .frequency-values { min-width: 0; padding: 4px; color: var(--app-text, #fff); overflow-wrap: anywhere; }
  .pitch-list { display: flex; flex-direction: column; gap: 5px; margin-top: 2px; color: var(--app-text, #fff); font-size: 12px; line-height: 1.35; }
  .pitch-group { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
  .pitch-dict-label { max-width: 100%; padding: 2px 4px; background: #6f7fca; color: #fff; border-radius: 4px; font-size: 11px; line-height: 1.15; overflow-wrap: anywhere; }
  .pitch-entries { margin: 0; padding: 0; list-style: circle inside; }
  .pitch-entries li { margin-top: 2px; }
  .transcription-entries { color: var(--app-muted, #999999); }
  .pitch-visual { display: inline-flex; align-items: flex-end; margin-right: 4px; vertical-align: bottom; }
  .pronunciation-mora { position: relative; display: inline-flex; flex-direction: column; align-items: center; min-width: 1.05em; padding-top: 6px; color: var(--app-text, #fff); font-size: 12px; line-height: 1.1; }
  .pronunciation-mora-line { position: absolute; top: 2px; left: 0; right: 0; height: 1px; background: transparent; }
  .pronunciation-mora[data-pitch="high"] .pronunciation-mora-line { background: var(--app-muted, #999999); }
  .pronunciation-mora[data-pitch="high"][data-next-pitch="low"] .pronunciation-mora-line::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    width: 1px;
    height: 9px;
    background: var(--app-muted, #999999);
  }
  .pronunciation-mora[data-pitch="low"][data-next-pitch="high"] .pronunciation-mora-line::after {
    content: "";
    position: absolute;
    right: 0;
    top: 0;
    width: 1px;
    height: 9px;
    background: var(--app-muted, #999999);
  }
  .pitch-position { color: var(--app-muted, #999999); font-size: 11px; }
  .lookup-glossary { display: flex; flex-direction: column; gap: 2px; color: var(--app-text, #fff); font-size: 12px; line-height: 1.38; overflow-wrap: anywhere; }
  .lookup-glossary-group { display: flex; flex-direction: column; gap: 4px; }
  .lookup-glossary-group[open] { display: flex; }
  .lookup-glossary-dict { color: var(--app-status, #cce8d5); font-size: 11px; cursor: pointer; }
  .lookup-glossary-list { margin: 0; padding-left: 1.25em; }
  .lookup-glossary-list > li { margin: 4px 0; }
  .lookup-glossary-content { min-width: 0; }
  .lookup-glossary-content :global(.structured-content) { display: inline; }
  .lookup-glossary-content :global(ul),
  .lookup-glossary-content :global(ol) { padding-left: 1.25em; margin: 3px 0; }
  .lookup-glossary-content :global(li) { margin: 2px 0; }
  .lookup-glossary-content :global(table) { max-width: 100%; table-layout: auto; border-collapse: collapse; }
  .lookup-glossary-content :global(th),
  .lookup-glossary-content :global(td) { padding: 3px 5px; border: 1px solid var(--app-border, #333333); vertical-align: top; }
  .lookup-glossary-content :global(th) { background: var(--app-control, #1b1b1b); font-weight: 600; }
  .lookup-glossary-content :global(.gloss-sc-table-container) { display: block; max-width: 100%; overflow-x: auto; }
  .lookup-glossary-content :global(a) { color: var(--app-primary, #d0bcff); }
  .lookup-glossary-content :global(a[data-lookup-redirect]) { border-bottom: 1px dotted currentColor; cursor: pointer; text-decoration: none; }
  .lookup-glossary-content :global(rt) { color: var(--app-muted, #999999); font-size: 0.72em; }
  .lookup-glossary-content :global(.gloss-media-placeholder) { display: inline-block; max-width: 100%; padding: 4px 7px; border: 1px dashed var(--app-border, #333333); border-radius: 4px; color: var(--app-muted, #999999); background: var(--app-control, #1b1b1b); font-size: 11px; }
  .lookup-glossary-content :global(.gloss-media-placeholder-loading) { color: var(--app-text, #fff); border-color: var(--app-muted, #999999); }
  .lookup-glossary-content :global(.gloss-media-placeholder-loaded) { display: block; padding: 2px; border-style: solid; }
  .lookup-glossary-content :global(.gloss-media-placeholder-error) { color: var(--app-error, #ffb4ab); border-color: var(--app-error, #ffb4ab); }
  .lookup-glossary-content :global(.gloss-media-image) { display: block; max-width: 100%; max-height: 180px; object-fit: contain; }
  .anki-preview { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px; background: var(--app-bg, #000); border: 1px solid var(--app-border, #333333); border-radius: 4px; }
  .anki-action-message { margin: 0; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
  .anki-action-message.ok { color: #9ad5b5; }
  .anki-action-message.warn { color: #ffd89b; }
  .anki-action-message.bad { color: #ffb4ac; }
</style>
