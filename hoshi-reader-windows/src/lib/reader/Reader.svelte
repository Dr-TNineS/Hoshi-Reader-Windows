<script lang="ts">
  import { getTotalChars } from "../reader";

  let {
    content = "",
    direction = "vertical",
    chapterIndex = 0,
    totalChapters = 0,
    onPrevChapter = () => {},
    onPrevChapterDirect = () => {},
    onNextChapter = () => {},
    onBackToShelf = () => {},
    startAtEnd = false,
  } = $props();

  let containerEl: HTMLDivElement = $state()!;
  let contentEl: HTMLDivElement = $state()!;
  let charCount = $state(0);
  let currentPage = $state(0);
  let totalPages = $state(1);
  let mode: "paginated" | "scroll" = $state((localStorage.getItem("hoshi_mode") as "paginated" | "scroll") ?? "paginated");
  let initializing = $state(false);
  let showSettings = $state(false);

  // ---- Reader appearance settings ----
  let fontSize = $state<number>(
    Number(localStorage.getItem("hoshi_fontSize")) || 21
  );
  let lineHeight = $state<number>(
    Number(localStorage.getItem("hoshi_lineHeight")) || 1.9
  );
  let hPadding = $state<number>(
    Number(localStorage.getItem("hoshi_hPadding")) || 150
  );
  let textIndent = $state<number>(
    Number(localStorage.getItem("hoshi_textIndent")) || 0
  );

  // Persist settings whenever they change
  $effect(() => { localStorage.setItem("hoshi_fontSize", String(fontSize)); });
  $effect(() => { localStorage.setItem("hoshi_lineHeight", String(lineHeight)); });
  $effect(() => { localStorage.setItem("hoshi_hPadding", String(hPadding)); });
  $effect(() => { localStorage.setItem("hoshi_textIndent", String(textIndent)); });

  let isVert = $derived(direction === "vertical");
  let columnGap = $derived(isVert ? 30 : 40);

  let styleVars = $derived(`--fs:${fontSize}px;--lh:${lineHeight};--hp:${hPadding}px;--indent:${textIndent}em`);

  // Measured page step: (scrollWidth + gap) / totalPages
  function pageStep(): number {
    if (!containerEl || totalPages <= 1) return containerEl?.clientWidth || 1;
    return (containerEl.scrollWidth + columnGap) / totalPages;
  }

  function recalc() {
    if (!containerEl || !contentEl) return;
    if (mode === "scroll") { totalPages = 1; return; }
    const colW = containerEl.clientWidth;
    const sw = containerEl.scrollWidth || colW;
    const pageW = colW + columnGap;
    totalPages = Math.max(1, Math.ceil((sw + columnGap) / (pageW || 1)));
  }

  function goPage(p: number) {
    if (!containerEl) return;
    const step = pageStep();
    currentPage = Math.max(0, Math.min(p, totalPages - 1));
    const scrollTarget = isVert
      ? (totalPages - 1 - currentPage) * step
      : currentPage * step;
    containerEl.scrollTo({ left: scrollTarget, behavior: "smooth" });
  }

  function next() {
    if (currentPage < totalPages - 1) goPage(currentPage + 1);
    else onNextChapter();
  }

  function prev() {
    if (currentPage > 0) goPage(currentPage - 1);
    else onPrevChapter();
  }

  function onScroll() {
    if (!containerEl || mode !== "paginated" || initializing) return;
    const step = pageStep();
    const raw = Math.round(containerEl.scrollLeft / (step || 1));
    currentPage = isVert
      ? Math.max(0, Math.min(totalPages - 1, totalPages - 1 - raw))
      : Math.max(0, Math.min(totalPages - 1, raw));
  }

  function handleKey(e: KeyboardEvent) {
    if (showSettings) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (isVert ? e.key === "ArrowLeft" : e.key === "ArrowRight")) { e.preventDefault(); onNextChapter(); }
    else if (ctrl && (isVert ? e.key === "ArrowRight" : e.key === "ArrowLeft")) { e.preventDefault(); onPrevChapterDirect(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); isVert ? prev() : next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); isVert ? next() : prev(); }
    else if (e.key === "m" || e.key === "M") { mode = mode === "paginated" ? "scroll" : "paginated"; currentPage = 0; }
    else if (e.key === "Escape") { showSettings ? showSettings = false : onBackToShelf(); }
  }

  // Persist mode
  $effect(() => {
    localStorage.setItem("hoshi_mode", mode);
  });

  $effect(() => {
    const el = contentEl;
    if (!content) return;
    if (!el) return;

    queueMicrotask(() => {
      charCount = getTotalChars(el);
      recalc();
      if (containerEl) {
        const step = pageStep();
        initializing = true;
        if (startAtEnd) {
          currentPage = totalPages - 1;
          containerEl.scrollLeft = isVert ? 0 : currentPage * step;
        } else if (isVert) {
          containerEl.scrollLeft = containerEl.scrollWidth;
          currentPage = 0;
        } else {
          containerEl.scrollLeft = 0;
          currentPage = 0;
        }
        requestAnimationFrame(() => requestAnimationFrame(() => { initializing = false; }));
      }
    });

    const ro = new ResizeObserver(() => recalc());
    ro.observe(el);

    return () => ro.disconnect();
  });

  // Recalc on settings change that affects layout
  $effect(() => { fontSize; lineHeight; hPadding; textIndent; recalc(); });
</script>

<svelte:window onkeydown={handleKey} />

<div class="rc" class:vert={isVert} class:hori={!isVert} class:pag={mode === "paginated"} class:scr={mode === "scroll"}>
  <div class="rh">
    <span>Ch.{chapterIndex + 1}/{totalChapters} | P.{currentPage + 1}/{totalPages} | {charCount}c</span>
    <div class="rh-btns">
      <button class="mb" onclick={() => showSettings = !showSettings}>{"⚙"}</button>
      <button class="mb" onclick={() => { mode = mode === "paginated" ? "scroll" : "paginated"; currentPage = 0; }}>{mode}</button>
    </div>
  </div>

  {#if showSettings}
    <div class="settings-panel">
      <label>Font Size <span>{fontSize}px</span>
        <input type="range" min=12 max=40 step=1 bind:value={fontSize} />
      </label>
      <label>Line Height <span>{lineHeight.toFixed(1)}</span>
        <input type="range" min=1.0 max=3.0 step=0.1 bind:value={lineHeight} />
      </label>
      <label>Margin <span>{hPadding}px</span>
        <input type="range" min=0 max=300 step=5 bind:value={hPadding} />
      </label>
      <label>Indent <span>{textIndent.toFixed(1)}em</span>
        <input type="range" min=0 max=4.0 step=0.5 bind:value={textIndent} />
      </label>
    </div>
  {/if}

  <div bind:this={containerEl} class="rv" onscroll={onScroll}>
    <div bind:this={contentEl} class="rct" class:vt={isVert} class:vp={mode === "paginated"} class:vs={mode === "scroll"} style={styleVars}>
      {@html content}
    </div>
  </div>
</div>

<style>
  .rc { display:flex; flex-direction:column; height:100vh; background:#1a1a1a; color:#ccc; }
  .rh { display:flex; justify-content:space-between; align-items:center; padding:3px 10px; font-size:10px; color:#888; background:#111; border-bottom:1px solid #333; flex-shrink:0; user-select:none; }
  .rh-btns { display:flex; gap:4px; }
  .mb { border:none; padding:2px 8px; background:#333; color:#aaa; border-radius:3px; font-size:9px; cursor:pointer; text-transform:uppercase; }
  .mb:hover { background:#444; }

  .settings-panel {
    display:flex; flex-direction:column; gap:6px; padding:8px 14px;
    background:#1a1a1a; border-bottom:1px solid #333; flex-shrink:0;
    font-size:11px; color:#aaa;
  }
  .settings-panel label {
    display:flex; align-items:center; gap:8px;
  }
  .settings-panel label span {
    min-width:48px; text-align:right; font-variant-numeric:tabular-nums;
  }
  .settings-panel input[type="range"] {
    flex:1; accent-color:#4a9; height:4px;
  }

  .rv { flex:1; overflow:hidden; }
  .rv:has(.vp) { overflow-x:auto; overflow-y:hidden; scroll-snap-type:x mandatory; }
  .rv:has(.vs) { overflow-y:auto; overflow-x:hidden; }
  .rct.vp { height:100%; scroll-snap-align:start; }

  .rct {
    font-size: var(--fs, 21px);
    line-height: var(--lh, 1.9);
    text-indent: var(--indent, 0);
  }
  .rct.vp.vt {
    writing-mode:vertical-rl;
    column-width:calc(100vw - var(--hp, 150px) * 2);
    column-gap:30px; column-fill:auto;
    padding:20px var(--hp, 150px);
    overflow-x:visible; width:max-content;
  }
  .rct.vp:not(.vt) {
    column-width:calc(100vw - var(--hp, 150px) * 2);
    column-gap:40px; column-fill:auto;
    padding:28px var(--hp, 150px);
    font-family:"Yu Mincho","Hiragino Mincho Pro","MS Mincho",serif;
    width:max-content;
  }
  .rct.vs.vt {
    writing-mode:vertical-rl;
    padding:28px var(--hp, 150px);
    overflow-y:hidden; overflow-x:auto;
  }
  .rct.vs:not(.vt) {
    padding:28px var(--hp, 150px);
    overflow-y:auto;
    font-family:"Yu Mincho","Hiragino Mincho Pro","MS Mincho",serif;
  }
  .rct :global(img) { max-width:100%; max-height:80vh; }
  .rct :global(ruby) { ruby-align:center; }
  .rct :global(rt) { font-size:0.5em; }
</style>