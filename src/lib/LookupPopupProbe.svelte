<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import type { LookupState } from "./lookup-popup";
  import type { DictResult, ReaderSelection } from "./types";

  const params = new URLSearchParams(window.location.search);
  const allowedStates: LookupState[] = ["loading", "noDictionaries", "engineUnavailable", "empty", "error", "ready"];
  const requestedState = params.get("lookupState") as LookupState | null;
  const lookupState = allowedStates.includes(requestedState ?? "loading") ? requestedState ?? "loading" : "loading";
  const longResult = params.has("longResult");

  const rootSelection: ReaderSelection = {
    text: "school",
    chapterIndex: 0,
    rect: { x: 460, y: 180, width: 36, height: 120 },
  };

  const glossaryText = longResult
    ? Array.from({ length: 16 }, (_, index) => `structured glossary line ${index + 1}: a school or learning place`).join("; ")
    : "school; a place of study";
  const structuredGlossaryText = JSON.stringify([
    {
      type: "structured-content",
      content: [
        { tag: "div", content: "classroom school room" },
        {
          tag: "ul",
          content: [
            { tag: "li", content: "first structured sense" },
            { tag: "li", content: ["second structured sense", { tag: "br" }, "with a line break"] },
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
    expression: "school",
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

  interface ProbePopup {
    id: string;
    selection: ReaderSelection;
    results: DictResult[];
    clearSelectionSignal: number;
  }

  let popups: ProbePopup[] = $state([{
    id: "root",
    selection: rootSelection,
    results: [{ ...baseResult }],
    clearSelectionSignal: 0,
  }]);
  let importClicks = $state(0);
  let closeClicks = $state(0);
  let scrollCloseCount = $state(0);
  let nestedLookupCount = $state(0);
  let nestedLookupText = $state("");

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
      ...popups.slice(0, parentIndex + 1).map((popup, index) => (
        index === parentIndex ? { ...popup, clearSelectionSignal: popup.clearSelectionSignal + 1 } : popup
      )),
      {
        id: `child-${nestedLookupCount}`,
        selection: nestedSelection,
        results: [nestedResult(nestedSelection)],
        clearSelectionSignal: 0,
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
</script>

<main class="probe">
  {#each popups as popup, index (popup.id)}
    <aside class="lookup-pop" data-state={lookupState} data-popup-id={popup.id} style={`--offset:${index * 26}px;--popup-z:${125 + index}`}>
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
        onScrolled={closeChildren}
        ankiTitle={() => "Payload prepared for Probe Book"}
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
    data-state={lookupState}
    aria-hidden="true"
  ></div>
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
