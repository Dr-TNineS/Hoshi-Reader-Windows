import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_READER_TOC_PORT || 5180);
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

async function state(page, name) {
  return page.locator(".probe-state").getAttribute(`data-${name}`);
}

async function waitForTriggerFocus(page) {
  await page.waitForFunction(() => document.activeElement?.id === "reader-toc-trigger");
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
    await page.goto(`${origin}/?readerTocProbe=1`);

    const trigger = page.getByRole("button", { name: "TOC", exact: true });
    assert(await trigger.getAttribute("aria-expanded") === "false", "Closed trigger should expose aria-expanded=false.");
    assert(await trigger.getAttribute("aria-controls") === "reader-toc", "Trigger should reference the stable drawer id.");

    await trigger.click();
    const drawer = page.locator("#reader-toc");
    await drawer.waitFor();
    assert(await trigger.getAttribute("aria-expanded") === "true", "Open trigger should expose aria-expanded=true.");
    assert(await drawer.getAttribute("aria-modal") === null, "TOC drawer must remain nonmodal.");
    assert(await drawer.getAttribute("aria-labelledby") === "reader-toc-title", "Drawer should reference its accessible title.");
    const close = drawer.getByRole("button", { name: "Close", exact: true });
    assert(await close.evaluate((element) => element === document.activeElement), "Opening should focus the drawer close control.");

    await page.getByRole("button", { name: "Reader surface", exact: true }).click();
    assert(await state(page, "surface-events") === "1", "Reader surface should remain interactive while TOC is open.");

    await page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
    assert(await state(page, "back-events") === "0", "First Escape should close TOC without leaving the reader.");
    await waitForTriggerFocus(page);
    assert(await trigger.evaluate((element) => element === document.activeElement), "Escape close should restore focus to the trigger.");

    await page.keyboard.press("Escape");
    assert(await state(page, "back-events") === "1", "Escape with TOC closed should reach the reader back action.");

    await trigger.click();
    await drawer.getByRole("button", { name: "Close", exact: true }).click();
    await waitForTriggerFocus(page);
    assert(await trigger.evaluate((element) => element === document.activeElement), "Close button should restore trigger focus.");

    await trigger.click();
    await drawer.getByRole("button", { name: "A nested section", exact: true }).click();
    assert(await state(page, "jump-events") === "1", "Chapter activation should emit one jump event.");
    assert(await state(page, "open") === "false", "Chapter activation should close the drawer.");
    await waitForTriggerFocus(page);
    assert(await trigger.evaluate((element) => element === document.activeElement), "Chapter activation should restore trigger focus.");

    await page.setViewportSize({ width: 420, height: 720 });
    await trigger.click();
    const bounds = await drawer.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 420, "Narrow drawer should remain inside the viewport.", { bounds });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Narrow TOC should not create horizontal overflow.");

    console.log(JSON.stringify({ backEvents: await state(page, "back-events"), jumpEvents: await state(page, "jump-events"), bounds }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
