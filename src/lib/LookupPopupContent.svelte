<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { ankiDictionaryMediaRefs, buildAnkiNoteRequest, isAnkiPreviewConfigured, payloadWithStoredDictionaryMedia, renderAnkiFieldPreview } from "./anki-field-renderer";
  import { formatLookupMatch, frequencyLabel, glossaryGroups, pitchLabel, renderGlossaryContent, resultDictionaryLabel, ruleTags, scopeDictionaryCss, type LookupState } from "./lookup-popup";
  import { selectPopupTextFromPoint } from "./popup-selection";
  import type { AnkiAddNoteResult, AnkiDictionaryMediaRef, AnkiFieldPreview, AnkiNoteRequest, AnkiSettings, AnkiStoreMediaResult, DictResult, LookupAnkiPayload, ReaderSelection } from "./types";

  let {
    popupId,
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
    onAddAnkiNote,
  }: {
    popupId: string;
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
    onAddAnkiNote?: (note: AnkiNoteRequest) => Promise<AnkiAddNoteResult>;
  } = $props();

  let shiftHoverLastX = -1;
  let shiftHoverLastY = -1;
  let lastNestedLookupKey = "";
  let previousClearSelectionSignal: number | null = null;
  let previousRestoreScrollSignal: number | null = null;
  let contentRoot: HTMLDivElement | null = null;
  let dictionaryStyleCss = $state("");
  let ankiPreviewKey = $state("");
  let ankiPreviewFields = $state<AnkiFieldPreview[]>([]);
  let ankiActionKey = $state("");
  let ankiActionState = $state<"idle" | "adding" | "added" | "duplicate" | "error">("idle");
  let ankiActionMessage = $state("");
  let ankiMediaWarnings = $state<string[]>([]);
  let styleRequestId = 0;
  const styleTag = "style";
  const canPreviewAnki = $derived(isAnkiPreviewConfigured(ankiSettings) && Boolean(buildAnkiPayload));

  interface DictionaryMediaResource {
    mimeType: string;
    dataBase64: string;
  }

  interface DictionaryStyleResource {
    css: string;
    source: string;
  }

  function resetShiftHover() {
    shiftHoverLastX = -1;
    shiftHoverLastY = -1;
  }

  $effect(() => {
    if (previousClearSelectionSignal === null) {
      previousClearSelectionSignal = clearSelectionSignal;
      return;
    }
    if (clearSelectionSignal === previousClearSelectionSignal) return;
    previousClearSelectionSignal = clearSelectionSignal;
    window.getSelection()?.removeAllRanges();
    resetShiftHover();
    lastNestedLookupKey = "";
  });

  $effect(() => {
    if (lookupState !== "ready" || !contentRoot) return;

    const frame = window.requestAnimationFrame(() => hydrateDictionaryMedia(contentRoot));
    return () => window.cancelAnimationFrame(frame);
  });

  $effect(() => {
    if (lookupState !== "ready") {
      dictionaryStyleCss = "";
      ankiPreviewKey = "";
      ankiPreviewFields = [];
      ankiActionKey = "";
      ankiActionState = "idle";
      ankiActionMessage = "";
      ankiMediaWarnings = [];
      return;
    }

    const dictionaries = resultDictionaries(results);
    const requestId = ++styleRequestId;
    void loadScopedDictionaryStyles(dictionaries, requestId);
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
    onNestedLookup(popupId, nestedSelection);
  }

  function handleResultsScroll() {
    onScrolled(popupId);
  }

  function handleGlossaryClick(event: MouseEvent) {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLAnchorElement>("a[data-lookup-redirect]")
      : null;
    if (!target) return;

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

  function resultDictionaries(lookupResults: DictResult[]): string[] {
    const dictionaries: string[] = [];
    for (const result of lookupResults) {
      for (const group of glossaryGroups(result)) {
        if (group.dictionary && !dictionaries.includes(group.dictionary)) dictionaries.push(group.dictionary);
      }
    }
    return dictionaries;
  }

  async function loadScopedDictionaryStyles(dictionaries: string[], requestId: number) {
    if (dictionaries.length === 0) {
      dictionaryStyleCss = "";
      return;
    }

    const loader = loadDictionaryStyles ?? invokeDictionaryStyles;
    const chunks: string[] = [];
    for (const dictionary of dictionaries) {
      try {
        const resource = await loader(dictionary);
        if (requestId !== styleRequestId) return;
        if (resource.css.trim()) chunks.push(scopeDictionaryCss(resource.css, popupId));
      } catch {
        if (requestId !== styleRequestId) return;
      }
    }
    if (requestId === styleRequestId) dictionaryStyleCss = chunks.filter(Boolean).join("\n");
  }

  async function invokeDictionaryStyles(dictionary: string): Promise<DictionaryStyleResource> {
    if (!isTauri()) return { css: "", source: dictionary };
    return invoke<DictionaryStyleResource>("dictionary_styles", { dictionary });
  }

  function previewAnki(result: DictResult, resultIndex: number) {
    if (!buildAnkiPayload || !canPreviewAnki) return;
    const key = `${resultIndex}:${result.expression}:${result.reading}`;
    if (ankiPreviewKey === key) {
      ankiPreviewKey = "";
      ankiPreviewFields = [];
      return;
    }
    ankiPreviewKey = key;
    ankiPreviewFields = renderAnkiFieldPreview(buildAnkiPayload(result, resultIndex), ankiSettings);
  }

  async function addAnki(result: DictResult, resultIndex: number) {
    if (!buildAnkiPayload || !canPreviewAnki || !onAddAnkiNote || ankiActionState === "adding") return;
    const key = `${resultIndex}:${result.expression}:${result.reading}`;
    const payload = buildAnkiPayload(result, resultIndex);

    ankiPreviewKey = key;
    ankiPreviewFields = renderAnkiFieldPreview(payload, ankiSettings);
    ankiActionKey = key;
    ankiActionState = "adding";
    ankiActionMessage = "Adding note...";
    ankiMediaWarnings = [];
    try {
      const storeResult = await storeAnkiMediaForPayload(payload);
      if (ankiActionKey !== key) return;
      const notePayload = storeResult
        ? payloadWithStoredDictionaryMedia(payload, storeResult.stored)
        : payload;
      ankiMediaWarnings = storeResult?.warnings ?? [];
      ankiPreviewFields = renderAnkiFieldPreview(notePayload, ankiSettings);
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

  function ankiButtonLabel(result: DictResult, resultIndex: number): string {
    const key = `${resultIndex}:${result.expression}:${result.reading}`;
    if (ankiActionKey !== key) return canPreviewAnki ? "Add Anki" : "Anki not configured";
    if (ankiActionState === "adding") return "Adding...";
    if (ankiActionState === "added") return "Added";
    if (ankiActionState === "duplicate") return "Duplicate";
    if (ankiActionState === "error") return "Anki error";
    return canPreviewAnki ? "Add Anki" : "Anki not configured";
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
  <p class="lookup-text">{selection.text}</p>
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
      {#each results.slice(0, 3) as result, resultIndex}
        <section class="lookup-result">
          <div class="lookup-result-head">
            <span>{result.expression}</span>
            {#if result.reading && result.reading !== result.expression}
              <span class="lookup-reading">{result.reading}</span>
            {/if}
          </div>
          {#if resultDictionaryLabel(result)}
            <p class="lookup-meta">{resultDictionaryLabel(result)}</p>
          {/if}
          {#if formatLookupMatch(result) || result.rules}
            <div class="lookup-tags">
              {#if formatLookupMatch(result)}
                <span class="lookup-tag">{formatLookupMatch(result)}</span>
              {/if}
              {#each ruleTags(result) as rule}
                <span class="lookup-tag">{rule}</span>
              {/each}
            </div>
          {/if}
          {#each glossaryGroups(result) as group, groupIndex}
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
                    >{@html renderGlossaryContent(entry.text, group.dictionary)}</div>
                  </li>
                {/each}
              </ol>
            </details>
          {/each}
          {#if frequencyLabel(result)}
            <p class="lookup-detail"><span>Freq</span>{frequencyLabel(result)}</p>
          {/if}
          {#if pitchLabel(result)}
            <p class="lookup-detail"><span>Pitch</span>{pitchLabel(result)}</p>
          {/if}
          <button
            class:ready={canPreviewAnki}
            class:added={ankiActionKey === `${resultIndex}:${result.expression}:${result.reading}` && ankiActionState === "added"}
            class:duplicate={ankiActionKey === `${resultIndex}:${result.expression}:${result.reading}` && ankiActionState === "duplicate"}
            class:error={ankiActionKey === `${resultIndex}:${result.expression}:${result.reading}` && ankiActionState === "error"}
            class="lookup-anki"
            disabled={!canPreviewAnki || ankiActionState === "adding"}
            title={canPreviewAnki ? "Create an Anki note after duplicate check" : ankiTitle(result, resultIndex)}
            onclick={() => addAnki(result, resultIndex)}
          >
            {ankiButtonLabel(result, resultIndex)}
          </button>
          {#if canPreviewAnki}
            <button class="lookup-anki-preview" onclick={() => previewAnki(result, resultIndex)}>Preview fields</button>
          {/if}
          {#if ankiPreviewKey === `${resultIndex}:${result.expression}:${result.reading}`}
            <section class="anki-preview" aria-label="Anki field preview">
              <div class="anki-preview-head">
                <span>{ankiSettings?.selectedDeck}</span>
                <span>{ankiSettings?.selectedNoteType}</span>
              </div>
              {#each ankiPreviewFields as field (field.field)}
                <div class="anki-preview-row">
                  <span>{field.field}</span>
                  <pre>{field.value}</pre>
                </div>
              {/each}
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
  .lookup-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #9aa0a6; font-size: 11px; text-transform: uppercase; }
  .lookup-head-actions { display: flex; align-items: center; gap: 4px; }
  .lookup-head button { flex-shrink: 0; min-width: 24px; padding: 3px 7px; background: #33383e; color: #d7d9dc; border: 1px solid #555c64; border-radius: 3px; cursor: pointer; font-size: 11px; text-transform: none; }
  .lookup-head button:disabled { color: #747b84; cursor: not-allowed; opacity: 0.62; }
  .lookup-text { color: #fff; font-size: 18px; line-height: 1.35; overflow-wrap: anywhere; max-height: 54px; overflow: hidden; }
  .lookup-state-block { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .lookup-state { color: #b7bcc3; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .lookup-action { padding: 5px 10px; background: #3b8f78; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .lookup-action:hover { background: #46a187; }
  .lookup-results { display: flex; flex-direction: column; gap: 8px; max-height: min(360px, calc(100vh - 220px)); overflow-y: auto; padding-right: 2px; }
  .lookup-result { display: flex; flex-direction: column; gap: 5px; padding-top: 8px; border-top: 1px solid #3c4043; min-width: 0; }
  .lookup-result-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; color: #fff; font-size: 16px; line-height: 1.25; overflow-wrap: anywhere; }
  .lookup-reading { color: #b7bcc3; font-size: 12px; overflow-wrap: anywhere; }
  .lookup-meta { color: #81c995; font-size: 11px; line-height: 1.3; overflow-wrap: anywhere; }
  .lookup-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .lookup-tag { max-width: 100%; padding: 2px 6px; background: #30343a; color: #8ab4f8; border: 1px solid #454b52; border-radius: 4px; font-size: 11px; line-height: 1.25; overflow-wrap: anywhere; }
  .lookup-glossary { display: flex; flex-direction: column; gap: 2px; color: #d7d9dc; font-size: 12px; line-height: 1.38; overflow-wrap: anywhere; }
  .lookup-glossary-group { display: flex; flex-direction: column; gap: 4px; }
  .lookup-glossary-group[open] { display: flex; }
  .lookup-glossary-dict { color: #81c995; font-size: 11px; cursor: pointer; }
  .lookup-glossary-list { margin: 0; padding-left: 1.25em; }
  .lookup-glossary-list > li { margin: 4px 0; }
  .lookup-glossary-content { min-width: 0; }
  .lookup-glossary-content :global(.structured-content) { display: inline; }
  .lookup-glossary-content :global(ul),
  .lookup-glossary-content :global(ol) { padding-left: 1.25em; margin: 3px 0; }
  .lookup-glossary-content :global(li) { margin: 2px 0; }
  .lookup-glossary-content :global(table) { max-width: 100%; table-layout: auto; border-collapse: collapse; }
  .lookup-glossary-content :global(th),
  .lookup-glossary-content :global(td) { padding: 3px 5px; border: 1px solid #5a6169; vertical-align: top; }
  .lookup-glossary-content :global(th) { background: #30343a; font-weight: 600; }
  .lookup-glossary-content :global(.gloss-sc-table-container) { display: block; max-width: 100%; overflow-x: auto; }
  .lookup-glossary-content :global(a) { color: #8ab4f8; }
  .lookup-glossary-content :global(a[data-lookup-redirect]) { border-bottom: 1px dotted currentColor; cursor: pointer; text-decoration: none; }
  .lookup-glossary-content :global(rt) { color: #b7bcc3; font-size: 0.72em; }
  .lookup-glossary-content :global(.gloss-media-placeholder) { display: inline-block; max-width: 100%; padding: 4px 7px; border: 1px dashed #5a6169; border-radius: 4px; color: #b7bcc3; background: #2b2f34; font-size: 11px; }
  .lookup-glossary-content :global(.gloss-media-placeholder-loading) { color: #d2d6dc; border-color: #6f7782; }
  .lookup-glossary-content :global(.gloss-media-placeholder-loaded) { display: block; padding: 2px; border-style: solid; }
  .lookup-glossary-content :global(.gloss-media-placeholder-error) { color: #f28b82; border-color: #7d4f4b; }
  .lookup-glossary-content :global(.gloss-media-image) { display: block; max-width: 100%; max-height: 180px; object-fit: contain; }
  .lookup-detail { color: #c8ccd1; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
  .lookup-detail span { margin-right: 6px; color: #fdd663; }
  .lookup-anki { align-self: flex-start; margin-top: 2px; padding: 3px 7px; background: #2b2f34; color: #7f858c; border: 1px solid #444a51; border-radius: 4px; cursor: not-allowed; font-size: 11px; }
  .lookup-anki.ready { color: #d8eadf; background: #24352f; border-color: #3b6956; cursor: pointer; }
  .lookup-anki.ready:hover { background: #2c4038; }
  .lookup-anki.added { color: #d8eadf; border-color: #4d8f6b; }
  .lookup-anki.duplicate { color: #ffd89b; border-color: #8d6a33; }
  .lookup-anki.error { color: #ffb4ac; border-color: #7d4f4b; }
  .lookup-anki-preview { align-self: flex-start; margin-top: -2px; padding: 0; color: #9bbdf9; background: transparent; border: none; cursor: pointer; font-size: 11px; text-decoration: underline; }
  .anki-preview { display: flex; flex-direction: column; gap: 6px; padding: 8px; background: #202326; border: 1px solid #3c4043; border-radius: 4px; }
  .anki-preview-head { display: flex; flex-wrap: wrap; gap: 6px; color: #9ad5b5; font-size: 11px; line-height: 1.3; }
  .anki-preview-row { display: grid; grid-template-columns: minmax(72px, 0.35fr) minmax(0, 1fr); gap: 7px; align-items: start; min-width: 0; }
  .anki-preview-row > span { min-width: 0; overflow-wrap: anywhere; color: #fdd663; font-size: 11px; line-height: 1.35; }
  .anki-preview-row pre { min-width: 0; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: #d7d9dc; font-family: inherit; font-size: 11px; line-height: 1.35; }
  .anki-action-message { margin: 0; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
  .anki-action-message.ok { color: #9ad5b5; }
  .anki-action-message.warn { color: #ffd89b; }
  .anki-action-message.bad { color: #ffb4ac; }
</style>
