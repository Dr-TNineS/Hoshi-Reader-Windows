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

async function probeSelectionText(page) {
  return await page.locator(".probe-state").getAttribute("data-selection") ?? "";
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

async function probeSentenceText(page) {
  return await page.locator(".probe-state").getAttribute("data-sentence") ?? "";
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
    assert(
      shiftHoverSentence.includes(shiftHoverSelection) && shiftHoverSentence.length > shiftHoverSelection.length,
      "Shift hover should capture the source paragraph separately from the lookup term.",
      { lookupPoint, shiftHoverSelection, shiftHoverSentence },
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
    await page.keyboard.press("ArrowLeft");
    await waitForProbeChapter(page, 1);
    assert(await probeChapterIndex(page) === 1, "ArrowLeft at the final page should advance to the next chapter.");
    await waitForPageIndex(page, 0);

    await page.keyboard.press("ArrowRight");
    await waitForProbeChapter(page, 0);
    await waitForPageIndex(page, desktop.totalPages - 1);

    await page.setViewportSize({ width: 520, height: 720 });
    await page.reload();
    const narrow = await readerMetrics(page);
    assert(!narrow.horizontalOverflow, "Reader fixture should not create horizontal overflow in a narrow window.", narrow);
    assert(narrow.totalPages >= desktop.totalPages, "Narrow reader should keep a paginated layout.", { desktop, narrow });

    console.log(JSON.stringify({ desktop, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
