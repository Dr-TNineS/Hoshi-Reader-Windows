<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import { extractDictionaryMediaReferences } from "./anki-field-renderer";
  import { defaultDictionarySettings, normalizeDictionarySettings } from "./dictionary-settings";
  import type { LookupState } from "./lookup-popup";
  import { lookupPopupStyle } from "./lookup-popup-position";
  import { normalizeLookupPopupSettings } from "./lookup-popup-settings";
  import type { AnkiAddNoteResult, AnkiDictionaryMediaRef, AnkiNoteRequest, AnkiRemoteAudioRequest, AnkiSettings, AnkiStoreBookCoverResult, AnkiStoreMediaResult, AnkiStoreRemoteAudioResult, AnkiStoreSasayakiAudioResult, DictResult, LocalAudioStoreRequest, LocalAudioStoreResult, LookupAnkiPayload, ReaderSelection, SasayakiPlaybackCue, WordAudioPlaybackResult, WordAudioResolveRequest } from "./types";

  type SasayakiPopupAction = "replayCue" | "togglePlayback" | "playForward";

  const params = new URLSearchParams(window.location.search);
  const allowedStates: LookupState[] = ["loading", "noDictionaries", "engineUnavailable", "empty", "error", "ready"];
  const requestedState = params.get("lookupState") as LookupState | null;
  const lookupState = allowedStates.includes(requestedState ?? "loading") ? requestedState ?? "loading" : "loading";
  const longResult = params.has("longResult");
  const bottomEdge = params.has("bottomEdge");
  const topEdge = params.has("topEdge");
  const mediaMode = params.get("mediaMode") ?? "success";
  const ankiMode = params.get("ankiMode") ?? "disabled";
  const ankiAddMode = params.get("ankiAddMode") ?? "added";
  const ankiStoreMode = params.get("ankiStoreMode") ?? "success";
  const ankiAudioStoreMode = params.get("ankiAudioStoreMode") ?? "success";
  const localAudioStoreMode = params.get("localAudioStoreMode") ?? "success";
  const coverStoreMode = params.get("coverStoreMode") ?? "success";
  const audioFieldEnabled = params.get("audioField") !== "disabled";
  const coverFieldEnabled = params.get("coverField") !== "disabled";
  const sasayakiFieldEnabled = params.get("sasayakiField") === "enabled";
  const sasayakiControlsEnabled = params.get("sasayakiControls") === "enabled";
  const sasayakiPlayingInitial = params.get("sasayakiPlaying") === "enabled";
  const sasayakiStoreMode = params.get("sasayakiStoreMode") ?? "success";
  const noSasayakiCue = params.has("noSasayakiCue");
  const noBookId = params.has("noBookId");
  const emptyExpression = params.has("emptyExpression");
  const showReading = params.has("showReading");
  const popupSettings = normalizeLookupPopupSettings({
    width: params.has("popupWidth") ? Number(params.get("popupWidth")) : 320,
    height: params.has("popupHeight") ? Number(params.get("popupHeight")) : 250,
    scale: params.has("popupScale") ? Number(params.get("popupScale")) : 1,
  });
  const importPopupSettings = normalizeLookupPopupSettings({
    width: params.has("importPopupWidth") ? Number(params.get("importPopupWidth")) : popupSettings.width,
    height: params.has("importPopupHeight") ? Number(params.get("importPopupHeight")) : popupSettings.height,
    scale: params.has("importPopupScale") ? Number(params.get("importPopupScale")) : popupSettings.scale,
  });
  const importedDictionaryRecords = [
    { dictId: "jitendex-probe", title: "Jitendex.org [probe]", styleSource: "probe:jank-css" },
    { dictId: "nocss-probe", title: "No CSS Dictionary [probe]", styleSource: "" },
  ];
  const dictionarySettings = normalizeDictionarySettings({
    ...defaultDictionarySettings,
    scanLength: params.has("scanLength") ? Number(params.get("scanLength")) : defaultDictionarySettings.scanLength,
    scanNonJapaneseText: params.get("scanNonJapaneseText") !== "disabled",
    collapseMode: params.get("collapseMode") ?? defaultDictionarySettings.collapseMode,
    expandFirstDictionary: params.get("expandFirstDictionary") === "enabled",
    collapsedDictionaries: params.has("collapsedDictionaries") ? params.get("collapsedDictionaries")?.split("|") : defaultDictionarySettings.collapsedDictionaries,
    compactGlossaries: params.get("dictionaryCompactGlossaries") !== "disabled",
    showExpressionTags: params.get("showExpressionTags") === "enabled",
    harmonicFrequency: params.get("harmonicFrequency") === "enabled",
    deduplicatePitchAccents: params.get("deduplicatePitchAccents") === "enabled",
    compactPitchAccents: params.get("compactPitchAccents") !== "disabled",
  });

  const rootSelection: ReaderSelection = {
    text: "school",
    sentence: "The academy school sentence contains the selected lookup term in a longer source paragraph.",
    sentenceOffset: "The academy ".length,
    chapterOffset: 16,
    chapterIndex: 0,
    rect: { x: 460, y: topEdge ? 44 : bottomEdge ? Math.max(120, window.innerHeight - 118) : 180, width: 36, height: 120 },
  };

  const probeSasayakiCue: SasayakiPlaybackCue = {
    id: "cue-42",
    startTime: 12,
    endTime: 16,
    chapterIndex: 0,
    start: 10,
    length: 24,
  };

  const glossaryText = longResult
    ? Array.from({ length: 16 }, (_, index) => `structured glossary line ${index + 1}: a school or learning place`).join("; ")
    : "school; a place of study";
  const mk3Gaiji = (path: string, alt: string) => ({
    tag: "img",
    path,
    alt,
    data: { img: "", gaiji: "", class: "gaiji", alt, src: path },
  });
  const structuredGlossaryText = JSON.stringify([
    {
      type: "structured-content",
      content: [
        { tag: "div", data: { class: "probe-entry", headword: "school" }, content: "classroom school room" },
        {
          tag: "span",
          data: { class: "probe-inline-style-safe" },
          style: { color: "DodgerBlue", fontWeight: "bold", fontSize: "1.2em", marginLeft: "-0.5em" },
          content: "colored structured style",
        },
        {
          tag: "span",
          data: { class: "probe-inline-style-unsafe" },
          style: { position: "fixed", backgroundImage: "url(https://example.invalid/bad.png)", color: "rgb(5, 6, 7)" },
          content: "sanitized structured style",
        },
        {
          tag: "div",
          data: { class: "probe-mk3-head" },
          content: [
            { tag: "span", data: { red: "" }, content: "\u3010" },
            "\u76ee",
            { tag: "span", data: { red: "" }, content: "\u3011" },
            "\uff08\u25bd\u773c\uff09",
          ],
        },
        {
          tag: "div",
          data: { class: "probe-cjk-hooks" },
          content: [
            { tag: "span", data: { "\u5916\u5b57": "", "\u5de6\u4e38": "" }, content: "\u53c2\u8003" },
            " ",
            { tag: "span", data: { "\u54c1\u8a5e": "", "\u6d3b\u7528": "" }, content: "\u6d3b\u7528" },
          ],
        },
        { tag: "div", data: { class: "probe-japanese-prefix" }, content: "Aことは A" },
        { tag: "div", data: { class: "probe-japanese-quote" }, content: "って「ことと言いなさい」" },
        { tag: "div", data: { class: "probe-japanese-plain" }, content: "ことは純日文" },
        { tag: "div", data: { class: "probe-sgkk-zh" }, lang: "zh", content: "\u4fee\u8865\u8863\u670d\u7834\u7efd\u3002" },
        { tag: "div", data: { class: "probe-inferred-zh" }, content: "\u4fee\u8865\u88c5\u9970\u7834\u7efd" },
        { tag: "div", data: { class: "probe-kanji-ja" }, content: "\u6f22\u5b57\u304b\u306a\u4ea4\u3058\u308a\u6587" },
        { tag: "div", data: { class: "probe-ambiguous-han-ja" }, content: "\u6c49" },
        { tag: "div", data: { class: "probe-dict-font" }, content: "dictionary font fixture" },
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
        {
          tag: "img",
          path: "icons/mono.svg",
          alt: "monochrome icon",
          width: 2,
          height: 1,
          preferredWidth: 2,
          preferredHeight: 1,
          appearance: "monochrome",
          sizeUnits: "em",
          data: { class: "probe-mono-svg", alt: "monochrome icon", src: "icons/mono.svg" },
        },
        mk3Gaiji("gaiji/bs\u4e00.svg", "black square one"),
        mk3Gaiji("gaiji/ws\u4e00.svg", "white square one"),
        mk3Gaiji("gaiji/bs\u4e8c.svg", "black square two"),
        mk3Gaiji("gaiji/\u53c2\u7167.svg", "reference arrow"),
        { type: "image", path: "gaiji/\u53c2\u80031.svg", alt: "reference gaiji", data: { img: "", gaiji: "", class: "gaiji", alt: "reference gaiji", src: "gaiji/\u53c2\u80031.svg" } },
        { type: "image", path: "gaiji/参考.svg", alt: "reference gaiji" },
      ],
    },
  ]);
  const noCssGlossaryText = JSON.stringify([
    {
      type: "structured-content",
      content: [
        "plain dictionary entry without imported CSS ",
        { tag: "span", data: { "\u5916\u5b57": "", "\u5de6\u4e38": "" }, content: "\u53c2\u8003" },
      ],
    },
  ]);

  const baseResult: DictResult = {
    expression: emptyExpression ? "" : "school",
    reading: showReading ? "すくーる" : "school",
    glossary: [
      { dict: "Jitendex.org [probe]", text: structuredGlossaryText, termTags: "n common", definitionTags: "education" },
      { dict: "Jitendex.org [probe]", text: "academy; lesson context", definitionTags: "place" },
      { dict: "No CSS Dictionary [probe]", text: noCssGlossaryText, definitionTags: "plain" },
      { dict: "JMdict [probe]", text: glossaryText, termTags: "n" },
    ],
    matched: "school",
    deinflected: "school",
    rules: "n",
    dictionary: "Jitendex.org [probe]",
    frequencies: [{ dictionary: "Freq Probe", items: [{ value: 120, displayValue: "120" }, { value: 240, displayValue: "240" }] }],
    pitches: [
      { dictionary: "Pitch Probe", positions: [0, 2], transcriptions: ["school"] },
      ...(dictionarySettings.deduplicatePitchAccents ? [{ dictionary: "Pitch Duplicate Probe", positions: [2], transcriptions: ["duplicate pitch"] }] : []),
    ],
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
      noteTypes: [{ name: "Hoshi Vocabulary", fields: ["Expression", "ExpressionFurigana", "Meaning", "FullGlossary", "Sentence", "JmOnly", "MissingDict", "Media", ...(coverFieldEnabled ? ["Picture"] : []), ...(audioFieldEnabled ? ["Audio"] : []), ...(sasayakiFieldEnabled ? ["SentenceAudio"] : []), "Frequency", "Pitch", "Unknown"] }],
      fieldMappings: [
        { field: "Expression", template: "{expression} / {reading}" },
        { field: "ExpressionFurigana", template: "{furigana-plain}" },
        { field: "Meaning", template: "{glossary-first}" },
        { field: "FullGlossary", template: "{glossary}" },
        { field: "Sentence", template: "{sentence}" },
        { field: "JmOnly", template: "{single-glossary-JMdict [probe]}" },
        { field: "MissingDict", template: "{single-glossary-Missing Probe}" },
        { field: "Media", template: "{dictionary-media}" },
        ...(coverFieldEnabled ? [{ field: "Picture", template: "{book-cover}" }] : []),
        ...(audioFieldEnabled ? [{ field: "Audio", template: "{audio}" }] : []),
        ...(sasayakiFieldEnabled ? [{ field: "SentenceAudio", template: "{sasayaki-audio}" }] : []),
        { field: "Frequency", template: "{frequencies}" },
        { field: "Pitch", template: "{pitch-accent-positions}" },
        { field: "Unknown", template: "before{not-a-token}after" },
      ],
      audioEnabled: params.get("audioEnabled") !== "disabled",
      localAudioEnabled: params.get("localAudio") === "enabled",
      audioSources: [
        ...(params.get("firstRemoteMiss") === "1" ? [{ id: "missing", name: "Missing Audio", url: "https://missing.invalid/{term}.mp3", enabled: true }] : []),
        ...(params.get("firstRemoteUnsafe") === "1" ? [{ id: "unsafe", name: "Unsafe Audio", url: "http://127.0.0.1/{term}.mp3", enabled: true }] : []),
        { id: "probe", name: "Probe Audio", url: "https://example.invalid/audio?term={term}&reading={reading}", enabled: true },
      ],
      audioDownloadTimeoutMs: 5000,
      forceSyncAfterAdd: params.get("forceSync") === "enabled",
      tags: "hoshi-reader mining",
      allowDuplicates: params.get("allowDuplicates") === "enabled",
      checkDuplicatesAcrossAllModels: params.get("checkAllModels") === "enabled",
      duplicateScope: params.get("duplicateScope") === "deckRoot" ? "deckRoot" : "collection",
      compactGlossaries: params.get("compactGlossaries") === "enabled",
      audioAutoplay: params.get("audioAutoplay") === "enabled",
      audioPlaybackMode: "interrupt",
      lastFetchedAt: 1780000000000,
    }
    : null;

  interface ProbePopup {
    id: string;
    selection: ReaderSelection;
    state: LookupState;
    results: DictResult[];
    clearSelectionSignal: number;
    selectionHighlightCount: number;
    selectionHighlightSignal: number;
    historyBack: Array<{ selection: ReaderSelection; scrollTop: number }>;
    historyForward: Array<{ selection: ReaderSelection; scrollTop: number }>;
    restoreScrollTop: number;
    restoreScrollSignal: number;
    sasayakiCue?: SasayakiPlaybackCue | null;
  }

  let popups: ProbePopup[] = $state([{
    id: "root",
    selection: rootSelection,
    state: lookupState,
    results: [{ ...baseResult }, ...extraResults],
    clearSelectionSignal: 0,
    selectionHighlightCount: 0,
    selectionHighlightSignal: 0,
    historyBack: [],
    historyForward: [],
    restoreScrollTop: 0,
    restoreScrollSignal: 0,
    sasayakiCue: sasayakiControlsEnabled && !noSasayakiCue ? probeSasayakiCue : null,
  }]);
  let importClicks = $state(0);
  let closeClicks = $state(0);
  let scrollCloseCount = $state(0);
  let nestedLookupCount = $state(0);
  let nestedLookupText = $state("");
  let nestedLookupAnchor = $state<ReaderSelection["anchorRect"] | null>(null);
  let ankiAddRequests = $state<AnkiNoteRequest[]>([]);
  let ankiStoreRequests = $state<AnkiDictionaryMediaRef[][]>([]);
  let ankiAudioStoreRequests = $state<AnkiRemoteAudioRequest[]>([]);
  let localAudioStoreRequests = $state<LocalAudioStoreRequest[]>([]);
  let coverStoreRequests = $state<string[]>([]);
  let sasayakiStoreRequests = $state<Array<{ bookId: string; cueId: string; sentence: string }>>([]);
  let operationEvents = $state<string[]>([]);
  let wordAudioPrepareRequests = $state<WordAudioResolveRequest[]>([]);
  let sasayakiActions = $state<Array<{ popupId: string; action: SasayakiPopupAction }>>([]);
  let sasayakiPlaying = $state(sasayakiPlayingInitial);

  function readerBottomBoundary(): number {
    const controls = document.querySelector<HTMLElement>(".probe-ctrls");
    const fallbackBottom = bottomEdge ? window.innerHeight - 26 : window.innerHeight;
    return Math.min(window.innerHeight, controls?.getBoundingClientRect().top ?? fallbackBottom);
  }

  function positionedPopupStyle(popup: ProbePopup, index: number): string {
    const bottom = readerBottomBoundary();
    const size = {
      width: Math.max(1, Math.min(popupSettings.width, window.innerWidth - 24)),
      height: Math.max(1, Math.min(popupSettings.height, bottom - 44)),
    };
    const style = lookupPopupStyle(popup.selection, size, {
      width: window.innerWidth,
      bottom,
    }, {
      orientation: popup.id === "root" ? "auto" : "horizontal",
    });
    return `${style};width:${size.width}px;height:${size.height}px;--popup-scale:${popupSettings.scale};--popup-z:${125 + index}`;
  }

  function nestedResult(selection: ReaderSelection): DictResult {
    const matched = Array.from(selection.text).slice(0, 2).join("");
    return {
      ...baseResult,
      expression: selection.text,
      reading: "",
      glossary: [{ dict: "Jitendex.org [probe]", text: `nested result for ${selection.text}` }],
      matched,
      deinflected: selection.text,
      rules: "",
      frequencies: [],
      pitches: [],
    };
  }

  function openNestedLookup(parentId: string, nestedSelection: ReaderSelection) {
    nestedLookupCount += 1;
    nestedLookupText = nestedSelection.text;
    nestedLookupAnchor = nestedSelection.anchorRect ?? nestedSelection.rect;
    const parentIndex = popups.findIndex((popup) => popup.id === parentId);
    if (parentIndex < 0) return;
    const result = nestedResult(nestedSelection);
    const childId = `child-${nestedLookupCount}`;
    popups = [
      ...popups.slice(0, parentIndex + 1).map((popup, popupIndex) => (
        popupIndex === parentIndex
          ? {
              ...popup,
              selectionHighlightCount: 0,
              selectionHighlightSignal: popup.selectionHighlightSignal + 1,
            }
          : popup
      )),
      {
        id: childId,
        selection: nestedSelection,
        state: "loading",
        results: [],
        clearSelectionSignal: 0,
        selectionHighlightCount: 0,
        selectionHighlightSignal: 0,
        historyBack: [],
        historyForward: [],
        restoreScrollTop: 0,
        restoreScrollSignal: 0,
        sasayakiCue: null,
      },
    ];
    window.setTimeout(() => {
      const childIndex = popups.findIndex((popup) => popup.id === childId);
      if (childIndex <= 0 || popups[childIndex - 1]?.id !== parentId) return;
      popups = popups.map((popup) => {
        if (popup.id === childId) return { ...popup, state: "ready", results: [result] };
        if (popup.id === parentId) {
          return {
            ...popup,
            selectionHighlightCount: Array.from(result.matched).length,
            selectionHighlightSignal: popup.selectionHighlightSignal + 1,
          };
        }
        return popup;
      });
    }, 80);
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
      sentenceOffset: selection.sentenceOffset,
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
      sasayakiCueId: noSasayakiCue ? null : "cue-42",
      sasayakiAudioFilename: null,
      coverFilename: null,
      sourceBook: { title: "Probe Book", ...(noBookId ? {} : { bookId: "probe-book" }) },
      sourceChapter: { chapterIndex: 0, chapterNumber: 1, totalChapters: 1, idref: "probe" },
    };
  }

  async function addAnkiNote(note: AnkiNoteRequest): Promise<AnkiAddNoteResult> {
    operationEvents = [...operationEvents, "add"];
    ankiAddRequests = [...ankiAddRequests, note];
    if (ankiAddMode === "error") throw new Error("Probe AnkiConnect failure");
    if (ankiAddMode === "duplicate") {
      return { status: "duplicate", noteId: null, message: "cannot create note because it is a duplicate", warnings: [] };
    }
    return {
      status: "added",
      noteId: 4242,
      message: "Added Anki note 4242.",
      warnings: ankiAddMode === "syncWarning" ? ["Anki sync failed: probe failure"] : [],
    };
  }

  async function storeAnkiMedia(media: AnkiDictionaryMediaRef[]): Promise<AnkiStoreMediaResult> {
    operationEvents = [...operationEvents, "dictionary"];
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

  async function storeAnkiBookCover(bookId: string): Promise<AnkiStoreBookCoverResult> {
    operationEvents = [...operationEvents, "cover"];
    coverStoreRequests = [...coverStoreRequests, bookId];
    if (coverStoreMode === "error") throw new Error("Probe cover path escapes the app-owned book directory.");
    if (coverStoreMode === "missing") return { filename: null, warnings: ["Book cover is not available."] };
    return { filename: "hsw_cover_probe.jpg", warnings: [] };
  }

  async function storeAnkiRemoteAudio(request: AnkiRemoteAudioRequest): Promise<AnkiStoreRemoteAudioResult> {
    operationEvents = [...operationEvents, "audio"];
    ankiAudioStoreRequests = [...ankiAudioStoreRequests, request];
    if (request.sourceName === "Missing Audio") {
      return { filename: null, warnings: ["Word audio (Missing Audio): Remote audio source returned HTTP 404."] };
    }
    if (request.sourceName === "Unsafe Audio") throw new Error("Remote audio target resolves to a private, local, or reserved address.");
    if (ankiAudioStoreMode === "error") throw new Error("Remote audio URL resolved to a private, local, or reserved address.");
    if (ankiAudioStoreMode === "missing") {
      return { filename: null, warnings: ["Word audio (Probe Audio): Remote audio source returned HTTP 404."] };
    }
    if (ankiAudioStoreMode === "unsupported") {
      return { filename: null, warnings: ["Word audio (Probe Audio): The response was not a supported audio file."] };
    }
    return { filename: "hsw_audio_probe.mp3", warnings: [] };
  }

  async function storeAnkiLocalAudio(request: LocalAudioStoreRequest): Promise<LocalAudioStoreResult> {
    localAudioStoreRequests = [...localAudioStoreRequests, request];
    if (localAudioStoreMode === "missing") return { filename: null, warnings: [] };
    if (localAudioStoreMode === "error") return { filename: null, warnings: ["Local word audio: Probe database read failure."] };
    return { filename: "hsw_audio_local.ogg", warnings: [] };
  }

  async function storeAnkiWordAudio(request: WordAudioResolveRequest): Promise<AnkiStoreRemoteAudioResult> {
    const warnings: string[] = [];
    if (request.localAudioEnabled) {
      const local = await storeAnkiLocalAudio({ expression: request.expression, reading: request.reading });
      warnings.push(...local.warnings);
      if (local.filename) return { filename: local.filename, warnings };
    }
    for (const source of request.sources.filter((item) => item.enabled && item.url.trim())) {
      const remote = await storeAnkiRemoteAudio({
        sourceName: source.name,
        urlTemplate: source.url,
        expression: request.expression,
        reading: request.reading,
        timeoutMs: request.timeoutMs,
      });
      warnings.push(...remote.warnings);
      if (remote.filename) return { filename: remote.filename, warnings };
    }
    return { filename: null, warnings };
  }

  async function storeAnkiSasayakiAudio(
    bookId: string,
    cueId: string,
    sentence: string,
  ): Promise<AnkiStoreSasayakiAudioResult> {
    operationEvents = [...operationEvents, "sasayaki"];
    sasayakiStoreRequests = [...sasayakiStoreRequests, { bookId, cueId, sentence }];
    if (sasayakiStoreMode === "error") {
      throw new Error("Sasayaki audio path escapes the app-owned sidecar directory.");
    }
    if (sasayakiStoreMode === "missing") {
      return { filename: null, warnings: ["The selected Sasayaki cue is no longer matched."] };
    }
    return { filename: "hsw_sasayaki_probe.wav", warnings: [] };
  }

  async function prepareWordAudio(request: WordAudioResolveRequest): Promise<WordAudioPlaybackResult> {
    wordAudioPrepareRequests = [...wordAudioPrepareRequests, request];
    const resolved = await storeAnkiWordAudio(request);
    return {
      cachePath: resolved.filename ? "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" : null,
      mimeType: resolved.filename ? "audio/wav" : null,
      sourceName: resolved.filename?.includes("local") ? "HSA Local Audio" : resolved.filename ? "Probe Audio" : null,
      warnings: resolved.warnings,
    };
  }

  function handleSasayakiAction(popupId: string, action: SasayakiPopupAction) {
    sasayakiActions = [...sasayakiActions, { popupId, action }];
    if (action === "togglePlayback") sasayakiPlaying = !sasayakiPlaying;
  }

  async function loadDictionaryStyles(dictionary: string) {
    if (dictionary === "No CSS Dictionary [probe]") {
      return {
        source: "probe:nocss",
        css: "",
      };
    }
    if (dictionary === "JMdict [probe]") {
      return {
        source: "probe",
        css: `li { margin-left: 2px; }`,
      };
    }
    if (dictionary !== "Jitendex.org [probe]") return { source: dictionary, css: "" };
    return {
      source: "probe",
      css: `
        @import url("https://example.invalid/bad.css");
        body { background: rgb(255, 0, 0); }
        .lookup-head { color: rgb(255, 0, 0); }
        .lookup-anki { display: none; }
        .gloss-sc-div {
          color: rgb(123, 210, 145);
          position: fixed;
          font-size: 42px;
          line-height: 3;
          width: 640px;
          height: 480px;
          max-height: 900px;
          transform: scale(2);
          zoom: 2;
          background-image: url("https://example.invalid/bad.png");
        }
        [data-sc-class="probe-dict-font"] {
          font-family: "Courier New", monospace;
        }
        [data-sc\u5916\u5b57][data-sc\u5de6\u4e38] {
          color: rgb(16, 154, 47);
          border: 1px solid rgb(16, 154, 47);
          border-radius: 8px;
          padding-inline: 0.2em;
        }
        [data-sc\u54c1\u8a5e][data-sc\u6d3b\u7528] {
          color: rgb(74, 138, 222);
          font-weight: bold;
        }
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
      data-state={popup.state}
      data-popup-id={popup.id}
      onpointerdown={() => closeChildren(popup.id)}
      style={positionedPopupStyle(popup, index)}
    >
      <LookupPopupContent
        popupId={popup.id}
        selection={popup.selection}
        state={popup.state}
        error={
          popup.state === "noDictionaries"
            ? "No imported dictionaries found."
            : popup.state === "engineUnavailable"
              ? "Dictionary engine not linked. Install CMake/C++ build tools and rebuild HSW with hoshidicts."
              : popup.state === "error"
                ? "Cannot parse dictionary manifest: probe"
                : ""
        }
        results={popup.state === "ready" ? popup.results : []}
        clearSelectionSignal={popup.clearSelectionSignal}
        selectionHighlightCount={popup.selectionHighlightCount}
        selectionHighlightSignal={popup.selectionHighlightSignal}
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
        {dictionarySettings}
        {loadDictionaryStyles}
        loadDictionaryMediaResource={mediaMode === "none" ? undefined : loadDictionaryMediaResource}
        ankiTitle={() => "Payload prepared for Probe Book"}
        {ankiSettings}
        buildAnkiPayload={(result, resultIndex) => buildAnkiPayload(popup.selection, result, resultIndex)}
        onStoreAnkiMedia={storeAnkiMedia}
        onStoreAnkiBookCover={storeAnkiBookCover}
        onStoreAnkiWordAudio={storeAnkiWordAudio}
        onStoreAnkiSasayakiAudio={storeAnkiSasayakiAudio}
        onPrepareWordAudio={prepareWordAudio}
        sasayakiCue={popup.sasayakiCue ?? null}
        {sasayakiPlaying}
        sasayakiAvailable={sasayakiControlsEnabled}
        onSasayakiAction={handleSasayakiAction}
        onAddAnkiNote={addAnkiNote}
        scale={popupSettings.scale}
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
    data-nested-lookup-anchor={JSON.stringify(nestedLookupAnchor)}
    data-popup-count={popups.length}
    data-root-clear-selection-signal={popups[0]?.clearSelectionSignal ?? 0}
    data-top-popup-id={popups[popups.length - 1]?.id ?? ""}
    data-anki-add-count={ankiAddRequests.length}
    data-anki-store-count={ankiStoreRequests.length}
    data-anki-audio-store-count={ankiAudioStoreRequests.length}
    data-anki-last-audio-request={JSON.stringify(ankiAudioStoreRequests[ankiAudioStoreRequests.length - 1] ?? null)}
    data-local-audio-store-count={localAudioStoreRequests.length}
    data-local-audio-last-request={JSON.stringify(localAudioStoreRequests[localAudioStoreRequests.length - 1] ?? null)}
    data-anki-last-media={JSON.stringify(ankiStoreRequests[ankiStoreRequests.length - 1] ?? [])}
    data-anki-last-deck={ankiAddRequests[ankiAddRequests.length - 1]?.deckName ?? ""}
    data-anki-last-model={ankiAddRequests[ankiAddRequests.length - 1]?.modelName ?? ""}
    data-anki-last-fields={JSON.stringify(ankiAddRequests[ankiAddRequests.length - 1]?.fields ?? {})}
    data-anki-last-request={JSON.stringify(ankiAddRequests[ankiAddRequests.length - 1] ?? null)}
    data-cover-store-count={coverStoreRequests.length}
    data-cover-last-book-id={coverStoreRequests[coverStoreRequests.length - 1] ?? ""}
    data-sasayaki-store-count={sasayakiStoreRequests.length}
    data-sasayaki-last-request={JSON.stringify(sasayakiStoreRequests[sasayakiStoreRequests.length - 1] ?? null)}
    data-operation-events={operationEvents.join(",")}
    data-word-audio-prepare-count={wordAudioPrepareRequests.length}
    data-word-audio-last-request={JSON.stringify(wordAudioPrepareRequests[wordAudioPrepareRequests.length - 1] ?? null)}
    data-sasayaki-action-count={sasayakiActions.length}
    data-sasayaki-last-action={JSON.stringify(sasayakiActions[sasayakiActions.length - 1] ?? null)}
    data-sasayaki-playing={sasayakiPlaying}
    data-import-popup-settings={JSON.stringify(importPopupSettings)}
    data-render-popup-settings={JSON.stringify(popupSettings)}
    data-imported-dictionary-records={JSON.stringify(importedDictionaryRecords)}
    data-dictionary-settings={JSON.stringify(dictionarySettings)}
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
  .probe { width: 100vw; height: 100vh; position: relative; --lookup-highlight-color: rgba(255, 255, 255, 0.32); }
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
    z-index: var(--popup-z);
    display: flex;
    flex-direction: column;
    gap: 8px;
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
