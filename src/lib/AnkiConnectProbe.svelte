<script lang="ts">
  import AnkiConnectPanel from "./AnkiConnectPanel.svelte";
  import { ankiHandlebarOptions } from "./anki-field-renderer";
  import type { AnkiSettings, LocalAudioStatus } from "./types";

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("ankiConnectMode") ?? "ready";
  const largeFields = [
    "Expression",
    "ExpressionFurigana",
    "ExpressionReading",
    "ExpressionAudio",
    "MainDefinition",
    "DefinitionPicture",
    "Sentence",
    "SentenceFurigana",
    "SentenceAudio",
    "Picture",
    "Glossary",
    "Hint",
    "IsWordAndSentenceCard",
    "IsClickCard",
    "IsSentenceCard",
    "IsAudioCard",
    "PitchPosition",
    "PitchCategories",
    "Frequency",
    "FreqSort",
    "MiscInfo",
    "IsAudioCard+",
  ];
  const lapisFields = [
    "Expression",
    "ExpressionFurigana",
    "ExpressionReading",
    "ExpressionAudio",
    "SelectionText",
    "MainDefinition",
    "DefinitionPicture",
    "Sentence",
    "SentenceFurigana",
    "SentenceAudio",
    "Picture",
    "Glossary",
    "Hint",
    "IsWordAndSentenceCard",
    "IsClickCard",
    "IsSentenceCard",
    "IsAudioCard",
    "PitchPosition",
    "PitchCategories",
    "Frequency",
    "FreqSort",
    "MiscInfo",
    "IsAudioCard+",
  ];
  const noteTypes = [
    { name: "Basic", fields: ["Front", "Back", "Audio"] },
    { name: "Hoshi Vocabulary", fields: ["Expression", "Reading", "Glossary", "Sentence", "ExpressionAudio"] },
    ...(mode === "large" ? [{ name: "Large Vocabulary", fields: largeFields }] : []),
    ...(mode === "lapis" || mode === "lapisMapped" ? [{ name: "Lapis", fields: lapisFields }] : []),
    ...(mode === "customLapis" ? [{ name: "Custom Lapis", fields: lapisFields }] : []),
  ];
  const selectedNoteType = mode === "large"
    ? "Large Vocabulary"
    : mode === "lapis" || mode === "lapisMapped"
      ? "Lapis"
      : mode === "customLapis"
        ? "Custom Lapis"
        : "Basic";

  const readySettings: AnkiSettings = {
    version: 1,
    endpoint: "http://127.0.0.1:8765",
    selectedDeck: "Mining",
    selectedNoteType,
    decks: [{ name: "Mining" }, { name: "Japanese::Reading" }],
    noteTypes,
    fieldMappings: mode === "lapis" || mode === "customLapis"
      ? []
      : mode === "lapisMapped"
        ? [{ field: "MainDefinition", template: "{single-glossary-JMdict}" }]
        : [
          { field: "Front", template: "{expression}" },
          { field: "Back", template: "{glossary-first}" },
        ],
    audioEnabled: false,
    localAudioEnabled: false,
    audioSources: [{ name: "Default", url: "", enabled: false }],
    audioDownloadTimeoutMs: 5000,
    forceSyncAfterAdd: false,
    tags: "hoshi-reader",
    allowDuplicates: false,
    checkDuplicatesAcrossAllModels: false,
    duplicateScope: "collection",
    compactGlossaries: false,
    lastFetchedAt: 1780000000000,
  };

  let settings = $state<AnkiSettings | null>(mode === "empty" ? null : readySettings);
  let endpoint = $state(mode === "empty" ? "http://127.0.0.1:8765" : readySettings.endpoint);
  let pingClicks = $state(0);
  let fetchClicks = $state(0);
  let saveClicks = $state(0);
  let deckEvents = $state<string[]>([]);
  let noteTypeEvents = $state<string[]>([]);
  let fieldTemplateEvents = $state<string[]>([]);
  let audioEvents = $state<string[]>([]);
  let localAudioEvents = $state<string[]>([]);
  let syncEvents = $state<string[]>([]);
  let noteOptionEvents = $state<string[]>([]);
  let compactGlossaryEvents = $state<string[]>([]);
  let localImportClicks = $state(0);
  let localRemoveClicks = $state(0);
  let localAudioStatus = $state<LocalAudioStatus>({
    imported: mode !== "empty",
    sizeBytes: mode === "empty" ? null : 24 * 1024 * 1024,
    sources: mode === "empty" ? [] : [{ name: "nhk16", order: 0 }, { name: "forvo", order: 1 }],
  });
  const handlebarOptions = ankiHandlebarOptions(["JMdict", "明鏡国語辞典 第三版", "JMdict"]);

  function selectDeck(deck: string) {
    deckEvents = [...deckEvents, deck];
    if (settings) settings = { ...settings, selectedDeck: deck };
  }

  function selectNoteType(noteType: string) {
    noteTypeEvents = [...noteTypeEvents, noteType];
    if (settings) settings = { ...settings, selectedNoteType: noteType };
  }

  function setFieldTemplate(field: string, template: string) {
    fieldTemplateEvents = [...fieldTemplateEvents, `${field}:${template}`];
    if (!settings) return;
    settings = {
      ...settings,
      fieldMappings: [
        ...settings.fieldMappings.filter((mapping) => mapping.field !== field),
        { field, template },
      ],
    };
  }

  function setAudioConfig(audioEnabled: boolean, audioSources: AnkiSettings["audioSources"], timeoutMs: number) {
    audioEvents = [...audioEvents, `${audioEnabled}:${audioSources[0]?.name ?? ""}:${audioSources[0]?.url ?? ""}:${timeoutMs}`];
    if (!settings) return;
    settings = {
      ...settings,
      audioEnabled,
      audioSources,
      audioDownloadTimeoutMs: timeoutMs,
    };
  }

  function setLocalAudioEnabled(enabled: boolean) {
    localAudioEvents = [...localAudioEvents, `enabled:${enabled}`];
    if (settings) settings = { ...settings, localAudioEnabled: enabled };
  }

  function setForceSyncAfterAdd(enabled: boolean) {
    syncEvents = [...syncEvents, String(enabled)];
    if (settings) settings = { ...settings, forceSyncAfterAdd: enabled };
  }

  function setNoteOptions(tags: string, allowDuplicates: boolean, duplicateScope: AnkiSettings["duplicateScope"], checkAllModels: boolean) {
    noteOptionEvents = [...noteOptionEvents, `${tags}:${allowDuplicates}:${duplicateScope}:${checkAllModels}`];
    if (settings) settings = { ...settings, tags, allowDuplicates, duplicateScope, checkDuplicatesAcrossAllModels: checkAllModels };
  }

  function setCompactGlossaries(enabled: boolean) {
    compactGlossaryEvents = [...compactGlossaryEvents, String(enabled)];
    if (settings) settings = { ...settings, compactGlossaries: enabled };
  }

  function moveLocalAudioSource(source: string, direction: -1 | 1) {
    localAudioEvents = [...localAudioEvents, `move:${source}:${direction}`];
    const sources = [...localAudioStatus.sources];
    const index = sources.findIndex((item) => item.name === source);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sources.length) return;
    [sources[index], sources[target]] = [sources[target], sources[index]];
    localAudioStatus = { ...localAudioStatus, sources: sources.map((item, order) => ({ ...item, order })) };
  }
</script>

<main class="probe" data-ui-portal-root>
  <AnkiConnectPanel
    {settings}
    {endpoint}
    status={mode === "connected" ? "Connected to AnkiConnect." : ""}
    error={mode === "error" ? "Cannot connect to AnkiConnect at 127.0.0.1:8765." : ""}
    busy={mode === "busy"}
    {handlebarOptions}
    onEndpointChange={(next) => endpoint = next}
    onPing={() => pingClicks += 1}
    onFetch={() => fetchClicks += 1}
    onSave={() => saveClicks += 1}
    onSelectDeck={selectDeck}
    onSelectNoteType={selectNoteType}
    onSetFieldTemplate={setFieldTemplate}
    onSetAudioConfig={setAudioConfig}
    onSetForceSyncAfterAdd={setForceSyncAfterAdd}
    onSetNoteOptions={setNoteOptions}
    onSetCompactGlossaries={setCompactGlossaries}
    {localAudioStatus}
    onSetLocalAudioEnabled={setLocalAudioEnabled}
    onImportLocalAudio={() => localImportClicks += 1}
    onRemoveLocalAudio={() => localRemoveClicks += 1}
    onMoveLocalAudioSource={moveLocalAudioSource}
  />
  <div
    class="probe-state"
    data-endpoint={endpoint}
    data-ping-clicks={pingClicks}
    data-fetch-clicks={fetchClicks}
    data-save-clicks={saveClicks}
    data-sync-events={syncEvents.join(",")}
    data-note-option-events={noteOptionEvents.join("|")}
    data-compact-glossary-events={compactGlossaryEvents.join(",")}
    data-deck-events={deckEvents.join(",")}
    data-note-type-events={noteTypeEvents.join(",")}
    data-field-template-events={fieldTemplateEvents.join(",")}
    data-audio-events={audioEvents.join("|")}
    data-selected-deck={settings?.selectedDeck ?? ""}
    data-selected-note-type={settings?.selectedNoteType ?? ""}
    data-field-mappings={settings?.fieldMappings.map((mapping) => `${mapping.field}:${mapping.template}`).join("|") ?? ""}
    data-audio-enabled={settings?.audioEnabled ? "true" : "false"}
    data-audio-source={settings?.audioSources[0]?.name ?? ""}
    data-audio-url={settings?.audioSources[0]?.url ?? ""}
    data-audio-timeout={settings?.audioDownloadTimeoutMs ?? 0}
    data-force-sync-after-add={settings?.forceSyncAfterAdd ?? false}
    data-tags={settings?.tags ?? ""}
    data-allow-duplicates={settings?.allowDuplicates ?? false}
    data-duplicate-scope={settings?.duplicateScope ?? ""}
    data-check-all-models={settings?.checkDuplicatesAcrossAllModels ?? false}
    data-compact-glossaries={settings?.compactGlossaries ?? false}
    data-local-audio-enabled={settings?.localAudioEnabled ? "true" : "false"}
    data-local-audio-events={localAudioEvents.join("|")}
    data-local-import-clicks={localImportClicks}
    data-local-remove-clicks={localRemoveClicks}
    data-local-sources={localAudioStatus.sources.map((source) => source.name).join(",")}
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
  .probe :global(.anki-panel) { width: 100%; }
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
