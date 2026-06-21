<script lang="ts">
  import { effectiveTemplateForField } from "./anki-field-renderer";
  import type { AnkiAudioSource, AnkiSettings, LocalAudioStatus } from "./types";
  import UiDropdownMenu from "./ui/DropdownMenu.svelte";
  import UiSelect from "./ui/Select.svelte";
  import UiSwitch from "./ui/Switch.svelte";

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
    onSetForceSyncAfterAdd = (_enabled: boolean) => {},
    onSetNoteOptions = (_tags: string, _allowDuplicates: boolean, _duplicateScope: AnkiSettings["duplicateScope"], _checkAllModels: boolean) => {},
    onSetCompactGlossaries = (_enabled: boolean) => {},
    localAudioStatus = { imported: false, sizeBytes: null, sources: [] },
    onSetLocalAudioEnabled = (_enabled: boolean) => {},
    onImportLocalAudio = () => {},
    onRemoveLocalAudio = () => {},
    onMoveLocalAudioSource = (_source: string, _direction: -1 | 1) => {},
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
    onSetForceSyncAfterAdd?: (enabled: boolean) => void;
    onSetNoteOptions?: (tags: string, allowDuplicates: boolean, duplicateScope: AnkiSettings["duplicateScope"], checkAllModels: boolean) => void;
    onSetCompactGlossaries?: (enabled: boolean) => void;
    localAudioStatus?: LocalAudioStatus;
    onSetLocalAudioEnabled?: (enabled: boolean) => void;
    onImportLocalAudio?: () => void;
    onRemoveLocalAudio?: () => void;
    onMoveLocalAudioSource?: (source: string, direction: -1 | 1) => void;
  } = $props();

  const selectedNote = $derived(
    settings?.noteTypes.find((noteType) => noteType.name === settings?.selectedNoteType) ?? null,
  );
  const deckOptions = $derived(settings?.decks.map((deck) => ({ value: deck.name, label: deck.name })) ?? []);
  const noteTypeOptions = $derived(settings?.noteTypes.map((noteType) => ({ value: noteType.name, label: noteType.name })) ?? []);
  const duplicateScopeOptions = [
    { value: "collection", label: "Collection" },
    { value: "deck", label: "Deck" },
    { value: "deckRoot", label: "Deck and children" },
  ];

  function fetchedLabel(timestamp: number | null | undefined): string {
    if (!timestamp) return "Not fetched yet";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "Fetch time unknown";
    return `Fetched ${date.toLocaleString()}`;
  }

  function audioSources(): AnkiAudioSource[] {
    return settings?.audioSources ?? [{ id: "default", name: "Default", url: "", enabled: false }];
  }

  function updateAudioSource(id: string, patch: Partial<AnkiAudioSource>) {
    const sources = audioSources().map((source) => source.id === id ? { ...source, ...patch } : source);
    onSetAudioConfig(Boolean(settings?.audioEnabled), sources, settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function addAudioSource() {
    const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `source-${Date.now()}`;
    onSetAudioConfig(Boolean(settings?.audioEnabled), [...audioSources(), { id, name: "New Source", url: "", enabled: true }], settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function removeAudioSource(id: string) {
    onSetAudioConfig(Boolean(settings?.audioEnabled), audioSources().filter((source) => source.id !== id), settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function moveAudioSource(id: string, direction: -1 | 1) {
    const sources = [...audioSources()];
    const index = sources.findIndex((source) => source.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sources.length) return;
    [sources[index], sources[target]] = [sources[target], sources[index]];
    onSetAudioConfig(Boolean(settings?.audioEnabled), sources, settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function updateAudioEnabled(enabled: boolean) {
    onSetAudioConfig(enabled, audioSources(), settings?.audioDownloadTimeoutMs ?? 5000);
  }

  function updateAudioTimeout(value: string) {
    const timeout = Number(value);
    onSetAudioConfig(
      Boolean(settings?.audioEnabled),
      audioSources(),
      Number.isFinite(timeout) ? Math.max(1000, Math.min(30000, Math.round(timeout))) : 5000,
    );
  }

  function selectHandlebar(field: string, option: string) {
    onSetFieldTemplate(field, option === "-" ? "" : option);
  }

  function updateNoteOptions(patch: Partial<Pick<AnkiSettings, "tags" | "allowDuplicates" | "duplicateScope" | "checkDuplicatesAcrossAllModels">>) {
    onSetNoteOptions(
      patch.tags ?? settings?.tags ?? "hoshi-reader",
      patch.allowDuplicates ?? settings?.allowDuplicates ?? false,
      patch.duplicateScope ?? settings?.duplicateScope ?? "collection",
      patch.checkDuplicatesAcrossAllModels ?? settings?.checkDuplicatesAcrossAllModels ?? false,
    );
  }

  function localAudioSizeLabel(): string {
    if (!localAudioStatus.imported) return "No HSA local audio database imported";
    const bytes = localAudioStatus.sizeBytes ?? 0;
    const size = bytes >= 1024 * 1024
      ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
      : `${Math.max(1, Math.round(bytes / 1024))} KiB`;
    return `${size}, ${localAudioStatus.sources.length} sources`;
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
    <div class="select-row">
      <span id="anki-deck-label">Deck</span>
      <UiSelect
        value={settings?.selectedDeck ?? ""}
        items={deckOptions}
        placeholder={settings?.decks.length ? "Select a deck" : "No decks fetched"}
        disabled={busy || !settings?.decks.length}
        ariaLabelledby="anki-deck-label"
        onValueChange={onSelectDeck}
      />
    </div>

    <div class="select-row">
      <span id="anki-note-type-label">Note Type</span>
      <UiSelect
        value={settings?.selectedNoteType ?? ""}
        items={noteTypeOptions}
        placeholder={settings?.noteTypes.length ? "Select a note type" : "No note types fetched"}
        disabled={busy || !settings?.noteTypes.length}
        ariaLabelledby="anki-note-type-label"
        onValueChange={onSelectNoteType}
      />
    </div>
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
              <UiDropdownMenu
                items={handlebarOptions}
                disabled={busy || handlebarOptions.length === 0}
                triggerAriaLabel={`Choose template token for ${field}`}
                onSelect={(option) => selectHandlebar(field, option)}
              />
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
        <p class="fields-title">Note Options</p>
        <p class="audio-summary">Tags and duplicate matching sent to AnkiConnect.</p>
      </div>
      <div class="audio-toggle">
        <UiSwitch
          id="anki-allow-duplicates"
          checked={settings?.allowDuplicates ?? false}
          disabled={busy}
          onCheckedChange={(enabled) => updateNoteOptions({ allowDuplicates: enabled })}
        />
        <label for="anki-allow-duplicates">Allow duplicates</label>
      </div>
    </div>
    <label class="endpoint-row">
      <span>Tags</span>
      <input
        aria-label="Anki tags"
        value={settings?.tags ?? "hoshi-reader"}
        disabled={busy}
        spellcheck="false"
        onchange={(event) => updateNoteOptions({ tags: event.currentTarget.value })}
      />
    </label>
    <div class="config-grid">
      <div class="select-row">
        <span id="anki-duplicate-scope-label">Duplicate Scope</span>
        <UiSelect
          value={settings?.duplicateScope ?? "collection"}
          items={duplicateScopeOptions}
          disabled={busy}
          ariaLabelledby="anki-duplicate-scope-label"
          onValueChange={(scope) => updateNoteOptions({ duplicateScope: scope as AnkiSettings["duplicateScope"] })}
        />
      </div>
      <div class="audio-toggle note-option-toggle">
        <UiSwitch
          id="anki-check-all-models"
          checked={settings?.checkDuplicatesAcrossAllModels ?? false}
          disabled={busy}
          onCheckedChange={(enabled) => updateNoteOptions({ checkDuplicatesAcrossAllModels: enabled })}
        />
        <label for="anki-check-all-models">Check all note types</label>
      </div>
    </div>
    <div class="audio-toggle">
      <UiSwitch
        id="anki-compact-glossaries"
        checked={settings?.compactGlossaries ?? false}
        disabled={busy}
        onCheckedChange={onSetCompactGlossaries}
      />
      <label for="anki-compact-glossaries">Compact glossary cards</label>
    </div>
  </div>

  <div class="audio-row">
    <div class="audio-head">
      <div>
        <p class="fields-title">Sync</p>
        <p class="audio-summary">Run AnkiConnect sync only after a note is added successfully.</p>
      </div>
      <div class="audio-toggle">
        <UiSwitch
          id="anki-force-sync-after-add"
          checked={settings?.forceSyncAfterAdd ?? false}
          disabled={busy}
          onCheckedChange={onSetForceSyncAfterAdd}
        />
        <label for="anki-force-sync-after-add">Sync after add</label>
      </div>
    </div>
  </div>

  <div class="audio-row">
    <div class="audio-head">
      <div>
        <p class="fields-title">Word Audio</p>
        <p class="audio-summary">
          {settings?.audioEnabled ? "Word audio export enabled" : "Audio export disabled"}
        </p>
      </div>
      <div class="audio-toggle">
        <UiSwitch
          id="anki-audio-enabled"
          checked={settings?.audioEnabled ?? false}
          disabled={busy}
          onCheckedChange={updateAudioEnabled}
        />
        <label for="anki-audio-enabled">Enable</label>
      </div>
    </div>
    <div class="audio-source-toolbar">
      <label class="select-row audio-timeout">
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
      <button class="compact-action" disabled={busy} onclick={addAudioSource}>Add Source</button>
    </div>
    <div class="remote-source-list" aria-label="Remote audio sources">
      {#each audioSources() as source, index (source.id)}
        <div class="remote-source-card" data-source-id={source.id}>
          <div class="remote-source-head">
            <div class="audio-toggle">
              <UiSwitch
                id={`anki-audio-source-${source.id}`}
                checked={source.enabled}
                disabled={busy}
                onCheckedChange={(enabled) => updateAudioSource(source.id, { enabled })}
              />
              <label for={`anki-audio-source-${source.id}`}>Enabled</label>
            </div>
            <div class="local-source-actions">
              <button aria-label={`Move ${source.name} up`} disabled={busy || index === 0} onclick={() => moveAudioSource(source.id, -1)}>↑</button>
              <button aria-label={`Move ${source.name} down`} disabled={busy || index === audioSources().length - 1} onclick={() => moveAudioSource(source.id, 1)}>↓</button>
              <button aria-label={`Remove ${source.name}`} disabled={busy} onclick={() => removeAudioSource(source.id)}>×</button>
            </div>
          </div>
          <label class="select-row">
            <span>Source Name</span>
            <input
              value={source.name}
              disabled={busy}
              spellcheck="false"
              onchange={(event) => updateAudioSource(source.id, { name: event.currentTarget.value })}
            />
          </label>
          <label class="endpoint-row">
            <span>Audio URL Template</span>
            <input
              value={source.url}
              disabled={busy}
              spellcheck="false"
              placeholder={`https://audio.example/clip?term={term}&reading={reading}`}
              onchange={(event) => updateAudioSource(source.id, { url: event.currentTarget.value })}
            />
          </label>
        </div>
      {/each}
    </div>

    <div class="local-audio-card">
      <div class="audio-head">
        <div>
          <p class="fields-title">HSA Local Audio</p>
          <p class="audio-summary">{localAudioSizeLabel()}</p>
        </div>
        <label class="audio-toggle">
          <input
            type="checkbox"
            checked={settings?.localAudioEnabled ?? false}
            disabled={busy || !localAudioStatus.imported}
            onchange={(event) => onSetLocalAudioEnabled(event.currentTarget.checked)}
          />
          <span>Local first</span>
        </label>
      </div>
      <div class="local-audio-actions">
        <button class="compact-action" disabled={busy} onclick={onImportLocalAudio}>
          {localAudioStatus.imported ? "Replace Database" : "Import Database"}
        </button>
        {#if localAudioStatus.imported}
          <button class="compact-action danger" disabled={busy} onclick={onRemoveLocalAudio}>Remove</button>
        {/if}
      </div>
      {#if localAudioStatus.sources.length > 0}
        <div class="local-source-list" aria-label="Local audio source order">
          {#each localAudioStatus.sources as source, index}
            <div class="local-source-row">
              <span>{source.name}</span>
              <div class="local-source-actions">
                <button aria-label={`Move ${source.name} up`} disabled={busy || index === 0} onclick={() => onMoveLocalAudioSource(source.name, -1)}>↑</button>
                <button aria-label={`Move ${source.name} down`} disabled={busy || index === localAudioStatus.sources.length - 1} onclick={() => onMoveLocalAudioSource(source.name, 1)}>↓</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
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
  .endpoint-row input, .select-row input { width: 100%; min-width: 0; padding: 7px 8px; background: var(--app-bg, #000); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; font-size: 13px; text-transform: none; }
  .endpoint-row input:disabled, .select-row input:disabled { color: var(--app-muted, #999999); }
  .config-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
  .config-grid[aria-busy="true"] { opacity: 0.72; }
  .fields-row { display: flex; flex-direction: column; gap: 7px; }
  .fields-title { color: var(--app-muted, #999999); font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .audio-row { display: flex; flex-direction: column; gap: 8px; padding-top: 2px; }
  .local-audio-card { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; padding-top: 10px; border-top: 1px solid var(--app-border, #333333); }
  .local-audio-actions, .local-source-actions { display: flex; align-items: center; gap: 6px; }
  .local-source-list { overflow: hidden; border: 1px solid var(--app-border, #333333); border-radius: 5px; }
  .local-source-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 8px; color: var(--app-text, #fff); font-size: 12px; }
  .local-source-row + .local-source-row { border-top: 1px solid var(--app-border, #333333); }
  .local-source-actions button { width: 26px; height: 24px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; cursor: pointer; }
  .local-source-actions button:disabled { color: var(--app-muted, #999999); cursor: default; }
  .danger { color: #ffb4ab; }
  .audio-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .audio-summary { margin-top: 3px; color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; }
  .audio-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--app-text, #fff); font-size: 12px; }
  .note-option-toggle { align-self: end; min-height: 34px; }
  .audio-source-toolbar, .remote-source-head { display: flex; align-items: end; justify-content: space-between; gap: 10px; }
  .audio-timeout { width: 130px; }
  .remote-source-list { display: flex; flex-direction: column; gap: 8px; }
  .remote-source-card { display: flex; flex-direction: column; gap: 7px; padding: 8px; border: 1px solid var(--app-border, #333333); border-radius: 5px; }
  .field-template-list { display: flex; flex-direction: column; gap: 7px; }
  .field-template-row { min-width: 0; display: grid; grid-template-columns: minmax(90px, 0.32fr) minmax(0, 1fr); align-items: start; gap: 8px; }
  .field-template-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-status, #cce8d5); font-size: 12px; }
  .field-template-control { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) 34px; gap: 6px; }
  .field-template-row input { width: 100%; min-width: 0; padding: 6px 7px; background: var(--app-bg, #000); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; font-size: 12px; }
  .field-template-row input:disabled { color: var(--app-muted, #999999); }
  .anki-status { color: var(--app-status, #cce8d5); font-size: 13px; line-height: 1.4; }
  .err { color: var(--app-error, #ffb4ab); font-size: 13px; white-space: pre-wrap; }
  .empty, .fetched-at { color: var(--app-muted, #999999); font-size: 12px; }
  @media (max-width: 640px) {
    .anki-head { flex-direction: column; gap: 10px; }
    .anki-actions { width: 100%; }
    .anki-actions button { flex: 1 1 0; }
    .config-grid { grid-template-columns: 1fr; }
    .field-template-row { grid-template-columns: 1fr; gap: 4px; }
    .field-template-control { grid-template-columns: minmax(0, 1fr) 34px; }
  }
</style>
