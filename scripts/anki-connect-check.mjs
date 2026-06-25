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
      handlebarMenuText: document.querySelector(".handlebar-menu")?.textContent ?? "",
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
      remoteSources: JSON.parse(state?.getAttribute("data-remote-sources") ?? "[]"),
      forceSyncAfterAdd: state?.getAttribute("data-force-sync-after-add") ?? "",
      syncEvents: state?.getAttribute("data-sync-events") ?? "",
      noteOptionEvents: state?.getAttribute("data-note-option-events") ?? "",
      tags: state?.getAttribute("data-tags") ?? "",
      allowDuplicates: state?.getAttribute("data-allow-duplicates") ?? "",
      duplicateScope: state?.getAttribute("data-duplicate-scope") ?? "",
      checkAllModels: state?.getAttribute("data-check-all-models") ?? "",
      compactGlossaries: state?.getAttribute("data-compact-glossaries") ?? "",
      compactGlossaryEvents: state?.getAttribute("data-compact-glossary-events") ?? "",
      audioAutoplay: state?.getAttribute("data-audio-autoplay") ?? "",
      audioPlaybackMode: state?.getAttribute("data-audio-playback-mode") ?? "",
      playbackOptionEvents: state?.getAttribute("data-playback-option-events") ?? "",
      localAudioEnabled: state?.getAttribute("data-local-audio-enabled") ?? "",
      localAudioEvents: state?.getAttribute("data-local-audio-events") ?? "",
      localImportClicks: Number(state?.getAttribute("data-local-import-clicks") ?? 0),
      localRemoveClicks: Number(state?.getAttribute("data-local-remove-clicks") ?? 0),
      localSources: state?.getAttribute("data-local-sources") ?? "",
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
    assert(metrics.text.includes("Sync after add"), "Ready panel should expose optional post-add sync.", metrics);
    await page.getByLabel("Sync after add").click();
    metrics = await panelMetrics(page);
    assert(metrics.forceSyncAfterAdd === "true" && metrics.syncEvents.includes("true"), "Sync toggle should update settings through the panel boundary.", metrics);
    assert(metrics.text.includes("Note Options") && metrics.tags === "hoshi-reader", "Ready panel should expose persisted note tags and duplicate settings.", metrics);
    await page.getByLabel("Anki tags").fill("hoshi-reader mined");
    await page.getByLabel("Anki tags").blur();
    await page.getByLabel("Allow duplicates").click();
    await page.getByLabel("Check all note types").click();
    await page.locator(".select-row").filter({ hasText: "Duplicate Scope" }).getByRole("button").click();
    await page.getByRole("option", { name: "Deck and children" }).click();
    metrics = await panelMetrics(page);
    assert(metrics.tags === "hoshi-reader mined" && metrics.allowDuplicates === "true", "Note tags and allow-duplicates should update through the panel boundary.", metrics);
    assert(metrics.duplicateScope === "deckRoot" && metrics.checkAllModels === "true", "Duplicate scope and all-model checking should update through the panel boundary.", metrics);
    assert(metrics.noteOptionEvents.includes("deckRoot"), "Note option changes should emit settings events.", metrics);
    await page.getByLabel("Compact glossary cards").click();
    metrics = await panelMetrics(page);
    assert(metrics.compactGlossaries === "true" && metrics.compactGlossaryEvents.includes("true"), "Compact glossary toggle should persist through the panel boundary.", metrics);
    await page.getByLabel("Autoplay on lookup").click();
    await page.locator(".select-row").filter({ hasText: "Playback Mode" }).getByRole("button").click();
    await page.getByRole("option", { name: "Keep volume" }).click();
    metrics = await panelMetrics(page);
    assert(metrics.audioAutoplay === "true" && metrics.audioPlaybackMode === "mix", "Word audio autoplay and playback mode should persist through the panel boundary.", metrics);
    assert(metrics.playbackOptionEvents.includes("true:mix"), "Playback setting changes should emit settings events.", metrics);
    assert(metrics.fieldMappings.includes("Front:{expression}") && metrics.fieldMappings.includes("Back:{glossary-first}"), "Ready panel should expose saved field templates.", metrics);
    assert(metrics.handlebarButtonCount === 3, "Ready panel should show a handlebar picker for each field template.", metrics);
    await page.locator(".field-template-row").filter({ hasText: "Front" }).locator(".handlebar-trigger").click();
    metrics = await panelMetrics(page);
    assert(metrics.handlebarMenuText.includes("-"), "Handlebar picker should include the blank option.", metrics);
    assert(metrics.handlebarMenuText.includes("{expression}") && metrics.handlebarMenuText.includes("{reading}"), "Handlebar picker should include core expression and reading options.", metrics);
    assert(metrics.handlebarMenuText.includes("{pitch-accent-positions}"), "Handlebar picker should include pitch accent positions.", metrics);
    assert(metrics.handlebarMenuText.includes("{furigana-plain}"), "Handlebar picker should include HSA furigana plain.", metrics);
    assert(
      metrics.handlebarMenuText.includes("{sasayaki-audio}") && metrics.handlebarMenuText.includes("{book-cover}"),
      "Handlebar picker should include Sasayaki sentence audio and book cover media tokens.",
      metrics,
    );
    assert(metrics.handlebarMenuText.includes("{single-glossary-JMdict}"), "Handlebar picker should include imported dictionary-specific glossary options.", metrics);
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
    const audioSwitch = page.getByRole("switch", { name: "Enable", exact: true });
    await audioSwitch.press("Space");
    await page.getByLabel("Source Name").fill("Probe Audio");
    await page.getByLabel("Source Name").blur();
    await page.getByLabel("Audio URL Template").fill("https://example.invalid/audio?term={term}&reading={reading}");
    await page.getByLabel("Audio URL Template").blur();
    await page.getByRole("button", { name: "Add Source" }).click();
    let remoteCards = page.locator(".remote-source-card");
    await remoteCards.nth(1).getByLabel("Source Name").fill("Probe Audio");
    await remoteCards.nth(1).getByLabel("Source Name").blur();
    await remoteCards.nth(1).getByRole("button", { name: /Move .* up/ }).click();
    metrics = await panelMetrics(page);
    assert(metrics.remoteSources.length === 2 && metrics.remoteSources[0].name === "Probe Audio" && metrics.remoteSources[1].name === "Probe Audio", "Remote sources should support duplicate names and ordering.", metrics);
    assert(metrics.remoteSources[0].id && metrics.remoteSources[1].id && metrics.remoteSources[0].id !== metrics.remoteSources[1].id, "Remote sources should keep distinct stable ids.", metrics);
    remoteCards = page.locator(".remote-source-card");
    await remoteCards.nth(0).getByRole("button", { name: /Remove/ }).click();
    await page.getByLabel("Timeout Ms").fill("7000");
    await page.getByLabel("Timeout Ms").blur();
    await page.getByLabel("Local first").check();
    await page.getByRole("button", { name: "Replace Database" }).click();
    await page.getByRole("button", { name: "Move forvo up" }).click();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    const deckSelect = page.getByRole("button", { name: "Deck", exact: true });
    await deckSelect.click();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    const noteTypeSelect = page.getByRole("button", { name: "Note Type", exact: true });
    await noteTypeSelect.click();
    await page.getByRole("option", { name: "Hoshi Vocabulary", exact: true }).click();
    metrics = await panelMetrics(page);
    assert(metrics.endpoint === "http://localhost:8765", "Endpoint input should update probe state.", metrics);
    assert(metrics.pingClicks === 1 && metrics.fetchClicks === 1 && metrics.saveClicks === 1, "Action buttons should be wired.", metrics);
    assert(metrics.deckEvents.includes("Japanese::Reading"), "Deck select should emit selected deck.", metrics);
    assert(metrics.noteTypeEvents.includes("Hoshi Vocabulary"), "Note type select should emit selected note type.", metrics);
    assert(metrics.fieldTemplateEvents.includes("Back:{glossary}"), "Field template edits should emit the field and template.", metrics);
    assert(metrics.fieldMappings.includes("Back:{glossary}"), "Field template edits should update visible state.", metrics);
    assert(metrics.audioEnabled === "true", "Audio enable switch should update visible state from the keyboard.", metrics);
    assert(metrics.audioSource === "Probe Audio", "Audio source name should update visible state.", metrics);
    assert(metrics.audioUrl.includes("{term}") && metrics.audioTimeout === 7000, "Audio URL and timeout should update visible state.", metrics);
    assert(metrics.audioEvents.includes("true:"), "Audio settings edits should emit changes.", metrics);
    assert(metrics.remoteSources.length === 1 && metrics.remoteSources[0].id === "default", "Remote source removal should preserve the surviving source identity.", metrics);
    assert(metrics.localAudioEnabled === "true" && metrics.localAudioEvents.includes("enabled:true"), "Local audio enable should update settings.", metrics);
    assert(metrics.localImportClicks === 1 && metrics.localRemoveClicks === 1, "Local audio import and remove actions should be wired.", metrics);
    assert(metrics.localSources.startsWith("forvo,nhk16") && metrics.localAudioEvents.includes("move:forvo:-1"), "Local audio source ordering should update visible state.", metrics);
    assert(metrics.selectedDeck === "Japanese::Reading", "Deck select should update visible state.", metrics);
    assert(metrics.selectedNoteType === "Hoshi Vocabulary", "Note type select should update visible state.", metrics);

    await page.setViewportSize({ width: 420, height: 720 });
    await openProbe(page, "ready");
    metrics = await panelMetrics(page);
    assert(!metrics.horizontalOverflow, "Anki panel should not create horizontal overflow in a narrow window.", metrics);
    assert(metrics.panel.right <= metrics.viewport.width, "Anki panel should stay within the narrow viewport.", metrics);

    await page.getByRole("button", { name: "Deck", exact: true }).click();
    let layerBounds = await page.locator(".ui-select-content").evaluate((layer) => {
      const rect = layer.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    assert(
      layerBounds.top >= 0 && layerBounds.left >= 0 && layerBounds.right <= metrics.viewport.width && layerBounds.bottom <= metrics.viewport.height,
      "Select content should stay within the narrow viewport.",
      { layerBounds, viewport: metrics.viewport },
    );
    await page.keyboard.press("Escape");

    await page.locator(".field-template-row").filter({ hasText: "Front" }).locator(".handlebar-trigger").click();
    layerBounds = await page.locator(".handlebar-menu").evaluate((layer) => {
      const rect = layer.getBoundingClientRect();
      return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    });
    assert(
      layerBounds.top >= 0 && layerBounds.left >= 0 && layerBounds.right <= metrics.viewport.width && layerBounds.bottom <= metrics.viewport.height,
      "Token menu should stay within the narrow viewport.",
      { layerBounds, viewport: metrics.viewport },
    );
    await page.keyboard.press("Escape");

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
