<script lang="ts">
  import { convertFileSrc, invoke, isTauri as isTauriRuntime } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import Reader from "./lib/reader/Reader.svelte";
  import type { EpubMeta, TocNode } from "./lib/types";

  type SavedSession = {
    path: string;
    chapter: number;
  };

  type BookRecord = {
    path: string;
    title: string;
    chapter: number;
    totalChapters: number;
    lastOpened: number;
  };

  type TocEntry = {
    label: string;
    href: string | null;
    level: number;
    chapterIndex: number | null;
  };

  const BOOKS_KEY = "hoshi_books";
  const SESSION_KEY = "hoshi_session";
  const MAX_BOOKS = 12;

  function readJson<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) as T : fallback;
    } catch {
      return fallback;
    }
  }

  function fileName(path: string): string {
    return path.split(/[\\/]/).pop()?.replace(/\.epub$/i, "") || "Untitled";
  }

  function clampChapter(chapter: number, total: number): number {
    return Math.max(0, Math.min(chapter, Math.max(0, total - 1)));
  }

  function normalizeHref(href: string): string {
    return decodeURI(href)
      .split("#")[0]
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
  }

  function isExternalAssetUrl(url: string): boolean {
    return /^(?:[a-z][a-z0-9+.-]*:|#|data:|blob:)/i.test(url);
  }

  function isInternalChapterHref(href: string): boolean {
    const path = href.split("#")[0];
    return /\.(?:x?html?|xht)$/i.test(path);
  }

  function chapterDir(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    return normalized.slice(0, normalized.lastIndexOf("/"));
  }

  function resolveAssetPath(baseFile: string, assetUrl: string): string {
    const parts = `${chapterDir(baseFile)}/${decodeUrlPath(assetUrl)}`.replace(/\\/g, "/").split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (!part || part === ".") continue;
      if (part === "..") resolved.pop();
      else resolved.push(part);
    }
    const prefix = /^[A-Za-z]:\//.test(resolved.join("/")) ? "" : "/";
    return `${prefix}${resolved.join("/")}`;
  }

  function splitUrlSuffix(url: string): { path: string; suffix: string } {
    const query = url.indexOf("?");
    const hash = url.indexOf("#");
    const cut = [query, hash].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
    return cut === undefined
      ? { path: url, suffix: "" }
      : { path: url.slice(0, cut), suffix: url.slice(cut) };
  }

  function decodeUrlPath(path: string): string {
    try {
      return decodeURI(path);
    } catch {
      return path;
    }
  }

  function resolveAssetUrl(baseFile: string, assetUrl: string): string {
    const { path, suffix } = splitUrlSuffix(assetUrl);
    return `${convertFileSrc(resolveAssetPath(baseFile, path))}${suffix}`;
  }

  function rewriteUrlAttribute(el: Element, attr: string, chapterPath: string) {
    const value = el.getAttribute(attr);
    if (!value || isExternalAssetUrl(value)) return;
    if (attr === "href" && isInternalChapterHref(value)) {
      el.setAttribute("data-epub-href", value);
      el.setAttribute("href", "#");
      return;
    }
    const resolved = resolveAssetUrl(chapterPath, value);
    el.setAttribute(attr, resolved);
    if (attr === "xlink:href") {
      el.setAttribute("href", resolved);
      el.setAttributeNS("http://www.w3.org/1999/xlink", "href", resolved);
    }
  }

  function rewriteSrcsetAttribute(el: Element, chapterPath: string) {
    const value = el.getAttribute("srcset");
    if (!value) return;
    const rewritten = value
      .split(",")
      .map((candidate) => {
        const parts = candidate.trim().split(/\s+/);
        const url = parts.shift();
        if (!url || isExternalAssetUrl(url)) return candidate.trim();
        return [resolveAssetUrl(chapterPath, url), ...parts].join(" ");
      })
      .join(", ");
    el.setAttribute("srcset", rewritten);
  }

  function replaceSingleImageSvgs(doc: Document, chapterPath: string) {
    doc.querySelectorAll("svg").forEach((svg) => {
      const images = Array.from(svg.querySelectorAll("image"));
      if (images.length !== 1) return;
      if (Array.from(svg.children).some((child) => child.localName.toLowerCase() !== "image")) return;

      const image = images[0];
      const src = image.getAttribute("href") ?? image.getAttribute("xlink:href");
      if (!src) return;

      const img = doc.createElement("img");
      img.setAttribute("src", isExternalAssetUrl(src) ? src : resolveAssetUrl(chapterPath, src));
      img.setAttribute("class", "epub-svg-cover-img");
      img.setAttribute("loading", "eager");
      img.setAttribute("decoding", "sync");
      svg.replaceWith(img);
    });
  }

  function resolveChapterAssets(html: string, chapterPath: string | null): string {
    if (!chapterPath) return html;
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("[src]").forEach((el) => rewriteUrlAttribute(el, "src", chapterPath));
    doc.querySelectorAll("[srcset]").forEach((el) => rewriteSrcsetAttribute(el, chapterPath));
    doc.querySelectorAll("[href]").forEach((el) => rewriteUrlAttribute(el, "href", chapterPath));
    doc.querySelectorAll("[poster]").forEach((el) => rewriteUrlAttribute(el, "poster", chapterPath));
    doc.querySelectorAll("[xlink\\:href]").forEach((el) => rewriteUrlAttribute(el, "xlink:href", chapterPath));
    replaceSingleImageSvgs(doc, chapterPath);
    doc.querySelectorAll("img.gaiji").forEach((el) => {
      el.setAttribute("width", "1");
      el.setAttribute("height", "1");
      el.setAttribute("loading", "eager");
      el.setAttribute("decoding", "sync");
    });
    doc.querySelectorAll("img.gaiji-line").forEach((el) => {
      el.setAttribute("width", "1");
      el.setAttribute("loading", "eager");
      el.setAttribute("decoding", "sync");
    });
    const bodyClasses = Array.from(doc.body.classList)
      .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
      .map((name) => `epub-body-${name}`)
      .join(" ");
    const bodyId = doc.body.id ? ` data-epub-body-id="${doc.body.id.replace(/"/g, "&quot;")}"` : "";
    return `<div class="epub-body ${bodyClasses}"${bodyId}>${doc.body.innerHTML}</div>`;
  }

  function findChapterIndex(bookMeta: EpubMeta, href: string | null): number | null {
    if (!href) return null;
    const target = normalizeHref(href);
    const manifestById = new Map(bookMeta.manifest.map((item) => [item.id, normalizeHref(item.href)]));
    const spineHrefs = bookMeta.spine.map((item) => manifestById.get(item.idref) ?? "");
    const exact = spineHrefs.findIndex((spineHref) => spineHref === target);
    if (exact >= 0) return exact;
    const suffix = spineHrefs.findIndex(
      (spineHref) => spineHref.endsWith(`/${target}`) || target.endsWith(`/${spineHref}`)
    );
    return suffix >= 0 ? suffix : null;
  }

  function flattenToc(nodes: TocNode[], bookMeta: EpubMeta, level = 0): TocEntry[] {
    return nodes.flatMap((node) => [
      {
        label: node.label,
        href: node.href,
        level,
        chapterIndex: findChapterIndex(bookMeta, node.href),
      },
      ...flattenToc(node.children, bookMeta, level + 1),
    ]);
  }

  let view = $state<"bookshelf" | "reader">("bookshelf");
  let meta = $state<EpubMeta | null>(null);
  let chapterHtml = $state("");
  let chapterIndex = $state(0);
  let currentBookPath = $state("");
  let books = $state<BookRecord[]>(readJson<BookRecord[]>(BOOKS_KEY, []));
  let startAtEnd = $state(false);
  let showToc = $state(false);
  let error = $state("");
  let debug = $state("");
  let triedRestore = false;

  let tocEntries = $derived(meta ? flattenToc(meta.toc, meta) : []);

  // Restore the last reader session once on page load. Returning to the shelf
  // should stay on the shelf, so this effect is intentionally one-shot.
  $effect(() => {
    if (triedRestore) return;
    triedRestore = true;

    const saved = localStorage.getItem(SESSION_KEY);
    if (saved && view === "bookshelf" && isTauriRuntime()) {
      (async () => {
        try {
          const session = JSON.parse(saved) as SavedSession;
          await openBookPath(session.path, session.chapter, "Restoring...");
          debug = "Restored";
        } catch (e) {
          localStorage.removeItem(SESSION_KEY);
          error = String(e);
          debug = "Restore failed";
        }
      })();
    }
  });

  function persistBooks(nextBooks: BookRecord[]) {
    books = nextBooks;
    localStorage.setItem(BOOKS_KEY, JSON.stringify(nextBooks));
  }

  function saveProgress(path: string, bookMeta: EpubMeta, chapter: number) {
    const totalChapters = bookMeta.spine.length;
    const safeChapter = clampChapter(chapter, totalChapters);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ path, chapter: safeChapter }));

    const record: BookRecord = {
      path,
      title: bookMeta.title || fileName(path),
      chapter: safeChapter,
      totalChapters,
      lastOpened: Date.now(),
    };
    const nextBooks = [
      record,
      ...books.filter((book) => book.path !== path),
    ].slice(0, MAX_BOOKS);
    persistBooks(nextBooks);
  }

  async function openBookPath(path: string, chapter = 0, status = "Opening...") {
    error = "";
    debug = status;
    if (!isTauriRuntime()) {
      error = "Not inside Tauri. Use `npx tauri dev`.";
      debug = "Browser";
      return;
    }

    currentBookPath = path;
    meta = await invoke<EpubMeta>("epub_open", { path });
    const safeChapter = clampChapter(chapter, meta.spine.length);
    await loadChapter(safeChapter);
    saveProgress(path, meta, safeChapter);
    view = "reader";
  }

  async function openBook() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "EPUB", extensions: ["epub"] }],
      });
      if (!selected) {
        debug = "Cancelled";
        return;
      }
      await openBookPath(selected, 0);
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function continueBook(book: BookRecord) {
    try {
      startAtEnd = false;
      await openBookPath(book.path, book.chapter, "Loading...");
    } catch (e) {
      error = String(e);
      debug = "Err";
    }
  }

  async function loadChapter(idx: number) {
    if (!meta || !isTauriRuntime()) return;

    try {
      const safeIndex = clampChapter(idx, meta.spine.length);
      const [rawHtml, chapterPath] = await Promise.all([
        invoke<string>("epub_read_chapter", { spineIndex: safeIndex }),
        invoke<string | null>("epub_get_chapter_path", { spineIndex: safeIndex }),
      ]);
      chapterHtml = resolveChapterAssets(rawHtml, chapterPath);
      chapterIndex = safeIndex;
      if (currentBookPath) saveProgress(currentBookPath, meta, safeIndex);
      debug = `Ch${safeIndex + 1}/${meta.spine.length}`;
    } catch (e) {
      error = String(e);
    }
  }

  async function jumpToChapter(idx: number) {
    startAtEnd = false;
    showToc = false;
    await loadChapter(idx);
  }

  async function navigateReaderHref(href: string) {
    if (!meta) return;

    const idx = findChapterIndex(meta, href);
    if (idx === null) {
      debug = "Link target not found";
      return;
    }

    startAtEnd = false;
    showToc = false;
    await loadChapter(idx);
  }

  function prevChapter() {
    if (chapterIndex > 0) {
      startAtEnd = true;
      loadChapter(chapterIndex - 1);
    }
  }

  function prevChapterDirect() {
    if (chapterIndex > 0) {
      startAtEnd = false;
      loadChapter(chapterIndex - 1);
    }
  }

  function nextChapter() {
    startAtEnd = false;
    if (meta && chapterIndex < meta.spine.length - 1) loadChapter(chapterIndex + 1);
  }

  function progressLabel(book: BookRecord): string {
    if (book.totalChapters <= 0) return "No chapters";
    return `Ch.${book.chapter + 1}/${book.totalChapters}`;
  }

  function openedLabel(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
  }

</script>

<main class="app">
  {#if view === "bookshelf"}
    <section class="bookshelf">
      <div class="shelf-head">
        <div>
          <h1>Hoshi Reader</h1>
          <p class="subtitle">Lightweight Japanese EPUB Reader</p>
        </div>
        <button class="ob" onclick={openBook}>Open EPUB</button>
      </div>

      {#if error}<p class="err">{error}</p>{/if}

      <div class="recent">
        <h2>Recent Books</h2>
        {#if books.length === 0}
          <p class="empty">No recent books yet.</p>
        {:else}
          <div class="book-list">
            {#each books as book (book.path)}
              <button class="book-row" onclick={() => continueBook(book)}>
                <span class="book-title">{book.title}</span>
                <span class="book-meta">{progressLabel(book)} | {openedLabel(book.lastOpened)}</span>
                <span class="book-path">{book.path}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <p class="keys">arrow:page | Ctrl+arrow:chapter | Esc:shelf</p>
    </section>
  {:else}
    <Reader
      content={chapterHtml}
      {chapterIndex}
      totalChapters={meta?.spine.length ?? 0}
      onPrevChapter={prevChapter}
      onPrevChapterDirect={prevChapterDirect}
      onNextChapter={nextChapter}
      onNavigateHref={navigateReaderHref}
      onBackToShelf={() => view = "bookshelf"}
      {startAtEnd}
    />
    {#if showToc}
      <aside class="toc-panel">
        <div class="toc-head">
          <h2>Contents</h2>
          <button onclick={() => showToc = false}>Close</button>
        </div>
        {#if tocEntries.length === 0}
          <p class="empty">No table of contents.</p>
        {:else}
          <div class="toc-list">
            {#each tocEntries as entry}
              <button
                class="toc-row"
                class:active={entry.chapterIndex === chapterIndex}
                disabled={entry.chapterIndex === null}
                style={`--level:${entry.level}`}
                onclick={() => entry.chapterIndex !== null && jumpToChapter(entry.chapterIndex)}
              >
                {entry.label}
              </button>
            {/each}
          </div>
        {/if}
      </aside>
    {/if}
    <div class="ctrls">
      <button onclick={prevChapterDirect}>Prev Ch</button>
      <span>Ch.{chapterIndex + 1}/{meta?.spine.length ?? 0}</span>
      <button onclick={nextChapter}>Next Ch</button>
      <button onclick={() => showToc = !showToc}>TOC</button>
      <button onclick={() => view = "bookshelf"}>Esc</button>
    </div>
  {/if}
</main>

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { background: #202124; color: #e8eaed; font-family: "Segoe UI", sans-serif; overflow: hidden; }
  .app { width: 100vw; height: 100vh; }
  .bookshelf { width: min(920px, calc(100vw - 48px)); height: 100vh; margin: 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
  .shelf-head { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
  h1 { font-size: 32px; font-weight: 300; letter-spacing: 4px; color: #fff; }
  h2 { font-size: 13px; font-weight: 600; color: #9aa0a6; text-transform: uppercase; }
  .subtitle { margin-top: 6px; color: #9aa0a6; font-size: 14px; }
  .ob { flex-shrink: 0; padding: 10px 22px; font-size: 14px; background: #3b8f78; color: #fff; border: none; border-radius: 4px; cursor: pointer; }
  .ob:hover { background: #46a187; }
  .err { color: #ff8a80; font-size: 13px; white-space: pre-wrap; }
  .recent { display: flex; flex-direction: column; gap: 10px; min-height: 240px; }
  .empty { padding: 28px 0; color: #80868b; font-size: 13px; }
  .book-list { display: flex; flex-direction: column; gap: 8px; max-height: 54vh; overflow-y: auto; padding-right: 4px; }
  .book-row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 4px 16px; padding: 12px 14px; text-align: left; background: #2b2d31; color: inherit; border: 1px solid #3c4043; border-radius: 6px; cursor: pointer; }
  .book-row:hover { background: #32363b; border-color: #5f6368; }
  .book-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; color: #f1f3f4; }
  .book-meta { white-space: nowrap; font-size: 12px; color: #9aa0a6; }
  .book-path { grid-column: 1 / -1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #80868b; }
  .keys { margin-top: 2px; font-size: 12px; color: #6f7479; }
  .toc-panel { position: fixed; top: 28px; right: 18px; bottom: 44px; z-index: 110; width: min(380px, calc(100vw - 36px)); display: flex; flex-direction: column; background: #202124; border: 1px solid #3c4043; border-radius: 6px; box-shadow: 0 16px 44px rgba(0, 0, 0, 0.45); }
  .toc-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid #3c4043; }
  .toc-head button { padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .toc-list { display: flex; flex-direction: column; overflow-y: auto; padding: 8px; }
  .toc-row { width: 100%; padding: 8px 10px 8px calc(10px + var(--level) * 16px); text-align: left; background: transparent; color: #d7d9dc; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .toc-row:hover { background: #303134; }
  .toc-row.active { background: #315c50; color: #fff; }
  .toc-row:disabled { color: #686d72; cursor: default; }
  .toc-row:disabled:hover { background: transparent; }
  .ctrls { position: fixed; bottom: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 5px; background: #111; border-top: 1px solid #333; z-index: 100; }
  .ctrls button { padding: 4px 10px; background: #333; color: #ccc; border: 1px solid #555; border-radius: 3px; cursor: pointer; font-size: 12px; }
  .ctrls button:hover { background: #444; }
  .ctrls span { font-size: 12px; color: #888; }
</style>
