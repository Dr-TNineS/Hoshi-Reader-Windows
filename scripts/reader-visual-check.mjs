import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_READER_VISUAL_PORT || 5174);
const origin = `http://127.0.0.1:${port}`;
const url = `${origin}/?readerVisualProbe=1`;

function assert(condition, message, details = {}) {
  if (!condition) {
    const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function waitForServer(proc) {
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite did not become ready.\n${output}`)), 30000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (output.includes("ready in")) {
        clearTimeout(timer);
        resolve();
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
  });

  const exit = once(proc, "exit").then(([code]) => {
    throw new Error(`Vite exited before ready with code ${code}.\n${output}`);
  });

  await Promise.race([ready, exit]);
}

function stopServer(proc) {
  if (proc.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  proc.kill();
}

async function readerMetrics(page) {
  await page.locator(".rv.ready").waitFor({ timeout: 10000 });
  return page.evaluate(() => {
    const rv = document.querySelector(".rv");
    const rct = document.querySelector(".rct");
    if (!(rv instanceof HTMLElement) || !(rct instanceof HTMLElement)) {
      throw new Error("Reader viewport/content elements not found.");
    }

    const style = getComputedStyle(rct);
    const pageSize = rv.clientHeight;
    const rawLimit = Math.max(0, rct.scrollHeight - pageSize);
    const contentMaxScroll = Math.ceil(Math.max(0, rawLimit - 1) / pageSize) * pageSize;
    const scrollLimit = Math.max(0, rv.scrollHeight - rv.clientHeight);
    const totalPages = Math.max(1, Math.round(contentMaxScroll / pageSize) + 1);
    const blockImage = rct.querySelector("img.block-img");
    const blockImageRect = blockImage?.getBoundingClientRect();

    function visibleTextMinTop(scrollTop) {
      rv.scrollTop = scrollTop;
      const viewport = rv.getBoundingClientRect();
      const walker = document.createTreeWalker(rct, NodeFilter.SHOW_TEXT);
      const tops = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (rect.width <= 0 || rect.height <= 0) continue;
          if (rect.bottom > viewport.top + 1 && rect.top < viewport.bottom - 1) {
            tops.push(Math.round(rect.top));
          }
        }
        range.detach();
      }
      return tops.length ? Math.min(...tops) : null;
    }

    const previousPageTop = visibleTextMinTop(Math.max(0, contentMaxScroll - pageSize));
    const lastPageTop = visibleTextMinTop(contentMaxScroll);

    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageSize,
      totalPages,
      rawLimit,
      contentMaxScroll,
      scrollLimit,
      paddingLeft: Number.parseFloat(style.paddingLeft),
      paddingRight: Number.parseFloat(style.paddingRight),
      writingMode: style.writingMode,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      previousPageTop,
      lastPageTop,
      blockImage: blockImageRect
        ? {
            width: Math.round(blockImageRect.width),
            height: Math.round(blockImageRect.height),
          }
        : null,
    };
  });
}

async function probeChapterIndex(page) {
  const value = await page.locator(".probe-state").getAttribute("data-chapter-index");
  return Number(value);
}

async function probeProgressState(page) {
  const state = page.locator(".probe-state");
  return {
    chapterIndex: Number(await state.getAttribute("data-chapter-index") ?? 0),
    chapterProgress: Number(await state.getAttribute("data-progress") ?? 0),
    chapterReadChars: Number(await state.getAttribute("data-chapter-read-chars") ?? 0),
    bookReadChars: Number(await state.getAttribute("data-book-read-chars") ?? 0),
    totalBookChars: Number(await state.getAttribute("data-total-book-chars") ?? 0),
    fixtureChapterStart: Number(await state.getAttribute("data-fixture-chapter-start") ?? 0),
    fixtureChapterCount: Number(await state.getAttribute("data-fixture-chapter-count") ?? 0),
    header: await page.locator(".rh").textContent() ?? "",
  };
}

async function waitForProbeChapter(page, chapterIndex) {
  await page.waitForFunction(
    (expected) => document.querySelector(".probe-state")?.getAttribute("data-chapter-index") === String(expected),
    chapterIndex,
    { timeout: 10000 },
  );
}

async function paginationState(page) {
  await page.locator(".rv.ready").waitFor({ timeout: 10000 });
  return page.evaluate(() => {
    const rv = document.querySelector(".rv");
    if (!(rv instanceof HTMLElement)) {
      throw new Error("Reader viewport element not found.");
    }

    const pageSize = rv.clientHeight;
    const scrollTop = rv.scrollTop;
    const snappedScroll = Math.round(scrollTop / pageSize) * pageSize;
    return {
      header: document.querySelector(".rh")?.textContent?.trim() ?? "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageSize,
      scrollTop,
      snappedScroll,
      snapDelta: Math.abs(scrollTop - snappedScroll),
    };
  });
}

async function waitForPageIndex(page, pageIndex) {
  await page.waitForFunction(
    (expected) => {
      const rv = document.querySelector(".rv");
      return rv instanceof HTMLElement && Math.round(rv.scrollTop / rv.clientHeight) === expected;
    },
    pageIndex,
    { timeout: 10000 },
  );
}

async function visibleParagraphPoint(page) {
  return await page.evaluate(() => {
    const rv = document.querySelector(".rv");
    const rct = document.querySelector(".rct");
    if (!(rv instanceof HTMLElement) || !(rct instanceof HTMLElement)) {
      throw new Error("Reader viewport/content elements not found.");
    }

    const viewport = rv.getBoundingClientRect();
    for (const paragraph of rct.querySelectorAll("p")) {
      if (paragraph.hasAttribute("data-offset-probe")) continue;
      if (paragraph.hasAttribute("data-ruby-highlight-probe")) continue;
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.textContent?.trim()) continue;

        const text = node.textContent ?? "";
        for (let offset = 0; offset < text.length; offset += 1) {
          if (/\s/.test(text[offset])) continue;

          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const rect = Array.from(range.getClientRects()).find((candidate) => (
            candidate.width > 0 &&
            candidate.height > 0 &&
            candidate.bottom > viewport.top + 10 &&
            candidate.top < viewport.bottom - 10 &&
            candidate.right > viewport.left + 10 &&
            candidate.left < viewport.right - 10
          ));
          range.detach();

          if (rect) {
            return {
              x: rect.left + rect.width / 2,
              y: rect.top + rect.height / 2,
              text: node.textContent.slice(0, 40),
            };
          }
        }
      }
    }

    throw new Error("No visible paragraph text found.");
  });
}

async function offsetProbePoint(page) {
  return page.evaluate(() => {
    function inRange(value, start, end) {
      return value >= start && value <= end;
    }
    function isReaderMatchableCodePoint(codePoint) {
      return inRange(codePoint, 0x30, 0x39) ||
        inRange(codePoint, 0x41, 0x5a) ||
        inRange(codePoint, 0x61, 0x7a) ||
        codePoint === 0x25cb ||
        codePoint === 0x25ef ||
        inRange(codePoint, 0x3005, 0x3007) ||
        codePoint === 0x303b ||
        inRange(codePoint, 0x3041, 0x3096) ||
        inRange(codePoint, 0x309d, 0x309e) ||
        inRange(codePoint, 0x30a1, 0x30fa) ||
        codePoint === 0x30fc ||
        inRange(codePoint, 0xff10, 0xff19) ||
        inRange(codePoint, 0xff21, 0xff3a) ||
        inRange(codePoint, 0xff41, 0xff5a) ||
        inRange(codePoint, 0xff66, 0xff9d) ||
        inRange(codePoint, 0x2e80, 0x2fdf) ||
        inRange(codePoint, 0x3400, 0x4dbf) ||
        inRange(codePoint, 0x4e00, 0x9fff) ||
        inRange(codePoint, 0x20000, 0x2a6df) ||
        inRange(codePoint, 0x2a700, 0x2b73f) ||
        inRange(codePoint, 0x2b740, 0x2b81f) ||
        inRange(codePoint, 0x2b820, 0x2ceaf) ||
        inRange(codePoint, 0x2ceb0, 0x2ebef) ||
        inRange(codePoint, 0x30000, 0x3134f) ||
        inRange(codePoint, 0x31350, 0x323af);
    }
    function countChars(text) {
      let count = 0;
      for (const ch of text) {
        if (isReaderMatchableCodePoint(ch.codePointAt(0))) count += 1;
      }
      return count;
    }

    const paragraph = document.querySelector("[data-offset-probe]");
    const h1 = document.querySelector(".rct h1");
    const precedingRubyProbeChars = countChars("優しい微笑みを見た");
    if (!(paragraph instanceof HTMLElement) || !(h1 instanceof HTMLElement)) {
      throw new Error("Offset probe fixture not found.");
    }
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest("rt, rp")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? "";
      const index = text.indexOf("後");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + "後".length);
      const rect = range.getBoundingClientRect();
      range.detach();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        rubyProbeChars: precedingRubyProbeChars,
        expectedOffset: countChars(h1.textContent ?? "") + countChars("始母"),
        domOffset: Array.from(`${h1.textContent ?? ""}${paragraph.textContent ?? ""}`.split("後")[0]).length,
      };
    }
    throw new Error("Offset probe target was not found.");
  });
}

async function rubyHighlightProbePoint(page) {
  return page.evaluate(() => {
    const paragraph = document.querySelector("[data-ruby-highlight-probe]");
    if (!(paragraph instanceof HTMLElement)) {
      throw new Error("Ruby highlight probe fixture not found.");
    }
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.parentElement?.closest("rt, rp")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
    });
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? "";
      const index = text.indexOf("優");
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + "優".length);
      const rect = range.getBoundingClientRect();
      range.detach();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    throw new Error("Ruby highlight probe target was not found.");
  });
}

async function probeSelectionText(page) {
  return await page.locator(".probe-state").getAttribute("data-selection") ?? "";
}

async function probeSelectionChapterOffset(page) {
  return Number(await page.locator(".probe-state").getAttribute("data-selection-chapter-offset") ?? -1);
}

async function probeDomSelectionText(page) {
  return await page.locator(".probe-state").getAttribute("data-dom-selection") ?? "";
}

async function probeHighlightText(page) {
  return await page.locator(".probe-state").getAttribute("data-highlight-text") ?? "";
}

async function probeRenderedHighlightText(page) {
  return await page.locator(".probe-state").getAttribute("data-rendered-highlight-text") ?? "";
}

async function readerLookupHighlightState(page) {
  return page.evaluate(() => {
    const highlight = CSS.highlights?.get("hsw-reader-lookup-selection");
    const ranges = [];
    if (highlight?.forEach) {
      highlight.forEach((range) => ranges.push(range));
    } else if (highlight?.[Symbol.iterator]) {
      for (const range of highlight) ranges.push(range);
    }

    return {
      text: ranges.map((range) => range.toString()).join(""),
      rangeCount: ranges.length,
      domSelection: window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "",
      containsRubyText: ranges.some((range) => /やさ|ほほえ/.test(range.toString())),
      containsRubyNode: ranges.some((range) => {
        const fragment = range.cloneContents();
        return !!fragment.querySelector?.("rt, rp");
      }),
      endpointInsideRuby: ranges.some((range) => {
        const start = range.startContainer.nodeType === Node.TEXT_NODE
          ? range.startContainer.parentElement
          : range.startContainer;
        const end = range.endContainer.nodeType === Node.TEXT_NODE
          ? range.endContainer.parentElement
          : range.endContainer;
        return !!start?.closest?.("rt, rp") || !!end?.closest?.("rt, rp");
      }),
    };
  });
}

async function sasayakiHighlightState(page) {
  return page.evaluate(() => {
    const cssHighlightSize = CSS.highlights?.get("hsw-reader-sasayaki-cue")?.size ?? 0;
    const reader = document.querySelector(".rc");
    const viewport = document.querySelector(".rv");
    const layer = document.querySelector(".sasayaki-highlight-layer");
    const rects = Array.from(document.querySelectorAll(".sasayaki-highlight-rect"));
    const firstRect = rects[0];
    return {
      text: layer instanceof HTMLElement ? layer.dataset.highlightText ?? "" : "",
      rectCount: rects.length,
      cssHighlightSize,
      scrollTop: viewport instanceof HTMLElement ? viewport.scrollTop : -1,
      pageSize: viewport instanceof HTMLElement ? viewport.clientHeight : 0,
      textColor: reader ? getComputedStyle(reader).getPropertyValue("--sasayaki-highlight-text").trim() : "",
      backgroundColor: firstRect ? getComputedStyle(firstRect).backgroundColor : "",
    };
  });
}

async function probeSentenceText(page) {
  return await page.locator(".probe-state").getAttribute("data-sentence") ?? "";
}

async function probeSentenceOffset(page) {
  return Number(await page.locator(".probe-state").getAttribute("data-sentence-offset") ?? -1);
}

async function probeSelectionCount(page) {
  return Number(await page.locator(".probe-state").getAttribute("data-selection-count") ?? 0);
}

async function probeSelectionAnchor(page) {
  return {
    x: Number(await page.locator(".probe-state").getAttribute("data-anchor-x") ?? -1),
    y: Number(await page.locator(".probe-state").getAttribute("data-anchor-y") ?? -1),
  };
}

async function adjacentReaderCharacterPoints(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".rct");
    const viewport = document.querySelector(".rv")?.getBoundingClientRect();
    if (!(root instanceof HTMLElement) || !viewport) throw new Error("Reader probe is not ready.");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? "";
      for (let offset = 0; offset < text.length;) {
        const firstChar = String.fromCodePoint(text.codePointAt(offset) ?? 0);
        const nextOffset = offset + firstChar.length;
        const secondChar = String.fromCodePoint(text.codePointAt(nextOffset) ?? 0);
        if (!/\s/u.test(firstChar) && secondChar && !/\s/u.test(secondChar)) {
          const firstRange = document.createRange();
          firstRange.setStart(node, offset);
          firstRange.setEnd(node, nextOffset);
          const secondRange = document.createRange();
          secondRange.setStart(node, nextOffset);
          secondRange.setEnd(node, nextOffset + secondChar.length);
          const firstRect = firstRange.getBoundingClientRect();
          const secondRect = secondRange.getBoundingClientRect();
          firstRange.detach();
          secondRange.detach();
          const visible = [firstRect, secondRect].every((rect) => (
            rect.width > 0 && rect.height > 0 && rect.left >= viewport.left && rect.right <= viewport.right &&
            rect.top >= viewport.top && rect.bottom <= viewport.bottom
          ));
          if (visible) {
            const vertical = Math.abs(firstRect.left - secondRect.left) < 2;
            const first = vertical
              ? { x: firstRect.left + firstRect.width / 2, y: firstRect.bottom - 1 }
              : { x: firstRect.right - 1, y: firstRect.top + firstRect.height / 2 };
            const second = vertical
              ? { x: secondRect.left + secondRect.width / 2, y: secondRect.top + 1 }
              : { x: secondRect.left + 1, y: secondRect.top + secondRect.height / 2 };
            const distance = Math.hypot(second.x - first.x, second.y - first.y);
            if (distance < 8 && document.elementFromPoint(first.x, first.y) && document.elementFromPoint(second.x, second.y)) {
              return {
                first,
                second,
                distance,
                secondAnchor: { x: secondRect.x, y: secondRect.y },
              };
            }
          }
        }
        offset = nextOffset;
      }
    }
    throw new Error("No visible adjacent reader character points were found.");
  });
}

async function dispatchReaderShiftMoves(page, points, cancelWith = "") {
  await page.evaluate(({ coordinates, cancel }) => {
    const viewport = document.querySelector(".rv");
    if (!(viewport instanceof HTMLElement)) throw new Error("Reader viewport not found.");
    for (const point of coordinates) {
      viewport.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        shiftKey: true,
      }));
    }
    if (cancel === "keyup") window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    if (cancel === "blur") window.dispatchEvent(new Event("blur"));
    if (cancel === "leave") viewport.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
  }, { coordinates: points, cancel: cancelWith });
}

async function dispatchReaderPointerMove(page, point, shiftKey = false) {
  await page.evaluate(({ x, y, shift }) => {
    const viewport = document.querySelector(".rv");
    if (!(viewport instanceof HTMLElement)) throw new Error("Reader viewport not found.");
    viewport.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: x,
      clientY: y,
      shiftKey: shift,
    }));
  }, { x: point.x, y: point.y, shift: shiftKey });
}

async function main() {
  const vite = spawn(
    process.platform === "win32" ? "cmd.exe" : "npm",
    process.platform === "win32"
      ? ["/c", "npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"]
      : ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
  );

  let browser;
  try {
    await waitForServer(vite);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(url);
    const desktop = await readerMetrics(page);

    assert(desktop.writingMode === "vertical-rl", "Reader should use vertical writing mode.", desktop);
    assert(desktop.totalPages >= 4, "Reader fixture should produce multiple pages.", desktop);
    assert(desktop.paddingLeft >= 39 && desktop.paddingLeft <= 73, "Left padding is outside baseline bounds.", desktop);
    assert(desktop.paddingRight >= 39 && desktop.paddingRight <= 73, "Right padding is outside baseline bounds.", desktop);
    assert(desktop.scrollLimit + 1 >= desktop.contentMaxScroll, "Scroll tail should allow reaching aligned final page.", desktop);
    assert(desktop.blockImage && desktop.blockImage.height > 200, "Fixture cover image should render as a block image.", desktop);
    assert(
      desktop.previousPageTop !== null &&
        desktop.lastPageTop !== null &&
        Math.abs(desktop.previousPageTop - desktop.lastPageTop) <= 2,
      "Last page text top should align with the previous page.",
      desktop,
    );

    await page.reload();
    await page.locator(".rv.ready").waitFor({ timeout: 10000 });
    await page.locator(".rv").click();
    await page.keyboard.press("ArrowLeft");
    await waitForPageIndex(page, 1);
    await page.keyboard.press("ArrowLeft");
    await waitForPageIndex(page, 2);
    const beforeResize = await paginationState(page);
    await page.setViewportSize({ width: 1280, height: 560 });
    await page.waitForFunction(
      (previousPageSize) => {
        const rv = document.querySelector(".rv");
        return rv instanceof HTMLElement && Math.abs(rv.clientHeight - previousPageSize) > 20;
      },
      beforeResize.pageSize,
      { timeout: 10000 },
    );
    await page.waitForFunction(() => {
      const rv = document.querySelector(".rv");
      if (!(rv instanceof HTMLElement)) return false;
      const pageSize = rv.clientHeight;
      return Math.abs(rv.scrollTop - Math.round(rv.scrollTop / pageSize) * pageSize) <= 1;
    }, { timeout: 10000 });
    const afterResize = await paginationState(page);
    assert(afterResize.snapDelta <= 1, "Reader should snap to the new page boundary after viewport height changes.", {
      beforeResize,
      afterResize,
    });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();

    const rubyOffsetPoint = await offsetProbePoint(page);
    await page.mouse.click(rubyOffsetPoint.x, rubyOffsetPoint.y);
    await page.waitForFunction(() => {
      const value = document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "";
      return value.length > 0;
    }, { timeout: 10000 });
    const rubyOffsetSelection = await probeSelectionText(page);
    const rubyChapterOffset = await probeSelectionChapterOffset(page);
    const expectedRubyChapterOffset = rubyOffsetPoint.expectedOffset + rubyOffsetPoint.rubyProbeChars;
    assert(
      rubyOffsetSelection.startsWith("後") &&
        rubyChapterOffset === expectedRubyChapterOffset &&
        rubyChapterOffset < rubyOffsetPoint.domOffset,
      "Reader selection chapterOffset should use Sasayaki/reader character coordinates, not raw DOM text offsets that include ruby text.",
      { rubyOffsetPoint, rubyOffsetSelection, rubyChapterOffset },
    );
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "");

    const adjacentPoints = await adjacentReaderCharacterPoints(page);
    const coalescedStartCount = await probeSelectionCount(page);
    await dispatchReaderShiftMoves(page, [adjacentPoints.first, adjacentPoints.second]);
    await page.waitForFunction(
      (expected) => Number(document.querySelector(".probe-state")?.getAttribute("data-selection-count") ?? 0) === expected,
      coalescedStartCount + 1,
    );
    await page.waitForTimeout(40);
    assert(
      await probeSelectionCount(page) === coalescedStartCount + 1,
      "Multiple Shift-hover moves in one frame should process only the latest coordinate.",
      { adjacentPoints, count: await probeSelectionCount(page) },
    );
    const coalescedAnchor = await probeSelectionAnchor(page);
    assert(
      Math.abs(coalescedAnchor.x - adjacentPoints.secondAnchor.x) <= 2 &&
        Math.abs(coalescedAnchor.y - adjacentPoints.secondAnchor.y) <= 2,
      "Frame-coalesced Shift-hover should select the final character position.",
      { adjacentPoints, coalescedAnchor },
    );

    await dispatchReaderShiftMoves(page, [{ x: adjacentPoints.second.x + 0.25, y: adjacentPoints.second.y + 0.25 }]);
    await page.waitForTimeout(40);
    assert(
      await probeSelectionCount(page) === coalescedStartCount + 1,
      "Pointer jitter inside one DOM character should not repeat lookup.",
      { adjacentPoints, count: await probeSelectionCount(page) },
    );

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" })));
    const adjacentStartCount = await probeSelectionCount(page);
    await dispatchReaderShiftMoves(page, [adjacentPoints.first]);
    await page.waitForFunction(
      (expected) => Number(document.querySelector(".probe-state")?.getAttribute("data-selection-count") ?? 0) === expected,
      adjacentStartCount + 1,
    );
    await dispatchReaderShiftMoves(page, [adjacentPoints.second]);
    await page.waitForFunction(
      (expected) => Number(document.querySelector(".probe-state")?.getAttribute("data-selection-count") ?? 0) === expected,
      adjacentStartCount + 2,
    );
    assert(adjacentPoints.distance < 8, "Adjacent-character fixture points should be closer than the removed Hibiki threshold.", adjacentPoints);

    for (const cancellation of ["keyup", "leave", "blur"]) {
      await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" })));
      const beforeCancellation = await probeSelectionCount(page);
      await dispatchReaderShiftMoves(page, [adjacentPoints.first], cancellation);
      await page.waitForTimeout(40);
      assert(
        await probeSelectionCount(page) === beforeCancellation,
        `Pending Shift-hover frame should be cancelled by ${cancellation}.`,
        { cancellation, beforeCancellation, current: await probeSelectionCount(page) },
      );
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "");

    const hoverThenShiftStartCount = await probeSelectionCount(page);
    await dispatchReaderPointerMove(page, adjacentPoints.first, false);
    await page.waitForTimeout(40);
    assert(
      await probeSelectionCount(page) === hoverThenShiftStartCount,
      "Plain hover before Shift should not trigger lookup.",
      { adjacentPoints, hoverThenShiftStartCount, currentCount: await probeSelectionCount(page) },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" })));
    await page.waitForFunction(
      (expected) => Number(document.querySelector(".probe-state")?.getAttribute("data-selection-count") ?? 0) === expected,
      hoverThenShiftStartCount + 1,
    );
    assert(
      await probeSelectionCount(page) === hoverThenShiftStartCount + 1,
      "Pressing Shift after hovering reader text should trigger Shift-hover lookup from the last pointer.",
      { adjacentPoints, currentCount: await probeSelectionCount(page) },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" })));

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "");
    const repeatCancelStartCount = await probeSelectionCount(page);
    await page.evaluate((point) => {
      const viewport = document.querySelector(".rv");
      if (!(viewport instanceof HTMLElement)) throw new Error("Reader viewport not found.");

      const callbacks = [];
      const originalRequestAnimationFrame = window.requestAnimationFrame;
      const originalCancelAnimationFrame = window.cancelAnimationFrame;
      window.__hswReaderVisualRaf = {
        callbacks,
        originalRequestAnimationFrame,
        originalCancelAnimationFrame,
      };
      window.requestAnimationFrame = (callback) => {
        const id = callbacks.length + 1;
        callbacks.push({ id, callback, cancelled: false });
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        const entry = callbacks.find((candidate) => candidate.id === id);
        if (entry) entry.cancelled = true;
      };

      viewport.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        shiftKey: false,
      }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", repeat: true }));
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    }, adjacentPoints.second);
    const repeatRafState = await page.evaluate(() => {
      const state = window.__hswReaderVisualRaf;
      if (!state) throw new Error("Reader visual RAF hook was not installed.");
      const scheduled = state.callbacks.length;
      const cancelled = state.callbacks.filter((entry) => entry.cancelled).length;
      const callbacks = [...state.callbacks];
      window.requestAnimationFrame = state.originalRequestAnimationFrame;
      window.cancelAnimationFrame = state.originalCancelAnimationFrame;
      delete window.__hswReaderVisualRaf;
      for (const entry of callbacks) {
        if (!entry.cancelled) entry.callback(performance.now());
      }
      return { scheduled, cancelled };
    });
    await page.waitForTimeout(40);
    assert(
      repeatRafState.scheduled === 1 && repeatRafState.cancelled === 1 &&
        await probeSelectionCount(page) === repeatCancelStartCount,
      "Shift key repeat should not reschedule lookup, and keyup should cancel the pending lookup.",
      { repeatRafState, repeatCancelStartCount, currentCount: await probeSelectionCount(page) },
    );

    await dispatchReaderPointerMove(page, adjacentPoints.first, false);
    await page.evaluate(() => {
      const viewport = document.querySelector(".rv");
      if (!(viewport instanceof HTMLElement)) throw new Error("Reader viewport not found.");
      viewport.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    });
    const leaveThenShiftStartCount = await probeSelectionCount(page);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" })));
    await page.waitForTimeout(40);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" })));
    assert(
      await probeSelectionCount(page) === leaveThenShiftStartCount,
      "Pressing Shift after leaving the reader should not use a stale pointer.",
      { leaveThenShiftStartCount, currentCount: await probeSelectionCount(page) },
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "");

    const lookupPoint = await visibleParagraphPoint(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(lookupPoint.x, lookupPoint.y);
    await page.waitForFunction(() => {
      const value = document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "";
      return value.length > 0;
    }, { timeout: 10000 });
    const shiftHoverSelection = await probeSelectionText(page);
    assert(shiftHoverSelection.length > 0, "Shift hover should select reader text for lookup.", { lookupPoint, shiftHoverSelection });
    const shiftHoverDomSelection = await probeDomSelectionText(page);
    const shiftHoverRenderedHighlight = await probeRenderedHighlightText(page);
    assert(shiftHoverDomSelection === "", "Shift hover lookup should not leave a native browser selection.", { shiftHoverDomSelection, shiftHoverRenderedHighlight });
    assert(shiftHoverRenderedHighlight === "", "Shift hover should keep lookup selection hidden while no matched result is available.", { shiftHoverRenderedHighlight });
    const shiftHoverSentence = await probeSentenceText(page);
    const shiftHoverSentenceOffset = await probeSentenceOffset(page);
    assert(
      shiftHoverSentence.includes(shiftHoverSelection) &&
        shiftHoverSentence.length > shiftHoverSelection.length &&
        !shiftHoverSentence.slice(0, -1).includes("。") &&
        shiftHoverSentenceOffset >= 0 &&
        shiftHoverSentence.slice(shiftHoverSentenceOffset, shiftHoverSentenceOffset + shiftHoverSelection.length) === shiftHoverSelection,
      "Shift hover should capture only the sentence containing the lookup term with a usable Anki sentence offset.",
      { lookupPoint, shiftHoverSelection, shiftHoverSentence, shiftHoverSentenceOffset },
    );
    const shiftHoverCount = await probeSelectionCount(page);

    await dispatchReaderShiftMoves(page, [{ x: lookupPoint.x + 0.25, y: lookupPoint.y + 0.25 }]);
    await page.waitForTimeout(40);
    await page.keyboard.up("Shift");
    assert(
      await probeSelectionCount(page) === shiftHoverCount,
      "Movement inside the same DOM character should not retrigger lookup selection.",
      { lookupPoint, shiftHoverSelection, shiftHoverCount, currentCount: await probeSelectionCount(page) },
    );

    await page.keyboard.down("Shift");
    await page.mouse.move(10, 10);
    await page.waitForTimeout(120);
    await page.keyboard.up("Shift");
    assert(
      await probeSelectionText(page) === shiftHoverSelection,
      "Shift-hover miss should not clear an existing lookup popup.",
      { lookupPoint, shiftHoverSelection, currentSelection: await probeSelectionText(page) },
    );

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "", { timeout: 10000 });
    await page.mouse.click(lookupPoint.x, lookupPoint.y);
    await page.waitForFunction(() => {
      const value = document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "";
      return value.length > 0;
    }, { timeout: 10000 });
    const clickSelection = await probeSelectionText(page);
    assert(clickSelection.length > 0, "Plain left click should select reader text for lookup.", { lookupPoint, clickSelection });
    assert(await probeDomSelectionText(page) === "", "Plain left click lookup should not leave a native browser selection.", { clickSelection });

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "", { timeout: 10000 });
    await page.keyboard.press("ArrowLeft");
    await waitForPageIndex(page, 1);
    const secondPageClickPoint = await visibleParagraphPoint(page);
    await page.mouse.click(secondPageClickPoint.x, secondPageClickPoint.y);
    await page.waitForFunction(() => {
      const value = document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "";
      return value.length > 0;
    }, { timeout: 10000 });
    const secondPageClickSelection = await probeSelectionText(page);
    assert(secondPageClickSelection.length > 0, "Plain left click should select reader text after the first page.", { secondPageClickPoint, secondPageClickSelection });
    assert(await probeDomSelectionText(page) === "", "Plain left click lookup after the first page should not leave a native browser selection.", { secondPageClickSelection });

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "") === "", { timeout: 10000 });
    await page.mouse.move(lookupPoint.x - 8, lookupPoint.y - 8);
    await page.mouse.down();
    await page.mouse.move(lookupPoint.x + 28, lookupPoint.y + 28, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const dragSelection = await probeSelectionText(page);
    assert(dragSelection === "", "Plain mouse text selection should not open lookup.", { lookupPoint, dragSelection });

    await page.goto(`${url}&lookupHighlightMode=prefix2`);
    const highlightPoint = await visibleParagraphPoint(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(highlightPoint.x, highlightPoint.y);
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "").length > 0);
    assert(
      await probeRenderedHighlightText(page) === "",
      "Reader lookup should not reveal the scanned selection while matched results are pending.",
      { highlightPoint, pendingSelection: await probeSelectionText(page) },
    );
    await page.waitForFunction(() => {
      const state = document.querySelector(".probe-state");
      return (state?.getAttribute("data-highlight-text") ?? "").length > 0 &&
        (state?.getAttribute("data-rendered-highlight-text") ?? "") === state?.getAttribute("data-highlight-text") &&
        (state?.getAttribute("data-dom-selection") ?? "") === "";
    }, { timeout: 10000 });
    await page.keyboard.up("Shift");
    const fullLookupSelection = await probeSelectionText(page);
    const narrowedDomSelection = await probeDomSelectionText(page);
    const highlightText = await probeHighlightText(page);
    const renderedHighlightText = await probeRenderedHighlightText(page);
    assert(
      fullLookupSelection.length > renderedHighlightText.length &&
        narrowedDomSelection === "" &&
        renderedHighlightText === highlightText &&
        fullLookupSelection.replace(/\s+/g, "").startsWith(highlightText),
      "Lookup highlight text should narrow the visible browser selection without changing the lookup input.",
      { highlightPoint, fullLookupSelection, narrowedDomSelection, renderedHighlightText, highlightText },
    );

    await page.goto(`${url}&lookupHighlightMode=rubyFull`);
    await page.locator(".rv.ready").waitFor({ timeout: 10000 });
    const rubyHighlightPoint = await rubyHighlightProbePoint(page);
    await page.mouse.click(rubyHighlightPoint.x, rubyHighlightPoint.y);
    await page.waitForFunction(() => (document.querySelector(".probe-state")?.getAttribute("data-selection") ?? "").length > 0);
    await page.waitForFunction(() => {
      const state = document.querySelector(".probe-state");
      return (state?.getAttribute("data-highlight-text") ?? "") === "優しい微笑み" &&
        (state?.getAttribute("data-rendered-highlight-text") ?? "") === "優しい微笑み" &&
        (state?.getAttribute("data-dom-selection") ?? "") === "";
    }, { timeout: 10000 });
    const rubyLookupSelection = await probeSelectionText(page);
    const rubyHighlightState = await readerLookupHighlightState(page);
    assert(
      rubyLookupSelection.startsWith("優しい微笑み") &&
        rubyLookupSelection.length > "優しい微笑み".length &&
        rubyHighlightState.text === "優しい微笑み" &&
        rubyHighlightState.rangeCount > 1 &&
        rubyHighlightState.domSelection === "" &&
        !rubyHighlightState.containsRubyText &&
        !rubyHighlightState.containsRubyNode &&
        !rubyHighlightState.endpointInsideRuby,
      "Ruby lookup highlight should cover base text segments without including furigana.",
      { rubyHighlightPoint, rubyLookupSelection, rubyHighlightState },
    );

    await page.locator(".rv").click();
    await page.keyboard.press("Control+ArrowLeft");
    await waitForProbeChapter(page, 1);
    await waitForPageIndex(page, 0);

    await page.keyboard.press("Control+ArrowRight");
    await waitForProbeChapter(page, 0);
    await waitForPageIndex(page, 0);
    await page.locator(".rv").click();

    for (let pageNumber = 2; pageNumber <= desktop.totalPages; pageNumber += 1) {
      await page.keyboard.press("ArrowLeft");
      await waitForPageIndex(page, pageNumber - 1);
    }
    await page.waitForFunction(() => {
      const state = document.querySelector(".probe-state");
      return state?.getAttribute("data-chapter-index") === "0" &&
        state?.getAttribute("data-book-read-chars") === state?.getAttribute("data-chapter-read-chars");
    }, { timeout: 10000 });
    const beforeChapterBoundary = await probeProgressState(page);
    await page.keyboard.press("ArrowLeft");
    await waitForProbeChapter(page, 1);
    await page.waitForFunction(() => {
      const state = document.querySelector(".probe-state");
      return state?.getAttribute("data-book-read-chars") === state?.getAttribute("data-fixture-chapter-start");
    }, { timeout: 10000 });
    const afterChapterBoundary = await probeProgressState(page);
    assert(await probeChapterIndex(page) === 1, "ArrowLeft at the final page should advance to the next chapter.");
    await waitForPageIndex(page, 0);
    assert(
      beforeChapterBoundary.bookReadChars >= beforeChapterBoundary.fixtureChapterStart &&
        beforeChapterBoundary.bookReadChars <= beforeChapterBoundary.fixtureChapterStart + beforeChapterBoundary.fixtureChapterCount,
      "Final-page progress should stay within the first chapter before advancing.",
      { beforeChapterBoundary },
    );
    assert(
      afterChapterBoundary.bookReadChars === afterChapterBoundary.fixtureChapterStart &&
        afterChapterBoundary.fixtureChapterStart === beforeChapterBoundary.fixtureChapterStart + beforeChapterBoundary.fixtureChapterCount,
      "Chapter-boundary progress should land exactly on the next chapter start.",
      { beforeChapterBoundary, afterChapterBoundary },
    );
    assert(
      afterChapterBoundary.bookReadChars - beforeChapterBoundary.bookReadChars ===
        beforeChapterBoundary.fixtureChapterCount - beforeChapterBoundary.chapterReadChars,
      "Chapter-boundary progress delta should equal only the unread tail of the previous chapter.",
      { beforeChapterBoundary, afterChapterBoundary },
    );

    await page.keyboard.press("ArrowRight");
    await waitForProbeChapter(page, 0);
    await waitForPageIndex(page, desktop.totalPages - 1);

    await page.setViewportSize({ width: 520, height: 720 });
    await page.reload();
    const narrow = await readerMetrics(page);
    assert(!narrow.horizontalOverflow, "Reader fixture should not create horizontal overflow in a narrow window.", narrow);
    assert(narrow.totalPages >= desktop.totalPages, "Narrow reader should keep a paginated layout.", { desktop, narrow });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${url}&sasayakiMode=highlight&theme=light`);
    await page.locator(".rv.ready").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => document.querySelectorAll(".sasayaki-highlight-rect").length > 0);
    const lightCue = await sasayakiHighlightState(page);
    assert(
      lightCue.text.length > 0 && lightCue.rectCount > 0 && lightCue.cssHighlightSize === 0 && lightCue.scrollTop === 0,
      "A current-chapter cue should render an overlay highlight without CSS Highlight or page movement when reveal is disabled.",
      lightCue,
    );
    const highlightedMetrics = await readerMetrics(page);
    assert(
      highlightedMetrics.totalPages === desktop.totalPages,
      "Sasayaki highlighting must not change pagination measurements.",
      { desktop, highlightedMetrics },
    );
    assert(
      lightCue.textColor === "#000000" && lightCue.backgroundColor === "rgba(135, 206, 235, 0.4)",
      "Light mode should expose the HSA-aligned Sasayaki cue colors.",
      lightCue,
    );

    await page.goto(`${url}&sasayakiMode=reveal&theme=dark`);
    await page.locator(".rv.ready").waitFor({ timeout: 10000 });
    await page.waitForFunction(() => {
      const viewport = document.querySelector(".rv");
      return viewport instanceof HTMLElement && viewport.scrollTop > 0 &&
        document.querySelectorAll(".sasayaki-highlight-rect").length > 0;
    });
    const darkCue = await sasayakiHighlightState(page);
    assert(
      darkCue.cssHighlightSize === 0 &&
        darkCue.rectCount > 0 &&
        darkCue.scrollTop > 0 &&
        Math.abs(darkCue.scrollTop - Math.round(darkCue.scrollTop / darkCue.pageSize) * darkCue.pageSize) <= 1,
      "Revealing an active cue should move only to an aligned reader page.",
      darkCue,
    );
    assert(
      darkCue.textColor === "#ffffff" && darkCue.backgroundColor === "rgba(135, 206, 235, 0.4)",
      "Dark mode should expose the HSA-aligned Sasayaki cue colors.",
      darkCue,
    );

    console.log(JSON.stringify({ desktop, narrow, lightCue, darkCue }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
