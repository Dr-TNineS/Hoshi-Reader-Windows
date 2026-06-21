<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import { extractDictionaryMediaReferences } from "./anki-field-renderer";
  import type { LookupState } from "./lookup-popup";
  import { lookupPopupStyle } from "./lookup-popup-position";
  import type { AnkiAddNoteResult, AnkiDictionaryMediaRef, AnkiNoteRequest, AnkiRemoteAudioRequest, AnkiSettings, AnkiStoreMediaResult, AnkiStoreRemoteAudioResult, DictResult, LookupAnkiPayload, ReaderSelection } from "./types";

  const params = new URLSearchParams(window.location.search);
  const allowedStates: LookupState[] = ["loading", "noDictionaries", "engineUnavailable", "empty", "error", "ready"];
  const requestedState = params.get("lookupState") as LookupState | null;
  const lookupState = allowedStates.includes(requestedState ?? "loading") ? requestedState ?? "loading" : "loading";
  const longResult = params.has("longResult");
  const bottomEdge = params.has("bottomEdge");
  const mediaMode = params.get("mediaMode") ?? "success";
  const ankiMode = params.get("ankiMode") ?? "disabled";
  const ankiAddMode = params.get("ankiAddMode") ?? "added";
  const ankiStoreMode = params.get("ankiStoreMode") ?? "success";
  const ankiAudioStoreMode = params.get("ankiAudioStoreMode") ?? "success";
  const audioFieldEnabled = params.get("audioField") !== "disabled";
  const emptyExpression = params.has("emptyExpression");

  const rootSelection: ReaderSelection = {
    text: "school",
    sentence: "The academy school sentence contains the selected lookup term in a longer source paragraph.",
    chapterIndex: 0,
    rect: { x: 460, y: bottomEdge ? Math.max(120, window.innerHeight - 118) : 180, width: 36, height: 120 },
  };

  const glossaryText = longResult
    ? Array.from({ length: 16 }, (_, index) => `structured glossary line ${index + 1}: a school or learning place`).join("; ")
    : "school; a place of study";
  const structuredGlossaryText = JSON.stringify([
    {
      type: "structured-content",
      content: [
        { tag: "div", data: { class: "probe-entry", headword: "school" }, content: "classroom school room" },
        { tag: "div", data: { class: "probe-japanese-prefix" }, content: "Aことは A" },
        { tag: "div", data: { class: "probe-japanese-quote" }, content: "って「ことと言いなさい」" },
        { tag: "div", data: { class: "probe-japanese-plain" }, content: "ことは純日文" },
        {
          tag: "ul",
          content: [
            { tag: "li", content: "first structured sense" },
            { tag: "li", content: ["second structured sense", { tag: "br" }, "with a line break"] },
            { tag: "li", content: ["see also ", { tag: "a", href: "?query=academy", content: "academy" }] },
          ],
        },
        {
          tag: "table",
          data: { content: "formsTable" },
          content: [
            {
              tag: "tr",
              content: [
                { tag: "th", content: "form" },
                { tag: "th", content: "reading" },
              ],
            },
            {
              tag: "tr",
              content: [
                { tag: "td", content: "学校" },
                { tag: "td", content: { tag: "ruby", content: ["学", { tag: "rt", content: "がく" }] } },
              ],
            },
          ],
        },
        { tag: "img", path: "images/school.svg", alt: "school icon" },
      ],
    },
  ]);

  const baseResult: DictResult = {
    expression: emptyExpression ? "" : "school",
    reading: "school",
    glossary: [
      { dict: "Jitendex.org [probe]", text: structuredGlossaryText, termTags: "n common", definitionTags: "education" },
      { dict: "Jitendex.org [probe]", text: "academy; lesson context", definitionTags: "place" },
      { dict: "JMdict [probe]", text: glossaryText, termTags: "n" },
    ],
    matched: "school",
    deinflected: "school",
    rules: "n",
    dictionary: "Jitendex.org [probe]",
    frequencies: [{ dictionary: "Freq Probe", items: [{ value: 120, displayValue: "120" }] }],
    pitches: [{ dictionary: "Pitch Probe", positions: [0, 2], transcriptions: ["school"] }],
  };

  const extraResults: DictResult[] = longResult
    ? Array.from({ length: 4 }, (_, index) => ({
      ...baseResult,
      expression: `school extra ${index + 2}`,
      reading: "",
      glossary: [{ dict: "Jitendex.org [probe]", text: `extra rendered lookup result ${index + 2}` }],
      matched: `school${index + 2}`,
      deinflected: `school${index + 2}`,
      frequencies: [],
      pitches: [],
    }))
    : [];

  const ankiSettings: AnkiSettings | null = ankiMode === "configured"
    ? {
      version: 1,
      endpoint: "http://127.0.0.1:8765",
      selectedDeck: "Mining",
      selectedNoteType: "Hoshi Vocabulary",
      decks: [{ name: "Mining" }],
      noteTypes: [{ name: "Hoshi Vocabulary", fields: ["Expression", "Meaning", "Sentence", "JmOnly", "MissingDict", "Media", ...(audioFieldEnabled ? ["Audio"] : []), "Frequency", "Pitch", "Unknown"] }],
      fieldMappings: [
        { field: "Expression", template: "{expression} / {reading}" },
        { field: "Meaning", template: "{glossary-first}" },
        { field: "Sentence", template: "{sentence}" },
        { field: "JmOnly", template: "{single-glossary-JMdict [probe]}" },
        { field: "MissingDict", template: "{single-glossary-Missing Probe}" },
        { field: "Media", template: "{dictionary-media}" },
        ...(audioFieldEnabled ? [{ field: "Audio", template: "{audio}" }] : []),
        { field: "Frequency", template: "{frequencies}" },
        { field: "Pitch", template: "{pitch-accent-positions}" },
        { field: "Unknown", template: "before{not-a-token}after" },
      ],
      audioEnabled: true,
      audioSources: [{ name: "Probe Audio", url: "https://example.invalid/audio?term={term}&reading={reading}", enabled: true }],
      audioDownloadTimeoutMs: 5000,
      lastFetchedAt: 1780000000000,
    }
    : null;

  interface ProbePopup {
    id: string;
    selection: ReaderSelection;
    results: DictResult[];
    clearSelectionSignal: number;
    historyBack: Array<{ selection: ReaderSelection; scrollTop: number }>;
    historyForward: Array<{ selection: ReaderSelection; scrollTop: number }>;
    restoreScrollTop: number;
    restoreScrollSignal: number;
  }

  let popups: ProbePopup[] = $state([{
    id: "root",
    selection: rootSelection,
    results: [{ ...baseResult }, ...extraResults],
    clearSelectionSignal: 0,
    historyBack: [],
    historyForward: [],
    restoreScrollTop: 0,
    restoreScrollSignal: 0,
  }]);
  let importClicks = $state(0);
  let closeClicks = $state(0);
  let scrollCloseCount = $state(0);
  let nestedLookupCount = $state(0);
  let nestedLookupText = $state("");
  let ankiAddRequests = $state<AnkiNoteRequest[]>([]);
  let ankiStoreRequests = $state<AnkiDictionaryMediaRef[][]>([]);
  let ankiAudioStoreRequests = $state<AnkiRemoteAudioRequest[]>([]);
  let popupSizes = $state<Record<string, { width: number; height: number }>>({});

  function readerBottomBoundary(): number {
    const controls = document.querySelector<HTMLElement>(".probe-ctrls");
    return Math.min(window.innerHeight, controls?.getBoundingClientRect().top ?? window.innerHeight);
  }

  function measureLookupPopup(node: HTMLElement, popupId: string) {
    let id = popupId;

    const sync = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nextSize = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      const previous = popupSizes[id];
      if (previous?.width === nextSize.width && previous?.height === nextSize.height) return;
      popupSizes = { ...popupSizes, [id]: nextSize };
    };

    const observer = new ResizeObserver(sync);
    observer.observe(node);
    const frame = requestAnimationFrame(sync);

    return {
      update(nextId: string) {
        if (nextId === id) return;
        const { [id]: _removed, ...rest } = popupSizes;
        popupSizes = rest;
        id = nextId;
        sync();
      },
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        const { [id]: _removed, ...rest } = popupSizes;
        popupSizes = rest;
      },
    };
  }

  function positionedPopupStyle(popup: ProbePopup, index: number): string {
    if (!bottomEdge) return `--offset:${index * 26}px;--popup-z:${125 + index}`;
    const style = lookupPopupStyle(popup.selection, popupSizes[popup.id] ?? { width: 306, height: 154 }, {
      width: window.innerWidth,
      bottom: readerBottomBoundary(),
    });
    return `${style};--offset:${index * 26}px;--popup-z:${125 + index}`;
  }

  function nestedResult(selection: ReaderSelection): DictResult {
    return {
      ...baseResult,
      expression: selection.text,
      reading: "",
      glossary: [{ dict: "Jitendex.org [probe]", text: `nested result for ${selection.text}` }],
      matched: selection.text,
      deinflected: selection.text,
      rules: "",
      frequencies: [],
      pitches: [],
    };
  }

  function openNestedLookup(parentId: string, nestedSelection: ReaderSelection) {
    nestedLookupCount += 1;
    nestedLookupText = nestedSelection.text;
    const parentIndex = popups.findIndex((popup) => popup.id === parentId);
    if (parentIndex < 0) return;
    popups = [
      ...popups.slice(0, parentIndex + 1),
      {
        id: `child-${nestedLookupCount}`,
        selection: nestedSelection,
        results: [nestedResult(nestedSelection)],
        clearSelectionSignal: 0,
        historyBack: [],
        historyForward: [],
        restoreScrollTop: 0,
        restoreScrollSignal: 0,
      },
    ];
  }

  function popupResultsScrollTop(id: string): number {
    const popup = [...document.querySelectorAll<HTMLElement>(".lookup-pop")]
      .find((element) => element.dataset.popupId === id);
    return popup?.querySelector<HTMLElement>(".lookup-results")?.scrollTop ?? 0;
  }

  function redirectLookup(popupId: string, selection: ReaderSelection) {
    const index = popups.findIndex((popup) => popup.id === popupId);
    if (index < 0) return;
    const popup = popups[index];
    const scrollTop = popupResultsScrollTop(popupId);
    const redirectedSelection = {
      ...selection,
      rect: popup.selection.rect,
      anchorRect: popup.selection.anchorRect,
    };
    popups = [
      ...popups.slice(0, index).map((item) => item),
      {
        ...popup,
        selection: redirectedSelection,
        results: [nestedResult(redirectedSelection)],
        clearSelectionSignal: popup.clearSelectionSignal + 1,
        historyBack: [...popup.historyBack, { selection: popup.selection, scrollTop }],
        historyForward: [],
        restoreScrollTop: 0,
        restoreScrollSignal: popup.restoreScrollSignal + 1,
      },
    ];
  }

  function navigateHistory(popupId: string, direction: "back" | "forward") {
    const index = popups.findIndex((popup) => popup.id === popupId);
    if (index < 0) return;
    const popup = popups[index];
    const source = direction === "back" ? popup.historyBack : popup.historyForward;
    if (source.length === 0) return;
    const current = { selection: popup.selection, scrollTop: popupResultsScrollTop(popupId) };
    const target = source[source.length - 1];
    popups = [
      ...popups.slice(0, index),
      {
        ...popup,
        selection: target.selection,
        results: target.selection.text === "school" ? [{ ...baseResult }] : [nestedResult(target.selection)],
        clearSelectionSignal: popup.clearSelectionSignal + 1,
        historyBack: direction === "back"
          ? popup.historyBack.slice(0, -1)
          : [...popup.historyBack, current],
        historyForward: direction === "back"
          ? [...popup.historyForward, current]
          : popup.historyForward.slice(0, -1),
        restoreScrollTop: target.scrollTop,
        restoreScrollSignal: popup.restoreScrollSignal + 1,
      },
    ];
  }

  function closePopup(popupId: string) {
    closeClicks += 1;
    const index = popups.findIndex((popup) => popup.id === popupId);
    if (index < 0) return;
    if (index === 0) {
      popups = [];
      return;
    }
    popups = popups.slice(0, index).map((popup, popupIndex) => (
      popupIndex === index - 1 ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 } : popup
    ));
  }

  function closeChildren(parentId: string) {
    const index = popups.findIndex((popup) => popup.id === parentId);
    if (index < 0 || index >= popups.length - 1) return;
    scrollCloseCount += 1;
    popups = popups.slice(0, index + 1).map((popup, popupIndex) => (
      popupIndex === index ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 } : popup
    ));
  }

  function buildAnkiPayload(selection: ReaderSelection, result: DictResult, resultIndex: number): LookupAnkiPayload {
    return {
      selectedText: selection.text,
      sentence: selection.sentence ?? selection.text,
      resultIndex,
      expression: result.expression,
      reading: result.reading,
      glossary: result.glossary,
      dictionary: result.dictionary,
      matched: result.matched,
      deinflected: result.deinflected,
      rules: result.rules,
      frequencies: result.frequencies,
      pitches: result.pitches,
      media: extractDictionaryMediaReferences(result.glossary),
      audioFilename: null,
      sourceBook: { title: "Probe Book" },
      sourceChapter: { chapterIndex: 0, chapterNumber: 1, totalChapters: 1, idref: "probe" },
    };
  }

  async function addAnkiNote(note: AnkiNoteRequest): Promise<AnkiAddNoteResult> {
    ankiAddRequests = [...ankiAddRequests, note];
    if (ankiAddMode === "error") throw new Error("Probe AnkiConnect failure");
    if (ankiAddMode === "duplicate") {
      return { status: "duplicate", noteId: null, message: "cannot create note because it is a duplicate" };
    }
    return { status: "added", noteId: 4242, message: "Added Anki note 4242." };
  }

  async function storeAnkiMedia(media: AnkiDictionaryMediaRef[]): Promise<AnkiStoreMediaResult> {
    ankiStoreRequests = [...ankiStoreRequests, media];
    if (ankiStoreMode === "error") throw new Error("Probe media store failure");
    if (ankiStoreMode === "missing") {
      return {
        stored: [],
        warnings: media.map((item) => `Missing probe media: ${item.dictionary}/${item.path}`),
      };
    }
    return {
      stored: media.map((item) => ({
        dictionary: item.dictionary,
        path: item.path,
        filename: `stored_${item.filename}`,
      })),
      warnings: [],
    };
  }

  async function storeAnkiRemoteAudio(request: AnkiRemoteAudioRequest): Promise<AnkiStoreRemoteAudioResult> {
    ankiAudioStoreRequests = [...ankiAudioStoreRequests, request];
    if (ankiAudioStoreMode === "error") throw new Error("Remote audio URL resolved to a private, local, or reserved address.");
    if (ankiAudioStoreMode === "missing") {
      return { filename: null, warnings: ["Word audio (Probe Audio): Remote audio source returned HTTP 404."] };
    }
    if (ankiAudioStoreMode === "unsupported") {
      return { filename: null, warnings: ["Word audio (Probe Audio): The response was not a supported audio file."] };
    }
    return { filename: "hsw_audio_probe.mp3", warnings: [] };
  }

  async function loadDictionaryStyles(dictionary: string) {
    if (dictionary !== "Jitendex.org [probe]") return { source: dictionary, css: "" };
    return {
      source: "probe",
      css: `
        @import url("https://example.invalid/bad.css");
        body { background: rgb(255, 0, 0); }
        .lookup-head { color: rgb(255, 0, 0); }
        .lookup-anki { display: none; }
        .gloss-sc-div { color: rgb(123, 210, 145); position: fixed; background-image: url("https://example.invalid/bad.png"); }
      `,
    };
  }

  async function loadDictionaryMediaResource(dictionary: string, path: string) {
    if (mediaMode === "fail") throw new Error(`Missing probe media: ${dictionary}/${path}`);
    return {
      mimeType: "image/svg+xml",
      dataBase64: "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDY0IDQwIj48cmVjdCB3aWR0aD0iNjQiIGhlaWdodD0iNDAiIHJ4PSI2IiBmaWxsPSIjMzAzNDNhIi8+PHBhdGggZD0iTTEwIDI4aDQ0TDM5IDEyIDI4IDI0bC02LTYiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzc5ZDI5MSIgc3Ryb2tlLXdpZHRoPSIzIi8+PC9zdmc+",
    };
  }
</script>

<main class="probe">
  {#each popups as popup, index (popup.id)}
    <aside
      class="lookup-pop"
      data-state={lookupState}
      data-popup-id={popup.id}
      use:measureLookupPopup={popup.id}
      onpointerdown={() => closeChildren(popup.id)}
      style={positionedPopupStyle(popup, index)}
    >
      <LookupPopupContent
        popupId={popup.id}
        selection={popup.selection}
        state={lookupState}
        error={
          lookupState === "noDictionaries"
            ? "No imported dictionaries found."
            : lookupState === "engineUnavailable"
              ? "Dictionary engine not linked. Install CMake/C++ build tools and rebuild HSW with hoshidicts."
              : lookupState === "error"
                ? "Cannot parse dictionary manifest: probe"
                : ""
        }
        results={lookupState === "ready" ? popup.results : []}
        clearSelectionSignal={popup.clearSelectionSignal}
        onImportDictionary={() => importClicks += 1}
        onClose={closePopup}
        onNestedLookup={openNestedLookup}
        onRedirectLookup={redirectLookup}
        onScrolled={closeChildren}
        onNavigateHistory={navigateHistory}
        canNavigateBack={popup.historyBack.length > 0}
        canNavigateForward={popup.historyForward.length > 0}
        restoreScrollTop={popup.restoreScrollTop}
        restoreScrollSignal={popup.restoreScrollSignal}
        {loadDictionaryStyles}
        loadDictionaryMediaResource={mediaMode === "none" ? undefined : loadDictionaryMediaResource}
        ankiTitle={() => "Payload prepared for Probe Book"}
        {ankiSettings}
        buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(popup.selection, result, resultIndex)}
        onStoreAnkiMedia={storeAnkiMedia}
        onStoreAnkiRemoteAudio={storeAnkiRemoteAudio}
        onAddAnkiNote={addAnkiNote}
      />
    </aside>
  {/each}
  <div
    class="probe-state"
    data-import-clicks={importClicks}
    data-close-clicks={closeClicks}
    data-scroll-close-count={scrollCloseCount}
    data-nested-lookup-count={nestedLookupCount}
    data-nested-lookup-text={nestedLookupText}
    data-popup-count={popups.length}
    data-root-clear-selection-signal={popups[0]?.clearSelectionSignal ?? 0}
    data-top-popup-id={popups[popups.length - 1]?.id ?? ""}
    data-anki-add-count={ankiAddRequests.length}
    data-anki-store-count={ankiStoreRequests.length}
    data-anki-audio-store-count={ankiAudioStoreRequests.length}
    data-anki-last-audio-request={JSON.stringify(ankiAudioStoreRequests[ankiAudioStoreRequests.length - 1] ?? null)}
    data-anki-last-media={JSON.stringify(ankiStoreRequests[ankiStoreRequests.length - 1] ?? [])}
    data-anki-last-deck={ankiAddRequests[ankiAddRequests.length - 1]?.deckName ?? ""}
    data-anki-last-model={ankiAddRequests[ankiAddRequests.length - 1]?.modelName ?? ""}
    data-anki-last-fields={JSON.stringify(ankiAddRequests[ankiAddRequests.length - 1]?.fields ?? {})}
    data-state={lookupState}
    aria-hidden="true"
    ></div>
  {#if bottomEdge}
    <div class="probe-ctrls">bottom controls</div>
  {/if}
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: #202124; color: #e8eaed; font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .probe { width: 100vw; height: 100vh; position: relative; }
  .probe::before {
    content: "school";
    position: fixed;
    left: 460px;
    top: 180px;
    writing-mode: vertical-rl;
    color: #5f6368;
    font-size: 22px;
  }
  .lookup-pop {
    position: fixed;
    left: min(calc(520px + var(--offset)), calc(100vw - 304px));
    top: calc(72px + var(--offset));
    z-index: var(--popup-z);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 280px;
    max-height: min(520px, calc(100vh - 92px));
    padding: 10px 12px;
    background: #23262a;
    color: #e8eaed;
    border: 1px solid #4b5056;
    border-radius: 6px;
    box-shadow: 0 14px 38px rgba(0, 0, 0, 0.42);
    overflow: hidden;
  }
  .probe-ctrls {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 100;
    padding: 5px;
    background: #111;
    border-top: 1px solid #333;
    color: #888;
    font-size: 12px;
    text-align: center;
  }
  .probe-state {
    position: fixed;
    right: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }
</style>
