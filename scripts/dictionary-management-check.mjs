import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_DICTIONARY_MANAGEMENT_PORT || 5176);
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

async function openProbe(page, mode) {
  const params = new URLSearchParams({ dictionaryManagementProbe: "1", dictionaryManagementMode: mode });
  await page.goto(`${origin}/?${params}`);
  await page.locator(".dictionary-panel").waitFor({ timeout: 10000 });
}

async function panelMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".dictionary-panel");
    const state = document.querySelector(".probe-state");
    if (!(panel instanceof HTMLElement)) throw new Error("Dictionary panel not found.");
    const rect = panel.getBoundingClientRect();
    return {
      text: panel.textContent ?? "",
      rows: document.querySelectorAll(".dictionary-row").length,
      enabledLabels: Array.from(document.querySelectorAll(".dictionary-toggle span")).map((item) => item.textContent ?? ""),
      refreshClicks: Number(state?.getAttribute("data-refresh-clicks") ?? 0),
      importClicks: Number(state?.getAttribute("data-import-clicks") ?? 0),
      enableEvents: state?.getAttribute("data-enable-events") ?? "",
      moveEvents: state?.getAttribute("data-move-events") ?? "",
      order: state?.getAttribute("data-order") ?? "",
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panel: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
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

    await openProbe(page, "empty");
    let metrics = await panelMetrics(page);
    assert(metrics.text.includes("No dictionaries imported."), "Empty panel should show an empty state.", metrics);
    assert(metrics.rows === 0, "Empty panel should not render dictionary rows.", metrics);

    await openProbe(page, "loading");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Loading dictionaries..."), "Loading panel should show loading text.", metrics);

    await openProbe(page, "error");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Cannot parse dictionary manifest: probe"), "Error panel should show manifest errors.", metrics);

    await openProbe(page, "ready");
    metrics = await panelMetrics(page);
    assert(metrics.rows === 2, "Ready panel should list imported dictionaries.", metrics);
    assert(metrics.text.includes("1/2 enabled dictionaries loaded."), "Ready panel should summarize status.", metrics);
    assert(metrics.text.includes("Jitendex.org [probe]"), "Ready panel should show dictionary titles.", metrics);
    assert(metrics.text.includes("432643 terms") && metrics.text.includes("1200 freq") && metrics.text.includes("80 pitch"), "Ready panel should show dictionary counts.", metrics);
    assert(metrics.text.includes("dictionaries/imported/jitendex"), "Ready panel should show internal path.", metrics);
    assert(metrics.enabledLabels.join("|") === "Enabled|Disabled", "Ready panel should show enabled labels.", metrics);

    await page.getByRole("button", { name: "Refresh" }).click();
    await page.getByRole("button", { name: "Import" }).click();
    metrics = await panelMetrics(page);
    assert(metrics.refreshClicks === 1 && metrics.importClicks === 1, "Refresh and import actions should be wired.", metrics);

    await page.getByRole("checkbox").nth(1).check();
    metrics = await panelMetrics(page);
    assert(metrics.enableEvents.includes("mk3:true"), "Enable toggle should emit the dictionary id and state.", metrics);
    assert(metrics.enabledLabels.join("|") === "Enabled|Enabled", "Enable toggle should update visible state.", metrics);

    await page.getByRole("button", { name: "Move MK3 Compatibility Probe Dictionary With A Very Long Visible Title up" }).click();
    metrics = await panelMetrics(page);
    assert(metrics.moveEvents.includes("mk3:-1"), "Move up should emit the dictionary id and direction.", metrics);
    assert(metrics.order === "mk3,jitendex", "Move up should reorder the visible dictionary list.", metrics);

    await page.setViewportSize({ width: 420, height: 720 });
    await openProbe(page, "ready");
    metrics = await panelMetrics(page);
    assert(!metrics.horizontalOverflow, "Dictionary panel should not create horizontal overflow in a narrow window.", metrics);
    assert(metrics.panel.right <= metrics.viewport.width, "Dictionary panel should stay within the narrow viewport.", metrics);

    console.log(JSON.stringify(metrics, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
