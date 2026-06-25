import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_SASAYAKI_PLAYBACK_PORT || 5184);
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

async function events(page) {
  return page.locator(".probe-state").getAttribute("data-events");
}

async function presentation(page) {
  const state = page.locator(".probe-state");
  return {
    activeCue: await state.getAttribute("data-active-cue"),
    reveal: await state.getAttribute("data-cue-reveal"),
    chapterToLoad: await state.getAttribute("data-chapter-to-load"),
    playing: await state.getAttribute("data-playing"),
  };
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
    await page.goto(`${origin}/?sasayakiPlaybackProbe=1`);
    const audioButton = page.getByRole("button", { name: "Audio", exact: true });
    assert(await audioButton.getAttribute("aria-expanded") === "false", "Playback panel should start closed.");
    await audioButton.click();
    const panel = page.getByRole("region", { name: "Sasayaki playback", exact: true });
    await panel.waitFor();
    assert((await panel.textContent())?.includes("星の音.wav"), "Playback should show the restored audio source.");
    assert((await panel.textContent())?.includes("0:12") && (await panel.textContent())?.includes("2:00"), "Playback should show restored progress and duration.");
    await panel.getByRole("button", { name: "Play Sasayaki", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "true");
    await page.getByRole("button", { name: "Probe open lookup", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "false");
    assert((await presentation(page)).playing === "false", "Auto-Pause should pause active Sasayaki playback when lookup opens.");
    await page.getByRole("button", { name: "Probe close lookup", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "true");
    assert((await presentation(page)).playing === "true", "Closing the lookup should resume only playback paused by lookup.");
    await panel.getByRole("button", { name: "Pause Sasayaki", exact: true }).click();
    await panel.getByRole("button", { name: "Skip backward sentence", exact: true }).click();
    await panel.getByRole("button", { name: "Skip forward sentence", exact: true }).click();
    const crossChapterCue = await presentation(page);
    assert(
      crossChapterCue.activeCue === "2" && crossChapterCue.reveal === "true" && crossChapterCue.chapterToLoad === "1",
      "A played cross-chapter cue should request chapter navigation while Auto-Scroll is enabled.",
      crossChapterCue,
    );
    await panel.getByRole("button", { name: "Skip backward 10 seconds", exact: true }).click();
    await panel.getByRole("button", { name: "Skip forward 10 seconds", exact: true }).click();
    await panel.getByLabel("Sasayaki playback speed").fill("1.5");
    await panel.getByLabel("Sasayaki cue delay").fill("-0.5");
    await panel.getByLabel("Sasayaki Auto-Scroll").uncheck();
    await panel.getByLabel("Sasayaki Auto-Pause on Lookup").uncheck();
    await panel.getByLabel("Sasayaki skip action").selectOption("seconds15");
    await panel.getByRole("button", { name: "Skip forward 15 seconds", exact: true }).click();
    assert(
      await events(page) === "play,lookup-pause,lookup-resume,pause,previous:5.25,next:15.25,skip:-10,skip:10,rate:1.5,delay:-0.5,autoScroll:false,autoPause:false,skipAction:seconds15,next:30.25",
      "Playback controls should emit stable lifecycle, cue/seconds skip, rate, delay, and coordination settings.",
    );
    const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!wideOverflow, "Wide playback panel should not overflow horizontally.");

    await page.setViewportSize({ width: 520, height: 760 });
    const narrowOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!narrowOverflow, "Narrow playback panel should not overflow horizontally.");
    const transportColumns = await panel.locator(".transport").evaluate((element) => getComputedStyle(element).gridTemplateColumns);
    assert(transportColumns.split(" ").length === 2, "Narrow transport controls should use two columns.");
    await panel.getByRole("button", { name: "Close Sasayaki playback", exact: true }).click();
    assert(await audioButton.getAttribute("aria-expanded") === "false", "Closing playback should restore the collapsed state.");
    await page.waitForFunction(() => document.activeElement?.id === "reader-sasayaki-trigger");
    assert(await audioButton.evaluate((element) => element === document.activeElement), "Closing playback should restore focus to the Audio trigger.");

    console.log(JSON.stringify({ events: await events(page), wideOverflow, narrowOverflow }, null, 2));
  } finally {
    await browser?.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
