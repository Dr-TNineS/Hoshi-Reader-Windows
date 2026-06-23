import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_SETTINGS_STATE_PORT || 5177);
const origin = `http://127.0.0.1:${port}`;

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function waitForServer(proc) {
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite did not become ready.\n${output}`)), 30000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!output.includes("ready in")) return;
      clearTimeout(timer);
      resolve();
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

async function state(page) {
  return page.locator(".probe-state").evaluate((element) => ({
    theme: element.getAttribute("data-theme"),
    reopen: element.getAttribute("data-reopen"),
    appearanceVars: element.getAttribute("data-appearance-vars"),
    savedAppearances: element.getAttribute("data-saved-appearances"),
    savedAdvanced: element.getAttribute("data-saved-advanced"),
    popupWidth: Number(element.getAttribute("data-popup-width")),
    popupHeight: Number(element.getAttribute("data-popup-height")),
    popupScale: Number(element.getAttribute("data-popup-scale")),
    savedPopup: JSON.parse(element.getAttribute("data-saved-popup") ?? "[]"),
    normalizedInvalidPopup: JSON.parse(element.getAttribute("data-normalized-invalid-popup") ?? "{}"),
    dictionaryMaxResults: Number(element.getAttribute("data-dictionary-max-results")),
    dictionaryScanLength: Number(element.getAttribute("data-dictionary-scan-length")),
    dictionaryHarmonic: element.getAttribute("data-dictionary-harmonic"),
    dictionaryCompactGlossaries: element.getAttribute("data-dictionary-compact-glossaries"),
    savedDictionary: JSON.parse(element.getAttribute("data-saved-dictionary") ?? "[]"),
    normalizedInvalidDictionary: JSON.parse(element.getAttribute("data-normalized-invalid-dictionary") ?? "{}"),
  }));
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
    const page = await browser.newPage();
    await page.goto(`${origin}/?settingsStateProbe=1`);
    await page.locator(".probe-state").waitFor({ state: "attached" });

    let current = await state(page);
    assert(current.theme === "dark" && current.reopen === "true", "Controller should expose loaded settings.", current);
    assert(current.savedAppearances === "dark", "Controller should preserve appearance startup normalization.", current);
    assert(current.savedAdvanced === "", "Controller should not rewrite Advanced settings during startup.", current);
    assert(current.popupWidth === 320 && current.popupHeight === 250 && current.popupScale === 1, "Controller should expose loaded popup settings.", current);
    assert(current.savedPopup.length === 0, "Controller should not rewrite popup settings during startup.", current);
    assert(current.normalizedInvalidPopup.width === 320 && current.normalizedInvalidPopup.height === 100 && current.normalizedInvalidPopup.scale === 1, "Invalid popup settings should fall back or clamp safely.", current);
    assert(current.dictionaryMaxResults === 12 && current.dictionaryScanLength === 24 && current.dictionaryHarmonic === "true", "Controller should expose loaded dictionary settings.", current);
    assert(current.savedDictionary.length === 0, "Controller should not rewrite dictionary settings during startup.", current);
    assert(current.normalizedInvalidDictionary.maxResults === 50 && current.normalizedInvalidDictionary.scanLength === 1 && current.normalizedInvalidDictionary.compactGlossaries === false && current.normalizedInvalidDictionary.compactPitchAccents === false, "Invalid dictionary settings should clamp and preserve supported booleans.", current);

    const lightTheme = page.getByRole("radio", { name: "Light", exact: true });
    const darkTheme = page.getByRole("radio", { name: "Dark", exact: true });
    assert(await darkTheme.getAttribute("aria-checked") === "true", "Loaded theme should be checked in the toggle group.");
    await darkTheme.click();
    current = await state(page);
    assert(current.savedAppearances === "dark", "Clicking the active theme should not deselect or persist it again.", current);

    await darkTheme.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    current = await state(page);
    assert(current.theme === "light", "Arrow navigation plus Space should update the selected theme.", current);
    assert(current.savedAppearances === "dark,light", "Theme setter should persist the next appearance.", current);
    assert(current.appearanceVars?.includes("--app-bg:#fff"), "Theme setter should recompute appearance CSS variables.", current);
    assert(await lightTheme.getAttribute("aria-checked") === "true", "Keyboard-selected theme should become checked.");

    await page.getByRole("button", { name: "Toggle startup", exact: true }).click();
    current = await state(page);
    assert(current.reopen === "false", "Advanced setter should update reactive state.", current);
    assert(current.savedAdvanced === "false", "Advanced setter should persist the next settings value.", current);

    await darkTheme.click();
    current = await state(page);
    assert(current.savedAppearances === "dark,light,dark", "Repeated theme changes should persist in order.", current);

    await page.getByLabel("Popup width").evaluate((input) => {
      input.value = "684";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByLabel("Popup height").evaluate((input) => {
      input.value = "999";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.getByLabel("Popup scale").evaluate((input) => {
      input.value = "1.13";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    current = await state(page);
    assert(current.popupWidth === 680, "Popup width should snap to its 10 px step.", current);
    assert(current.popupHeight === 800, "Popup height should clamp to its supported maximum.", current);
    assert(current.popupScale === 1.15, "Popup scale should snap to its 0.05 step.", current);
    assert(current.savedPopup.length === 3, "Each popup setting change should persist immediately.", current);

    await page.getByRole("button", { name: "Clamp dictionary", exact: true }).click();
    current = await state(page);
    assert(current.dictionaryMaxResults === 50 && current.dictionaryScanLength === 1 && current.dictionaryCompactGlossaries === "false", "Dictionary setter should normalize HSA-aligned bounds.", current);
    assert(current.savedDictionary.length === 1 && current.savedDictionary[0].maxResults === 50 && current.savedDictionary[0].scanLength === 1, "Dictionary setter should persist normalized settings.", current);

    console.log(JSON.stringify(current, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
