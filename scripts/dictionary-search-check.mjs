import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_DICTIONARY_SEARCH_PORT || 5184);
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

async function metrics(page) {
  return page.evaluate(() => {
    const state = document.querySelector(".probe-state");
    const panel = document.querySelector(".panel-shell");
    const result = document.querySelector(".dictionary-search-results");
    const search = document.querySelector(".dictionary-search-bar input");
    const root = document.querySelector('[data-popup-id="dictionary-search-root"]');
    const rootContent = document.querySelector('[data-popup-id="dictionary-search-root"] .lookup-content');
    const rootExpression = document.querySelector('[data-popup-id="dictionary-search-root"] .lookup-expression');
    const childPopup = document.querySelector('.lookup-pop:not([data-popup-id="dictionary-search-root"])');
    const childContent = document.querySelector('.lookup-pop:not([data-popup-id="dictionary-search-root"]) .lookup-content');
    const childExpression = document.querySelector('.lookup-pop:not([data-popup-id="dictionary-search-root"]) .lookup-expression');
    const rootRect = root instanceof HTMLElement ? root.getBoundingClientRect() : null;
    const panelRect = panel instanceof HTMLElement ? panel.getBoundingClientRect() : null;
    const resultRect = result instanceof HTMLElement ? result.getBoundingClientRect() : null;
    const childRect = childPopup instanceof HTMLElement ? childPopup.getBoundingClientRect() : null;
    return {
      text: document.body.textContent ?? "",
      navLabels: Array.from(document.querySelectorAll(".side-nav button .nav-copy span")).map((node) => node.textContent ?? ""),
      lookupEvents: state?.getAttribute("data-lookup-events") ?? "",
      importClicks: Number(state?.getAttribute("data-import-clicks") ?? 0),
      query: state?.getAttribute("data-query") ?? "",
      lastQuery: state?.getAttribute("data-last-query") ?? "",
      rootState: state?.getAttribute("data-root-state") ?? "",
      rootResults: Number(state?.getAttribute("data-root-results") ?? 0),
      backCount: Number(state?.getAttribute("data-back-count") ?? 0),
      forwardCount: Number(state?.getAttribute("data-forward-count") ?? 0),
      childCount: Number(state?.getAttribute("data-child-count") ?? 0),
      activeElementLabel: document.activeElement?.getAttribute("aria-label") ?? "",
      selectedText: search instanceof HTMLInputElement ? search.value.slice(search.selectionStart ?? 0, search.selectionEnd ?? 0) : "",
      searchDisabled: search instanceof HTMLInputElement ? search.disabled : false,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      panel: panelRect ? { left: panelRect.left, top: panelRect.top, right: panelRect.right, bottom: panelRect.bottom } : null,
      result: resultRect ? { left: resultRect.left, top: resultRect.top, right: resultRect.right, bottom: resultRect.bottom } : null,
      root: rootRect ? { left: rootRect.left, top: rootRect.top, right: rootRect.right, bottom: rootRect.bottom } : null,
      child: childRect ? { width: childRect.width, height: childRect.height } : null,
      closeButtons: document.querySelectorAll('[data-popup-id="dictionary-search-root"] button[aria-label="Close lookup"]').length,
      sasayakiButtons: document.querySelectorAll('[data-popup-id="dictionary-search-root"] .lookup-sasayaki-controls button').length,
      rootHistoryButtons: document.querySelectorAll('[data-popup-id="dictionary-search-root"] button[aria-label="Back"], [data-popup-id="dictionary-search-root"] button[aria-label="Forward"]').length,
      popupScaleControls: document.querySelectorAll('[aria-label="Popup scale"]').length,
      rootScale: rootContent instanceof HTMLElement ? getComputedStyle(rootContent).getPropertyValue("--popup-scale").trim() : "",
      rootExpressionFontSize: rootExpression instanceof HTMLElement ? Number.parseFloat(getComputedStyle(rootExpression).fontSize) : 0,
      childScale: childContent instanceof HTMLElement ? getComputedStyle(childContent).getPropertyValue("--popup-scale").trim() : "",
      childExpressionFontSize: childExpression instanceof HTMLElement ? Number.parseFloat(getComputedStyle(childExpression).fontSize) : 0,
    };
  });
}

async function openProbe(page) {
  await page.goto(`${origin}/?dictionarySearchProbe=1`);
  await page.locator(".bookshelf").waitFor({ timeout: 10000 });
}

async function activateDictionary(page) {
  await page.locator(".side-nav button").nth(1).click();
  await page.getByRole("textbox", { name: "Dictionary search" }).waitFor();
}

async function search(page, text) {
  const input = page.getByRole("textbox", { name: "Dictionary search" });
  await input.fill(text);
  await input.press("Enter");
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

    await openProbe(page);
    let state = await metrics(page);
    assert(state.navLabels.slice(0, 3).join(" -> ") === "Library -> Dictionary -> Dictionaries", "Sidebar should place Dictionary before Dictionaries.", state);

    await activateDictionary(page);
    state = await metrics(page);
    assert(state.activeElementLabel === "Dictionary search", "Dictionary panel should focus the search input.", state);

    await search(page, "school");
    await page.locator(".lookup-result").waitFor();
    state = await metrics(page);
    assert(state.lookupEvents.includes("school:"), "Enter should invoke lookup for the typed query.", state);
    assert(state.lookupEvents.includes(":7:13"), "Lookup should receive dictionary maxResults and scanLength.", state);
    assert(state.rootState === "ready" && state.rootResults === 1, "Ready search should render root results.", state);
    assert(state.closeButtons === 0 && state.sasayakiButtons === 0, "Root frame should hide close and Sasayaki controls.", state);
    assert(state.rootHistoryButtons === 0, "Root frame should not expose a popup action bar.", state);
    assert(state.rootScale === "1.15" && Math.abs(state.rootExpressionFontSize - 29.9) < 0.2, "Root frame should use shared lookup popup scale.", state);
    assert(state.popupScaleControls === 0, "Dictionary Search should not expose a scale control.", state);

    await page.getByRole("button", { name: "Clear search" }).click();
    state = await metrics(page);
    assert(state.query === "" && state.rootResults === 1, "Clear should only clear the query and keep current results.", state);
    const eventsAfterClear = state.lookupEvents;
    await page.getByRole("textbox", { name: "Dictionary search" }).press("Enter");
    state = await metrics(page);
    assert(state.rootState === "idle" && state.rootResults === 0, "Blank Enter should clear root results and return to idle.", state);
    assert(state.lookupEvents === eventsAfterClear, "Blank Enter should not call lookup.", state);

    await page.getByRole("button", { name: "status none" }).click();
    await search(page, "none");
    state = await metrics(page);
    assert(state.rootState === "noDictionaries" && state.text.includes("No probe dictionaries."), "No-dictionary status should render a page-level state.", state);
    await page.getByRole("button", { name: "Import Dictionary" }).click();
    state = await metrics(page);
    assert(state.importClicks === 1, "No-dictionary import action should be wired.", state);

    await page.getByRole("button", { name: "status engine" }).click();
    await search(page, "engine");
    state = await metrics(page);
    assert(state.rootState === "engineUnavailable" && state.text.includes("Probe engine unavailable."), "Engine unavailable should render distinctly.", state);

    await page.getByRole("button", { name: "status ready" }).click();
    await page.getByRole("button", { name: "lookup error" }).click();
    await search(page, "failure");
    state = await metrics(page);
    assert(state.rootState === "error" && state.text.includes("Probe lookup failed."), "Lookup errors should render distinctly.", state);

    await page.getByRole("button", { name: "lookup empty" }).click();
    await search(page, "empty");
    state = await metrics(page);
    assert(state.rootState === "empty" && state.rootResults === 0 && !state.text.includes("No dictionary results"), "Empty lookup should leave the result area blank.", state);

    await page.getByRole("button", { name: "lookup ready" }).click();
    await search(page, "school");
    await page.locator('a[data-lookup-redirect="redirected"]').click();
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-last-query") === "redirected");
    state = await metrics(page);
    assert(state.lastQuery === "redirected" && state.backCount === 1, "Root redirect should replace results and add back history.", state);
    await page.keyboard.press("Alt+ArrowLeft");
    state = await metrics(page);
    assert(state.lastQuery === "school" && state.forwardCount === 1, "Alt+Left should restore the previous root result session.", state);

    const glossary = page.locator('[data-popup-id="dictionary-search-root"] .lookup-glossary-content').first();
    const box = await glossary.boundingBox();
    assert(box, "Root glossary content should be measurable for child lookup.");
    await page.keyboard.down("Shift");
    await page.mouse.move(box.x + Math.min(80, box.width / 2), box.y + Math.min(12, box.height / 2));
    await page.keyboard.up("Shift");
    await page.waitForFunction(() => Number(document.querySelector(".probe-state")?.getAttribute("data-child-count") ?? 0) > 0);
    state = await metrics(page);
    assert(state.childCount > 0, "Selecting glossary text should open a child popup.", state);
    assert(state.childScale === "1.15" && Math.abs(state.childExpressionFontSize - 29.9) < 0.2, "Child popups should use shared lookup popup scale.", state);
    assert(state.child && Math.abs(state.child.width - 320) < 30 && Math.abs(state.child.height - 250) < 30, "Child popups should use shared lookup popup dimensions.", state);

    await page.getByRole("button", { name: /Appearance Reader theme/ }).click();
    await page.locator('input[aria-label="Popup scale"]').evaluate((node) => {
      node.value = "1.3";
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByRole("button", { name: /Dictionary Search terms/ }).click();
    state = await metrics(page);
    assert(state.rootScale === "1.3" && state.childScale === "1.3", "Dictionary root and child should follow Appearance popup scale.", state);

    await page.getByRole("button", { name: "lookup slow" }).click();
    await search(page, "slow-new");
    state = await metrics(page);
    assert(state.rootState === "loading" && state.rootResults === 1 && state.searchDisabled, "New searches should keep prior results visible while loading and disable input.", state);
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-last-query") === "slow-new" && document.querySelector(".probe-state")?.getAttribute("data-root-state") === "ready");
    state = await metrics(page);
    assert(state.backCount === 0 && state.forwardCount === 0 && state.childCount === 0, "Completed new searches should clear history and child popups.", state);

    await page.getByRole("button", { name: /Library Recent EPUBs/ }).click();
    await page.getByRole("button", { name: /Dictionary Search terms/ }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Dictionary search");
    state = await metrics(page);
    assert(state.lastQuery === "slow-new" && state.rootResults === 1, "Dictionary search state should survive sidebar switching.", state);
    assert(state.selectedText === "slow-new", "Reactivating Dictionary should select the current query.", state);

    await page.setViewportSize({ width: 460, height: 720 });
    await activateDictionary(page);
    state = await metrics(page);
    assert(!state.horizontalOverflow, "Dictionary search should not create horizontal overflow in a narrow viewport.", state);
    assert(state.root && state.result && state.panel && state.root.left >= state.panel.left && state.root.top >= state.result.top, "Root results should stay inside the panel and below the search bar.", state);

    console.log(JSON.stringify(state, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
