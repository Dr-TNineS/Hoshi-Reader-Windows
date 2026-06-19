<script lang="ts">
  import { shortcutGroups } from "./shortcuts";
</script>

<section class="shortcuts-panel" aria-label="Keyboard shortcuts">
  <p class="shortcuts-summary">Current keyboard and mouse shortcuts, grouped by feature.</p>

  {#each shortcutGroups as group}
    <section class="shortcut-group" aria-labelledby={`shortcut-group-${group.id}`}>
      <h2 id={`shortcut-group-${group.id}`}>{group.label}</h2>
      <div class="shortcut-card">
        {#each group.actions as action}
          <div class="shortcut-row">
            <div class="action-copy">
              <span class="action-label">{action.label}</span>
              {#if action.detail}<span class="action-detail">{action.detail}</span>{/if}
            </div>
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
  .shortcut-row + .shortcut-row { border-top: 1px solid var(--app-border); }
  .action-copy { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .action-label { color: var(--app-text); font-size: 14px; font-weight: 600; line-height: 1.35; }
  .action-detail { color: var(--app-muted); font-size: 12px; line-height: 1.4; }
  .bindings { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 7px; }
  .binding { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .binding-or, .binding-plus { color: var(--app-muted); font-size: 11px; }
  kbd { min-width: 28px; min-height: 27px; display: inline-flex; align-items: center; justify-content: center; padding: 3px 8px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-bottom-color: var(--app-muted); border-radius: 5px; font-family: inherit; font-size: 12px; font-weight: 600; line-height: 1; box-shadow: 0 1px 0 color-mix(in srgb, var(--app-muted) 35%, transparent); }

  @media (max-width: 640px) {
    .shortcut-row { grid-template-columns: minmax(0, 1fr); gap: 10px; }
    .bindings { justify-content: flex-start; }
  }
</style>
