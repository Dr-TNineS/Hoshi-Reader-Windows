import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_BOOKSHELF_PORT || 5179);
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

async function forgetEvents(page) {
  return page.locator(".probe-state").getAttribute("data-forget-events");
}

async function sasayakiEvents(page) {
  return page.locator(".probe-state").getAttribute("data-sasayaki-events");
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
    await page.goto(`${origin}/?bookshelfProbe=1`);
    await page.locator(".bookshelf").waitFor();

    const navigation = page.locator(".sidebar");
    for (const panel of ["Dictionaries", "Anki", "Appearance", "Advanced", "Shortcuts", "Library"]) {
      const entry = navigation.getByRole("button").filter({ hasText: panel });
      await entry.click();
      await page.locator(".panel-head").getByRole("heading", { name: panel, exact: true }).waitFor();
      assert(await entry.getAttribute("aria-current") === "page", `${panel} should become the single active panel.`);
      assert(await navigation.locator('[aria-current="page"]').count() === 1, "Bookshelf should expose exactly one active panel.");
    }

    const ownedCard = page.locator(".book-card").filter({ hasText: "Owned Book" });
    await ownedCard.hover();
    const sasayakiTrigger = ownedCard.getByRole("button", { name: "Configure Sasayaki for Owned Book", exact: true });
    await sasayakiTrigger.click();
    const sasayakiPanel = page.getByRole("region", { name: "Sasayaki for Owned Book" });
    await sasayakiPanel.waitFor();
    const sasayakiText = await sasayakiPanel.textContent();
    assert(sasayakiText?.includes("Linked to the external audiobook"), "Sasayaki status should distinguish linked external audio.");
    assert(sasayakiText?.includes("星の音.wav") && sasayakiText?.includes("星の音.srt"), "Sasayaki status should show audio and subtitle filenames.");
    assert(sasayakiText?.includes("Cue matching and playback are not implemented yet."), "Sasayaki setup should keep later slices visibly out of scope.");
    assert(await sasayakiEvents(page) === "load:owned-book", "Opening Sasayaki setup should load status by book id.");
    await sasayakiPanel.getByRole("button", { name: "Link audio + SRT", exact: true }).click();
    await sasayakiPanel.getByRole("button", { name: "Copy audio + SRT", exact: true }).click();
    assert(await sasayakiEvents(page) === "load:owned-book,link:owned-book,copy:owned-book", "Sasayaki import modes should remain distinct.");
    await sasayakiPanel.getByRole("button", { name: "Remove", exact: true }).click();
    let sasayakiDialog = page.getByRole("alertdialog");
    assert((await sasayakiDialog.textContent())?.includes("linked external audiobook is not deleted"), "Sasayaki removal should protect linked external audio.");
    await sasayakiDialog.getByRole("button", { name: "Remove", exact: true }).click();
    assert(await sasayakiEvents(page) === "load:owned-book,link:owned-book,copy:owned-book,remove:owned-book", "Sasayaki removal should emit once.");
    await sasayakiPanel.getByRole("button", { name: "Close Sasayaki setup", exact: true }).click();
    await sasayakiPanel.waitFor({ state: "hidden" });

    const ownedTrigger = ownedCard.getByRole("button", { name: "Forget Owned Book", exact: true });
    await ownedTrigger.click();
    let dialog = page.getByRole("alertdialog");
    assert((await dialog.textContent())?.includes("deletes the app-owned EPUB copy"), "App-owned confirmation should describe the managed copy.");
    assert((await dialog.textContent())?.includes("original EPUB file is not touched"), "App-owned confirmation should protect the original file.");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    assert(await forgetEvents(page) === "", "Cancel should not emit a forget event.");
    assert(await ownedTrigger.evaluate((element) => element === document.activeElement), "Cancel should restore focus to the trigger.");

    await ownedTrigger.click();
    await dialog.getByRole("button", { name: "Forget", exact: true }).click();
    assert(await forgetEvents(page) === "owned-book", "Confirm should emit exactly one app-owned forget event.");

    const legacyCard = page.locator(".book-card").filter({ hasText: "Legacy Book" });
    await legacyCard.hover();
    const legacyTrigger = legacyCard.getByRole("button", { name: "Forget Legacy Book", exact: true });
    await legacyTrigger.click();
    dialog = page.getByRole("alertdialog");
    assert((await dialog.textContent())?.includes("legacy book record"), "Legacy confirmation should describe record-only removal.");
    await dialog.getByRole("button", { name: "Forget", exact: true }).click();
    assert(await forgetEvents(page) === "owned-book,C:/Books/Legacy Book.epub", "Legacy confirm should emit one additional event.");

    const legacyAudioButton = page.locator(".book-card").filter({ hasText: "Legacy Book" }).getByRole("button", { name: /Configure Sasayaki/ });
    assert(await legacyAudioButton.count() === 0, "Legacy books without bookId should not expose Sasayaki setup.");

    console.log(JSON.stringify({
      forgetEvents: await forgetEvents(page),
      sasayakiEvents: await sasayakiEvents(page),
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
