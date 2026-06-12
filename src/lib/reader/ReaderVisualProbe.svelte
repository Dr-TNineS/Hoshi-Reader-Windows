<script lang="ts">
  import Reader from "./Reader.svelte";
  import type { ReaderProgress, ReaderSelection } from "../types";

  const imageSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
      <rect width="360" height="520" fill="#202124"/>
      <rect x="36" y="36" width="288" height="448" fill="#d7d9dc"/>
      <text x="180" y="260" text-anchor="middle" font-family="serif" font-size="34" fill="#202124">Hoshi</text>
    </svg>
  `);

  function chapterParagraphs(label: string, count: number) {
    return Array.from({ length: count }, (_, index) => `
    <p>
      ${label}第${index + 1}段。星の読書室には、静かなページ送りと、縦書きの余白を確かめるための文章が並んでいる。
      これは視覚回帰チェック用の固定本文であり、章末の揃い、通常ページ、狭い画面での横溢れを測る。
      雨音のように同じ調子の文を少しずつ続け、十分なページ数を作る。
    </p>
  `).join("");
  }

  function chapterContent(title: string, paragraphs: string, includeImage = false) {
    return `
    <section class="main">
      <h1>${title}</h1>
      ${includeImage ? `
        <p class="align-center">
          <img src="data:image/svg+xml,${imageSvg}" alt="Reader visual probe cover" />
        </p>
      ` : ""}
      ${paragraphs}
    </section>
  `;
  }

  const chapters = [
    chapterContent("視覚回帰サンプル 一", chapterParagraphs("一章", 36), true),
    chapterContent("視覚回帰サンプル 二", chapterParagraphs("二章", 20)),
  ];

  let chapterIndex = $state(0);
  let startAtEnd = $state(false);
  let lastProgress = $state<ReaderProgress | null>(null);
  let lastSelection = $state<ReaderSelection | null>(null);

  function recordProgress(progress: ReaderProgress) {
    lastProgress = progress;
  }

  function recordSelection(selection: ReaderSelection | null) {
    lastSelection = selection;
  }

  function nextChapter() {
    if (chapterIndex >= chapters.length - 1) return;
    startAtEnd = false;
    chapterIndex += 1;
  }

  function previousChapterAtEnd() {
    if (chapterIndex <= 0) return;
    startAtEnd = true;
    chapterIndex -= 1;
  }

  function previousChapterDirect() {
    if (chapterIndex <= 0) return;
    startAtEnd = false;
    chapterIndex -= 1;
  }
</script>

<Reader
  content={chapters[chapterIndex]}
  {chapterIndex}
  totalChapters={chapters.length}
  totalBookChars={3600}
  {startAtEnd}
  onNextChapter={nextChapter}
  onPrevChapter={previousChapterAtEnd}
  onPrevChapterDirect={previousChapterDirect}
  onProgressChange={recordProgress}
  onSelectionChange={recordSelection}
/>

<div
  class="probe-state"
  aria-hidden="true"
  data-chapter-index={chapterIndex}
  data-progress={lastProgress?.chapterProgress ?? 0}
  data-selection={lastSelection?.text ?? ""}
>
  {lastProgress?.chapterReadChars ?? 0}:{lastSelection?.text ?? ""}
</div>

<style>
  .probe-state {
    position: fixed;
    right: 0;
    bottom: 0;
    width: 1px;
    height: 1px;
    overflow: hidden;
    opacity: 0;
    pointer-events: none;
  }
</style>
