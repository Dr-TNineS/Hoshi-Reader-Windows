import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_ANKI_CONNECT_PORT || 5178);
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
  const params = new URLSearchParams({ ankiConnectProbe: "1", ankiConnectMode: mode });
  await page.goto(`${origin}/?${params}`);
  await page.locator(".anki-panel").waitFor({ timeout: 10000 });
}

async function panelMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".anki-panel");
    const state = document.querySelector(".probe-state");
    if (!(panel instanceof HTMLElement)) throw new Error("Anki panel not found.");
    const rect = panel.getBoundingClientRect();
    return {
      text: panel.textContent ?? "",
      endpoint: state?.getAttribute("data-endpoint") ?? "",
      pingClicks: Number(state?.getAttribute("data-ping-clicks") ?? 0),
      fetchClicks: Number(state?.getAttribute("data-fetch-clicks") ?? 0),
      saveClicks: Number(state?.getAttribute("data-save-clicks") ?? 0),
      deckEvents: state?.getAttribute("data-deck-events") ?? "",
      noteTypeEvents: state?.getAttribute("data-note-type-events") ?? "",
      selectedDeck: state?.getAttribute("data-selected-deck") ?? "",
      selectedNoteType: state?.getAttribute("data-selected-note-type") ?? "",
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
    assert(metrics.text.includes("Desktop Anki configuration only"), "Empty panel should describe readiness scope.", metrics);
    assert(metrics.text.includes("Fetch AnkiConnect config to preview fields."), "Empty panel should show field preview guidance.", metrics);

    await openProbe(page, "error");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Cannot connect to AnkiConnect"), "Error panel should show AnkiConnect errors.", metrics);

    await openProbe(page, "connected");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Connected to AnkiConnect."), "Connected panel should show status.", metrics);

    await openProbe(page, "ready");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("2 decks, 2 note types"), "Ready panel should summarize fetched config.", metrics);
    assert(metrics.text.includes("Mining"), "Ready panel should show deck names.", metrics);
    assert(metrics.text.includes("Basic"), "Ready panel should show note type names.", metrics);
    assert(metrics.text.includes("Front") && metrics.text.includes("Back"), "Ready panel should preview note fields.", metrics);

    await page.getByLabel("Endpoint").fill("http://localhost:8765");
    await page.getByRole("button", { name: "Test" }).click();
    await page.getByRole("button", { name: "Fetch" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByLabel("Deck").selectOption("Japanese::Reading");
    await page.getByLabel("Note Type").selectOption("Hoshi Vocabulary");
    metrics = await panelMetrics(page);
    assert(metrics.endpoint === "http://localhost:8765", "Endpoint input should update probe state.", metrics);
    assert(metrics.pingClicks === 1 && metrics.fetchClicks === 1 && metrics.saveClicks === 1, "Action buttons should be wired.", metrics);
    assert(metrics.deckEvents.includes("Japanese::Reading"), "Deck select should emit selected deck.", metrics);
    assert(metrics.noteTypeEvents.includes("Hoshi Vocabulary"), "Note type select should emit selected note type.", metrics);
    assert(metrics.selectedDeck === "Japanese::Reading", "Deck select should update visible state.", metrics);
    assert(metrics.selectedNoteType === "Hoshi Vocabulary", "Note type select should update visible state.", metrics);

    await page.setViewportSize({ width: 420, height: 720 });
    await openProbe(page, "ready");
    metrics = await panelMetrics(page);
    assert(!metrics.horizontalOverflow, "Anki panel should not create horizontal overflow in a narrow window.", metrics);
    assert(metrics.panel.right <= metrics.viewport.width, "Anki panel should stay within the narrow viewport.", metrics);

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
