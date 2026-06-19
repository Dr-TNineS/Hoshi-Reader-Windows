<script lang="ts">
  import { Select } from "bits-ui";

  export type SelectOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  let {
    id,
    value,
    items,
    placeholder = "Select an option",
    disabled = false,
    ariaLabel,
    ariaLabelledby,
    onValueChange,
  }: {
    id?: string;
    value: string;
    items: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
    ariaLabelledby?: string;
    onValueChange: (value: string) => void;
  } = $props();
</script>

<Select.Root type="single" {value} {items} {disabled} {onValueChange}>
  <Select.Trigger
    {id}
    aria-label={ariaLabel}
    aria-labelledby={ariaLabelledby}
    class="ui-select-trigger"
  >
    <Select.Value {placeholder} />
    <span class="ui-select-caret" aria-hidden="true">⌄</span>
  </Select.Trigger>
  <Select.Portal to="[data-ui-portal-root]">
    <Select.Content class="ui-select-content" sideOffset={4}>
      <Select.ScrollUpButton class="ui-select-scroll">▲</Select.ScrollUpButton>
      <Select.Viewport class="ui-select-viewport">
        {#each items as item (item.value)}
          <Select.Item
            value={item.value}
            label={item.label}
            disabled={item.disabled}
            class="ui-select-item"
          >
            {#snippet children({ selected })}
              <span>{item.label}</span>
              {#if selected}<span class="ui-select-check" aria-hidden="true">✓</span>{/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
      <Select.ScrollDownButton class="ui-select-scroll">▼</Select.ScrollDownButton>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.ui-select-trigger) {
    width: 100%;
    min-width: 0;
    min-height: var(--ui-control-height-md);
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    padding: 0 var(--ui-space-2);
    text-align: left;
    background: var(--app-bg, #000000);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 13px;
  }
  :global(.ui-select-trigger:disabled) { color: var(--app-muted, #999999); cursor: default; }
  :global(.ui-select-trigger:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }
  :global(.ui-select-trigger[data-placeholder]) { color: var(--app-muted, #999999); }
  :global(.ui-select-caret) { margin-left: auto; color: var(--app-muted, #999999); font-size: 16px; line-height: 1; }
  :global(.ui-select-content) {
    z-index: 250;
    width: var(--bits-select-anchor-width);
    min-width: var(--bits-select-anchor-width);
    max-height: min(280px, calc(100vh - 24px));
    overflow: hidden;
    padding: var(--ui-space-1);
    background: var(--app-surface, #121212);
    color: var(--app-text, #ffffff);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-md);
    box-shadow: var(--ui-dialog-shadow);
    outline: none;
  }
  :global(.ui-select-viewport) { display: flex; flex-direction: column; gap: 2px; }
  :global(.ui-select-item) {
    min-width: 0;
    min-height: var(--ui-control-height-md);
    display: flex;
    align-items: center;
    gap: var(--ui-space-2);
    padding: 6px var(--ui-space-2);
    overflow-wrap: anywhere;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 13px;
    outline: none;
  }
  :global(.ui-select-item[data-highlighted]) { background: var(--app-control-hover, #262626); }
  :global(.ui-select-item[data-disabled]) { color: var(--app-muted, #999999); cursor: default; }
  :global(.ui-select-check) { margin-left: auto; color: var(--app-primary, #d0bcff); }
  :global(.ui-select-scroll) {
    width: 100%;
    min-height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--app-muted, #999999);
    font-size: 9px;
  }
</style>
