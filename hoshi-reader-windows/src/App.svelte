<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import Reader from "./lib/reader/Reader.svelte";
  import type { EpubMeta, TextDirection } from "./lib/types";

  let view = $state<"bookshelf" | "reader">("bookshelf");
  let meta = $state<EpubMeta | null>(null);
  let chapterHtml = $state("");
  let chapterIndex = $state(0);
  let direction = $state<TextDirection>("vertical");
  let startAtEnd = $state(false);
  let error = $state("");
  let debug = $state("");

  // Restore session on page load (handles refresh)
  $effect(() => {
    const saved = localStorage.getItem("hoshi_session");
    if (saved && view === "bookshelf") {
      (async () => {
        try {
          const session = JSON.parse(saved);
          debug = "Restoring...";
          meta = await invoke<EpubMeta>("epub_open", { path: session.path });
          chapterIndex = session.chapter;
          chapterHtml = await invoke<string>("epub_read_chapter", { spineIndex: chapterIndex });
          view = "reader";
          debug = "Restored";
        } catch (e) { localStorage.removeItem("hoshi_session"); }
      })();
    }
  });

  function saveSession(path: string, ch: number) {
    localStorage.setItem("hoshi_session", JSON.stringify({ path, chapter: ch }));
  }

  async function openBook() {
    error = ""; debug = "Opening...";
    try {
      const path = "C:/Users/Wxm/Documents/EBooks/娱乐型/Novels/かがみの孤城 (辻村深月) (z-library.sk, 1lib.sk, z-lib.sk).epub";
      meta = await invoke<EpubMeta>("epub_open", { path });
      debug = `${meta.title} | ${meta.spine.length}ch`;
      await loadChapter(0);
      saveSession(path, 0);
      view = "reader";
    } catch (e) { error = String(e); debug = "Err"; }
  }

  async function loadChapter(idx: number) {
    if (!meta) return;
    try {
      chapterHtml = await invoke<string>("epub_read_chapter", { spineIndex: idx });
      chapterIndex = idx;
      if (meta) saveSession("C:/Users/Wxm/Documents/EBooks/娱乐型/Novels/かがみの孤城 (辻村深月) (z-library.sk, 1lib.sk, z-lib.sk).epub", idx);
      debug = `Ch${idx + 1}/${meta.spine.length}`;
    } catch (e) { error = String(e); }
  }

  function prevChapter() { if (chapterIndex > 0) { startAtEnd = true; loadChapter(chapterIndex - 1); } }
  function prevChapterDirect() { if (chapterIndex > 0) { startAtEnd = false; loadChapter(chapterIndex - 1); } }
  function nextChapter() { startAtEnd = false; if (meta && chapterIndex < meta.spine.length - 1) loadChapter(chapterIndex + 1); }
  function toggleDirection() { direction = direction === "vertical" ? "horizontal" : "vertical"; }
</script>

<main class="app">
  {#if view === "bookshelf"}
    <div class="bookshelf">
      <h1>Hoshi Reader</h1>
      <p class="subtitle">Lightweight Japanese EPUB Reader</p>
      <button class="ob" onclick={openBook}> Open EPUB </button>
      {#if error}<p class="err">{error}</p>{/if}
      <p class="keys">arrow:page | M:mode | V:dir | Ctrl+arrow:chapter | Esc:shelf</p>
    </div>
  {:else}
    <Reader
      content={chapterHtml}
      {direction}
      {chapterIndex}
      totalChapters={meta?.spine.length ?? 0}
      onPrevChapter={prevChapter}
      onPrevChapterDirect={prevChapterDirect}
      onNextChapter={nextChapter}
      onBackToShelf={() => view = "bookshelf"}
      {startAtEnd}
    />
    <div class="ctrls">
      <button onclick={prevChapterDirect}>Ch?</button>
      <span>Ch.{chapterIndex + 1}/{meta?.spine.length ?? 0}</span>
      <button onclick={nextChapter}>Ch?</button>
      <button onclick={toggleDirection}>{direction === "vertical" ? "V" : "H"}</button>
      <button onclick={() => view = "bookshelf"}>Esc</button>
    </div>
  {/if}
  {#if debug}<div class="dbg">{debug}</div>{/if}
</main>

<style>
  :global(*){margin:0;padding:0;box-sizing:border-box}
  :global(body){background:#2d2d2d;color:#e0e0e0;font-family:"Segoe UI",sans-serif;overflow:hidden}
  .app{width:100vw;height:100vh}
  .dbg{position:fixed;top:0;right:0;z-index:9999;padding:2px 10px;font-size:11px;background:rgba(0,150,0,0.8);color:#fff;border-radius:0 0 0 4px;pointer-events:none}
  .bookshelf{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px}
  h1{font-size:32px;font-weight:300;letter-spacing:4px;color:#fff}
  .subtitle{color:#888;font-size:14px}
  .ob{margin-top:32px;padding:12px 32px;font-size:16px;background:#4a9;color:#fff;border:none;border-radius:4px;cursor:pointer}
  .ob:hover{background:#5ba}
  .err{color:#e55;font-size:13px;max-width:500px;text-align:center;white-space:pre-wrap}
  .keys{margin-top:24px;font-size:12px;color:#666}
  .ctrls{position:fixed;bottom:0;left:0;right:0;display:flex;align-items:center;justify-content:center;gap:6px;padding:5px;background:#111;border-top:1px solid #333;z-index:100}
  .ctrls button{padding:4px 10px;background:#333;color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px}
  .ctrls button:hover{background:#444}
  .ctrls span{font-size:12px;color:#888}
</style>