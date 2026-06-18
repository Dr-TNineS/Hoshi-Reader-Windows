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
    const fieldTemplates = Object.fromEntries(
      Array.from(panel.querySelectorAll(".field-template-row")).map((row) => {
        const label = row.querySelector("span")?.textContent ?? "";
        const input = row.querySelector("input");
        return [label, input instanceof HTMLInputElement ? input.value : ""];
      }),
    );
    return {
      text: panel.textContent ?? "",
      fieldTemplates,
      handlebarButtonCount: panel.querySelectorAll(".handlebar-trigger").length,
      handlebarMenuText: panel.querySelector(".handlebar-menu")?.textContent ?? "",
      endpoint: state?.getAttribute("data-endpoint") ?? "",
      pingClicks: Number(state?.getAttribute("data-ping-clicks") ?? 0),
      fetchClicks: Number(state?.getAttribute("data-fetch-clicks") ?? 0),
      saveClicks: Number(state?.getAttribute("data-save-clicks") ?? 0),
      deckEvents: state?.getAttribute("data-deck-events") ?? "",
      noteTypeEvents: state?.getAttribute("data-note-type-events") ?? "",
      fieldTemplateEvents: state?.getAttribute("data-field-template-events") ?? "",
      audioEvents: state?.getAttribute("data-audio-events") ?? "",
      selectedDeck: state?.getAttribute("data-selected-deck") ?? "",
      selectedNoteType: state?.getAttribute("data-selected-note-type") ?? "",
      fieldMappings: state?.getAttribute("data-field-mappings") ?? "",
      audioEnabled: state?.getAttribute("data-audio-enabled") ?? "",
      audioSource: state?.getAttribute("data-audio-source") ?? "",
      audioUrl: state?.getAttribute("data-audio-url") ?? "",
      audioTimeout: Number(state?.getAttribute("data-audio-timeout") ?? 0),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      panel: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom,
        clientHeight: panel.clientHeight,
        scrollHeight: panel.scrollHeight,
        scrollTop: panel.scrollTop,
      },
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
    assert(metrics.text.includes("Fetch AnkiConnect config to edit field templates."), "Empty panel should show field template guidance.", metrics);

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
    assert(metrics.text.includes("Front") && metrics.text.includes("Back"), "Ready panel should show note fields.", metrics);
    assert(metrics.text.includes("Word Audio") && metrics.text.includes("Audio export disabled"), "Ready panel should expose word audio settings boundary.", metrics);
    assert(metrics.fieldMappings.includes("Front:{expression}") && metrics.fieldMappings.includes("Back:{glossary-first}"), "Ready panel should expose saved field templates.", metrics);
    assert(metrics.handlebarButtonCount === 3, "Ready panel should show a handlebar picker for each field template.", metrics);
    await page.locator(".field-template-row").filter({ hasText: "Front" }).locator(".handlebar-trigger").click();
    metrics = await panelMetrics(page);
    assert(metrics.handlebarMenuText.includes("-"), "Handlebar picker should include the blank option.", metrics);
    assert(metrics.handlebarMenuText.includes("{expression}") && metrics.handlebarMenuText.includes("{reading}"), "Handlebar picker should include core expression and reading options.", metrics);
    assert(metrics.handlebarMenuText.includes("{pitch-accent-positions}"), "Handlebar picker should include pitch accent positions.", metrics);
    assert(metrics.handlebarMenuText.includes("{single-glossary-JMdict}"), "Handlebar picker should include imported dictionary-specific glossary options.", metrics);
    assert(!metrics.handlebarMenuText.includes("{furigana-plain}"), "Handlebar picker should not expose unavailable HSA-only tokens.", metrics);
    await page.getByRole("menuitem", { name: "{reading}", exact: true }).click();
    metrics = await panelMetrics(page);
    assert(metrics.fieldTemplates.Front === "{reading}", "Choosing a handlebar option should replace the full field template.", metrics);
    assert(metrics.fieldTemplateEvents.includes("Front:{reading}"), "Choosing a handlebar option should emit a field template event.", metrics);
    await page.locator(".field-template-row").filter({ hasText: "Back" }).locator(".handlebar-trigger").click();
    await page.getByRole("menuitem", { name: "-", exact: true }).click();
    metrics = await panelMetrics(page);
    assert(metrics.fieldTemplates.Back === "", "Choosing '-' should clear the full field template.", metrics);
    assert(metrics.fieldTemplateEvents.includes("Back:"), "Choosing '-' should emit an empty field template event.", metrics);

    await openProbe(page, "lapis");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Lapis"), "Lapis panel should show the selected note type.", metrics);
    assert(metrics.fieldTemplates.Expression === "{expression}", "Lapis Expression should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.ExpressionFurigana === "{furigana-plain}", "Lapis ExpressionFurigana should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.MainDefinition === "{glossary-first}", "Lapis MainDefinition should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.PitchPosition === "{pitch-accent-positions}", "Lapis PitchPosition should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.FreqSort === "{frequency-harmonic-rank}", "Lapis FreqSort should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.IsWordAndSentenceCard === "x", "Lapis IsWordAndSentenceCard should use the HSA default.", metrics);
    assert(metrics.fieldTemplates.DefinitionPicture === "", "Lapis fields not covered by HSA defaults should stay empty.", metrics);
    assert(metrics.fieldTemplates.IsClickCard === "", "Uncovered Lapis boolean fields should stay empty.", metrics);

    await openProbe(page, "lapisMapped");
    metrics = await panelMetrics(page);
    assert(metrics.fieldTemplates.MainDefinition === "{single-glossary-JMdict}", "Existing Lapis field mappings should not be overwritten.", metrics);
    assert(metrics.fieldTemplates.Expression === "{expression}", "Unmapped Lapis fields should still preview known defaults.", metrics);

    await openProbe(page, "customLapis");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Custom Lapis"), "Custom Lapis panel should show the selected note type.", metrics);
    assert(metrics.fieldTemplates.Expression === "{expression}", "Custom Lapis should still use generic field inference where it matches.", metrics);
    assert(metrics.fieldTemplates.ExpressionFurigana === "", "Custom Lapis should not receive exact Lapis defaults.", metrics);
    assert(metrics.fieldTemplates.MainDefinition === "", "Custom Lapis should not receive exact Lapis MainDefinition default.", metrics);

    await openProbe(page, "large");
    metrics = await panelMetrics(page);
    assert(metrics.text.includes("Large Vocabulary"), "Large panel should show the selected note type.", metrics);
    assert(metrics.panel.height <= metrics.viewport.height - 40, "Large Anki panel should stay inside the viewport.", metrics);
    assert(metrics.panel.scrollHeight > metrics.panel.clientHeight, "Large Anki panel should scroll internally.", metrics);
    await page.locator(".anki-panel").evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
    metrics = await panelMetrics(page);
    assert(metrics.panel.scrollTop > 0, "Large Anki panel should allow access to offscreen controls by scrolling.", metrics);

    await openProbe(page, "ready");
    await page.getByLabel("Endpoint").fill("http://localhost:8765");
    await page.getByRole("button", { name: "Test" }).click();
    await page.getByRole("button", { name: "Fetch" }).click();
    await page.getByRole("button", { name: "Save" }).click();
    await page.locator(".field-template-row").filter({ hasText: "Back" }).locator("input").fill("{glossary}");
    await page.locator(".field-template-row").filter({ hasText: "Back" }).locator("input").blur();
    await page.getByLabel("Enable").check();
    await page.getByLabel("Source Name").fill("Probe Audio");
    await page.getByLabel("Source Name").blur();
    await page.getByLabel("Audio URL Template").fill("https://example.invalid/audio?term={term}&reading={reading}");
    await page.getByLabel("Audio URL Template").blur();
    await page.getByLabel("Timeout Ms").fill("7000");
    await page.getByLabel("Timeout Ms").blur();
    await page.getByLabel("Deck").selectOption("Japanese::Reading");
    await page.getByLabel("Note Type").selectOption("Hoshi Vocabulary");
    metrics = await panelMetrics(page);
    assert(metrics.endpoint === "http://localhost:8765", "Endpoint input should update probe state.", metrics);
    assert(metrics.pingClicks === 1 && metrics.fetchClicks === 1 && metrics.saveClicks === 1, "Action buttons should be wired.", metrics);
    assert(metrics.deckEvents.includes("Japanese::Reading"), "Deck select should emit selected deck.", metrics);
    assert(metrics.noteTypeEvents.includes("Hoshi Vocabulary"), "Note type select should emit selected note type.", metrics);
    assert(metrics.fieldTemplateEvents.includes("Back:{glossary}"), "Field template edits should emit the field and template.", metrics);
    assert(metrics.fieldMappings.includes("Back:{glossary}"), "Field template edits should update visible state.", metrics);
    assert(metrics.audioEnabled === "true", "Audio enable checkbox should update visible state.", metrics);
    assert(metrics.audioSource === "Probe Audio", "Audio source name should update visible state.", metrics);
    assert(metrics.audioUrl.includes("{term}") && metrics.audioTimeout === 7000, "Audio URL and timeout should update visible state.", metrics);
    assert(metrics.audioEvents.includes("true:"), "Audio settings edits should emit changes.", metrics);
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
