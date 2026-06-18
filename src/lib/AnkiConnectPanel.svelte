<script lang="ts">
  import { effectiveTemplateForField } from "./anki-field-renderer";
  import type { AnkiAudioSource, AnkiSettings } from "./types";

  let {
    settings = null,
    endpoint = "http://127.0.0.1:8765",
    status = "",
    error = "",
    busy = false,
    handlebarOptions = [],
    onEndpointChange = (_endpoint: string) => {},
    onPing = () => {},
    onFetch = () => {},
    onSave = () => {},
    onSelectDeck = (_deck: string) => {},
    onSelectNoteType = (_noteType: string) => {},
    onSetFieldTemplate = (_field: string, _template: string) => {},
    onSetAudioConfig = (_enabled: boolean, _sources: AnkiAudioSource[], _timeoutMs: number) => {},
  }: {
    settings?: AnkiSettings | null;
    endpoint?: string;
    status?: string;
    error?: string;
    busy?: boolean;
    handlebarOptions?: string[];
    onEndpointChange?: (endpoint: string) => void;
    onPing?: () => void;
    onFetch?: () => void;
    onSave?: () => void;
    onSelectDeck?: (deck: string) => void;
    onSelectNoteType?: (noteType: string) => void;
    onSetFieldTemplate?: (field: string, template: string) => void;
    onSetAudioConfig?: (enabled: boolean, sources: AnkiAudioSource[], timeoutMs: number) => void;
  } = $props();

  const selectedNote = $derived(
    settings?.noteTypes.find((noteType) => noteType.name === settings?.selectedNoteType) ?? null,
  );
  let openHandlebarField = $state<string | null>(null);

  function fetchedLabel(timestamp: number | null | undefined): string {
    if (!timestamp) return "Not fetched yet";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Fetch time unknown";
    return `Fetched ${date.toLocaleString()}`;
  }

  function audioSource(): AnkiAudioSource {
    return settings?.audioSources[0] ?? { name: "Default", url: "", enabled: false };
  }

  function updateAudioSource(patch: Partial<AnkiAudioSource>) {
    const source = { ...audioSource(), ...patch };
    onSetAudioConfig(Boolean(settings?.audioEnabled), [source], settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function updateAudioEnabled(enabled: boolean) {
    onSetAudioConfig(enabled, [{ ...audioSource(), enabled }], settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function updateAudioTimeout(value: string) {
    const timeout = Number(value);
    onSetAudioConfig(
      Boolean(settings?.audioEnabled),
      [audioSource()],
      Number.isFinite(timeout) ? Math.max(1000, Math.min(30000, Math.round(timeout))) : 5000,
    );
  }

  function selectHandlebar(field: string, option: string) {
    openHandlebarField = null;
    onSetFieldTemplate(field, option === "-" ? "" : option);
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
    <p class="fields-title">Field Templates</p>
    {#if selectedNote?.fields.length}
      <div class="field-template-list">
        {#each selectedNote.fields as field}
          <div class="field-template-row">
            <span>{field}</span>
            <div class="field-template-control">
              <input
                aria-label={`${field} template`}
                value={effectiveTemplateForField(field, settings)}
                disabled={busy}
                spellcheck="false"
                onchange={(event) => onSetFieldTemplate(field, event.currentTarget.value)}
              />
              <button
                type="button"
                class="handlebar-trigger"
                disabled={busy || handlebarOptions.length === 0}
                aria-label={`Choose template token for ${field}`}
                aria-expanded={openHandlebarField === field}
                onclick={() => openHandlebarField = openHandlebarField === field ? null : field}
              >
                {"{}"}
              </button>
              {#if openHandlebarField === field}
                <div class="handlebar-menu" role="menu">
                  {#each handlebarOptions as option}
                    <button type="button" role="menuitem" onclick={() => selectHandlebar(field, option)}>
                      {option}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">Fetch AnkiConnect config to edit field templates.</p>
    {/if}
  </div>

  <div class="audio-row">
    <div class="audio-head">
      <div>
        <p class="fields-title">Word Audio</p>
        <p class="audio-summary">
          {settings?.audioEnabled ? "Audio token boundary enabled" : "Audio export disabled"}
        </p>
      </div>
      <label class="audio-toggle">
        <input
          type="checkbox"
          checked={settings?.audioEnabled ?? false}
          disabled={busy}
          onchange={(event) => updateAudioEnabled(event.currentTarget.checked)}
        />
        <span>Enable</span>
      </label>
    </div>
    <div class="audio-grid">
      <label class="select-row">
        <span>Source Name</span>
        <input
          value={audioSource().name}
          disabled={busy}
          spellcheck="false"
          onchange={(event) => updateAudioSource({ name: event.currentTarget.value })}
        />
      </label>
      <label class="select-row">
        <span>Timeout Ms</span>
        <input
          type="number"
          min="1000"
          max="30000"
          step="500"
          value={settings?.audioDownloadTimeoutMs ?? 5000}
          disabled={busy}
          onchange={(event) => updateAudioTimeout(event.currentTarget.value)}
        />
      </label>
    </div>
    <label class="endpoint-row">
      <span>Audio URL Template</span>
      <input
        value={audioSource().url}
        disabled={busy}
        spellcheck="false"
        placeholder={`https://example.invalid/audio?term={term}&reading={reading}`}
        onchange={(event) => updateAudioSource({ url: event.currentTarget.value })}
      />
    </label>
  </div>

  <p class="fetched-at">{fetchedLabel(settings?.lastFetchedAt)}</p>
</section>

<style>
  .anki-panel { display: flex; flex-direction: column; gap: 10px; max-height: calc(100vh - 48px); padding: 12px; background: var(--app-surface, #121212); border: 1px solid var(--app-border, #333333); border-radius: 6px; overflow-y: auto; }
  .anki-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .anki-summary { margin-top: 4px; color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; }
  .anki-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .compact-action { padding: 5px 10px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .compact-action:hover:not(:disabled) { background: var(--app-control-hover, #262626); }
  .compact-action:disabled { color: var(--app-muted, #999999); cursor: default; }
  .endpoint-row, .select-row { min-width: 0; display: flex; flex-direction: column; gap: 5px; color: var(--app-muted, #999999); font-size: 11px; text-transform: uppercase; }
  .endpoint-row input, .select-row input, .select-row select { width: 100%; min-width: 0; padding: 7px 8px; background: var(--app-bg, #000); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; font-size: 13px; text-transform: none; }
  .endpoint-row input:disabled, .select-row input:disabled, .select-row select:disabled { color: var(--app-muted, #999999); }
  .config-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .config-grid[aria-busy="true"] { opacity: 0.72; }
  .fields-row { display: flex; flex-direction: column; gap: 7px; }
  .fields-title { color: var(--app-muted, #999999); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .audio-row { display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
  .audio-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .audio-summary { margin-top: 3px; color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; }
  .audio-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--app-text, #fff); font-size: 12px; }
  .audio-toggle input { width: 14px; height: 14px; accent-color: var(--app-primary, #d0bcff); }
  .audio-grid { display: grid; grid-template-columns: minmax(0, 1fr) 130px; gap: 10px; }
  .field-template-list { display: flex; flex-direction: column; gap: 7px; }
  .field-template-row { min-width: 0; display: grid; grid-template-columns: minmax(90px, 0.32fr) minmax(0, 1fr); align-items: start; gap: 8px; }
  .field-template-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-status, #cce8d5); font-size: 12px; }
  .field-template-control { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 6px; }
  .field-template-row input { width: 100%; min-width: 0; padding: 6px 7px; background: var(--app-bg, #000); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; font-size: 12px; }
  .field-template-row input:disabled { color: var(--app-muted, #999999); }
  .handlebar-trigger { width: 34px; min-height: 30px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; cursor: pointer; font-size: 12px; font-family: ui-monospace, "Cascadia Code", Consolas, monospace; }
  .handlebar-trigger:hover:not(:disabled) { background: var(--app-control-hover, #262626); }
  .handlebar-trigger:disabled { color: var(--app-muted, #999999); cursor: default; }
  .handlebar-menu { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fit, minmax(168px, 1fr)); gap: 4px; max-height: 180px; overflow-y: auto; padding: 6px; background: var(--app-bg, #000); border: 1px solid var(--app-border, #333333); border-radius: 4px; }
  .handlebar-menu button { min-width: 0; padding: 5px 7px; text-align: left; overflow-wrap: anywhere; background: transparent; color: var(--app-text, #fff); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .handlebar-menu button:hover { background: var(--app-control, #1b1b1b); }
  .anki-status { color: var(--app-status, #cce8d5); font-size: 13px; line-height: 1.4; }
  .err { color: var(--app-error, #ffb4ab); font-size: 13px; white-space: pre-wrap; }
  .empty, .fetched-at { color: var(--app-muted, #999999); font-size: 12px; }
  @media (max-width: 640px) {
    .anki-head { flex-direction: column; gap: 10px; }
    .anki-actions { width: 100%; }
    .anki-actions button { flex: 1 1 0; }
    .config-grid { grid-template-columns: 1fr; }
    .audio-grid { grid-template-columns: 1fr; }
    .field-template-row { grid-template-columns: 1fr; gap: 4px; }
    .field-template-control { grid-template-columns: minmax(0, 1fr) 34px; }
  }
</style>
