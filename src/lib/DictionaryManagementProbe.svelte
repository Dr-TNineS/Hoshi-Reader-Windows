<script lang="ts">
  import DictionaryManagementPanel from "./DictionaryManagementPanel.svelte";
  import type { DictionaryManifestEntry, DictionaryStatus } from "./types";

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("dictionaryManagementMode") ?? "ready";

  const baseDictionaries: DictionaryManifestEntry[] = [
    {
      dictId: "jitendex",
      title: "Jitendex.org [probe]",
      kind: "term",
      enabled: true,
      order: 0,
      internalPath: "dictionaries/imported/jitendex",
      termCount: 432643,
      metaCount: 0,
      freqCount: 1200,
      pitchCount: 80,
      mediaCount: 0,
      lastImported: 1780000000,
    },
    {
      dictId: "mk3",
      title: "MK3 Compatibility Probe Dictionary With A Very Long Visible Title",
      kind: "term",
      enabled: false,
      order: 1,
      internalPath: "dictionaries/imported/mk3-compatible-title-that-should-ellipsis",
      termCount: 140821,
      metaCount: 0,
      freqCount: 0,
      pitchCount: 0,
      mediaCount: 0,
      lastImported: 1780000500,
    },
  ];

  let dictionaries = $state<DictionaryManifestEntry[]>(mode === "empty" || mode === "loading" ? [] : baseDictionaries);
  let refreshClicks = $state(0);
  let importClicks = $state(0);
  let enableEvents = $state<string[]>([]);
  let moveEvents = $state<string[]>([]);

  const status: DictionaryStatus | null = mode === "error"
    ? { status: "error", message: "Cannot parse dictionary manifest: probe", loadedCount: 0, importedCount: 0 }
    : mode === "empty" || mode === "loading"
      ? { status: "noDictionaries", message: "No imported dictionaries found.", loadedCount: 0, importedCount: 0 }
      : { status: "ready", message: "1 dictionary loaded.", loadedCount: 1, importedCount: baseDictionaries.length };

  function setEnabled(dictionary: DictionaryManifestEntry, enabled: boolean) {
    enableEvents = [...enableEvents, `${dictionary.dictId}:${enabled}`];
    dictionaries = dictionaries.map((entry) => entry.dictId === dictionary.dictId ? { ...entry, enabled } : entry);
  }

  function moveDictionary(dictionary: DictionaryManifestEntry, direction: -1 | 1) {
    moveEvents = [...moveEvents, `${dictionary.dictId}:${direction}`];
    const currentIndex = dictionaries.findIndex((entry) => entry.dictId === dictionary.dictId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= dictionaries.length) return;
    const reordered = [...dictionaries];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    dictionaries = reordered.map((entry, index) => ({ ...entry, order: index }));
  }
</script>

<main class="probe">
  <DictionaryManagementPanel
    {dictionaries}
    {status}
    error={mode === "error" ? "Cannot parse dictionary manifest: probe" : ""}
    busy={mode === "loading"}
    onRefresh={() => refreshClicks += 1}
    onImport={() => importClicks += 1}
    onSetEnabled={setEnabled}
    onMove={moveDictionary}
  />
  <div
    class="probe-state"
    data-refresh-clicks={refreshClicks}
    data-import-clicks={importClicks}
    data-enable-events={enableEvents.join(",")}
    data-move-events={moveEvents.join(",")}
    data-order={dictionaries.map((dictionary) => dictionary.dictId).join(",")}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: #202124; color: #e8eaed; font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .probe {
    width: min(920px, calc(100vw - 48px));
    height: 100vh;
    margin: 0 auto;
    display: flex;
    align-items: center;
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
  @media (max-width: 640px) {
    .probe { width: min(100vw - 32px, 920px); }
  }
</style>
