import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_LOOKUP_POPUP_PORT || 5175);
const origin = `http://127.0.0.1:${port}`;

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

async function openProbe(page, state, options = {}) {
  const params = new URLSearchParams({ lookupPopupProbe: "1", lookupState: state });
  if (options.longResult) params.set("longResult", "1");
  await page.goto(`${origin}/?${params}`);
  await page.locator(".lookup-pop").waitFor({ timeout: 10000 });
}

async function popupMetrics(page) {
  return page.evaluate(() => {
    const popup = document.querySelector(".lookup-pop");
    const results = document.querySelector(".lookup-results");
    const state = document.querySelector(".probe-state");
    const rect = popup instanceof HTMLElement
      ? popup.getBoundingClientRect()
      : { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
    return {
      text: Array.from(document.querySelectorAll(".lookup-pop")).map((node) => node.textContent ?? "").join("\n"),
      state: state?.getAttribute("data-state") ?? "",
      importClicks: Number(state?.getAttribute("data-import-clicks") ?? 0),
      closeClicks: Number(state?.getAttribute("data-close-clicks") ?? 0),
      scrollCloseCount: Number(state?.getAttribute("data-scroll-close-count") ?? 0),
      nestedLookupCount: Number(state?.getAttribute("data-nested-lookup-count") ?? 0),
      nestedLookupText: state?.getAttribute("data-nested-lookup-text") ?? "",
      popupCount: Number(state?.getAttribute("data-popup-count") ?? 0),
      rootClearSelectionSignal: Number(state?.getAttribute("data-root-clear-selection-signal") ?? 0),
      topPopupId: state?.getAttribute("data-top-popup-id") ?? "",
      popup: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      hasResultsScroller: results instanceof HTMLElement && results.scrollHeight > results.clientHeight,
      ankiDisabled: document.querySelector(".lookup-anki")?.hasAttribute("disabled") ?? false,
      ankiTitle: document.querySelector(".lookup-anki")?.getAttribute("title") ?? "",
      structuredListItems: document.querySelectorAll(".lookup-glossary-content ul li").length,
      structuredBreaks: document.querySelectorAll(".lookup-glossary-content br").length,
    };
  });
}

async function dispatchShiftHover(page, text) {
  await page.evaluate((needle) => {
    const content = document.querySelector(".lookup-glossary-content");
    if (!(content instanceof HTMLElement)) throw new Error("Glossary content not found.");

    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let offset = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index >= 0) {
        textNode = node;
        offset = index + Math.min(2, Math.max(0, needle.length - 1));
        break;
      }
    }
    if (!textNode || offset < 0) throw new Error(`Nested lookup probe text not found: ${needle}`);

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    const rect = range.getBoundingClientRect();
    range.detach();
    content.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      shiftKey: true,
    }));
  }, text);
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

    const expectations = [
      ["loading", "Looking up..."],
      ["noDictionaries", "No imported dictionaries found."],
      ["engineUnavailable", "Dictionary engine not linked."],
      ["empty", "No dictionary results for"],
      ["error", "Cannot parse dictionary manifest"],
    ];

    for (const [state, text] of expectations) {
      await openProbe(page, state);
      const metrics = await popupMetrics(page);
      assert(metrics.state === state, "Probe state should match requested state.", metrics);
      assert(metrics.text.includes(text), `Lookup popup should render ${state} text.`, metrics);
      assert(!metrics.horizontalOverflow, `${state} popup should not create horizontal overflow.`, metrics);
    }

    await openProbe(page, "noDictionaries");
    await page.getByRole("button", { name: "Import Dictionary" }).click();
    assert((await popupMetrics(page)).importClicks === 1, "No-dictionary import action should be wired.");

    await page.getByRole("button", { name: "Close lookup" }).click();
    assert((await popupMetrics(page)).closeClicks === 1, "Close action should be wired.");

    await openProbe(page, "ready", { longResult: true });
    const ready = await popupMetrics(page);
    assert(ready.text.includes("school"), "Ready popup should render expression.", ready);
    assert(ready.text.includes("Jitendex.org [probe]"), "Ready popup should render dictionary source.", ready);
    assert(ready.text.includes("classroom school room"), "Ready popup should render structured glossary as readable text.", ready);
    assert(!ready.text.includes("structured-content") && !ready.text.includes("\"tag\""), "Ready popup should not expose raw structured glossary JSON.", ready);
    assert(ready.structuredListItems >= 2 && ready.structuredBreaks >= 1, "Ready popup should preserve structured glossary list and line breaks.", ready);
    assert(ready.text.includes("Freq") && ready.text.includes("120"), "Ready popup should render frequency.", ready);
    assert(ready.text.includes("Pitch") && ready.text.includes("school"), "Ready popup should render pitch.", ready);
    assert(ready.text.includes("Anki not configured") && ready.ankiDisabled, "Anki boundary should remain disabled.", ready);
    assert(ready.ankiTitle.includes("Probe Book"), "Anki payload title should be exposed as disabled affordance text.", ready);
    assert(ready.hasResultsScroller, "Long ready results should scroll inside the popup.", ready);

    await dispatchShiftHover(page, "classroom");
    const nested = await popupMetrics(page);
    assert(nested.nestedLookupCount === 1, "Shift-hover inside glossary should trigger nested lookup callback.", nested);
    assert(nested.nestedLookupText.includes("classroom"), "Nested lookup should select the glossary word under the pointer.", nested);
    assert(nested.popupCount === 2, "Nested lookup should append a child popup.", nested);
    assert(nested.text.includes("nested result for classroom"), "Nested lookup child should render its own result.", nested);
    assert(nested.text.includes("classroom school room"), "Nested lookup should keep the root popup open.", nested);
    assert(nested.topPopupId.startsWith("child-"), "Nested lookup should make the child popup topmost.", nested);

    await page.locator(".lookup-pop[data-popup-id^='child-']").getByRole("button", { name: "Close lookup" }).click();
    const childClosed = await popupMetrics(page);
    assert(childClosed.popupCount === 1, "Closing a child popup should keep the root popup open.", childClosed);
    assert(childClosed.rootClearSelectionSignal > nested.rootClearSelectionSignal, "Closing a child popup should signal parent selection clear.", { nested, childClosed });

    await dispatchShiftHover(page, "school room");
    const secondNested = await popupMetrics(page);
    assert(secondNested.popupCount === 2, "A second root nested lookup should replace the previous child, not stack siblings.", secondNested);

    await page.locator(".lookup-pop[data-popup-id='root'] .lookup-results").evaluate((el) => {
      el.scrollTop = 80;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const scrolled = await popupMetrics(page);
    assert(scrolled.popupCount === 1, "Scrolling the parent popup should close child popups.", scrolled);
    assert(scrolled.scrollCloseCount >= 1, "Parent scroll should record child close behavior.", scrolled);

    await page.setViewportSize({ width: 360, height: 640 });
    await openProbe(page, "ready", { longResult: true });
    const narrow = await popupMetrics(page);
    assert(!narrow.horizontalOverflow, "Narrow lookup popup should not create horizontal overflow.", narrow);
    assert(narrow.popup.right <= narrow.viewport.width, "Narrow lookup popup should stay within the viewport.", narrow);

    console.log(JSON.stringify({ ready, nested, childClosed, scrolled, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
