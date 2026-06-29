<script lang="ts">
  import { defaultGlobalLookupShortcut, type GlobalLookupSettings, type ShortcutBinding as GlobalShortcutBinding } from "./global-lookup-settings";
  import GlobalShortcutEditor from "./GlobalShortcutEditor.svelte";
  import {
    defaultKeyboardShortcutBindings,
    defaultKeyboardShortcutSettings,
    type KeyboardShortcutActionId,
    type KeyboardShortcutSettings,
  } from "./keyboard-shortcuts";
  import { shortcutGroups } from "./shortcuts";

  let {
    globalLookupSettings = null,
    keyboardShortcutSettings = defaultKeyboardShortcutSettings,
    onGlobalLookupShortcutChange = null,
    onGlobalLookupShortcutReset = null,
    onKeyboardShortcutChange = (_actionId: KeyboardShortcutActionId, _shortcut: GlobalShortcutBinding) => "",
    onKeyboardShortcutReset = (_actionId: KeyboardShortcutActionId) => {},
  }: {
    globalLookupSettings?: GlobalLookupSettings | null;
    keyboardShortcutSettings?: KeyboardShortcutSettings;
    onGlobalLookupShortcutChange?: ((shortcut: GlobalShortcutBinding) => void) | null;
    onGlobalLookupShortcutReset?: (() => void) | null;
    onKeyboardShortcutChange?: (actionId: KeyboardShortcutActionId, shortcut: GlobalShortcutBinding) => string;
    onKeyboardShortcutReset?: (actionId: KeyboardShortcutActionId) => void;
  } = $props();

  let shortcutErrors = $state<Record<string, string>>({});

  const groups = $derived(shortcutGroups(globalLookupSettings, keyboardShortcutSettings));
  const canEditGlobalShortcut = $derived(Boolean(
    globalLookupSettings && onGlobalLookupShortcutChange && onGlobalLookupShortcutReset,
  ));
  const actionLabels = $derived(new Map(
    groups.flatMap((group) => group.actions.map((action) => [action.id, action.label] as const)),
  ));

  function setLocalShortcut(actionId: KeyboardShortcutActionId, shortcut: GlobalShortcutBinding) {
    const conflict = onKeyboardShortcutChange(actionId, shortcut);
    shortcutErrors = {
      ...shortcutErrors,
      [actionId]: conflict ? `Already used by ${actionLabels.get(conflict) ?? conflict}.` : "",
    };
  }

  function resetLocalShortcut(actionId: KeyboardShortcutActionId) {
    onKeyboardShortcutReset(actionId);
    shortcutErrors = { ...shortcutErrors, [actionId]: "" };
  }
</script>

<section class="shortcuts-panel" aria-label="Keyboard shortcuts">
  <p class="shortcuts-summary">Current keyboard and mouse shortcuts, grouped by feature.</p>

  {#each groups as group}
    <section class="shortcut-group" aria-labelledby={`shortcut-group-${group.id}`}>
      <h2 id={`shortcut-group-${group.id}`}>{group.label}</h2>
      <div class="shortcut-card">
        {#each group.actions as action}
          <div class="shortcut-row" class:editable={Boolean(action.editableActionId)}>
            <div class="action-copy">
              <span class="action-label">{action.label}</span>
              {#if action.detail}<span class="action-detail">{action.detail}</span>{/if}
            </div>
            {#if action.editableActionId === "global-selected-text-lookup" && canEditGlobalShortcut && globalLookupSettings && onGlobalLookupShortcutChange && onGlobalLookupShortcutReset}
              <GlobalShortcutEditor
                shortcut={globalLookupSettings.shortcut}
                defaultShortcut={defaultGlobalLookupShortcut}
                requireCommandModifier={true}
                onShortcutChange={onGlobalLookupShortcutChange}
                onShortcutReset={onGlobalLookupShortcutReset}
              />
            {:else if action.editableActionId && action.editableActionId !== "global-selected-text-lookup"}
              {@const localActionId = action.editableActionId}
              {@const editable = action.bindings.find((binding) => binding.editable)?.shortcut}
              {#if editable}
                <div class="editable-bindings">
                  <GlobalShortcutEditor
                    shortcut={editable}
                    ariaLabel={`${action.label} shortcut`}
                    defaultShortcut={defaultKeyboardShortcutBindings[localActionId]}
                    requireCommandModifier={false}
                    externalError={shortcutErrors[localActionId] ?? ""}
                    onShortcutChange={(shortcut) => setLocalShortcut(localActionId, shortcut)}
                    onShortcutReset={() => resetLocalShortcut(localActionId)}
                  />
                  <div class="bindings fixed-bindings" aria-label={`${action.label} fixed shortcuts`}>
                    {#each action.bindings.filter((binding) => !binding.editable) as binding}
                      <span class="binding">
                        {#each binding.tokens as token, tokenIndex}
                          {#if tokenIndex > 0}<span class="binding-plus">+</span>{/if}
                          <kbd>{token}</kbd>
                        {/each}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
            {:else}
              <div class="bindings" aria-label={`${action.label} shortcuts`}>
                {#each action.bindings as binding, bindingIndex}
                  {#if bindingIndex > 0}<span class="binding-or">or</span>{/if}
                  <span class="binding">
                    {#each binding.tokens as token, tokenIndex}
                      {#if tokenIndex > 0}<span class="binding-plus">+</span>{/if}
                      <kbd>{token}</kbd>
                    {/each}
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/each}
</section>

<style>
  .shortcuts-panel { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
  .shortcuts-summary { color: var(--app-muted); font-size: 13px; line-height: 1.45; }
  .shortcut-group { min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  h2 { color: var(--app-muted); font-size: 13px; font-weight: 650; letter-spacing: 0.02em; text-transform: uppercase; }
  .shortcut-card { min-width: 0; overflow: hidden; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 8px; }
  .shortcut-row { min-width: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: center; padding: 13px 14px; }
  .shortcut-row.editable { align-items: start; }
  .shortcut-row + .shortcut-row { border-top: 1px solid var(--app-border); }
  .action-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .action-label { color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; }
  .action-detail { color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  .bindings { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
  .editable-bindings { min-width: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
  .fixed-bindings:empty { display: none; }
  .binding { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .binding-or, .binding-plus { color: var(--app-muted); font-size: 11px; }
  kbd { min-width: 28px; min-height: 27px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-bottom-color: var(--app-muted); border-radius: 5px; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1; box-shadow: 0 1px 0 color-mix(in srgb, var(--app-muted) 35%, transparent); }

  @media (max-width: 640px) {
    .shortcut-row { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .bindings,
    .editable-bindings { align-items: flex-start; justify-content: flex-start; }
  }
</style>
