<script lang="ts">
  import type { AnkiSettings } from "./types";

  let {
    settings = null,
    endpoint = "http://127.0.0.1:8765",
    status = "",
    error = "",
    busy = false,
    onEndpointChange = (_endpoint: string) => {},
    onPing = () => {},
    onFetch = () => {},
    onSave = () => {},
    onSelectDeck = (_deck: string) => {},
    onSelectNoteType = (_noteType: string) => {},
  }: {
    settings?: AnkiSettings | null;
    endpoint?: string;
    status?: string;
    error?: string;
    busy?: boolean;
    onEndpointChange?: (endpoint: string) => void;
    onPing?: () => void;
    onFetch?: () => void;
    onSave?: () => void;
    onSelectDeck?: (deck: string) => void;
    onSelectNoteType?: (noteType: string) => void;
  } = $props();

  const selectedNote = $derived(
    settings?.noteTypes.find((noteType) => noteType.name === settings?.selectedNoteType) ?? null,
  );

  function fetchedLabel(timestamp: number | null | undefined): string {
    if (!timestamp) return "Not fetched yet";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Fetch time unknown";
    return `Fetched ${date.toLocaleString()}`;
  }
</script>

<section class="anki-panel">
  <div class="anki-head">
    <div>
      <h2>AnkiConnect</h2>
      <p class="anki-summary">
        {settings?.decks.length ? `${settings.decks.length} decks, ${settings.noteTypes.length} note types` : "Desktop Anki configuration only"}
      </p>
    </div>
    <div class="anki-actions">
      <button class="compact-action" disabled={busy} onclick={onPing}>Test</button>
      <button class="compact-action" disabled={busy} onclick={onFetch}>Fetch</button>
      <button class="compact-action" disabled={busy} onclick={onSave}>Save</button>
    </div>
  </div>

  <label class="endpoint-row">
    <span>Endpoint</span>
    <input
      value={endpoint}
      disabled={busy}
      spellcheck="false"
      oninput={(event) => onEndpointChange(event.currentTarget.value)}
    />
  </label>

  {#if error}
    <p class="err">{error}</p>
  {:else if status}
    <p class="anki-status">{status}</p>
  {/if}

  <div class="config-grid" aria-busy={busy}>
    <label class="select-row">
      <span>Deck</span>
      <select
        disabled={busy || !settings?.decks.length}
        value={settings?.selectedDeck ?? ""}
        onchange={(event) => onSelectDeck(event.currentTarget.value)}
      >
        {#if !settings?.decks.length}
          <option value="">No decks fetched</option>
        {:else}
          {#each settings.decks as deck (deck.name)}
            <option value={deck.name}>{deck.name}</option>
          {/each}
        {/if}
      </select>
    </label>

    <label class="select-row">
      <span>Note Type</span>
      <select
        disabled={busy || !settings?.noteTypes.length}
        value={settings?.selectedNoteType ?? ""}
        onchange={(event) => onSelectNoteType(event.currentTarget.value)}
      >
        {#if !settings?.noteTypes.length}
          <option value="">No note types fetched</option>
        {:else}
          {#each settings.noteTypes as noteType (noteType.name)}
            <option value={noteType.name}>{noteType.name}</option>
          {/each}
        {/if}
      </select>
    </label>
  </div>

  <div class="fields-row">
    <p class="fields-title">Fields</p>
    {#if selectedNote?.fields.length}
      <div class="field-list">
        {#each selectedNote.fields as field}
          <span>{field}</span>
        {/each}
      </div>
    {:else}
      <p class="empty">Fetch AnkiConnect config to preview fields.</p>
    {/if}
  </div>

  <p class="fetched-at">{fetchedLabel(settings?.lastFetchedAt)}</p>
</section>

<style>
  .anki-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #26282c; border: 1px solid #3c4043; border-radius: 6px; }
  .anki-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .anki-summary { margin-top: 4px; color: #b7bcc3; font-size: 12px; line-height: 1.35; }
  .anki-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .compact-action { padding: 5px 10px; background: #303134; color: #d7d9dc; border: 1px solid #555c64; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .compact-action:hover:not(:disabled) { background: #3a3d41; }
  .compact-action:disabled { color: #747a80; cursor: default; }
  .endpoint-row, .select-row { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: #9aa0a6; font-size: 11px; text-transform: uppercase; }
  .endpoint-row input, .select-row select { width: 100%; min-width: 0; padding: 7px 8px; background: #202124; color: #f1f3f4; border: 1px solid #555c64; border-radius: 4px; font-size: 13px; text-transform: none; }
  .endpoint-row input:disabled, .select-row select:disabled { color: #747a80; }
  .config-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .config-grid[aria-busy="true"] { opacity: 0.72; }
  .fields-row { display: flex; flex-direction: column; gap: 7px; }
  .fields-title { color: #9aa0a6; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .field-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .field-list span { max-width: 100%; overflow-wrap: anywhere; padding: 3px 7px; color: #d8eadf; background: #24352f; border: 1px solid #3b6956; border-radius: 4px; font-size: 12px; }
  .anki-status { color: #9ad5b5; font-size: 13px; line-height: 1.4; }
  .err { color: #ff8a80; font-size: 13px; white-space: pre-wrap; }
  .empty, .fetched-at { color: #80868b; font-size: 12px; }
  @media (max-width: 640px) {
    .anki-head { flex-direction: column; gap: 10px; }
    .anki-actions { width: 100%; }
    .anki-actions button { flex: 1 1 0; }
    .config-grid { grid-template-columns: 1fr; }
  }
</style>
