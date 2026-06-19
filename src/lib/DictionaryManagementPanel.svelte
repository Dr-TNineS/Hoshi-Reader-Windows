<script lang="ts">
  import { Tabs } from "bits-ui";
  import {
    dictionaryCountsLabel,
    dictionaryRole,
    dictionaryRoleLabels,
    dictionaryRoles,
    dictionaryStatusLabel,
    importedLabel,
  } from "./dictionary-management";
  import type { DictionaryManifestEntry, DictionaryRole, DictionaryStatus } from "./types";
  import ConfirmDialog from "./ui/ConfirmDialog.svelte";
  import UiSwitch from "./ui/Switch.svelte";

  let {
    dictionaries = [],
    status = null,
    error = "",
    busy = false,
    onRefresh = () => {},
    onImport = () => {},
    onImportFolder = () => {},
    onSetEnabled = (_dictionary: DictionaryManifestEntry, _enabled: boolean) => {},
    onMove = (_dictionary: DictionaryManifestEntry, _direction: -1 | 1) => {},
    onRemove = (_dictionary: DictionaryManifestEntry) => {},
  }: {
    dictionaries?: DictionaryManifestEntry[];
    status?: DictionaryStatus | null;
    error?: string;
    busy?: boolean;
    onRefresh?: () => void;
    onImport?: () => void;
    onImportFolder?: () => void;
    onSetEnabled?: (dictionary: DictionaryManifestEntry, enabled: boolean) => void;
    onMove?: (dictionary: DictionaryManifestEntry, direction: -1 | 1) => void;
    onRemove?: (dictionary: DictionaryManifestEntry) => void;
  } = $props();

  let selectedRole = $state<DictionaryRole>("term");

  function dictionariesForRole(role: DictionaryRole): DictionaryManifestEntry[] {
    return dictionaries.filter((dictionary) => dictionaryRole(dictionary) === role);
  }
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
      <button class="compact-action" disabled={busy} onclick={onImport}>Import Files</button>
      <button class="compact-action" disabled={busy} onclick={onImportFolder}>Import Folder</button>
    </div>
  </div>
  {#if error}
    <p class="err">{error}</p>
  {:else if busy && dictionaries.length === 0}
    <p class="empty">Loading dictionaries...</p>
  {:else if dictionaries.length === 0}
    <p class="empty">No dictionaries imported.</p>
  {:else}
    <Tabs.Root bind:value={selectedRole} orientation="horizontal" class="dictionary-tab-root">
      <Tabs.List class="dictionary-tabs" aria-label="Dictionary type">
        {#each dictionaryRoles as role}
          <Tabs.Trigger value={role} disabled={busy}>
            {dictionaryRoleLabels[role]}
          </Tabs.Trigger>
        {/each}
      </Tabs.List>
      {#each dictionaryRoles as role}
        <Tabs.Content value={role} class="dictionary-tab-content">
          {#if selectedRole === role}
            {@const visibleDictionaries = dictionariesForRole(role)}
            <div class="dictionary-list" aria-busy={busy}>
              {#if visibleDictionaries.length === 0}
                <p class="empty">No {dictionaryRoleLabels[role]} dictionaries.</p>
              {/if}
              {#each visibleDictionaries as dictionary, index (dictionary.dictId)}
                <div class="dictionary-row">
                  <div class="dictionary-toggle">
                    <UiSwitch
                      checked={dictionary.enabled}
                      disabled={busy}
                      ariaLabel={`${dictionary.enabled ? "Disable" : "Enable"} ${dictionary.title}`}
                      onCheckedChange={(enabled) => onSetEnabled(dictionary, enabled)}
                    />
                    <span>{dictionary.enabled ? "Enabled" : "Disabled"}</span>
                  </div>
                  <div class="dictionary-main">
                    <p class="dictionary-title">{dictionary.title}</p>
                    <p class="dictionary-meta">
                      {dictionaryRoleLabels[dictionaryRole(dictionary)]} | {dictionaryCountsLabel(dictionary)} | {importedLabel(dictionary.lastImported)}
                    </p>
                    <p class="dictionary-path">{dictionary.internalPath}</p>
                  </div>
                  <div class="dictionary-row-actions">
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
                      disabled={busy || index === visibleDictionaries.length - 1}
                      onclick={() => onMove(dictionary, 1)}
                    >
                      v
                    </button>
                    <ConfirmDialog
                      title={`Delete ${dictionary.title}?`}
                      description="This removes the imported dictionary and all of its Term, Frequency, and Pitch entries. This action cannot be undone."
                      confirmLabel="Delete"
                      triggerAriaLabel={`Delete ${dictionary.title}`}
                      disabled={busy}
                      onConfirm={() => onRemove(dictionary)}
                    >
                      {#snippet trigger()}Delete{/snippet}
                    </ConfirmDialog>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Tabs.Content>
      {/each}
    </Tabs.Root>
  {/if}
</section>

<style>
  .dictionary-panel { min-width: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px; background: var(--app-surface, #121212); border: 1px solid var(--app-border, #333333); border-radius: 6px; }
  .dictionary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .dictionary-summary { margin-top: 4px; color: var(--app-muted, #999999); font-size: 12px; line-height: 1.35; }
  .dictionary-actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .compact-action { padding: 5px 10px; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .compact-action:hover:not(:disabled) { background: var(--app-control-hover, #262626); }
  .compact-action:disabled { color: var(--app-muted, #999999); cursor: default; }
  .dictionary-panel :global(.dictionary-tabs) { display: flex; align-items: center; gap: 4px; padding: 3px; background: var(--app-control, #1b1b1b); border: 1px solid var(--app-border, #333333); border-radius: 6px; }
  .dictionary-panel :global(.dictionary-tabs button) { flex: 1 1 0; min-width: 0; padding: 6px 10px; background: transparent; color: var(--app-text, #fff); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; }
  .dictionary-panel :global(.dictionary-tabs button:hover:not(:disabled)) { background: var(--app-control-hover, #262626); }
  .dictionary-panel :global(.dictionary-tabs button[data-state="active"]) { background: var(--app-primary, #d0bcff); color: var(--app-bg, #000); }
  .dictionary-panel :global(.dictionary-tabs button:disabled) { color: var(--app-muted, #999999); cursor: default; }
  .dictionary-panel :global(.dictionary-tabs button:focus-visible) { outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color); outline-offset: var(--ui-focus-ring-offset); }
  .dictionary-panel :global(.dictionary-tab-content) { margin-top: 8px; outline: none; }
  .dictionary-list { display: flex; flex-direction: column; gap: 8px; max-height: 28vh; overflow-y: auto; padding-right: 2px; }
  .dictionary-list[aria-busy="true"] { opacity: 0.72; }
  .dictionary-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; align-items: center; gap: 12px; padding: 10px 12px; background: var(--app-bg, #000); border: 1px solid var(--app-border, #333333); border-radius: 6px; }
  .dictionary-toggle { display: flex; align-items: center; gap: 7px; color: var(--app-text, #fff); font-size: 12px; user-select: none; }
  .dictionary-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .dictionary-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text, #fff); font-size: 14px; }
  .dictionary-meta { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted, #999999); font-size: 11px; }
  .dictionary-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-muted, #999999); font-size: 11px; }
  .dictionary-row-actions { display: flex; align-items: center; gap: 5px; }
  .icon-action { width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; background: var(--app-control, #1b1b1b); color: var(--app-text, #fff); border: 1px solid var(--app-border, #333333); border-radius: 4px; cursor: pointer; font-size: 13px; line-height: 1; }
  .icon-action:hover:not(:disabled) { background: var(--app-control-hover, #262626); }
  .icon-action:disabled { color: var(--app-muted, #999999); cursor: default; }
  .err { color: var(--app-error, #ffb4ab); font-size: 13px; white-space: pre-wrap; }
  .empty { padding: 28px 0; color: var(--app-muted, #999999); font-size: 13px; }
  @media (max-width: 640px) {
    .dictionary-head { flex-direction: column; }
    .dictionary-actions { width: 100%; }
    .dictionary-actions button { flex: 1 1 0; min-width: 0; }
    .dictionary-row { grid-template-columns: 1fr; align-items: start; }
    .dictionary-toggle { grid-column: 1 / -1; }
    .dictionary-main { grid-column: 1; }
    .dictionary-row-actions { grid-column: 1; }
  }
</style>
