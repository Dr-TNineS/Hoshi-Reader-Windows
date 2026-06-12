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
    if (!(popup instanceof HTMLElement)) throw new Error("Lookup popup not found.");
    const rect = popup.getBoundingClientRect();
    return {
      text: popup.textContent ?? "",
      state: state?.getAttribute("data-state") ?? "",
      importClicks: Number(state?.getAttribute("data-import-clicks") ?? 0),
      closeClicks: Number(state?.getAttribute("data-close-clicks") ?? 0),
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
    assert(ready.text.includes("学校") && ready.text.includes("がっこう"), "Ready popup should render expression and reading.", ready);
    assert(ready.text.includes("Jitendex.org [probe]"), "Ready popup should render dictionary source.", ready);
    assert(ready.text.includes("classroom school room"), "Ready popup should render structured glossary as readable text.", ready);
    assert(!ready.text.includes("structured-content") && !ready.text.includes("\"tag\""), "Ready popup should not expose raw structured glossary JSON.", ready);
    assert(ready.structuredListItems >= 2 && ready.structuredBreaks >= 1, "Ready popup should preserve structured glossary list and line breaks.", ready);
    assert(ready.text.includes("Freq") && ready.text.includes("120"), "Ready popup should render frequency.", ready);
    assert(ready.text.includes("Pitch") && ready.text.includes("ガッコー"), "Ready popup should render pitch.", ready);
    assert(ready.text.includes("Anki not configured") && ready.ankiDisabled, "Anki boundary should remain disabled.", ready);
    assert(ready.ankiTitle.includes("Probe Book"), "Anki payload title should be exposed as disabled affordance text.", ready);
    assert(ready.hasResultsScroller, "Long ready results should scroll inside the popup.", ready);

    await page.setViewportSize({ width: 360, height: 640 });
    await openProbe(page, "ready", { longResult: true });
    const narrow = await popupMetrics(page);
    assert(!narrow.horizontalOverflow, "Narrow lookup popup should not create horizontal overflow.", narrow);
    assert(narrow.popup.right <= narrow.viewport.width, "Narrow lookup popup should stay within the viewport.", narrow);

    console.log(JSON.stringify({ ready, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
