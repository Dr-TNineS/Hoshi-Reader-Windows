<script lang="ts">
  import Reader from "./Reader.svelte";
  import { countChars } from "../reader";
  import { readerAppearancePalette } from "../appearance";
  import {
    lookupHighlightText as renderedLookupHighlightTextFor,
    READER_LOOKUP_HIGHLIGHT,
  } from "../lookup-highlight";
  import type { ReaderProgress, ReaderSelection, SasayakiPlaybackCue } from "../types";

  const params = new URLSearchParams(window.location.search);
  const lookupHighlightMode = params.get("lookupHighlightMode") ?? "";
  const sasayakiMode = params.get("sasayakiMode") ?? "";
  const appearancePalette = readerAppearancePalette({ theme: params.get("theme") === "light" ? "light" : "dark" });

  const imageSvg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520">
      <rect width="360" height="520" fill="#202124"/>
      <rect x="36" y="36" width="288" height="448" fill="#d7d9dc"/>
      <text x="180" y="260" text-anchor="middle" font-family="serif" font-size="34" fill="#202124">Hoshi</text>
    </svg>
  `);

  type FixtureChapter = {
    html: string;
    charCount: number;
    startChars: number;
  };

  function chapterParagraphs(label: string, count: number) {
    const paragraphs = Array.from({ length: count }, (_, index) => {
      const mixed = index % 5 === 0
        ? " 日々○◯〻ぁゖゝゞァヺー０９ＡＺａｚｦﾝ⺀⿟㐀䶿一鿿𠀀𪛟𪜀𫜿𫝀𫠟𫠠𬺯𬺰𮯯𰀀𱍏𱍐𲎯"
        : "";
      const visible = `
      ${label}第${index + 1}段。星の読書室には、静かなページ送りと、縦書きの余白を確かめるための文章が並んでいる。
      これは視覚回帰チェック用の固定本文であり、章末の揃い、通常ページ、狭い画面での横溢れを測る。
      雨音のように同じ調子の文を少しずつ続け、十分なページ数を作る。${mixed}
    `;
      const html = `
    <p>
      ${label}第${index + 1}段。星の読書室には、静かなページ送りと、縦書きの余白を確かめるための文章が並んでいる。
      これは視覚回帰チェック用の固定本文であり、章末の揃い、通常ページ、狭い画面での横溢れを測る。
      <ruby>雨<rt>あめ</rt><rp>（</rp></ruby>音のように同じ調子の文を少しずつ続け、十分なページ数を作る。${mixed}
    </p>
  `;
      return { html, visible };
    });
    return {
      html: paragraphs.map((paragraph) => paragraph.html).join(""),
      text: paragraphs.map((paragraph) => paragraph.visible).join(""),
    };
  }

  function chapterContent(title: string, paragraphs: ReturnType<typeof chapterParagraphs>, includeImage = false) {
    const html = `
    <section class="main">
      <h1>${title}</h1>
      ${includeImage ? `
        <p class="align-center">
          <img src="data:image/svg+xml,${imageSvg}" alt="Reader visual probe cover" />
        </p>
      ` : ""}
      ${paragraphs.html}
    </section>
  `;
    return {
      html,
      charCount: countChars(`${title}${paragraphs.text}`),
    };
  }

  const chapterFixtures = [
    chapterContent("視覚回帰サンプル 一", chapterParagraphs("一章", 36), true),
    chapterContent("視覚回帰サンプル 二", chapterParagraphs("二章", 20)),
  ];
  const chapters: FixtureChapter[] = chapterFixtures.reduce<FixtureChapter[]>((acc, chapter) => {
    const startChars = acc.reduce((total, existing) => total + existing.charCount, 0);
    acc.push({ ...chapter, startChars });
    return acc;
  }, []);
  const totalBookChars = chapters.reduce((total, chapter) => total + chapter.charCount, 0);

  let chapterIndex = $state(0);
  let startAtEnd = $state(false);
  let lastProgress = $state<ReaderProgress | null>(null);
  let lastSelection = $state<ReaderSelection | null>(null);
  let lookupHighlightText = $state("");
  let lookupHighlightSignal = $state(0);
  let visibleSelectionText = $state("");
  let renderedLookupHighlightText = $state("");
  let renderedSasayakiHighlightText = $state("");
  let selectionCount = $state(0);
  let lookupGeneration = 0;
  const sasayakiCue: SasayakiPlaybackCue | null = sasayakiMode
    ? {
        id: "probe-cue",
        startTime: 10,
        endTime: 15,
        chapterIndex: 0,
        start: sasayakiMode === "reveal" ? Math.floor(chapters[0].charCount * 0.72) : 8,
        length: 8,
      }
    : null;

  function recordProgress(progress: ReaderProgress) {
    lastProgress = progress;
  }

  function recordSelection(selection: ReaderSelection | null) {
    const generation = ++lookupGeneration;
    lastSelection = selection;
    if (selection) selectionCount += 1;
    lookupHighlightText = "";
    lookupHighlightSignal += 1;
    if (selection && lookupHighlightMode === "prefix2") {
      window.setTimeout(() => {
        if (generation !== lookupGeneration) return;
        lookupHighlightText = Array.from(selection.text).slice(0, 2).join("");
        lookupHighlightSignal += 1;
      }, 120);
    }
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

  $effect(() => {
    lastSelection;
    const waitForHighlight = lookupHighlightText.length > 0;
    let secondFrame = 0;
    const syncSelection = () => {
      visibleSelectionText = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
      renderedLookupHighlightText = renderedLookupHighlightTextFor(READER_LOOKUP_HIGHLIGHT);
      const sasayakiLayer = document.querySelector<HTMLElement>(".sasayaki-highlight-layer");
      renderedSasayakiHighlightText = sasayakiLayer?.dataset.highlightText ?? "";
    };
    const firstFrame = requestAnimationFrame(() => {
      if (waitForHighlight) {
        secondFrame = requestAnimationFrame(syncSelection);
      } else {
        syncSelection();
      }
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  });
</script>

<Reader
  content={chapters[chapterIndex].html}
  {chapterIndex}
  chapterStartChars={chapters[chapterIndex].startChars}
  {totalBookChars}
  {startAtEnd}
  {appearancePalette}
  onNextChapter={nextChapter}
  onPrevChapter={previousChapterAtEnd}
  onPrevChapterDirect={previousChapterDirect}
  onProgressChange={recordProgress}
  onSelectionChange={recordSelection}
  lookupHighlightCount={Array.from(lookupHighlightText).length}
  {lookupHighlightSignal}
  {sasayakiCue}
  sasayakiReveal={sasayakiMode === "reveal"}
  sasayakiCueSignal={sasayakiMode ? 1 : 0}
/>

<div
  class="probe-state"
  aria-hidden="true"
  data-chapter-index={chapterIndex}
  data-progress={lastProgress?.chapterProgress ?? 0}
  data-chapter-read-chars={lastProgress?.chapterReadChars ?? 0}
  data-book-read-chars={lastProgress?.bookReadChars ?? 0}
  data-total-book-chars={lastProgress?.totalBookChars ?? totalBookChars}
  data-fixture-chapter-start={chapters[chapterIndex].startChars}
  data-fixture-chapter-count={chapters[chapterIndex].charCount}
  data-selection={lastSelection?.text ?? ""}
  data-dom-selection={visibleSelectionText}
  data-highlight-text={lookupHighlightText}
  data-rendered-highlight-text={renderedLookupHighlightText}
  data-sasayaki-highlight={renderedSasayakiHighlightText}
  data-sentence={lastSelection?.sentence ?? ""}
  data-selection-count={selectionCount}
  data-anchor-x={lastSelection?.anchorRect?.x ?? lastSelection?.rect.x ?? -1}
  data-anchor-y={lastSelection?.anchorRect?.y ?? lastSelection?.rect.y ?? -1}
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
