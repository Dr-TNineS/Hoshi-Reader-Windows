<script lang="ts">
  import LookupPopupContent from "./LookupPopupContent.svelte";
  import type { LookupState } from "./lookup-popup";
  import type { DictResult, ReaderSelection } from "./types";

  const params = new URLSearchParams(window.location.search);
  const allowedStates: LookupState[] = ["loading", "noDictionaries", "engineUnavailable", "empty", "error", "ready"];
  const requestedState = params.get("lookupState") as LookupState | null;
  const lookupState = allowedStates.includes(requestedState ?? "loading") ? requestedState ?? "loading" : "loading";
  const longResult = params.has("longResult");

  const selection: ReaderSelection = {
    text: "学校",
    chapterIndex: 0,
    rect: { x: 460, y: 180, width: 36, height: 120 },
  };

  const glossaryText = longResult
    ? Array.from({ length: 16 }, (_, index) => `structured glossary line ${index + 1}: a school or learning place`).join("; ")
    : "school; a place of study";

  const results: DictResult[] = [
    {
      expression: "学校",
      reading: "がっこう",
      glossary: [
        { dict: "Jitendex.org [probe]", text: glossaryText },
        { dict: "Jitendex.org [probe]", text: "academy; lesson context" },
      ],
      matched: "学校",
      deinflected: "学校",
      rules: "v5k",
      dictionary: "Jitendex.org [probe]",
      frequencies: [{ dictionary: "Freq Probe", items: [{ value: 120, displayValue: "120" }] }],
      pitches: [{ dictionary: "Pitch Probe", positions: [0, 2], transcriptions: ["ガッコー"] }],
    },
  ];

  let importClicks = $state(0);
  let closeClicks = $state(0);
</script>

<main class="probe">
  <aside class="lookup-pop" data-state={lookupState}>
    <LookupPopupContent
      {selection}
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
      results={lookupState === "ready" ? results : []}
      onImportDictionary={() => importClicks += 1}
      onClose={() => closeClicks += 1}
      ankiTitle={() => "Payload prepared for Probe Book"}
    />
  </aside>
  <div
    class="probe-state"
    data-import-clicks={importClicks}
    data-close-clicks={closeClicks}
    data-state={lookupState}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: #202124; color: #e8eaed; font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .probe { width: 100vw; height: 100vh; position: relative; }
  .probe::before {
    content: "学校";
    position: fixed;
    left: 460px;
    top: 180px;
    writing-mode: vertical-rl;
    color: #5f6368;
    font-size: 22px;
  }
  .lookup-pop {
    position: fixed;
    left: min(520px, calc(100vw - 304px));
    top: 72px;
    z-index: 125;
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
