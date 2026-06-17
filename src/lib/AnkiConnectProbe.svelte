<script lang="ts">
  import AnkiConnectPanel from "./AnkiConnectPanel.svelte";
  import type { AnkiSettings } from "./types";

  const params = new URLSearchParams(window.location.search);
  const mode = params.get("ankiConnectMode") ?? "ready";

  const readySettings: AnkiSettings = {
    version: 1,
    endpoint: "http://127.0.0.1:8765",
    selectedDeck: "Mining",
    selectedNoteType: "Basic",
    decks: [{ name: "Mining" }, { name: "Japanese::Reading" }],
    noteTypes: [
      { name: "Basic", fields: ["Front", "Back", "Audio"] },
      { name: "Hoshi Vocabulary", fields: ["Expression", "Reading", "Glossary", "Sentence", "ExpressionAudio"] },
    ],
    fieldMappings: [
      { field: "Front", template: "{expression}" },
      { field: "Back", template: "{glossary-first}" },
    ],
    audioEnabled: false,
    audioSources: [{ name: "Default", url: "", enabled: false }],
    audioDownloadTimeoutMs: 5000,
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
</script>

<main class="probe">
  <AnkiConnectPanel
    {settings}
    {endpoint}
    status={mode === "connected" ? "Connected to AnkiConnect." : ""}
    error={mode === "error" ? "Cannot connect to AnkiConnect at 127.0.0.1:8765." : ""}
    busy={mode === "busy"}
    onEndpointChange={(next) => endpoint = next}
    onPing={() => pingClicks += 1}
    onFetch={() => fetchClicks += 1}
    onSave={() => saveClicks += 1}
    onSelectDeck={selectDeck}
    onSelectNoteType={selectNoteType}
    onSetFieldTemplate={setFieldTemplate}
    onSetAudioConfig={setAudioConfig}
  />
  <div
    class="probe-state"
    data-endpoint={endpoint}
    data-ping-clicks={pingClicks}
    data-fetch-clicks={fetchClicks}
    data-save-clicks={saveClicks}
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
