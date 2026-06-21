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
  if (options.bottomEdge) params.set("bottomEdge", "1");
  if (options.mediaMode) params.set("mediaMode", options.mediaMode);
  if (options.ankiMode) params.set("ankiMode", options.ankiMode);
  if (options.ankiAddMode) params.set("ankiAddMode", options.ankiAddMode);
  if (options.forceSync) params.set("forceSync", "enabled");
  if (options.allowDuplicates) params.set("allowDuplicates", "enabled");
  if (options.checkAllModels) params.set("checkAllModels", "enabled");
  if (options.duplicateScope) params.set("duplicateScope", options.duplicateScope);
  if (options.ankiStoreMode) params.set("ankiStoreMode", options.ankiStoreMode);
  if (options.ankiAudioStoreMode) params.set("ankiAudioStoreMode", options.ankiAudioStoreMode);
  if (options.localAudioStoreMode) params.set("localAudioStoreMode", options.localAudioStoreMode);
  if (options.localAudio) params.set("localAudio", "enabled");
  if (options.audioEnabled === false) params.set("audioEnabled", "disabled");
  if (options.audioField === false) params.set("audioField", "disabled");
  if (options.emptyExpression) params.set("emptyExpression", "1");
  await page.goto(`${origin}/?${params}`);
  await page.locator(".lookup-pop").waitFor({ timeout: 10000 });
}

async function popupMetrics(page) {
  return page.evaluate(() => {
    const popup = document.querySelector(".lookup-pop");
    const results = document.querySelector(".lookup-results");
    const state = document.querySelector(".probe-state");
    const styledGlossary = document.querySelector(".lookup-glossary-content .gloss-sc-div");
    const head = document.querySelector(".lookup-head");
    const anki = document.querySelector(".lookup-anki");
    const audio = document.querySelector(".lookup-audio");
    const controls = document.querySelector(".probe-ctrls");
    const rect = popup instanceof HTMLElement
      ? popup.getBoundingClientRect()
      : { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
    const controlsRect = controls instanceof HTMLElement ? controls.getBoundingClientRect() : null;
    return {
      text: Array.from(document.querySelectorAll(".lookup-pop")).map((node) => node.textContent ?? "").join("\n"),
      nativeSelectionText: window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "",
      popupHighlightText: (() => {
        const highlight = CSS.highlights?.get("hsw-popup-lookup-selection");
        const parts = [];
        if (highlight?.forEach) {
          highlight.forEach((range) => parts.push(range.toString()));
        } else if (highlight?.[Symbol.iterator]) {
          for (const range of highlight) parts.push(range.toString());
        }
        return parts.join("").replace(/\s+/g, " ").trim();
      })(),
      state: state?.getAttribute("data-state") ?? "",
      importClicks: Number(state?.getAttribute("data-import-clicks") ?? 0),
      closeClicks: Number(state?.getAttribute("data-close-clicks") ?? 0),
      scrollCloseCount: Number(state?.getAttribute("data-scroll-close-count") ?? 0),
      nestedLookupCount: Number(state?.getAttribute("data-nested-lookup-count") ?? 0),
      nestedLookupText: state?.getAttribute("data-nested-lookup-text") ?? "",
      popupCount: Number(state?.getAttribute("data-popup-count") ?? 0),
      rootClearSelectionSignal: Number(state?.getAttribute("data-root-clear-selection-signal") ?? 0),
      topPopupId: state?.getAttribute("data-top-popup-id") ?? "",
      ankiAddCount: Number(state?.getAttribute("data-anki-add-count") ?? 0),
      ankiStoreCount: Number(state?.getAttribute("data-anki-store-count") ?? 0),
      ankiAudioStoreCount: Number(state?.getAttribute("data-anki-audio-store-count") ?? 0),
      ankiLastAudioRequest: JSON.parse(state?.getAttribute("data-anki-last-audio-request") ?? "null"),
      localAudioStoreCount: Number(state?.getAttribute("data-local-audio-store-count") ?? 0),
      localAudioLastRequest: JSON.parse(state?.getAttribute("data-local-audio-last-request") ?? "null"),
      ankiLastMedia: JSON.parse(state?.getAttribute("data-anki-last-media") ?? "[]"),
      ankiLastDeck: state?.getAttribute("data-anki-last-deck") ?? "",
      ankiLastModel: state?.getAttribute("data-anki-last-model") ?? "",
      ankiLastFields: JSON.parse(state?.getAttribute("data-anki-last-fields") ?? "{}"),
      ankiLastRequest: JSON.parse(state?.getAttribute("data-anki-last-request") ?? "null"),
      popup: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      controlsTop: controlsRect?.top ?? window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      hasResultsScroller: results instanceof HTMLElement && results.scrollHeight > results.clientHeight,
      resultsScrollbarWidth: results instanceof HTMLElement ? results.offsetWidth - results.clientWidth : 0,
      lookupTextRows: document.querySelectorAll(".lookup-text").length,
      lookupMetaRows: document.querySelectorAll(".lookup-meta").length,
      lookupResultRows: document.querySelectorAll(".lookup-result").length,
      ankiDisabled: document.querySelector(".lookup-anki")?.hasAttribute("disabled") ?? false,
      ankiAriaLabel: document.querySelector(".lookup-anki")?.getAttribute("aria-label") ?? "",
      ankiTitle: document.querySelector(".lookup-anki")?.getAttribute("title") ?? "",
      audioDisabled: document.querySelector(".lookup-audio")?.hasAttribute("disabled") ?? false,
      audioTitle: document.querySelector(".lookup-audio")?.getAttribute("title") ?? "",
      ankiPreviewRows: document.querySelectorAll(".anki-preview-row").length,
      ankiPreviewButtons: document.querySelectorAll(".lookup-anki-preview").length,
      headerActions: document.querySelectorAll(".lookup-header-actions").length,
      audioButtons: document.querySelectorAll(".lookup-audio").length,
      frequencyGroups: document.querySelectorAll(".frequency-group").length,
      frequencyDictLabels: Array.from(document.querySelectorAll(".frequency-dict-label")).map((node) => node.textContent ?? ""),
      pitchGroups: document.querySelectorAll(".pitch-group").length,
      pitchVisuals: document.querySelectorAll(".pitch-visual").length,
      lookupDetailRows: document.querySelectorAll(".lookup-detail").length,
      structuredListItems: document.querySelectorAll(".lookup-glossary-content ul li").length,
      structuredBreaks: document.querySelectorAll(".lookup-glossary-content br").length,
      structuredTables: document.querySelectorAll(".lookup-glossary-content table").length,
      structuredRuby: document.querySelectorAll(".lookup-glossary-content ruby rt").length,
      mediaPlaceholders: document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder").length,
      mediaLoaded: document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length,
      mediaErrors: document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='error']").length,
      mediaLoading: document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loading']").length,
      mediaImages: document.querySelectorAll(".lookup-glossary-content .gloss-media-image").length,
      mediaImageMaxHeight: (() => {
        const image = document.querySelector(".lookup-glossary-content .gloss-media-image");
        return image instanceof HTMLElement ? getComputedStyle(image).maxHeight : "";
      })(),
      glossaryGroups: document.querySelectorAll(".lookup-glossary-group").length,
      redirectLinks: document.querySelectorAll(".lookup-glossary-content a[data-lookup-redirect]").length,
      canGoBack: !document.querySelector(".lookup-pop[data-popup-id='root'] button[aria-label='Back']")?.hasAttribute("disabled"),
      canGoForward: !document.querySelector(".lookup-pop[data-popup-id='root'] button[aria-label='Forward']")?.hasAttribute("disabled"),
      resultsScrollTop: document.querySelector(".lookup-pop[data-popup-id='root'] .lookup-results")?.scrollTop ?? 0,
      dictionaryStyleTags: Array.from(document.head.querySelectorAll("style"))
        .filter((style) => style.textContent?.includes(".lookup-glossary-content .gloss-sc-div")).length,
      dictionaryStyledColor: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).color : "",
      dictionaryStyledPosition: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).position : "",
      dictionaryStyledBackgroundImage: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).backgroundImage : "",
      headColor: head instanceof HTMLElement ? getComputedStyle(head).color : "",
      ankiDisplay: anki instanceof HTMLElement ? getComputedStyle(anki).display : "",
      audioDisplay: audio instanceof HTMLElement ? getComputedStyle(audio).display : "",
      bodyBackground: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function dispatchShiftHover(page, text, offsetInText = null) {
  await dispatchGlossaryPointer(page, text, "pointermove", { shiftKey: true, offsetInText });
}

async function dispatchGlossaryClick(page, text, offsetInText = null) {
  await dispatchGlossaryPointer(page, text, "click", { shiftKey: false, offsetInText });
}

async function dispatchGlossaryPointer(page, text, eventType, options = {}) {
  await page.evaluate(({ needle, requestedOffset, type, shiftKey }) => {
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
        const localOffset = Number.isInteger(requestedOffset)
          ? Math.max(0, Math.min(requestedOffset, Math.max(0, needle.length - 1)))
          : 0;
        offset = index + localOffset;
        break;
      }
    }
    if (!textNode || offset < 0) throw new Error(`Nested lookup probe text not found: ${needle}`);

    const range = document.createRange();
    range.setStart(textNode, offset);
    range.setEnd(textNode, offset + 1);
    const rect = range.getBoundingClientRect();
    range.detach();
    const eventInit = {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      shiftKey,
    };
    const event = type === "click"
      ? new MouseEvent(type, eventInit)
      : new PointerEvent(type, eventInit);
    content.dispatchEvent(event);
  }, { needle: text, requestedOffset: options.offsetInText ?? null, type: eventType, shiftKey: options.shiftKey ?? false });
}

async function closeChildPopup(page) {
  await page.waitForFunction(() => document.querySelectorAll(".lookup-pop").length > 1, { timeout: 10000 });
  await page.evaluate(() => {
    const popups = Array.from(document.querySelectorAll(".lookup-pop"));
    const child = popups.reverse().find((popup) => popup instanceof HTMLElement && popup.dataset.popupId !== "root");
    const button = child?.querySelector("button[aria-label='Close lookup']");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Child close button not found: ${popups.map((popup) => popup instanceof HTMLElement ? popup.dataset.popupId : "").join(",")}`);
    }
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function scrollFirstMediaPlaceholderIntoView(page) {
  await page.locator(".lookup-glossary-content .gloss-media-placeholder").first().evaluate((placeholder) => {
    placeholder.scrollIntoView({ block: "center", inline: "nearest" });
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
    await page.waitForFunction(() => {
      const target = document.querySelector(".lookup-glossary-content .gloss-sc-div");
      return target instanceof HTMLElement && getComputedStyle(target).color === "rgb(123, 210, 145)";
    });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length >= 1
    ));
    const ready = await popupMetrics(page);
    assert(ready.text.includes("school"), "Ready popup should render expression.", ready);
    assert(ready.lookupResultRows >= 5 && ready.text.includes("extra rendered lookup result 5"), "Ready popup should render all backend lookup results, not only the first three.", ready);
    assert(ready.text.includes("Jitendex.org [probe]"), "Ready popup should render dictionary source.", ready);
    assert(ready.lookupTextRows === 0, "Ready popup should not render the original selected text row.", ready);
    assert(ready.lookupMetaRows === 0, "Ready popup should not render the dictionary source meta row.", ready);
    assert(ready.text.includes("classroom school room"), "Ready popup should render structured glossary as readable text.", ready);
    assert(!ready.text.includes("structured-content") && !ready.text.includes("\"tag\""), "Ready popup should not expose raw structured glossary JSON.", ready);
    assert(ready.structuredListItems >= 2 && ready.structuredBreaks >= 1, "Ready popup should preserve structured glossary list and line breaks.", ready);
    assert(ready.structuredTables >= 1, "Ready popup should preserve structured glossary tables.", ready);
    assert(ready.structuredRuby >= 1, "Ready popup should preserve structured glossary ruby.", ready);
    assert(ready.mediaPlaceholders >= 1, "Ready popup should render safe placeholders for dictionary media.", ready);
    assert(ready.mediaLoaded >= 1 && ready.mediaImages >= 1, "Ready popup should lazy-load dictionary media into an image.", ready);
    assert(ready.mediaErrors === 0 && ready.mediaLoading === 0, "Successful dictionary media should not remain loading or error.", ready);
    assert(ready.mediaImageMaxHeight === "180px", "Dictionary media image should be constrained inside the popup.", ready);
    assert(ready.glossaryGroups >= 2, "Ready popup should group glossary entries by dictionary.", ready);
    assert(ready.redirectLinks >= 1, "Ready popup should render dictionary cross-reference links.", ready);
    assert(!ready.canGoBack && !ready.canGoForward, "Root popup should start without redirect history.", ready);
    assert(ready.dictionaryStyleTags >= 1, "Ready popup should inject scoped dictionary CSS.", ready);
    assert(ready.dictionaryStyledColor === "rgb(123, 210, 145)", "Dictionary CSS should affect glossary content.", ready);
    assert(ready.dictionaryStyledPosition !== "fixed", "Dictionary CSS sanitizer should block fixed positioning.", ready);
    assert(ready.dictionaryStyledBackgroundImage === "none", "Dictionary CSS sanitizer should block remote image URLs.", ready);
    assert(ready.headColor !== "rgb(255, 0, 0)", "Dictionary CSS should not style popup chrome.", ready);
    assert(ready.ankiDisplay !== "none", "Dictionary CSS should not style popup action buttons.", ready);
    assert(ready.bodyBackground !== "rgb(255, 0, 0)", "Dictionary CSS should not style the page body.", ready);
    assert(ready.text.includes("education") && ready.text.includes("place"), "Ready popup should render glossary definition tags.", ready);
    assert(ready.headerActions >= 1, "Ready popup should render HSA-style header actions.", ready);
    assert(ready.audioButtons >= 1 && ready.audioDisabled, "Word audio button should render as a disabled boundary.", ready);
    assert(ready.audioTitle.includes("not implemented"), "Disabled audio affordance should describe the boundary.", ready);
    assert(ready.frequencyGroups >= 1 && ready.frequencyDictLabels.includes("Freq Probe") && ready.text.includes("120"), "Ready popup should render frequency as dictionary pills.", ready);
    assert(ready.pitchGroups >= 1 && ready.pitchVisuals >= 1 && ready.text.includes("school"), "Ready popup should render pitch as grouped pitch rows.", ready);
    assert(ready.lookupDetailRows === 0 && !ready.text.includes("FreqPitch"), "Ready popup should not render old Freq/Pitch detail rows.", ready);
    assert(ready.ankiAriaLabel === "Anki not configured" && ready.ankiDisabled, "Anki boundary should remain disabled.", ready);
    assert(ready.ankiTitle.includes("Probe Book"), "Anki payload title should be exposed as disabled affordance text.", ready);
    assert(ready.ankiPreviewButtons === 0 && ready.ankiPreviewRows === 0, "Manual Anki field preview controls should be removed.", ready);
    assert(ready.hasResultsScroller, "Long ready results should scroll inside the popup.", ready);
    assert(ready.resultsScrollbarWidth === 0, "Long ready results should hide the visual scrollbar while remaining scrollable.", ready);

    await openProbe(page, "ready", { ankiMode: "configured" });
    const configuredAnki = await popupMetrics(page);
    assert(!configuredAnki.ankiDisabled && configuredAnki.ankiAriaLabel === "Add to Anki", "Configured Anki action should be enabled as a header icon.", configuredAnki);
    assert(configuredAnki.ankiPreviewButtons === 0 && configuredAnki.ankiPreviewRows === 0, "Configured popup should not expose manual Anki preview UI.", configuredAnki);

    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiAdded = await popupMetrics(page);
    assert(ankiAdded.ankiAddCount === 1, "Add Anki should call the note creation callback once.", ankiAdded);
    assert(ankiAdded.ankiStoreCount === 1, "Add Anki should store dictionary media before note creation.", ankiAdded);
    assert(ankiAdded.ankiLastMedia.length === 1 && ankiAdded.ankiLastMedia[0].filename.startsWith("hsw_"), "Stored media request should use deterministic HSW filenames.", ankiAdded);
    assert(ankiAdded.ankiLastDeck === "Mining" && ankiAdded.ankiLastModel === "Hoshi Vocabulary", "Add Anki should send selected deck and note type.", ankiAdded);
    assert(ankiAdded.ankiLastRequest.tags.join(" ") === "hoshi-reader mining", "Add Anki should send configured whitespace-separated tags.", ankiAdded);
    assert(ankiAdded.ankiLastRequest.allowDuplicates === false && ankiAdded.ankiLastRequest.duplicateScope === "collection", "Add Anki should send default duplicate policy.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Expression === "school / school", "Add Anki should send rendered field values.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Sentence === "The academy school sentence contains the selected lookup term in a longer source paragraph.", "Add Anki should send sentence context rather than only selected text.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("classroom school room") && !ankiAdded.ankiLastFields.Meaning.includes("\"tag\""), "Add Anki should send rendered structured glossary values.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("yomitan-glossary"), "Add Anki should wrap glossary HTML in an HSA/Lapis-compatible glossary container.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('data-dictionary="Jitendex.org [probe]"'), "Add Anki should preserve dictionary identity for note template CSS.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('data-sc-headword="school"'), "Add Anki should preserve structured glossary data attributes.", ankiAdded);
    assert(ankiAdded.ankiLastFields.JmOnly.includes("school; a place of study") && ankiAdded.ankiLastFields.JmOnly.includes('data-dictionary="JMdict [probe]"'), "Add Anki should send dictionary-specific glossary values with template-compatible wrappers.", ankiAdded);
    assert(ankiAdded.ankiLastFields.MissingDict === "", "Unknown dictionary-specific glossary tokens should render empty.", ankiAdded);
    assert(ankiAdded.ankiAudioStoreCount === 1, "Add Anki should store remote word audio before note creation.", ankiAdded);
    assert(ankiAdded.ankiLastAudioRequest.expression === "school" && ankiAdded.ankiLastAudioRequest.reading === "school", "Remote audio request should use lookup expression and reading.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Audio === "[sound:hsw_audio_probe.mp3]", "Add Anki should render the stored word audio filename.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Media.includes("<img src=\"stored_hsw_") && ankiAdded.ankiLastFields.Media.includes(".svg"), "Add Anki should include stored dictionary media filenames.", ankiAdded);
    assert(ankiAdded.text.includes("Added Anki note 4242."), "Added state should show the Anki note id message.", ankiAdded);
    assert(ankiAdded.text.includes("Word audio stored as hsw_audio_probe.mp3"), "Add state should expose stored word audio.", ankiAdded);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAddMode: "syncWarning", forceSync: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiSyncWarning = await popupMetrics(page);
    assert(ankiSyncWarning.ankiAddCount === 1 && ankiSyncWarning.text.includes("Added Anki note 4242."), "Sync failure should preserve the added note state.", ankiSyncWarning);
    assert(ankiSyncWarning.text.includes("Anki sync failed: probe failure"), "Sync failure should be shown as a secondary warning.", ankiSyncWarning);

    await openProbe(page, "ready", { ankiMode: "configured", allowDuplicates: true, checkAllModels: true, duplicateScope: "deckRoot" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiDuplicatePolicy = await popupMetrics(page);
    assert(ankiDuplicatePolicy.ankiLastRequest.allowDuplicates === true, "Configured allow-duplicates should reach the note request.", ankiDuplicatePolicy);
    assert(ankiDuplicatePolicy.ankiLastRequest.checkDuplicatesAcrossAllModels === true && ankiDuplicatePolicy.ankiLastRequest.duplicateScope === "deckRoot", "Configured duplicate scope should reach the note request.", ankiDuplicatePolicy);

    await openProbe(page, "ready", { ankiMode: "configured", localAudio: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiLocalAudio = await popupMetrics(page);
    assert(ankiLocalAudio.localAudioStoreCount === 1, "Enabled local audio should be attempted first.", ankiLocalAudio);
    assert(ankiLocalAudio.ankiAudioStoreCount === 0, "A local audio hit should skip remote audio.", ankiLocalAudio);
    assert(ankiLocalAudio.localAudioLastRequest.expression === "school", "Local audio should receive the lookup expression.", ankiLocalAudio);
    assert(ankiLocalAudio.ankiLastFields.Audio === "[sound:hsw_audio_local.ogg]", "A local audio hit should render into the audio field.", ankiLocalAudio);

    await openProbe(page, "ready", { ankiMode: "configured", localAudio: true, localAudioStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiLocalMissing = await popupMetrics(page);
    assert(ankiLocalMissing.localAudioStoreCount === 1 && ankiLocalMissing.ankiAudioStoreCount === 1, "A local miss should fall back to remote audio.", ankiLocalMissing);
    assert(ankiLocalMissing.ankiLastFields.Audio === "[sound:hsw_audio_probe.mp3]", "Remote fallback should populate the audio field.", ankiLocalMissing);

    await openProbe(page, "ready", { ankiMode: "configured", localAudio: true, localAudioStoreMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiLocalError = await popupMetrics(page);
    assert(ankiLocalError.ankiAudioStoreCount === 1 && ankiLocalError.ankiAddCount === 1, "A local read warning should fall back and preserve note creation.", ankiLocalError);
    assert(ankiLocalError.text.includes("Probe database read failure"), "Local audio warnings should remain visible after remote fallback.", ankiLocalError);

    await openProbe(page, "ready", { ankiMode: "configured", localAudio: true, localAudioStoreMode: "missing", ankiAudioStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiAllAudioMissing = await popupMetrics(page);
    assert(ankiAllAudioMissing.ankiAddCount === 1 && ankiAllAudioMissing.ankiLastFields.Audio === "", "Missing local and remote audio should still create a text note.", ankiAllAudioMissing);

    await openProbe(page, "ready", { ankiMode: "configured", localAudio: true, audioEnabled: false });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiAudioDisabled = await popupMetrics(page);
    assert(ankiAudioDisabled.localAudioStoreCount === 0 && ankiAudioDisabled.ankiAudioStoreCount === 0, "The master audio switch should skip local and remote audio.", ankiAudioDisabled);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAudioStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiMissingAudio = await popupMetrics(page);
    assert(ankiMissingAudio.ankiAudioStoreCount === 1 && ankiMissingAudio.ankiAddCount === 1, "Missing remote audio should not block text note creation.", ankiMissingAudio);
    assert(ankiMissingAudio.ankiLastFields.Audio === "", "Missing remote audio should leave the audio field empty.", ankiMissingAudio);
    assert(ankiMissingAudio.text.includes("HTTP 404"), "Missing remote audio warning should be visible.", ankiMissingAudio);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAudioStoreMode: "unsupported" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiUnsupportedAudio = await popupMetrics(page);
    assert(ankiUnsupportedAudio.ankiAddCount === 1 && ankiUnsupportedAudio.ankiLastFields.Audio === "", "Unsupported remote audio should continue without audio.", ankiUnsupportedAudio);
    assert(ankiUnsupportedAudio.text.includes("not a supported audio file"), "Unsupported remote audio warning should be visible.", ankiUnsupportedAudio);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAudioStoreMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiUnsafeAudio = await popupMetrics(page);
    assert(ankiUnsafeAudio.ankiAudioStoreCount === 1 && ankiUnsafeAudio.ankiAddCount === 0, "Unsafe remote audio targets should stop note creation.", ankiUnsafeAudio);
    assert(ankiUnsafeAudio.text.includes("private, local, or reserved"), "Unsafe remote audio error should be visible.", ankiUnsafeAudio);

    await openProbe(page, "ready", { ankiMode: "configured", audioField: false });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiWithoutAudioField = await popupMetrics(page);
    assert(ankiWithoutAudioField.ankiAudioStoreCount === 0 && ankiWithoutAudioField.ankiAddCount === 1, "Notes without an audio token should skip remote audio.", ankiWithoutAudioField);

    await openProbe(page, "ready", { ankiMode: "configured", emptyExpression: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiWithoutExpression = await popupMetrics(page);
    assert(ankiWithoutExpression.ankiAudioStoreCount === 0 && ankiWithoutExpression.ankiAddCount === 1, "Lookups without an expression should skip remote audio.", ankiWithoutExpression);

    await openProbe(page, "ready", { ankiMode: "configured", ankiStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiMissingMedia = await popupMetrics(page);
    assert(ankiMissingMedia.ankiStoreCount === 1, "Missing media path should still attempt media storage.", ankiMissingMedia);
    assert(ankiMissingMedia.ankiAddCount === 1, "Missing media warnings should not block text note creation.", ankiMissingMedia);
    assert(ankiMissingMedia.ankiLastFields.Media === "", "Missing media should be removed from the final note field.", ankiMissingMedia);
    assert(ankiMissingMedia.text.includes("Missing probe media:"), "Missing media warnings should be visible in the popup.", ankiMissingMedia);

    await openProbe(page, "ready", { ankiMode: "configured", ankiStoreMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiMediaError = await popupMetrics(page);
    assert(ankiMediaError.ankiStoreCount === 1, "Media store errors should be surfaced after one store attempt.", ankiMediaError);
    assert(ankiMediaError.ankiAddCount === 0, "Hard media storage errors should stop note creation.", ankiMediaError);
    assert(ankiMediaError.text.includes("Probe media store failure"), "Media store errors should be visible in the popup.", ankiMediaError);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAddMode: "duplicate" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiDuplicate = await popupMetrics(page);
    assert(ankiDuplicate.ankiAddCount === 1, "Duplicate check should still make a single add attempt callback.", ankiDuplicate);
    assert(ankiDuplicate.text.includes("cannot create note because it is a duplicate"), "Duplicate state should show duplicate details.", ankiDuplicate);

    await openProbe(page, "ready", { ankiMode: "configured", ankiAddMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiError = await popupMetrics(page);
    assert(ankiError.text.includes("Probe AnkiConnect failure"), "Anki error state should show failure details.", ankiError);

    await page.setViewportSize({ width: 1280, height: 720 });
    await openProbe(page, "ready", { longResult: true, bottomEdge: true });
    await page.waitForFunction(() => {
      const popup = document.querySelector(".lookup-pop");
      const controls = document.querySelector(".probe-ctrls");
      if (!(popup instanceof HTMLElement) || !(controls instanceof HTMLElement)) return false;
      return popup.getBoundingClientRect().bottom <= controls.getBoundingClientRect().top + 1;
    });
    const bottomEdge = await popupMetrics(page);
    assert(bottomEdge.popup.bottom <= bottomEdge.controlsTop + 1, "Bottom-edge popup should not overlap the bottom controls.", bottomEdge);
    assert(Math.abs(bottomEdge.popup.height - ready.popup.height) <= 2, "Bottom-edge positioning should not shrink the long popup.", { ready, bottomEdge });
    assert(bottomEdge.hasResultsScroller, "Bottom-edge long results should still scroll inside the popup.", bottomEdge);

    await openProbe(page, "ready", { longResult: true, mediaMode: "fail" });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='error']").length >= 1
    ));
    const mediaFailed = await popupMetrics(page);
    assert(mediaFailed.mediaErrors >= 1, "Missing dictionary media should render a non-fatal unavailable state.", mediaFailed);
    assert(mediaFailed.text.includes("Media unavailable"), "Missing dictionary media should show an understandable placeholder.", mediaFailed);
    assert(mediaFailed.text.includes("classroom school room"), "Missing dictionary media should not break text glossary rendering.", mediaFailed);

    await openProbe(page, "ready", { longResult: true, mediaMode: "none" });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='error']").length >= 1
    ));
    const mediaNoTauri = await popupMetrics(page);
    assert(mediaNoTauri.mediaErrors >= 1, "Non-Tauri media fallback should render unavailable instead of hanging.", mediaNoTauri);
    assert(mediaNoTauri.mediaImages === 0, "Non-Tauri media fallback should not fake loaded images.", mediaNoTauri);

    await openProbe(page, "ready", { longResult: true });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length >= 1
    ));

    await page.locator(".lookup-pop[data-popup-id='root'] a[data-lookup-redirect]").first().evaluate((link) => {
      const scroller = link.closest(".lookup-results");
      if (scroller instanceof HTMLElement) scroller.scrollTop = 72;
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    const redirected = await popupMetrics(page);
    assert(redirected.popupCount === 1, "Cross-reference redirect should reuse the current popup.", redirected);
    assert(redirected.text.includes("nested result for academy"), "Cross-reference redirect should look up the target in the same popup.", redirected);
    assert(redirected.canGoBack && !redirected.canGoForward, "Redirect should push back history and clear forward history.", redirected);

    await page.locator(".lookup-pop[data-popup-id='root']").getByRole("button", { name: "Back" }).click();
    await page.waitForFunction(() => (
      (document.querySelector(".lookup-pop[data-popup-id='root'] .lookup-results")?.scrollTop ?? 0) >= 70
    ));
    const afterBack = await popupMetrics(page);
    assert(afterBack.popupCount === 1, "Back navigation should stay in the same popup.", afterBack);
    assert(afterBack.text.includes("classroom school room"), "Back navigation should restore the previous lookup.", afterBack);
    assert(afterBack.resultsScrollTop >= 70, "Back navigation should restore the previous popup scroll position.", afterBack);
    assert(!afterBack.canGoBack && afterBack.canGoForward, "Back navigation should move the redirect into forward history.", afterBack);

    await page.locator(".lookup-pop[data-popup-id='root']").getByRole("button", { name: "Forward" }).click();
    await page.waitForFunction(() => document.querySelector(".lookup-pop[data-popup-id='root']")?.textContent?.includes("nested result for academy"));
    const afterForward = await popupMetrics(page);
    assert(afterForward.text.includes("nested result for academy"), "Forward navigation should restore the redirected lookup.", afterForward);
    assert(afterForward.canGoBack && !afterForward.canGoForward, "Forward navigation should move the previous lookup back into back history.", afterForward);

    await page.locator(".lookup-pop[data-popup-id='root']").getByRole("button", { name: "Back" }).click();
    await page.waitForFunction(() => document.querySelector(".lookup-pop[data-popup-id='root']")?.textContent?.includes("classroom school room"));

    await dispatchGlossaryClick(page, "classroom");
    await page.waitForFunction(() => document.querySelectorAll(".lookup-pop").length === 2);
    const clickNested = await popupMetrics(page);
    assert(clickNested.nestedLookupCount === 1, "Plain left click inside glossary should trigger nested lookup callback.", clickNested);
    assert(clickNested.nestedLookupText.includes("classroom"), "Plain left click should select the glossary word under the pointer.", clickNested);
    assert(clickNested.popupCount === 2, "Plain left click inside glossary should append a child popup.", clickNested);
    assert(clickNested.nativeSelectionText === "", "Plain left click nested lookup should not leave a native browser selection.", clickNested);
    assert(clickNested.popupHighlightText.includes("classroom"), "Plain left click nested lookup should render a CSS Highlight selection.", clickNested);

    await dispatchShiftHover(page, "classroom");
    const nested = await popupMetrics(page);
    assert(nested.nestedLookupCount === 2, "Shift-hover inside glossary should trigger nested lookup callback.", nested);
    assert(nested.nestedLookupText.includes("classroom"), "Nested lookup should select the glossary word under the pointer.", nested);
    assert(nested.popupCount === 2, "Nested lookup should append a child popup.", nested);
    assert(nested.text.includes("nested result for classroom"), "Nested lookup child should render its own result.", nested);
    assert(nested.text.includes("classroom school room"), "Nested lookup should keep the root popup open.", nested);
    assert(nested.topPopupId.startsWith("child-"), "Nested lookup should make the child popup topmost.", nested);
    assert(nested.nativeSelectionText === "", "Shift-hover nested lookup should not leave a native browser selection.", nested);
    assert(nested.popupHighlightText.includes("classroom"), "Shift-hover nested lookup should render a CSS Highlight selection.", nested);

    await closeChildPopup(page);
    const childClosed = await popupMetrics(page);
    assert(childClosed.popupCount === 1, "Closing a child popup should keep the root popup open.", childClosed);
    assert(childClosed.rootClearSelectionSignal > nested.rootClearSelectionSignal, "Closing a child popup should signal parent selection clear.", { nested, childClosed });
    assert(childClosed.popupHighlightText === "", "Closing a child popup should clear the parent popup lookup highlight.", childClosed);

    await dispatchShiftHover(page, "Aことは A", 1);
    const japanesePrefix = await popupMetrics(page);
    assert(japanesePrefix.nestedLookupText.startsWith("こと"), "Nested lookup should start at the hovered Japanese text, not the preceding Latin token.", japanesePrefix);
    assert(!japanesePrefix.nestedLookupText.startsWith("A"), "Nested lookup should not include the preceding A token.", japanesePrefix);
    assert(japanesePrefix.popupCount === 2 && japanesePrefix.text.includes("nested result for こと"), "Japanese prefix nested lookup should render a child popup.", japanesePrefix);

    await dispatchShiftHover(page, "って「ことと言いなさい」", 3);
    const japaneseQuoted = await popupMetrics(page);
    assert(japaneseQuoted.nestedLookupText.startsWith("こと"), "Nested lookup should not backtrack into preceding quoted text.", japaneseQuoted);
    assert(!japaneseQuoted.nestedLookupText.startsWith("って"), "Nested lookup should not include the previous token before punctuation.", japaneseQuoted);

    await dispatchShiftHover(page, "ことは純日文", 0);
    const japanesePlain = await popupMetrics(page);
    assert(japanesePlain.nestedLookupText.startsWith("こと"), "Plain Japanese nested lookup should keep scanning after the hovered character.", japanesePlain);
    assert(japanesePlain.nestedLookupText !== "こ", "Plain Japanese nested lookup should not stop at the first character.", japanesePlain);

    await dispatchShiftHover(page, "school room");
    const secondNested = await popupMetrics(page);
    assert(secondNested.popupCount === 2, "A second root nested lookup should replace the previous child, not stack siblings.", secondNested);

    await page.locator(".lookup-pop[data-popup-id='root']").evaluate((popup) => {
      popup.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    const parentClicked = await popupMetrics(page);
    assert(parentClicked.popupCount === 1, "Interacting with a parent popup should close child popups.", parentClicked);
    assert(parentClicked.rootClearSelectionSignal > secondNested.rootClearSelectionSignal, "Parent interaction should clear the parent nested selection highlight.", { secondNested, parentClicked });
    assert(parentClicked.popupHighlightText === "", "Interacting with a parent popup should clear child lookup highlight.", parentClicked);

    await dispatchShiftHover(page, "school room");
    const nestedForScroll = await popupMetrics(page);
    assert(nestedForScroll.popupCount === 2, "Nested lookup should reopen a child before scroll-close validation.", nestedForScroll);

    await page.locator(".lookup-pop[data-popup-id='root'] .lookup-results").evaluate((el) => {
      el.scrollTop = 80;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll(".lookup-pop").length === 1);
    const scrolled = await popupMetrics(page);
    assert(scrolled.popupCount === 1, "Scrolling the parent popup should close child popups.", scrolled);
    assert(scrolled.scrollCloseCount >= 1, "Parent scroll should record child close behavior.", scrolled);
    assert(scrolled.popupHighlightText === "", "Scrolling the parent popup should clear child lookup highlight.", scrolled);

    await page.setViewportSize({ width: 360, height: 640 });
    await openProbe(page, "ready", { longResult: true });
    const narrow = await popupMetrics(page);
    assert(!narrow.horizontalOverflow, "Narrow lookup popup should not create horizontal overflow.", narrow);
    assert(narrow.popup.right <= narrow.viewport.width, "Narrow lookup popup should stay within the viewport.", narrow);

    console.log(JSON.stringify({ ready, mediaFailed, mediaNoTauri, nested, childClosed, scrolled, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
