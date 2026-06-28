<script lang="ts">
  import BookshelfView from "./BookshelfView.svelte";
  import { defaultDictionarySettings } from "./dictionary-settings";
  import { createDictionarySearchState } from "./state/dictionary-search-state.svelte";
  import type { BookRecord } from "./storage";
  import type { DictResult, DictionaryStatus } from "./types";

  const books: BookRecord[] = [];
  const dictionarySearchState = createDictionarySearchState();
  const dictionarySettings = { ...defaultDictionarySettings, maxResults: 7, scanLength: 13 };
  let statusMode = $state<DictionaryStatus["status"]>("ready");
  let lookupMode = $state<"ready" | "empty" | "error" | "slow">("ready");
  let lookupEvents = $state<string[]>([]);
  let importClicks = $state(0);

  function resultFor(text: string): DictResult {
    return {
      expression: text === "redirected" ? "転送" : text,
      reading: text === "redirected" ? "てんそう" : "がっこう",
      matched: text.slice(0, 2),
      deinflected: text,
      rules: "",
      dictionary: "Probe Dictionary",
      frequencies: [{ dictionary: "Probe Frequency", items: [{ value: 42, displayValue: "42" }] }],
      pitches: [{ dictionary: "Probe Pitch", positions: [1], transcriptions: [] }],
      glossary: [
        {
          dict: "Probe Dictionary",
          definitionTags: "tag",
          termTags: "term",
          text: JSON.stringify([
            "A probe definition for ",
            text,
            ". ",
            { tag: "a", content: "redirected", data: { query: "redirected" } },
            ". Child lookup target appears here.",
          ]),
        },
      ],
    };
  }

  async function lookupStatus(): Promise<DictionaryStatus> {
    if (statusMode === "ready") return { status: "ready", message: "Ready", loadedCount: 1, importedCount: 1 };
    if (statusMode === "noDictionaries") return { status: "noDictionaries", message: "No probe dictionaries.", loadedCount: 0, importedCount: 0 };
    if (statusMode === "engineUnavailable") return { status: "engineUnavailable", message: "Probe engine unavailable.", loadedCount: 0, importedCount: 1 };
    return { status: "error", message: "Probe status error.", loadedCount: 0, importedCount: 1 };
  }

  async function lookup(text: string, requestId: number, settings: Pick<typeof dictionarySettings, "maxResults" | "scanLength">): Promise<DictResult[]> {
    lookupEvents = [...lookupEvents, `${text}:${requestId}:${settings.maxResults}:${settings.scanLength}`];
    if (lookupMode === "slow") await new Promise((resolve) => setTimeout(resolve, 120));
    if (lookupMode === "error") throw new Error("Probe lookup failed.");
    if (lookupMode === "empty" || text === "empty") return [];
    return [resultFor(text)];
  }

  const dictionarySearchActions = {
    lookupStatus,
    lookup,
    fallbackStatus: lookupStatus,
    onImportDictionary: () => importClicks += 1,
  };
</script>

<main class="probe" data-ui-portal-root>
  <BookshelfView
    {books}
    readerAppearance={{ theme: "dark" }}
    readerThemeLabels={{ light: "Light", dark: "Dark" }}
    advancedSettings={{ reopenLastBookOnStartup: true }}
    lookupPopupSettings={{ width: 320, height: 250, scale: 1 }}
    {dictionarySettings}
    {dictionarySearchState}
    {dictionarySearchActions}
    ankiSettings={null}
    onOpenBook={() => {}}
    onContinueBook={() => {}}
    onForgetBook={() => {}}
    onSetReaderTheme={() => {}}
    onSetReopenLastBookOnStartup={() => {}}
    onSetLookupPopupWidth={() => {}}
    onSetLookupPopupHeight={() => {}}
    onSetLookupPopupScale={() => {}}
    onDictionarySettingsChange={() => {}}
    onRefreshDictionaries={() => {}}
    onImportDictionary={() => importClicks += 1}
    onImportDictionaryFolder={() => {}}
    onSetDictionaryEnabled={() => {}}
    onMoveDictionary={() => {}}
    onRemoveDictionaryImport={() => {}}
    onAnkiEndpointChange={() => {}}
    onPingAnkiConnect={() => {}}
    onFetchAnkiConfig={() => {}}
    onSaveAnkiSettings={() => {}}
    onSelectAnkiDeck={() => {}}
    onSelectAnkiNoteType={() => {}}
    onSetAnkiFieldTemplate={() => {}}
    onSetAnkiAudioConfig={() => {}}
  />

  <div class="probe-controls" aria-label="Dictionary search probe controls">
    <button onclick={() => statusMode = "ready"}>status ready</button>
    <button onclick={() => statusMode = "noDictionaries"}>status none</button>
    <button onclick={() => statusMode = "engineUnavailable"}>status engine</button>
    <button onclick={() => lookupMode = "ready"}>lookup ready</button>
    <button onclick={() => lookupMode = "empty"}>lookup empty</button>
    <button onclick={() => lookupMode = "error"}>lookup error</button>
    <button onclick={() => lookupMode = "slow"}>lookup slow</button>
  </div>

  <div
    class="probe-state"
    data-status-mode={statusMode}
    data-lookup-mode={lookupMode}
    data-lookup-events={lookupEvents.join("|")}
    data-import-clicks={importClicks}
    data-query={dictionarySearchState.query}
    data-last-query={dictionarySearchState.lastQuery}
    data-root-state={dictionarySearchState.rootState}
    data-root-results={dictionarySearchState.rootResults.length}
    data-back-count={dictionarySearchState.rootHistoryBack.length}
    data-forward-count={dictionarySearchState.rootHistoryForward.length}
    data-child-count={dictionarySearchState.childPopups.length}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { overflow: hidden; font-family: "Segoe UI", sans-serif; }
  .probe {
    --app-bg: #000000;
    --app-text: #ffffff;
    --app-muted: #999999;
    --app-surface: #121212;
    --app-surface-hover: #1d1d1d;
    --app-border: #333333;
    --app-control: #1b1b1b;
    --app-control-hover: #262626;
    --app-primary: #d0bcff;
    --app-primary-hover: #c1a9fb;
    --app-error: #ffb4ab;
    --app-status: #cce8d5;
    --app-shadow: rgba(0, 0, 0, 0.48);
  }
  .probe-controls { position: fixed; right: 8px; bottom: 8px; z-index: 500; display: flex; gap: 4px; opacity: 0.01; pointer-events: auto; }
  .probe-state { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
