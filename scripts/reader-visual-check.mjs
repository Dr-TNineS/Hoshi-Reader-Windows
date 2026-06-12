import { spawn } from "node:child_process";
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

async function readerHeaderText(page) {
  return page.locator(".rh").innerText();
}

async function waitForHeaderText(page, text) {
  await page.waitForFunction(
    (expected) => document.querySelector(".rh")?.textContent?.includes(expected),
    text,
    { timeout: 10000 },
  );
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

    await page.locator(".rv").click();
    await page.keyboard.press("Control+ArrowLeft");
    await waitForProbeChapter(page, 1);
    await waitForHeaderText(page, "Ch.2/2");
    await waitForHeaderText(page, "P.1/");

    await page.keyboard.press("Control+ArrowRight");
    await waitForProbeChapter(page, 0);
    await waitForHeaderText(page, "Ch.1/2");
    await waitForHeaderText(page, "P.1/");

    for (let i = 0; i < desktop.totalPages; i += 1) {
      await page.keyboard.press("ArrowLeft");
    }
    await waitForProbeChapter(page, 1);
    assert(await probeChapterIndex(page) === 1, "ArrowLeft at the final page should advance to the next chapter.");
    await waitForHeaderText(page, "P.1/");

    await page.keyboard.press("ArrowRight");
    await waitForProbeChapter(page, 0);
    await waitForHeaderText(page, `P.${desktop.totalPages}/${desktop.totalPages}`);
    const previousAtEndHeader = await readerHeaderText(page);
    assert(
      previousAtEndHeader.includes("Ch.1/2") && previousAtEndHeader.includes(`P.${desktop.totalPages}/${desktop.totalPages}`),
      "ArrowRight at a chapter start should return to the previous chapter's final page.",
      { previousAtEndHeader },
    );

    await page.setViewportSize({ width: 520, height: 720 });
    await page.reload();
    const narrow = await readerMetrics(page);
    assert(!narrow.horizontalOverflow, "Reader fixture should not create horizontal overflow in a narrow window.", narrow);
    assert(narrow.totalPages >= desktop.totalPages, "Narrow reader should keep a paginated layout.", { desktop, narrow });

    console.log(JSON.stringify({ desktop, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    vite.kill();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
