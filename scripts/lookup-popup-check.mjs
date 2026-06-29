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
  if (options.topEdge) params.set("topEdge", "1");
  if (options.mediaMode) params.set("mediaMode", options.mediaMode);
  if (options.ankiMode) params.set("ankiMode", options.ankiMode);
  if (options.ankiAddMode) params.set("ankiAddMode", options.ankiAddMode);
  if (options.forceSync) params.set("forceSync", "enabled");
  if (options.allowDuplicates) params.set("allowDuplicates", "enabled");
  if (options.checkAllModels) params.set("checkAllModels", "enabled");
  if (options.duplicateScope) params.set("duplicateScope", options.duplicateScope);
  if (options.coverStoreMode) params.set("coverStoreMode", options.coverStoreMode);
  if (options.compactGlossaries) params.set("compactGlossaries", "enabled");
  if (options.coverField === false) params.set("coverField", "disabled");
  if (options.noBookId) params.set("noBookId", "1");
  if (options.firstRemoteMiss) params.set("firstRemoteMiss", "1");
  if (options.firstRemoteUnsafe) params.set("firstRemoteUnsafe", "1");
  if (options.audioAutoplay) params.set("audioAutoplay", "enabled");
  if (options.ankiStoreMode) params.set("ankiStoreMode", options.ankiStoreMode);
  if (options.ankiAudioStoreMode) params.set("ankiAudioStoreMode", options.ankiAudioStoreMode);
  if (options.localAudioStoreMode) params.set("localAudioStoreMode", options.localAudioStoreMode);
  if (options.localAudio) params.set("localAudio", "enabled");
  if (options.audioEnabled === false) params.set("audioEnabled", "disabled");
  if (options.audioField === false) params.set("audioField", "disabled");
  if (options.sasayakiField) params.set("sasayakiField", "enabled");
  if (options.sasayakiControls) params.set("sasayakiControls", "enabled");
  if (options.sasayakiPlaying) params.set("sasayakiPlaying", "enabled");
  if (options.sasayakiStoreMode) params.set("sasayakiStoreMode", options.sasayakiStoreMode);
  if (options.noSasayakiCue) params.set("noSasayakiCue", "1");
  if (options.emptyExpression) params.set("emptyExpression", "1");
  if (options.popupWidth) params.set("popupWidth", String(options.popupWidth));
  if (options.popupHeight) params.set("popupHeight", String(options.popupHeight));
  if (options.popupScale) params.set("popupScale", String(options.popupScale));
  if (options.importPopupWidth) params.set("importPopupWidth", String(options.importPopupWidth));
  if (options.importPopupHeight) params.set("importPopupHeight", String(options.importPopupHeight));
  if (options.importPopupScale) params.set("importPopupScale", String(options.importPopupScale));
  if (options.showReading) params.set("showReading", "1");
  if (options.scanLength) params.set("scanLength", String(options.scanLength));
  if (options.scanNonJapaneseText === false) params.set("scanNonJapaneseText", "disabled");
  if (options.collapseMode) params.set("collapseMode", options.collapseMode);
  if (options.expandFirstDictionary) params.set("expandFirstDictionary", "enabled");
  if (options.collapsedDictionaries) params.set("collapsedDictionaries", options.collapsedDictionaries.join("|"));
  if (options.dictionaryCompactGlossaries === false) params.set("dictionaryCompactGlossaries", "disabled");
  if (options.showExpressionTags) params.set("showExpressionTags", "enabled");
  if (options.harmonicFrequency) params.set("harmonicFrequency", "enabled");
  if (options.deduplicatePitchAccents) params.set("deduplicatePitchAccents", "enabled");
  if (options.compactPitchAccents === false) params.set("compactPitchAccents", "disabled");
  const url = `${origin}/?${params}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  try {
    await page.locator(".lookup-pop").waitFor({ timeout: 30000 });
  } catch (error) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.locator(".lookup-pop").waitFor({ timeout: 30000 });
  }
}

async function popupMetrics(page) {
  return page.evaluate(() => {
    const popup = document.querySelector(".lookup-pop");
    const results = document.querySelector(".lookup-results");
    const state = document.querySelector(".probe-state");
    const styledGlossary = document.querySelector(".lookup-glossary-content .gloss-sc-div");
    const safeInlineStyle = document.querySelector('.lookup-glossary-content [data-sc-class="probe-inline-style-safe"]');
    const unsafeInlineStyle = document.querySelector('.lookup-glossary-content [data-sc-class="probe-inline-style-unsafe"]');
    const head = document.querySelector(".lookup-head");
    const anki = document.querySelector(".lookup-anki");
    const audio = document.querySelector(".lookup-audio");
    const controls = document.querySelector(".probe-ctrls");
    const content = document.querySelector(".lookup-content");
    const expression = document.querySelector(".lookup-expression");
    const reading = document.querySelector(".lookup-reading");
    const glossary = document.querySelector(".lookup-glossary-content");
    const glossaryItem = document.querySelector(".lookup-glossary");
    const glossaryDictionary = document.querySelector(".lookup-glossary-dict");
    const pitchList = document.querySelector(".pitch-list");
    const rect = popup instanceof HTMLElement
      ? popup.getBoundingClientRect()
      : { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
    const popupRects = Array.from(document.querySelectorAll(".lookup-pop")).map((node) => {
      const nodeRect = node.getBoundingClientRect();
      return {
        id: node instanceof HTMLElement ? node.dataset.popupId ?? "" : "",
        x: nodeRect.x,
        y: nodeRect.y,
        width: nodeRect.width,
        height: nodeRect.height,
        right: nodeRect.right,
        bottom: nodeRect.bottom,
      };
    });
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
      nestedLookupAnchor: JSON.parse(state?.getAttribute("data-nested-lookup-anchor") ?? "null"),
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
      coverStoreCount: Number(state?.getAttribute("data-cover-store-count") ?? 0),
      coverLastBookId: state?.getAttribute("data-cover-last-book-id") ?? "",
      sasayakiStoreCount: Number(state?.getAttribute("data-sasayaki-store-count") ?? 0),
      sasayakiLastRequest: JSON.parse(state?.getAttribute("data-sasayaki-last-request") ?? "null"),
      operationEvents: state?.getAttribute("data-operation-events") ?? "",
      wordAudioPrepareCount: Number(state?.getAttribute("data-word-audio-prepare-count") ?? 0),
      wordAudioLastRequest: JSON.parse(state?.getAttribute("data-word-audio-last-request") ?? "null"),
      sasayakiActionCount: Number(state?.getAttribute("data-sasayaki-action-count") ?? 0),
      sasayakiLastAction: JSON.parse(state?.getAttribute("data-sasayaki-last-action") ?? "null"),
      sasayakiPlaying: state?.getAttribute("data-sasayaki-playing") === "true",
      sasayakiControls: document.querySelectorAll(".lookup-sasayaki-controls button").length,
      popup: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
      popups: popupRects,
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
      gaijiMediaImages: document.querySelectorAll('.lookup-glossary-content [data-sc-img][data-sc-class="gaiji"] .gloss-media-image').length,
      mediaImageMaxHeight: (() => {
        const image = Array.from(document.querySelectorAll(".lookup-glossary-content .gloss-media-image"))
          .find((node) => node instanceof HTMLElement && !node.closest('[data-sc-img][data-sc-class="gaiji"]'));
        return image instanceof HTMLElement ? getComputedStyle(image).maxHeight : "";
      })(),
      gaijiImageMaxHeight: (() => {
        const image = document.querySelector('.lookup-glossary-content [data-sc-img][data-sc-class="gaiji"] .gloss-media-image');
        return image instanceof HTMLElement ? getComputedStyle(image).maxHeight : "";
      })(),
      gaijiImageDisplay: (() => {
        const image = document.querySelector('.lookup-glossary-content [data-sc-img][data-sc-class="gaiji"] .gloss-media-image');
        return image instanceof HTMLElement ? getComputedStyle(image).display : "";
      })(),
      gaijiContainerWidth: (() => {
        const container = document.querySelector('.lookup-glossary-content [data-sc-img][data-sc-class="gaiji"] .gloss-image-container');
        return container instanceof HTMLElement ? getComputedStyle(container).width : "";
      })(),
      glossaryGroups: document.querySelectorAll(".lookup-glossary-group").length,
      openGlossaryGroups: document.querySelectorAll(".lookup-glossary-group[open]").length,
      compactGlossariesClass: document.querySelector(".lookup-content")?.classList.contains("compact-glossaries") ?? false,
      compactPitchClass: document.querySelector(".lookup-content")?.classList.contains("compact-pitch") ?? false,
      expressionTags: Array.from(document.querySelectorAll(".lookup-glossary-group > .lookup-tags .lookup-tag")).map((node) => node.textContent ?? ""),
      pitchPositions: Array.from(document.querySelectorAll(".pitch-position")).map((node) => node.textContent ?? ""),
      dictionarySettings: JSON.parse(state?.getAttribute("data-dictionary-settings") ?? "{}"),
      importPopupSettings: JSON.parse(state?.getAttribute("data-import-popup-settings") ?? "{}"),
      renderPopupSettings: JSON.parse(state?.getAttribute("data-render-popup-settings") ?? "{}"),
      importedDictionaryRecords: JSON.parse(state?.getAttribute("data-imported-dictionary-records") ?? "[]"),
      redirectLinks: document.querySelectorAll(".lookup-glossary-content a[data-lookup-redirect]").length,
      canGoBack: !document.querySelector(".lookup-pop[data-popup-id='root'] button[aria-label='Back']")?.hasAttribute("disabled"),
      canGoForward: !document.querySelector(".lookup-pop[data-popup-id='root'] button[aria-label='Forward']")?.hasAttribute("disabled"),
      resultsScrollTop: document.querySelector(".lookup-pop[data-popup-id='root'] .lookup-results")?.scrollTop ?? 0,
      dictionaryStyleTags: Array.from(document.head.querySelectorAll("style"))
        .filter((style) => style.textContent?.includes(".lookup-glossary-content .gloss-sc-div")).length,
      dictionaryStyledColor: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).color : "",
      dictionaryStyledPosition: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).position : "",
      dictionaryStyledBackgroundImage: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).backgroundImage : "",
      dictionaryStyledFontSize: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).fontSize : "",
      dictionaryStyledLineHeight: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).lineHeight : "",
      dictionaryStyledWidth: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).width : "",
      dictionaryStyledHeight: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).height : "",
      dictionaryStyledMaxHeight: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).maxHeight : "",
      dictionaryStyledTransform: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).transform : "",
      dictionaryStyledZoom: styledGlossary instanceof HTMLElement ? getComputedStyle(styledGlossary).zoom : "",
      structuredInlineColor: safeInlineStyle instanceof HTMLElement ? getComputedStyle(safeInlineStyle).color : "",
      structuredInlineFontWeight: safeInlineStyle instanceof HTMLElement ? getComputedStyle(safeInlineStyle).fontWeight : "",
      structuredInlineFontSize: safeInlineStyle instanceof HTMLElement ? getComputedStyle(safeInlineStyle).fontSize : "",
      structuredInlineMarginLeft: safeInlineStyle instanceof HTMLElement ? getComputedStyle(safeInlineStyle).marginLeft : "",
      unsafeInlinePosition: unsafeInlineStyle instanceof HTMLElement ? getComputedStyle(unsafeInlineStyle).position : "",
      unsafeInlineBackgroundImage: unsafeInlineStyle instanceof HTMLElement ? getComputedStyle(unsafeInlineStyle).backgroundImage : "",
      unsafeInlineColor: unsafeInlineStyle instanceof HTMLElement ? getComputedStyle(unsafeInlineStyle).color : "",
      headColor: head instanceof HTMLElement ? getComputedStyle(head).color : "",
      ankiDisplay: anki instanceof HTMLElement ? getComputedStyle(anki).display : "",
      audioDisplay: audio instanceof HTMLElement ? getComputedStyle(audio).display : "",
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      contentFontFamily: content instanceof HTMLElement ? getComputedStyle(content).fontFamily : "",
      expressionFontSize: expression instanceof HTMLElement ? getComputedStyle(expression).fontSize : "",
      readingFontSize: reading instanceof HTMLElement ? getComputedStyle(reading).fontSize : "",
      glossaryFontSize: glossary instanceof HTMLElement ? getComputedStyle(glossary).fontSize : "",
      glossaryLineHeight: glossary instanceof HTMLElement ? getComputedStyle(glossary).lineHeight : "",
      glossaryItemFontSize: glossaryItem instanceof HTMLElement ? getComputedStyle(glossaryItem).fontSize : "",
      glossaryDictionaryFontSize: glossaryDictionary instanceof HTMLElement ? getComputedStyle(glossaryDictionary).fontSize : "",
      pitchFontSize: pitchList instanceof HTMLElement ? getComputedStyle(pitchList).fontSize : "",
      actionSlotWidth: anki instanceof HTMLElement ? getComputedStyle(anki).width : "",
    };
  });
}

async function dispatchShiftHover(page, text, offsetInText = null) {
  const before = Number(await page.locator(".probe-state").getAttribute("data-nested-lookup-count") ?? 0);
  await dispatchGlossaryPointer(page, text, "pointermove", { shiftKey: true, offsetInText });
  await page.waitForFunction(
    (count) => Number(document.querySelector(".probe-state")?.getAttribute("data-nested-lookup-count") ?? 0) > count,
    before,
  );
  await page.waitForFunction(() => {
    const popups = Array.from(document.querySelectorAll(".lookup-pop"));
    return popups.length > 1 && popups[popups.length - 1]?.getAttribute("data-state") === "ready";
  });
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

    textNode.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
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

async function dispatchPopupShiftSequence(page, text, offsets, cancelWithKeyUp = false) {
  return page.evaluate(({ needle, requestedOffsets, cancel }) => {
    const content = document.querySelector(".lookup-pop[data-popup-id='root'] .lookup-glossary-content");
    if (!(content instanceof HTMLElement)) throw new Error("Root glossary content not found.");
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let textNode = null;
    let baseOffset = -1;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const index = node.textContent?.indexOf(needle) ?? -1;
      if (index >= 0) {
        textNode = node;
        baseOffset = index;
        break;
      }
    }
    if (!textNode || baseOffset < 0) throw new Error(`Popup sequence text not found: ${needle}`);
    textNode.parentElement?.scrollIntoView({ block: "center", inline: "nearest" });
    const rects = requestedOffsets.map((localOffset) => {
      const range = document.createRange();
      range.setStart(textNode, baseOffset + localOffset);
      range.setEnd(textNode, baseOffset + localOffset + 1);
      const rect = range.getBoundingClientRect();
      range.detach();
      return rect;
    });
    const vertical = rects.length > 1 && Math.abs(rects[0].left - rects[1].left) < 2;
    const points = rects.map((rect, index) => {
      if (rects.length === 1) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      if (vertical) {
        return index === 0
          ? { x: rect.left + rect.width / 2, y: rect.bottom - 1 }
          : { x: rect.left + rect.width / 2, y: rect.top + 1 };
      }
      return index === 0
        ? { x: rect.right - 1, y: rect.top + rect.height / 2 }
        : { x: rect.left + 1, y: rect.top + rect.height / 2 };
    });
    for (const point of points) {
      content.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: point.x,
        clientY: point.y,
        shiftKey: true,
      }));
    }
    if (cancel) window.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
    return points.length > 1 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : 0;
  }, { needle: text, requestedOffsets: offsets, cancel: cancelWithKeyUp });
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

    await openProbe(page, "ready", { longResult: true, showReading: true });
    await page.waitForFunction(() => {
      const target = document.querySelector(".lookup-glossary-content .gloss-sc-div");
      return target instanceof HTMLElement && getComputedStyle(target).color === "rgb(123, 210, 145)";
    });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length >= 2
    ));
    const ready = await popupMetrics(page);
    assert(Math.abs(ready.popup.width - 320) <= 1 && Math.abs(ready.popup.height - 250) <= 1, "Default popup outer frame should be 320 x 250.", ready);
    assert(ready.text.includes("school"), "Ready popup should render expression.", ready);
    assert(ready.contentFontFamily.includes("Yu Mincho"), "Popup content should use the reader body font stack.", ready);
    assert(ready.expressionFontSize === "26px" && ready.readingFontSize === "13px", "Scale 1 should use upstream expression and reading sizes.", ready);
    assert(ready.glossaryFontSize === "14px" && ready.glossaryItemFontSize === "14px" && ready.glossaryDictionaryFontSize === "10px", "Scale 1 should apply compact glossary defaults while preserving the type hierarchy.", ready);
    assert(Math.abs(parseFloat(ready.glossaryLineHeight) - 18.48) < 0.1 && ready.pitchFontSize === "12px", "Scale 1 should apply HSA compact glossary and pitch defaults.", ready);
    assert(ready.compactGlossariesClass && ready.compactPitchClass, "HSA compact glossary and pitch defaults should be active.", ready);
    assert(ready.actionSlotWidth === "28px", "Scale 1 should keep result-level action slots at 28 px.", ready);
    assert(ready.lookupResultRows >= 5 && ready.text.includes("extra rendered lookup result 5"), "Ready popup should render all backend lookup results, not only the first three.", ready);
    assert(ready.text.includes("Jitendex.org [probe]"), "Ready popup should render dictionary source.", ready);
    assert(ready.text.includes("No CSS Dictionary [probe]") && ready.text.includes("plain dictionary entry without imported CSS"), "Ready popup should render dictionaries that have no imported CSS.", ready);
    assert(ready.lookupTextRows === 0, "Ready popup should not render the original selected text row.", ready);
    assert(ready.lookupMetaRows === 0, "Ready popup should not render the dictionary source meta row.", ready);
    assert(ready.text.includes("classroom school room"), "Ready popup should render structured glossary as readable text.", ready);
    assert(!ready.text.includes("structured-content") && !ready.text.includes("\"tag\""), "Ready popup should not expose raw structured glossary JSON.", ready);
    assert(ready.structuredListItems >= 2 && ready.structuredBreaks >= 1, "Ready popup should preserve structured glossary list and line breaks.", ready);
    assert(ready.structuredTables >= 1, "Ready popup should preserve structured glossary tables.", ready);
    assert(ready.structuredRuby >= 1, "Ready popup should preserve structured glossary ruby.", ready);
    assert(ready.mediaPlaceholders >= 6, "Ready popup should render safe placeholders for dictionary media.", ready);
    assert(ready.mediaLoaded >= 6 && ready.mediaImages >= 6, "Ready popup should lazy-load tag and type dictionary media into images.", ready);
    assert(ready.gaijiMediaImages >= 5, "Ready popup should hydrate MK3 gaiji SVG media into inline images.", ready);
    assert(ready.mediaErrors === 0 && ready.mediaLoading === 0, "Successful dictionary media should not remain loading or error.", ready);
    assert(ready.mediaImageMaxHeight === "180px", "Dictionary media image should be constrained inside the popup.", ready);
    assert(ready.gaijiImageMaxHeight !== "180px" && ready.gaijiContainerWidth !== "" && Number.parseFloat(ready.gaijiContainerWidth) < 32, "MK3 gaiji SVG media should stay inline and small rather than rendering as block media cards.", ready);
    assert(ready.glossaryGroups >= 2, "Ready popup should group glossary entries by dictionary.", ready);
    assert(ready.redirectLinks >= 1, "Ready popup should render dictionary cross-reference links.", ready);
    assert(!ready.canGoBack && !ready.canGoForward, "Root popup should start without redirect history.", ready);
    assert(ready.dictionaryStyleTags >= 1, "Ready popup should inject scoped dictionary CSS.", ready);
    assert(ready.dictionaryStyledColor === "rgb(123, 210, 145)", "Dictionary CSS should affect glossary content.", ready);
    assert(ready.dictionaryStyledPosition !== "fixed", "Dictionary CSS sanitizer should block fixed positioning.", ready);
    assert(ready.dictionaryStyledBackgroundImage === "none", "Dictionary CSS sanitizer should block remote image URLs.", ready);
    assert(ready.dictionaryStyledFontSize !== "42px" && ready.dictionaryStyledFontSize === ready.glossaryFontSize, "Dictionary CSS sanitizer should block imported font-size overrides.", ready);
    assert(ready.dictionaryStyledLineHeight !== "126px", "Dictionary CSS sanitizer should block imported line-height overrides.", ready);
    assert(ready.dictionaryStyledWidth !== "640px" && ready.dictionaryStyledHeight !== "480px" && ready.dictionaryStyledMaxHeight !== "900px", "Dictionary CSS sanitizer should block imported box-size overrides.", ready);
    assert(ready.dictionaryStyledTransform === "none" && ready.dictionaryStyledZoom === "1", "Dictionary CSS sanitizer should block imported transform and zoom overrides.", ready);
    assert(ready.structuredInlineColor === "rgb(30, 144, 255)", "Structured glossary inline color should be preserved for Yomitan style objects.", ready);
    assert(Number.parseInt(ready.structuredInlineFontWeight, 10) >= 700, "Structured glossary inline font weight should be preserved.", ready);
    assert(ready.structuredInlineFontSize === "16.8px", "Structured glossary inline font size should be preserved.", ready);
    assert(Math.abs(Number.parseFloat(ready.structuredInlineMarginLeft) + 8.4) < 0.1, "Structured glossary inline margin should be preserved.", ready);
    assert(ready.unsafeInlinePosition !== "fixed", "Structured glossary inline style should reject positioning escape properties.", ready);
    assert(ready.unsafeInlineBackgroundImage === "none", "Structured glossary inline style should reject remote image URLs.", ready);
    assert(ready.unsafeInlineColor === "rgb(5, 6, 7)", "Structured glossary inline rgb colors should remain allowed while unsafe properties are dropped.", ready);
    assert(ready.headColor !== "rgb(255, 0, 0)", "Dictionary CSS should not style popup chrome.", ready);
    assert(ready.ankiDisplay !== "none", "Dictionary CSS should not style popup action buttons.", ready);
    assert(ready.bodyBackground !== "rgb(255, 0, 0)", "Dictionary CSS should not style the page body.", ready);
    assert(ready.text.includes("education") && ready.text.includes("place"), "Ready popup should render glossary definition tags.", ready);
    assert(ready.headerActions >= 1, "Ready popup should render HSA-style header actions.", ready);
    assert(ready.importPopupSettings.width === ready.renderPopupSettings.width && ready.importPopupSettings.scale === ready.renderPopupSettings.scale, "Default probe import and render popup settings should match.", ready);
    assert(ready.importedDictionaryRecords.length === 2 && ready.importedDictionaryRecords.some((record) => record.styleSource === ""), "Probe import metadata should include CSS and no-CSS dictionaries.", ready);
    assert(ready.audioButtons >= 1 && ready.audioDisabled, "Word audio button should render as a disabled boundary.", ready);
    assert(ready.audioTitle.includes("No enabled"), "Disabled audio affordance should describe missing configuration.", ready);
    assert(ready.frequencyGroups >= 1 && ready.frequencyDictLabels.includes("Freq Probe") && ready.text.includes("120"), "Ready popup should render frequency as dictionary pills.", ready);
    assert(ready.pitchGroups >= 1 && ready.pitchVisuals >= 1 && ready.text.includes("school"), "Ready popup should render pitch as grouped pitch rows.", ready);
    assert(ready.lookupDetailRows === 0 && !ready.text.includes("FreqPitch"), "Ready popup should not render old Freq/Pitch detail rows.", ready);

    await openProbe(page, "ready", {
      collapseMode: "collapseAll",
      expandFirstDictionary: true,
      showExpressionTags: true,
      harmonicFrequency: true,
      deduplicatePitchAccents: true,
      compactPitchAccents: false,
      dictionaryCompactGlossaries: false,
    });
    const settingsReady = await popupMetrics(page);
    assert(settingsReady.openGlossaryGroups === 1, "Collapse-all with expand-first should keep only the first glossary group open.", settingsReady);
    assert(settingsReady.expressionTags.includes("n") && settingsReady.expressionTags.includes("common"), "Show expression tags should reveal glossary term tags.", settingsReady);
    assert(settingsReady.frequencyDictLabels.includes("Harmonic"), "Harmonic frequency should add an aggregate frequency pill.", settingsReady);
    assert(settingsReady.pitchPositions.filter((value) => value === "[2]").length === 1, "Deduplicate pitch accents should remove repeated pitch positions across dictionaries.", settingsReady);
    assert(!settingsReady.compactGlossariesClass && !settingsReady.compactPitchClass, "Compact settings should be toggleable in the popup renderer.", settingsReady);
    assert(ready.ankiAriaLabel === "Anki not configured" && ready.ankiDisabled, "Anki boundary should remain disabled.", ready);
    assert(ready.ankiTitle.includes("Probe Book"), "Anki payload title should be exposed as disabled affordance text.", ready);
    assert(ready.ankiPreviewButtons === 0 && ready.ankiPreviewRows === 0, "Manual Anki field preview controls should be removed.", ready);
    assert(ready.hasResultsScroller, "Long ready results should scroll inside the popup.", ready);
    assert(ready.resultsScrollbarWidth === 0, "Long ready results should hide the visual scrollbar while remaining scrollable.", ready);

    await openProbe(page, "ready", { ankiMode: "configured" });
    const configuredAnki = await popupMetrics(page);
    assert(!configuredAnki.ankiDisabled && configuredAnki.ankiAriaLabel === "Add to Anki", "Configured Anki action should be enabled as a header icon.", configuredAnki);
    assert(!configuredAnki.audioDisabled && configuredAnki.audioTitle.includes("Play word audio"), "Configured word audio action should be enabled.", configuredAnki);
    await page.getByRole("button", { name: "Play audio" }).first().click();
    await page.waitForFunction(() => Number(document.querySelector(".probe-state")?.getAttribute("data-word-audio-prepare-count") ?? 0) === 1);
    const playedAudio = await popupMetrics(page);
    assert(playedAudio.wordAudioLastRequest.expression === "school" && playedAudio.wordAudioLastRequest.sources[0].id === "probe", "Playback should call the shared resolver with lookup text and stable source settings.", playedAudio);
    assert(configuredAnki.ankiPreviewButtons === 0 && configuredAnki.ankiPreviewRows === 0, "Configured popup should not expose manual Anki preview UI.", configuredAnki);

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiControls: true });
    const sasayakiControls = await popupMetrics(page);
    assert(sasayakiControls.sasayakiControls === 3, "Root lookup with a matched Sasayaki cue should expose replay, toggle, and play-forward controls.", sasayakiControls);
    const replayPointerPreservedSelection = await page.getByRole("button", { name: "Replay Sasayaki cue", exact: true }).evaluate((button) => {
      const event = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      return event.defaultPrevented;
    });
    assert(replayPointerPreservedSelection, "Replay pointerdown should preserve the reader selection so the root popup stays open.", replayPointerPreservedSelection);
    await page.getByRole("button", { name: "Play audio" }).first().click();
    await page.waitForFunction(() => Number(document.querySelector(".probe-state")?.getAttribute("data-word-audio-prepare-count") ?? 0) === 1);
    await page.getByRole("button", { name: "Replay Sasayaki cue", exact: true }).click();
    const replaySasayaki = await popupMetrics(page);
    assert(replaySasayaki.sasayakiLastAction.action === "replayCue" && replaySasayaki.sasayakiLastAction.popupId === "root", "Replay should target the root popup Sasayaki cue.", replaySasayaki);
    assert(replaySasayaki.popupCount === 1, "Replay should keep the root dictionary popup open.", replaySasayaki);
    assert(replaySasayaki.audioTitle.includes("Play word audio"), "Sasayaki controls should stop any active popup word audio before acting.", replaySasayaki);
    await page.getByRole("button", { name: "Play Sasayaki", exact: true }).click();
    const toggledSasayaki = await popupMetrics(page);
    assert(toggledSasayaki.sasayakiLastAction.action === "togglePlayback" && toggledSasayaki.sasayakiPlaying, "Toggle should update the Sasayaki playback state.", toggledSasayaki);
    assert(toggledSasayaki.popupCount === 1, "Toggle playback should keep the root dictionary popup open.", toggledSasayaki);
    await page.getByRole("button", { name: "Play Sasayaki from this cue", exact: true }).click();
    const forwardSasayaki = await popupMetrics(page);
    assert(forwardSasayaki.sasayakiLastAction.action === "playForward", "Play-forward should dispatch the HSA root popup Sasayaki action.", forwardSasayaki);

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiControls: true, noSasayakiCue: true });
    const noCueSasayaki = await popupMetrics(page);
    assert(noCueSasayaki.sasayakiControls === 0, "Lookup popups without a matched Sasayaki cue should not show cue controls.", noCueSasayaki);

    await openProbe(page, "ready", { ankiMode: "configured" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiAdded = await popupMetrics(page);
    assert(ankiAdded.ankiAddCount === 1, "Add Anki should call the note creation callback once.", ankiAdded);
    assert(ankiAdded.ankiStoreCount === 1, "Add Anki should store dictionary media before note creation.", ankiAdded);
    assert(ankiAdded.ankiLastMedia.length >= 6 && ankiAdded.ankiLastMedia.every((item) => item.filename.startsWith("hsw_")), "Stored media request should use deterministic HSW filenames.", ankiAdded);
    assert(ankiAdded.ankiLastMedia.some((item) => item.path === "gaiji/bs一.svg") && ankiAdded.ankiLastMedia.some((item) => item.path === "gaiji/ws一.svg"), "Stored media request should include MK3 bs/ws one gaiji references.", ankiAdded);
    assert(ankiAdded.ankiLastMedia.some((item) => item.path === "gaiji/参照.svg"), "Stored media request should include MK3 reference gaiji references.", ankiAdded);
    assert(ankiAdded.ankiLastMedia.some((item) => item.path === "gaiji/参考.svg"), "Stored media request should include Yomitan type:image gaiji references.", ankiAdded);
    assert(ankiAdded.ankiLastDeck === "Mining" && ankiAdded.ankiLastModel === "Hoshi Vocabulary", "Add Anki should send selected deck and note type.", ankiAdded);
    assert(ankiAdded.ankiLastRequest.tags.join(" ") === "hoshi-reader mining", "Add Anki should send configured whitespace-separated tags.", ankiAdded);
    assert(ankiAdded.ankiLastRequest.allowDuplicates === false && ankiAdded.ankiLastRequest.duplicateScope === "collection", "Add Anki should send default duplicate policy.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Expression === "school / school", "Add Anki should send rendered field values.", ankiAdded);
    assert(ankiAdded.ankiLastFields.ExpressionFurigana === "school ", "Add Anki should render the HSA furigana-plain field.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Sentence === "The academy <b>school</b> sentence contains the selected lookup term in a longer source paragraph.", "Add Anki should bold the selected lookup term in sentence context.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("classroom school room") && !ankiAdded.ankiLastFields.Meaning.includes("\"tag\""), "Add Anki should send rendered structured glossary values.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("yomitan-glossary"), "Add Anki should wrap glossary HTML in an HSA/Lapis-compatible glossary container.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('data-dictionary="Jitendex.org [probe]"'), "Add Anki should preserve dictionary identity for note template CSS.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('.yomitan-glossary [data-dictionary="Jitendex.org [probe]"] .gloss-sc-div'), "Anki glossary-first should inline scoped CSS for the first glossary dictionary.", ankiAdded);
    assert(!ankiAdded.ankiLastFields.Meaning.includes('data-dictionary="JMdict [probe]"] li'), "Anki glossary-first should not inline CSS for dictionaries outside the first glossary entry.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("position: static"), "Anki dictionary CSS should sanitize fixed positioning.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes("background-image: none"), "Anki dictionary CSS should sanitize remote image URLs.", ankiAdded);
    assert(!ankiAdded.ankiLastFields.Meaning.includes("@import") && !ankiAdded.ankiLastFields.Meaning.includes("example.invalid") && !ankiAdded.ankiLastFields.Meaning.includes("body {"), "Anki dictionary CSS should not export unsafe stylesheet constructs.", ankiAdded);
    assert(ankiAdded.ankiLastFields.FullGlossary.includes('.yomitan-glossary [data-dictionary="Jitendex.org [probe]"] .gloss-sc-div') && ankiAdded.ankiLastFields.FullGlossary.includes('.yomitan-glossary [data-dictionary="JMdict [probe]"] li'), "Anki full glossary should inline scoped CSS for each represented dictionary.", ankiAdded);
    assert((ankiAdded.ankiLastFields.FullGlossary.match(/data-dictionary="Jitendex\.org \[probe\]"] \.gloss-sc-div/g) ?? []).length === 1, "Anki full glossary should not duplicate CSS for repeated entries from one dictionary.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('data-sc-headword="school"'), "Add Anki should preserve structured glossary data attributes.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('data-sc-red=""') && ankiAdded.ankiLastFields.Meaning.includes("color:#ff3333"), "Add Anki should preserve MK3 red bracket styling inside glossary HTML.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Meaning.includes('<img class="gloss-image gloss-media-image" src="stored_hsw_') && ankiAdded.ankiLastFields.Meaning.includes('data-sc-class="gaiji"'), "Add Anki should render inline gaiji media as stored SVG images inside glossary HTML.", ankiAdded);
    assert(!ankiAdded.ankiLastFields.Meaning.includes(">gaiji/bs一.svg<") && !ankiAdded.ankiLastFields.Meaning.includes(">gaiji/参照.svg<"), "Add Anki should not leave MK3 gaiji media paths as glossary text.", ankiAdded);
    assert(ankiAdded.ankiLastFields.JmOnly.includes("school; a place of study") && ankiAdded.ankiLastFields.JmOnly.includes('data-dictionary="JMdict [probe]"'), "Add Anki should send dictionary-specific glossary values with template-compatible wrappers.", ankiAdded);
    assert(ankiAdded.ankiLastFields.JmOnly.includes('.yomitan-glossary [data-dictionary="JMdict [probe]"] li'), "Dictionary-specific Anki glossary fields should inline scoped CSS for their dictionary.", ankiAdded);
    assert(ankiAdded.ankiLastFields.MissingDict === "", "Unknown dictionary-specific glossary tokens should render empty.", ankiAdded);
    assert(ankiAdded.ankiAudioStoreCount === 1, "Add Anki should store remote word audio before note creation.", ankiAdded);
    assert(ankiAdded.ankiLastAudioRequest.expression === "school" && ankiAdded.ankiLastAudioRequest.reading === "school", "Remote audio request should use lookup expression and reading.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Audio === "[sound:hsw_audio_probe.mp3]", "Add Anki should render the stored word audio filename.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Pitch === '<ol><li><span style="display:inline;"><span>[</span><span>0</span><span>]</span></span></li><li><span style="display:inline;"><span>[</span><span>2</span><span>]</span></span></li></ol>', "Add Anki should render HSA-style pitch accent positions.", ankiAdded);
    assert(ankiAdded.coverStoreCount === 1 && ankiAdded.coverLastBookId === "probe-book", "Referenced book cover should be stored by bookId.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Picture === '<img src="hsw_cover_probe.jpg">', "Stored cover should render into the book-cover field.", ankiAdded);
    assert(ankiAdded.operationEvents === "dictionary,cover,audio,add", "Media should store in dictionary-cover-audio order before addNote.", ankiAdded);
    assert(ankiAdded.ankiLastFields.Media.includes("<img src=\"stored_hsw_") && ankiAdded.ankiLastFields.Media.includes(".svg"), "Add Anki should include stored dictionary media filenames.", ankiAdded);
    assert(ankiAdded.text.includes("Added Anki note 4242."), "Added state should show the Anki note id message.", ankiAdded);
    assert(ankiAdded.text.includes("Word audio stored as hsw_audio_probe.mp3"), "Add state should expose stored word audio.", ankiAdded);

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiField: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiSasayaki = await popupMetrics(page);
    assert(
      ankiSasayaki.operationEvents === "dictionary,cover,audio,sasayaki,add",
      "Sasayaki audio should store after word audio and before addNote.",
      ankiSasayaki,
    );
    assert(
      ankiSasayaki.sasayakiStoreCount === 1 &&
        ankiSasayaki.sasayakiLastRequest.bookId === "probe-book" &&
        ankiSasayaki.sasayakiLastRequest.cueId === "cue-42" &&
        ankiSasayaki.sasayakiLastRequest.sentence === "The academy school sentence contains the selected lookup term in a longer source paragraph.",
      "Sasayaki export should pass bookId, cueId, and the Anki sentence context.",
      ankiSasayaki,
    );
    assert(
      ankiSasayaki.ankiLastFields.SentenceAudio === "[sound:hsw_sasayaki_probe.wav]",
      "Stored Sasayaki WAV should render through the sentence-audio token.",
      ankiSasayaki,
    );

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiField: true, sasayakiStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiMissingSasayaki = await popupMetrics(page);
    assert(
      ankiMissingSasayaki.sasayakiStoreCount === 1 &&
        ankiMissingSasayaki.ankiAddCount === 1 &&
        ankiMissingSasayaki.ankiLastFields.SentenceAudio === "",
      "Missing Sasayaki cues should warn and continue with a text note.",
      ankiMissingSasayaki,
    );
    assert(ankiMissingSasayaki.text.includes("no longer matched"), "Missing Sasayaki warning should be visible.", ankiMissingSasayaki);

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiField: true, noSasayakiCue: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiNoActiveCue = await popupMetrics(page);
    assert(
      ankiNoActiveCue.sasayakiStoreCount === 0 &&
        ankiNoActiveCue.ankiAddCount === 1 &&
        ankiNoActiveCue.text.includes("No matched Sasayaki cue is active"),
      "No active cue should skip native storage, warn, and continue.",
      ankiNoActiveCue,
    );

    await openProbe(page, "ready", { ankiMode: "configured", sasayakiField: true, sasayakiStoreMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiUnsafeSasayaki = await popupMetrics(page);
    assert(
      ankiUnsafeSasayaki.sasayakiStoreCount === 1 && ankiUnsafeSasayaki.ankiAddCount === 0,
      "Unsafe Sasayaki sidecars should stop note creation.",
      ankiUnsafeSasayaki,
    );
    assert(ankiUnsafeSasayaki.text.includes("escapes"), "Unsafe Sasayaki error should be visible.", ankiUnsafeSasayaki);

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

    await openProbe(page, "ready", { ankiMode: "configured", compactGlossaries: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiCompactGlossary = await popupMetrics(page);
    assert(ankiCompactGlossary.ankiLastFields.Meaning.includes(".yomitan-glossary li{margin:.1em 0}"), "Compact glossary setting should inject card-only compact CSS.", ankiCompactGlossary);

    await openProbe(page, "ready", { ankiMode: "configured", coverStoreMode: "missing" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiMissingCover = await popupMetrics(page);
    assert(ankiMissingCover.ankiAddCount === 1 && ankiMissingCover.ankiLastFields.Picture === "", "Missing cover should continue with a text card.", ankiMissingCover);
    assert(ankiMissingCover.text.includes("Book cover is not available."), "Missing cover warning should remain visible.", ankiMissingCover);

    await openProbe(page, "ready", { ankiMode: "configured", coverStoreMode: "error" });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiUnsafeCover = await popupMetrics(page);
    assert(ankiUnsafeCover.coverStoreCount === 1 && ankiUnsafeCover.ankiAddCount === 0, "Unsafe cover path should block note creation.", ankiUnsafeCover);

    await openProbe(page, "ready", { ankiMode: "configured", coverField: false });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiWithoutCoverField = await popupMetrics(page);
    assert(ankiWithoutCoverField.coverStoreCount === 0 && ankiWithoutCoverField.ankiAddCount === 1, "Notes without book-cover token should skip cover storage.", ankiWithoutCoverField);

    await openProbe(page, "ready", { ankiMode: "configured", noBookId: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiLegacyBook = await popupMetrics(page);
    assert(ankiLegacyBook.coverStoreCount === 0 && ankiLegacyBook.ankiAddCount === 1 && ankiLegacyBook.ankiLastFields.Picture === "", "Legacy books without bookId should create cards without reading frontend paths.", ankiLegacyBook);

    await openProbe(page, "ready", { ankiMode: "configured", firstRemoteMiss: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiRemoteFallback = await popupMetrics(page);
    assert(ankiRemoteFallback.ankiAudioStoreCount === 2 && ankiRemoteFallback.ankiLastFields.Audio === "[sound:hsw_audio_probe.mp3]", "A remote miss should continue to the next enabled source.", ankiRemoteFallback);
    assert(ankiRemoteFallback.text.includes("Missing Audio") && ankiRemoteFallback.text.includes("HTTP 404"), "Earlier remote-source warnings should remain visible after fallback succeeds.", ankiRemoteFallback);

    await openProbe(page, "ready", { ankiMode: "configured", firstRemoteUnsafe: true });
    await page.getByRole("button", { name: "Add to Anki" }).click();
    const ankiUnsafeFirstRemote = await popupMetrics(page);
    assert(ankiUnsafeFirstRemote.ankiAudioStoreCount === 1 && ankiUnsafeFirstRemote.ankiAddCount === 0, "A hard error in the first remote source should stop fallback and note creation.", ankiUnsafeFirstRemote);

    await openProbe(page, "ready", { ankiMode: "configured", audioAutoplay: true });
    await page.waitForFunction(() => Number(document.querySelector(".probe-state")?.getAttribute("data-word-audio-prepare-count") ?? 0) === 1);
    const autoplayAudio = await popupMetrics(page);
    assert(autoplayAudio.wordAudioPrepareCount === 1, "Autoplay should resolve the first lookup result once.", autoplayAudio);

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
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length >= 2
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
    await page.waitForFunction(() => (
      (document.querySelector(".lookup-pop[data-popup-id='root'] .lookup-results")?.scrollTop ?? 0) >= 70
    ));

    await dispatchGlossaryClick(page, "classroom");
    await page.waitForFunction(() => document.querySelectorAll(".lookup-pop").length === 2);
    const clickPending = await popupMetrics(page);
    assert(clickPending.popupHighlightText === "" && clickPending.text.includes("Looking up..."), "Nested lookup should keep the scanned range hidden while the child result is pending.", clickPending);
    await page.waitForFunction(() => {
      const popups = Array.from(document.querySelectorAll(".lookup-pop"));
      return popups[popups.length - 1]?.getAttribute("data-state") === "ready";
    });
    const clickNested = await popupMetrics(page);
    assert(clickNested.nestedLookupCount === 1, "Plain left click inside glossary should trigger nested lookup callback.", clickNested);
    assert(clickNested.nestedLookupText.includes("classroom"), "Plain left click should select the glossary word under the pointer.", clickNested);
    assert(clickNested.popupCount === 2, "Plain left click inside glossary should append a child popup.", clickNested);
    assert(clickNested.nativeSelectionText === "", "Plain left click nested lookup should not leave a native browser selection.", clickNested);
    assert(clickNested.popupHighlightText === "cl", "Plain left click nested lookup should highlight only the first result's matched range.", clickNested);

    await closeChildPopup(page);
    const clickChildClosed = await popupMetrics(page);
    assert(clickChildClosed.popupCount === 1 && clickChildClosed.popupHighlightText === "", "Closing the click-opened child should clear its parent selection before Shift-hover validation.", clickChildClosed);

    await dispatchShiftHover(page, "classroom");
    await page.waitForFunction(() => Number(document.querySelector(".probe-state")?.getAttribute("data-nested-lookup-count") ?? 0) === 2);
    const nested = await popupMetrics(page);
    assert(nested.nestedLookupCount === 2, "Shift-hover inside glossary should trigger nested lookup callback.", nested);
    assert(nested.nestedLookupText.includes("classroom"), "Nested lookup should select the glossary word under the pointer.", nested);
    assert(nested.popupCount === 2, "Nested lookup should append a child popup.", nested);
    assert(nested.text.includes("nested result for classroom"), "Nested lookup child should render its own result.", nested);
    assert(nested.text.includes("classroom school room"), "Nested lookup should keep the root popup open.", nested);
    assert(nested.topPopupId.startsWith("child-"), "Nested lookup should make the child popup topmost.", nested);
    assert(nested.nativeSelectionText === "", "Shift-hover nested lookup should not leave a native browser selection.", nested);
    assert(nested.popupHighlightText === "cl", "Shift-hover nested lookup should highlight only the first result's matched range.", nested);
    const nestedChild = nested.popups.find((popup) => popup.id !== "root");
    assert(nestedChild && nested.nestedLookupAnchor, "Nested lookup should expose child popup and anchor metrics.", nested);
    assert(nestedChild.bottom <= nested.nestedLookupAnchor.y + 1, "Horizontal nested child popup should prefer the space above the selected glossary line.", { nestedChild, anchor: nested.nestedLookupAnchor });
    assert(
      Math.abs((nestedChild.x + nestedChild.width / 2) - (nested.nestedLookupAnchor.x + nested.nestedLookupAnchor.width / 2)) <= 2,
      "Horizontal nested child popup should center on the selected glossary line when space permits.",
      { nestedChild, anchor: nested.nestedLookupAnchor },
    );

    await closeChildPopup(page);
    const childClosed = await popupMetrics(page);
    assert(childClosed.popupCount === 1, "Closing a child popup should keep the root popup open.", childClosed);
    assert(childClosed.rootClearSelectionSignal > nested.rootClearSelectionSignal, "Closing a child popup should signal parent selection clear.", { nested, childClosed });
    assert(childClosed.popupHighlightText === "", "Closing a child popup should clear the parent popup lookup highlight.", childClosed);

    await openProbe(page, "ready", { topEdge: true });
    await dispatchShiftHover(page, "classroom");
    await page.waitForFunction(() => document.querySelectorAll(".lookup-pop").length === 2);
    const topEdgeNested = await popupMetrics(page);
    const topEdgeChild = topEdgeNested.popups.find((popup) => popup.id !== "root");
    assert(topEdgeChild && topEdgeNested.nestedLookupAnchor, "Top-edge nested lookup should expose child popup and anchor metrics.", topEdgeNested);
    assert(
      topEdgeChild.y >= topEdgeNested.nestedLookupAnchor.y + topEdgeNested.nestedLookupAnchor.height - 1,
      "Horizontal nested child popup should fall below the selected glossary line when there is not enough space above.",
      { topEdgeChild, anchor: topEdgeNested.nestedLookupAnchor },
    );
    assert(topEdgeChild.y >= 44, "Top-edge fallback child popup should stay inside the viewport top margin.", topEdgeNested);

    await openProbe(page, "ready");

    await dispatchGlossaryClick(page, "school room");
    await page.waitForFunction(() => {
      const popups = Array.from(document.querySelectorAll(".lookup-pop"));
      return popups.length === 2 && popups[1]?.getAttribute("data-state") === "loading";
    });
    await closeChildPopup(page);
    await page.waitForTimeout(120);
    const staleChildClosed = await popupMetrics(page);
    assert(staleChildClosed.popupCount === 1 && staleChildClosed.popupHighlightText === "", "A stale child result must not restore highlight after the child closes.", staleChildClosed);

    await dispatchShiftHover(page, "Aことは A", 1);
    const japanesePrefix = await popupMetrics(page);
    assert(japanesePrefix.nestedLookupText.startsWith("こと"), "Nested lookup should start at the hovered Japanese text, not the preceding Latin token.", japanesePrefix);
    assert(!japanesePrefix.nestedLookupText.startsWith("A"), "Nested lookup should not include the preceding A token.", japanesePrefix);
    assert(japanesePrefix.popupCount === 2 && japanesePrefix.text.includes("nested result for こと"), "Japanese prefix nested lookup should render a child popup.", japanesePrefix);
    await closeChildPopup(page);

    await dispatchShiftHover(page, "って「ことと言いなさい」", 3);
    const japaneseQuoted = await popupMetrics(page);
    assert(japaneseQuoted.nestedLookupText.startsWith("こと"), "Nested lookup should not backtrack into preceding quoted text.", japaneseQuoted);
    assert(!japaneseQuoted.nestedLookupText.startsWith("って"), "Nested lookup should not include the previous token before punctuation.", japaneseQuoted);
    await closeChildPopup(page);

    await dispatchShiftHover(page, "ことは純日文", 0);
    const japanesePlain = await popupMetrics(page);
    assert(japanesePlain.nestedLookupText.startsWith("こと"), "Plain Japanese nested lookup should keep scanning after the hovered character.", japanesePlain);
    assert(japanesePlain.nestedLookupText !== "こ", "Plain Japanese nested lookup should not stop at the first character.", japanesePlain);
    await closeChildPopup(page);

    await dispatchShiftHover(page, "school room");
    const secondNested = await popupMetrics(page);
    assert(secondNested.popupCount === 2, "A later root nested lookup should open one child without stacking siblings.", secondNested);

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

    const coalescedPopupStart = Number(await page.locator(".probe-state").getAttribute("data-nested-lookup-count") ?? 0);
    const popupAdjacentDistance = await dispatchPopupShiftSequence(page, "classroom", [0, 1]);
    await page.waitForFunction(
      (expected) => Number(document.querySelector(".probe-state")?.getAttribute("data-nested-lookup-count") ?? 0) === expected,
      coalescedPopupStart + 1,
    );
    await page.waitForFunction(() => {
      const popups = Array.from(document.querySelectorAll(".lookup-pop"));
      return popups.length === 2 && popups[1]?.getAttribute("data-state") === "ready";
    });
    const popupCoalesced = await popupMetrics(page);
    assert(popupAdjacentDistance < 8, "Popup adjacent-character fixture points should be closer than the removed Hibiki threshold.", { popupAdjacentDistance });
    assert(popupCoalesced.nestedLookupCount === coalescedPopupStart + 1 && popupCoalesced.nestedLookupText.startsWith("lassroom"), "Popup Shift-hover should process only the latest character coordinate in one frame.", popupCoalesced);
    await closeChildPopup(page);

    const popupCancelStart = Number(await page.locator(".probe-state").getAttribute("data-nested-lookup-count") ?? 0);
    await dispatchPopupShiftSequence(page, "classroom", [0], true);
    await page.waitForTimeout(40);
    assert(Number(await page.locator(".probe-state").getAttribute("data-nested-lookup-count") ?? 0) === popupCancelStart, "Popup Shift release should cancel a pending hover frame.");

    await openProbe(page, "ready", { longResult: true, popupScale: 1.5, showReading: true });
    await scrollFirstMediaPlaceholderIntoView(page);
    await page.waitForFunction(() => (
      document.querySelectorAll(".lookup-glossary-content .gloss-media-placeholder[data-media-status='loaded']").length >= 2
    ));
    const scaled = await popupMetrics(page);
    assert(scaled.popup.width === 320 && scaled.popup.height === 250, "Content scale should not change the popup outer frame.", scaled);
    assert(scaled.expressionFontSize === "39px" && scaled.readingFontSize === "19.5px" && scaled.glossaryFontSize === "21px", "Scale 1.5 should multiply the compact popup type sizes.", scaled);
    assert(scaled.actionSlotWidth === "42px" && scaled.mediaImageMaxHeight === "270px", "Scale 1.5 should multiply result actions and media limits.", scaled);

    await openProbe(page, "ready", {
      longResult: true,
      showReading: true,
      popupWidth: 320,
      popupHeight: 250,
      popupScale: 1,
      importPopupWidth: 700,
      importPopupHeight: 800,
      importPopupScale: 1.5,
    });
    const largeImportSmallRender = await popupMetrics(page);
    await openProbe(page, "ready", {
      longResult: true,
      showReading: true,
      popupWidth: 320,
      popupHeight: 250,
      popupScale: 1,
      importPopupWidth: 100,
      importPopupHeight: 100,
      importPopupScale: 0.8,
    });
    const smallImportSmallRender = await popupMetrics(page);
    assert(
      JSON.stringify(largeImportSmallRender.importedDictionaryRecords) === JSON.stringify(smallImportSmallRender.importedDictionaryRecords),
      "Simulated import metadata and style identities should not depend on popup settings active during import.",
      { largeImportSmallRender, smallImportSmallRender },
    );
    assert(
      largeImportSmallRender.expressionFontSize === smallImportSmallRender.expressionFontSize
        && largeImportSmallRender.glossaryFontSize === smallImportSmallRender.glossaryFontSize
        && largeImportSmallRender.dictionaryStyledFontSize === smallImportSmallRender.dictionaryStyledFontSize,
      "Rendered dictionary size should depend on current popup scale, not simulated import-time popup settings.",
      { largeImportSmallRender, smallImportSmallRender },
    );
    assert(
      largeImportSmallRender.importPopupSettings.scale === 1.5
        && smallImportSmallRender.importPopupSettings.scale === 0.8
        && largeImportSmallRender.renderPopupSettings.scale === 1
        && smallImportSmallRender.renderPopupSettings.scale === 1,
      "Probe should distinguish import-time popup settings from render-time popup settings.",
      { largeImportSmallRender, smallImportSmallRender },
    );

    await page.setViewportSize({ width: 1280, height: 720 });
    await openProbe(page, "ready", { longResult: true, popupWidth: 700, popupHeight: 800 });
    const constrainedMaximum = await popupMetrics(page);
    assert(Math.abs(constrainedMaximum.popup.width - 700) <= 1, "Maximum configured popup width should render at 700 px when space permits.", constrainedMaximum);
    assert(constrainedMaximum.popup.height === 676, "Maximum configured popup height should shrink to the available reader viewport.", constrainedMaximum);
    assert(constrainedMaximum.popup.bottom <= constrainedMaximum.viewport.height, "Constrained maximum popup should stay inside the viewport.", constrainedMaximum);

    await page.setViewportSize({ width: 360, height: 640 });
    await openProbe(page, "ready", { longResult: true, popupWidth: 700, popupHeight: 800 });
    const narrow = await popupMetrics(page);
    assert(!narrow.horizontalOverflow, "Narrow lookup popup should not create horizontal overflow.", narrow);
    assert(narrow.popup.right <= narrow.viewport.width, "Narrow lookup popup should stay within the viewport.", narrow);
    assert(narrow.popup.width === 336 && narrow.popup.height === 596, "Narrow popup should shrink to the available viewport without changing the configured limits.", narrow);

    console.log(JSON.stringify({ ready, mediaFailed, mediaNoTauri, nested, childClosed, scrolled, scaled, constrainedMaximum, narrow }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
