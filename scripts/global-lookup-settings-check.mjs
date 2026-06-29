import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { chromium } from "playwright";

const port = Number(process.env.HSW_GLOBAL_LOOKUP_SETTINGS_PORT || 5189);
const origin = `http://127.0.0.1:${port}`;
const root = process.cwd();

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

function viteCommand() {
  if (process.platform === "win32") return path.join(root, "node_modules", ".bin", "vite.cmd");
  return path.join(root, "node_modules", ".bin", "vite");
}

function viteEnv() {
  const nodeDir = path.dirname(process.execPath);
  const binDir = path.join(root, "node_modules", ".bin");
  return {
    ...process.env,
    PATH: `${nodeDir}${path.delimiter}${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
  };
}

async function state(page) {
  return page.locator(".probe-state").evaluate((element) => ({
    enabled: element.getAttribute("data-enabled"),
    shortcut: element.getAttribute("data-shortcut"),
    registered: element.getAttribute("data-registered"),
    error: element.getAttribute("data-error"),
    events: element.getAttribute("data-events"),
    text: document.body.textContent ?? "",
  }));
}

async function globalLookupWindowMetrics(page) {
  return page.locator(".popup-shell").evaluate((element) => {
    const shell = element.getBoundingClientRect();
    const root = document.querySelector(".global-lookup-window")?.getBoundingClientRect();
    const shellStyle = getComputedStyle(element);
    return {
      shellWidth: Math.round(shell.width),
      shellHeight: Math.round(shell.height),
      rootWidth: root ? Math.round(root.width) : 0,
      rootHeight: root ? Math.round(root.height) : 0,
      popupScale: shellStyle.getPropertyValue("--popup-scale").trim(),
      text: document.body.textContent ?? "",
    };
  });
}

async function main() {
  const viteArgs = ["--host", "127.0.0.1", "--port", String(port), "--strictPort"];
  const vite = process.platform === "win32"
    ? spawn("cmd.exe", ["/c", viteCommand(), ...viteArgs], { cwd: root, env: viteEnv(), stdio: ["ignore", "pipe", "pipe"] })
    : spawn(viteCommand(), viteArgs, { cwd: root, env: viteEnv(), stdio: ["ignore", "pipe", "pipe"] });

  let browser;
  try {
    await waitForServer(vite);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
    await page.goto(`${origin}/?globalLookupSettingsProbe=1`);
    await page.locator(".probe-state").waitFor({ state: "attached" });

    let current = await state(page);
    assert(current.enabled === "false" && current.shortcut === "Ctrl + Alt + H", "Default global shortcut should be visible but opt-in disabled.", current);
    assert(current.text.includes("Look up selected text") && current.text.includes("Disabled in Advanced settings."), "Shortcuts panel should describe the disabled global lookup shortcut.", current);

    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.keyboard.down("Shift");
    await page.keyboard.press("l");
    await page.keyboard.up("Shift");
    current = await state(page);
    assert(current.shortcut === "Ctrl + Alt + H", "Invalid Shift-only shortcut should not save.", current);
    assert(current.text.includes("Use Ctrl, Alt, or Win with a regular key."), "Invalid shortcut should show an actionable error.", current);

    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    await page.keyboard.press("j");
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");
    current = await state(page);
    assert(current.shortcut === "Ctrl + Alt + J", "Recorder should save a valid Ctrl+Alt shortcut.", current);
    assert(current.enabled === "false", "Recording the shortcut should not enable global lookup.", current);
    assert(current.events?.includes("shortcut:Ctrl + Alt + J"), "Shortcut recorder should call the save handler.", current);

    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.keyboard.press("Escape");
    current = await state(page);
    assert(current.shortcut === "Ctrl + Alt + J", "Escape should cancel recording without changing the shortcut.", current);

    await page.getByRole("button", { name: "Record", exact: true }).click();
    await page.keyboard.press("Backspace");
    current = await state(page);
    assert(current.shortcut === "Ctrl + Alt + H", "Backspace during recording should reset to the default shortcut.", current);
    assert(current.enabled === "false", "Resetting the shortcut should not enable global lookup.", current);
    assert(current.events?.endsWith("reset"), "Reset should call the reset handler.", current);

    await page.locator("#global-selected-lookup").click();
    current = await state(page);
    assert(current.enabled === "true" && current.events?.includes("enabled:true"), "Switch should enable global lookup.", current);
    assert(current.text.includes("Works in Windows apps that expose selected text through UI Automation."), "Shortcuts panel should reflect enabled global lookup.", current);

    await page.getByRole("button", { name: "registration error", exact: true }).click();
    current = await state(page);
    assert(current.error === "Shortcut is already used.", "Registration errors should be exposed in state.", current);
    assert(current.text.includes("Shortcut is already used."), "Registration errors should be visible in Advanced settings.", current);

    const globalLookupPage = await browser.newPage({ viewport: { width: 900, height: 900 } });
    await globalLookupPage.addInitScript(() => {
      localStorage.setItem("hoshi_reader_lookup_popup", JSON.stringify({ width: 680, height: 800, scale: 1.15 }));
    });
    await globalLookupPage.goto(`${origin}/?globalLookup=1`);
    await globalLookupPage.locator(".popup-shell").waitFor({ state: "attached" });
    const windowMetrics = await globalLookupWindowMetrics(globalLookupPage);
    assert(
      windowMetrics.shellWidth === 680 && windowMetrics.shellHeight === 800,
      "Global lookup popup shell should use the saved Appearance popup size.",
      windowMetrics,
    );
    assert(windowMetrics.popupScale === "1.15", "Global lookup popup shell should use the saved Appearance popup scale.", windowMetrics);
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
