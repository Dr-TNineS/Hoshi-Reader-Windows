<script lang="ts">
  import { ToggleGroup } from "bits-ui";

  export type ToggleGroupOption = {
    value: string;
    label: string;
    disabled?: boolean;
  };

  let {
    value,
    items,
    ariaLabel,
    disabled = false,
    onValueChange,
  }: {
    value: string;
    items: ToggleGroupOption[];
    ariaLabel: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  } = $props();

  function handleValueChange(nextValue: string) {
    if (!nextValue || nextValue === value) return;
    onValueChange(nextValue);
  }
</script>

<ToggleGroup.Root
  type="single"
  {value}
  {disabled}
  orientation="horizontal"
  rovingFocus
  loop
  aria-label={ariaLabel}
  onValueChange={handleValueChange}
  class="ui-toggle-group"
>
  {#each items as item (item.value)}
    <ToggleGroup.Item value={item.value} disabled={item.disabled} class="ui-toggle-group-item">
      {item.label}
    </ToggleGroup.Item>
  {/each}
</ToggleGroup.Root>

<style>
  :global(.ui-toggle-group) {
    display: flex;
    align-items: center;
    gap: var(--ui-space-1);
    padding: 3px;
    background: var(--app-control, #1b1b1b);
    border: 1px solid var(--app-border, #333333);
    border-radius: var(--ui-radius-md);
  }
  :global(.ui-toggle-group-item) {
    min-width: 72px;
    min-height: var(--ui-control-height-sm);
    padding: 0 var(--ui-space-3);
    background: transparent;
    color: var(--app-text, #ffffff);
    border: none;
    border-radius: var(--ui-radius-sm);
    cursor: pointer;
    font-size: 13px;
  }
  :global(.ui-toggle-group-item:hover:not(:disabled)) { background: var(--app-control-hover, #262626); }
  :global(.ui-toggle-group-item[data-state="on"]) { background: var(--app-primary, #d0bcff); color: var(--app-bg, #000000); }
  :global(.ui-toggle-group-item:disabled) { color: var(--app-muted, #999999); cursor: default; }
  :global(.ui-toggle-group-item:focus-visible) {
    outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring-color);
    outline-offset: var(--ui-focus-ring-offset);
  }

  @media (max-width: 640px) {
    :global(.ui-toggle-group),
    :global(.ui-toggle-group-item) { width: 100%; }
    :global(.ui-toggle-group-item) { flex: 1 1 0; }
  }
</style>
