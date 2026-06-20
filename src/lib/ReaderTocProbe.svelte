<script lang="ts">
  import ReaderControls from "./ReaderControls.svelte";
  import TocPanel from "./TocPanel.svelte";
  import type { TocEntry } from "./toc";

  const entries: TocEntry[] = [
    { label: "Opening", href: "opening.xhtml", level: 0, chapterIndex: 0 },
    { label: "A nested section", href: "section.xhtml", level: 1, chapterIndex: 1 },
    { label: "Unavailable appendix", href: null, level: 0, chapterIndex: null },
  ];

  let showToc = $state(false);
  let chapterIndex = $state(0);
  let backEvents = $state(0);
  let jumpEvents = $state<number[]>([]);
  let surfaceEvents = $state(0);

  function restoreTriggerFocus() {
    requestAnimationFrame(() => document.getElementById("reader-toc-trigger")?.focus());
  }

  function closeToc() {
    if (!showToc) return;
    showToc = false;
    restoreTriggerFocus();
  }

  function toggleToc() {
    if (showToc) closeToc();
    else showToc = true;
  }

  function jumpToChapter(nextChapter: number) {
    chapterIndex = nextChapter;
    jumpEvents = [...jumpEvents, nextChapter];
    closeToc();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (showToc) closeToc();
    else backEvents += 1;
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<main class="probe">
  <button class="reader-surface" onclick={() => surfaceEvents += 1}>Reader surface</button>
  {#if showToc}
    <TocPanel {entries} {chapterIndex} onClose={closeToc} onJumpToChapter={jumpToChapter} />
  {/if}
  <ReaderControls
    {chapterIndex}
    totalChapters={2}
    onPrevChapter={() => {}}
    onNextChapter={() => {}}
    onToggleToc={toggleToc}
    onBackToShelf={() => backEvents += 1}
    tocOpen={showToc}
  />
  <div
    class="probe-state"
    data-open={showToc}
    data-back-events={backEvents}
    data-jump-events={jumpEvents.join(",")}
    data-surface-events={surfaceEvents}
    aria-hidden="true"
  ></div>
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { overflow: hidden; font-family: "Segoe UI", sans-serif; }
  .probe {
    min-height: 100vh;
    padding: 32px;
    background: var(--app-bg, #000000);
    color: var(--app-text, #ffffff);
    --app-bg: #000000;
    --app-text: #ffffff;
    --app-muted: #999999;
    --app-border: #333333;
    --app-control: #1b1b1b;
    --app-control-hover: #262626;
    --app-primary: #d0bcff;
    --app-shadow: rgba(0, 0, 0, 0.48);
  }
  .reader-surface { padding: 8px 12px; }
  .probe-state { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
