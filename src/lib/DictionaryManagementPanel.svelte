<script lang="ts">
  import { dictionaryCountsLabel, dictionaryStatusLabel, importedLabel } from "./dictionary-management";
  import type { DictionaryManifestEntry, DictionaryStatus } from "./types";

  let {
    dictionaries = [],
    status = null,
    error = "",
    busy = false,
    onRefresh = () => {},
    onImport = () => {},
    onSetEnabled = (_dictionary: DictionaryManifestEntry, _enabled: boolean) => {},
    onMove = (_dictionary: DictionaryManifestEntry, _direction: -1 | 1) => {},
  }: {
    dictionaries?: DictionaryManifestEntry[];
    status?: DictionaryStatus | null;
    error?: string;
    busy?: boolean;
    onRefresh?: () => void;
    onImport?: () => void;
    onSetEnabled?: (dictionary: DictionaryManifestEntry, enabled: boolean) => void;
    onMove?: (dictionary: DictionaryManifestEntry, direction: -1 | 1) => void;
  } = $props();
</script>

<section class="dictionary-panel">
  <div class="dictionary-head">
    <div>
      <h2>Dictionaries</h2>
      {#if dictionaryStatusLabel(status)}
        <p class="dictionary-summary">{dictionaryStatusLabel(status)}</p>
      {/if}
    </div>
    <div class="dictionary-actions">
      <button class="compact-action" disabled={busy} onclick={onRefresh}>Refresh</button>
      <button class="compact-action" disabled={busy} onclick={onImport}>Import</button>
    </div>
  </div>
  {#if error}
    <p class="err">{error}</p>
  {:else if busy && dictionaries.length === 0}
    <p class="empty">Loading dictionaries...</p>
  {:else if dictionaries.length === 0}
    <p class="empty">No dictionaries imported.</p>
  {:else}
    <div class="dictionary-list" aria-busy={busy}>
      {#each dictionaries as dictionary, index (dictionary.dictId)}
        <div class="dictionary-row">
          <label class="dictionary-toggle">
            <input
              type="checkbox"
              checked={dictionary.enabled}
              disabled={busy}
              onchange={(event) => onSetEnabled(dictionary, event.currentTarget.checked)}
            />
            <span>{dictionary.enabled ? "Enabled" : "Disabled"}</span>
          </label>
          <div class="dictionary-main">
            <p class="dictionary-title">{dictionary.title}</p>
            <p class="dictionary-meta">
              {dictionary.kind} | {dictionaryCountsLabel(dictionary)} | {importedLabel(dictionary.lastImported)}
            </p>
            <p class="dictionary-path">{dictionary.internalPath}</p>
          </div>
          <div class="dictionary-order">
            <button
              class="icon-action"
              aria-label={`Move ${dictionary.title} up`}
              title="Move up"
              disabled={busy || index === 0}
              onclick={() => onMove(dictionary, -1)}
            >
              ^
            </button>
            <button
              class="icon-action"
              aria-label={`Move ${dictionary.title} down`}
              title="Move down"
              disabled={busy || index === dictionaries.length - 1}
              onclick={() => onMove(dictionary, 1)}
            >
              v
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .dictionary-panel { display: flex; flex-direction: column; gap: 10px; padding: 12px; background: #26282c; border: 1px solid #3c4043; border-radius: 6px; }
  .dictionary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .dictionary-summary { margin-top: 4px; color: #b7bcc3; font-size: 12px; line-height: 1.35; }
  .dictionary-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .compact-action { padding: 5px 10px; background: #303134; color: #d7d9dc; border: 1px solid #555c64; border-radius: 4px; cursor: pointer; font-size: 12px; }
  .compact-action:hover:not(:disabled) { background: #3a3d41; }
  .compact-action:disabled { color: #747a80; cursor: default; }
  .dictionary-list { display: flex; flex-direction: column; gap: 8px; max-height: 28vh; overflow-y: auto; padding-right: 2px; }
  .dictionary-list[aria-busy="true"] { opacity: 0.72; }
  .dictionary-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; background: #2b2d31; border: 1px solid #3c4043; border-radius: 6px; }
  .dictionary-toggle { display: flex; align-items: center; gap: 7px; color: #d7d9dc; font-size: 12px; user-select: none; }
  .dictionary-toggle input { width: 14px; height: 14px; accent-color: #3b8f78; }
  .dictionary-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .dictionary-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #f1f3f4; font-size: 14px; }
  .dictionary-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #9aa0a6; font-size: 11px; }
  .dictionary-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6f7479; font-size: 11px; }
  .dictionary-order { display: flex; align-items: center; gap: 5px; }
  .icon-action { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: #303134; color: #d7d9dc; border: 1px solid #555c64; border-radius: 4px; cursor: pointer; font-size: 13px; line-height: 1; }
  .icon-action:hover:not(:disabled) { background: #3a3d41; }
  .icon-action:disabled { color: #666c72; cursor: default; }
  .err { color: #ff8a80; font-size: 13px; white-space: pre-wrap; }
  .empty { padding: 28px 0; color: #80868b; font-size: 13px; }
  @media (max-width: 640px) {
    .dictionary-row { grid-template-columns: 1fr auto; align-items: start; }
    .dictionary-toggle { grid-column: 1 / -1; }
    .dictionary-main { grid-column: 1; }
    .dictionary-order { grid-column: 2; grid-row: 2; }
  }
</style>
