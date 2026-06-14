<script lang="ts">
  import { invoke, isTauri } from "@tauri-apps/api/core";
  import { formatLookupMatch, frequencyLabel, glossaryGroups, pitchLabel, renderGlossaryContent, resultDictionaryLabel, ruleTags, type LookupState } from "./lookup-popup";
  import { selectPopupTextFromPoint } from "./popup-selection";
  import type { DictResult, ReaderSelection } from "./types";

  let {
    popupId,
    selection,
    state,
    error = "",
    results = [],
    clearSelectionSignal = 0,
    onClose = () => {},
    onImportDictionary = () => {},
    onNestedLookup = () => {},
    onScrolled = () => {},
    ankiTitle = () => "Payload prepared for current book",
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
    onScrolled?: (popupId: string) => void;
    ankiTitle?: (result: DictResult, resultIndex: number) => string;
  } = $props();

  let shiftHoverLastX = -1;
  let shiftHoverLastY = -1;
  let lastNestedLookupKey = "";
  let previousClearSelectionSignal: number | null = null;
  let contentRoot: HTMLDivElement | null = null;

  interface DictionaryMediaResource {
    mimeType: string;
    dataBase64: string;
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
    if (state !== "ready" || !contentRoot || !isTauri()) return;

    const frame = window.requestAnimationFrame(() => loadDictionaryMedia(contentRoot));
    return () => window.cancelAnimationFrame(frame);
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

  function loadDictionaryMedia(root: HTMLElement | null) {
    if (!root) return;
    const placeholders = [
      ...root.querySelectorAll<HTMLElement>(".gloss-media-placeholder[data-media-path][data-media-dictionary]"),
    ].filter((placeholder) => !placeholder.dataset.mediaStatus);

    if (placeholders.length === 0) return;
    if (!("IntersectionObserver" in window)) {
      for (const placeholder of placeholders) void loadDictionaryMediaPlaceholder(placeholder);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const placeholder = entry.target as HTMLElement;
        observer.unobserve(placeholder);
        void loadDictionaryMediaPlaceholder(placeholder);
      }
    }, { rootMargin: "160px" });

    for (const placeholder of placeholders) {
      placeholder.dataset.mediaStatus = "pending";
      observer.observe(placeholder);
    }
  }

  async function loadDictionaryMediaPlaceholder(placeholder: HTMLElement) {
    const dictionary = placeholder.dataset.mediaDictionary ?? "";
    const path = placeholder.dataset.mediaPath ?? "";
    if (!dictionary || !path) return;

    placeholder.dataset.mediaStatus = "loading";
    try {
      const resource = await invoke<DictionaryMediaResource>("dictionary_media", { dictionary, path });
      if (!placeholder.isConnected) return;

      const image = document.createElement("img");
      image.className = "gloss-media-image";
      image.alt = placeholder.textContent?.trim() || "Dictionary media";
      image.src = `data:${resource.mimeType};base64,${resource.dataBase64}`;
      placeholder.replaceChildren(image);
      placeholder.dataset.mediaStatus = "loaded";
      placeholder.classList.add("gloss-media-placeholder-loaded");
    } catch {
      if (!placeholder.isConnected) return;
      placeholder.textContent = "Media unavailable";
      placeholder.dataset.mediaStatus = "error";
      placeholder.classList.add("gloss-media-placeholder-error");
    }
  }
</script>

<div class="lookup-content" bind:this={contentRoot}>
  <div class="lookup-head">
    <span>Lookup</span>
    <button aria-label="Close lookup" onclick={() => onClose(popupId)}>Close</button>
  </div>
  <p class="lookup-text">{selection.text}</p>
  {#if state === "loading"}
    <p class="lookup-state">Looking up...</p>
  {:else if state === "noDictionaries"}
    <div class="lookup-state-block">
      <p class="lookup-state">{error}</p>
      <button class="lookup-action" onclick={onImportDictionary}>Import Dictionary</button>
    </div>
  {:else if state === "engineUnavailable"}
    <p class="lookup-state">{error}</p>
  {:else if state === "error"}
    <p class="lookup-state">{error}</p>
  {:else if state === "empty"}
    <p class="lookup-state">No dictionary results for "{selection.text}".</p>
  {:else if state === "ready"}
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
          <button class="lookup-anki" disabled title={ankiTitle(result, resultIndex)}>
            Anki not configured
          </button>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .lookup-content { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .lookup-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #9aa0a6; font-size: 11px; text-transform: uppercase; }
  .lookup-head button { flex-shrink: 0; padding: 3px 8px; background: #33383e; color: #d7d9dc; border: 1px solid #555c64; border-radius: 3px; cursor: pointer; font-size: 11px; text-transform: none; }
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
  .lookup-glossary-content :global(rt) { color: #b7bcc3; font-size: 0.72em; }
  .lookup-glossary-content :global(.gloss-media-placeholder) { display: inline-block; max-width: 100%; padding: 4px 7px; border: 1px dashed #5a6169; border-radius: 4px; color: #b7bcc3; background: #2b2f34; font-size: 11px; }
  .lookup-glossary-content :global(.gloss-media-placeholder-loaded) { display: block; padding: 2px; border-style: solid; }
  .lookup-glossary-content :global(.gloss-media-placeholder-error) { color: #f28b82; border-color: #7d4f4b; }
  .lookup-glossary-content :global(.gloss-media-image) { display: block; max-width: 100%; max-height: 180px; object-fit: contain; }
  .lookup-detail { color: #c8ccd1; font-size: 11px; line-height: 1.35; overflow-wrap: anywhere; }
  .lookup-detail span { margin-right: 6px; color: #fdd663; }
  .lookup-anki { align-self: flex-start; margin-top: 2px; padding: 3px 7px; background: #2b2f34; color: #7f858c; border: 1px solid #444a51; border-radius: 4px; cursor: not-allowed; font-size: 11px; }
</style>
