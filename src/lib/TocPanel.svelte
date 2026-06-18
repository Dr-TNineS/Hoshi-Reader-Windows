<script lang="ts">
  import type { TocEntry } from "./toc";

  let {
    entries = [],
    chapterIndex = 0,
    onClose,
    onJumpToChapter,
  }: {
    entries?: TocEntry[];
    chapterIndex?: number;
    onClose: () => void;
    onJumpToChapter: (chapterIndex: number) => void;
  } = $props();
</script>

<aside class="toc-panel">
  <div class="toc-head">
    <h2>Contents</h2>
    <button onclick={onClose}>Close</button>
  </div>
  {#if entries.length === 0}
    <p class="empty">No table of contents.</p>
  {:else}
    <div class="toc-list">
      {#each entries as entry}
        <button
          class="toc-row"
          class:active={entry.chapterIndex === chapterIndex}
          disabled={entry.chapterIndex === null}
          style={`--level:${entry.level}`}
          onclick={() => entry.chapterIndex !== null && onJumpToChapter(entry.chapterIndex)}
        >
          {entry.label}
        </button>
      {/each}
    </div>
  {/if}
</aside>

<style>
  h2 { font-size: 13px; font-weight: 600; color: var(--app-muted); text-transform: uppercase; }
  .empty { padding: 28px 0; color: var(--app-muted); font-size: 13px; }
  .toc-panel { position: fixed; top: 28px; right: 18px; bottom: 44px; z-index: 110; width: min(380px, calc(100vw - 36px)); display: flex; flex-direction: column; background: var(--app-bg); border: 1px solid var(--app-border); border-radius: 6px; box-shadow: 0 16px 44px var(--app-shadow); }
  .toc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--app-border); }
  .toc-head button { padding: 4px 10px; background: var(--app-control); color: var(--app-text); border: 1px solid var(--app-border); border-radius: 3px; cursor: pointer; font-size: 12px; }
  .toc-list { display: flex; flex-direction: column; overflow-y: auto; padding: 8px; }
  .toc-row { width: 100%; padding: 8px 10px 8px calc(10px + var(--level) * 16px); text-align: left; background: transparent; color: var(--app-text); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toc-row:hover { background: var(--app-control); }
  .toc-row.active { background: var(--app-primary); color: var(--app-bg); }
  .toc-row:disabled { color: var(--app-muted); cursor: default; }
  .toc-row:disabled:hover { background: transparent; }
</style>
