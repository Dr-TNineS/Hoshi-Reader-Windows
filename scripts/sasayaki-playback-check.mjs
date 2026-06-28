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
    audioElement: await state.getAttribute("data-audio-element"),
    audioTimeCommits: await state.getAttribute("data-audio-time-commits"),
    repaintSentinel: await state.getAttribute("data-repaint-sentinel"),
    wordCoordinationActive: await state.getAttribute("data-word-coordination-active"),
    sasayakiVolume: await state.getAttribute("data-sasayaki-volume"),
    savedPositions: await state.getAttribute("data-saved-positions"),
    saveRunning: await state.getAttribute("data-save-running"),
    pendingSave: await state.getAttribute("data-pending-save"),
    readerView: await state.getAttribute("data-reader-view"),
    lifecycleExitRunning: await state.getAttribute("data-lifecycle-exit-running"),
    lifecycleSavedPosition: await state.getAttribute("data-lifecycle-saved-position"),
    lifecycleCurrentTime: await state.getAttribute("data-lifecycle-current-time"),
    lifecycleSaveAttempts: await state.getAttribute("data-lifecycle-save-attempts"),
    lifecycleError: await state.getAttribute("data-lifecycle-error"),
    traceEvents: await state.getAttribute("data-trace-events"),
    restorePending: await state.getAttribute("data-restore-pending"),
    restoreAudioTime: await state.getAttribute("data-restore-audio-time"),
    restoreSavedPositions: await state.getAttribute("data-restore-saved-positions"),
    restoreTraceEvents: await state.getAttribute("data-restore-trace-events"),
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
    assert((await presentation(page)).audioElement === "true", "Playback probe should mount a controlled audio element.");
    await panel.getByRole("button", { name: "Play Sasayaki", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "true");
    await page.getByRole("button", { name: "Probe throttled audio tick", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe committed audio tick", exact: true }).dispatchEvent("click");
    const audioTick = await presentation(page);
    assert(
      audioTick.audioTimeCommits === "1" && audioTick.repaintSentinel === "2",
      "Probe audio time updates should throttle low-value ticks and commit after the UI interval.",
      audioTick,
    );
    await page.getByRole("button", { name: "Probe persisted second ticks", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-saved-positions") === "1.10,2.00,3.20");
    assert(
      (await presentation(page)).savedPositions === "1.10,2.00,3.20",
      "Sasayaki playback should persist once per crossed playback second.",
      await presentation(page),
    );
    await page.getByRole("button", { name: "Probe overlapping Sasayaki saves", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-saved-positions") === "1.00");
    assert(
      (await presentation(page)).pendingSave === "3",
      "Overlapping Sasayaki saves should keep only the latest pending position.",
      await presentation(page),
    );
    await page.getByRole("button", { name: "Probe release overlapping Sasayaki save", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-saved-positions") === "1.00,3.00");
    assert(
      (await presentation(page)).saveRunning === "false",
      "Overlapping Sasayaki save worker should drain and stop after the latest snapshot is saved.",
      await presentation(page),
    );
    await page.getByRole("button", { name: "Probe exit Sasayaki flush", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-saved-positions") === "42.75");
    assert(
      (await presentation(page)).savedPositions === "42.75",
      "Sasayaki exit flush should persist the current audio position immediately.",
      await presentation(page),
    );
    await page.getByRole("button", { name: "Probe open lookup", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "false");
    assert((await presentation(page)).playing === "false", "Auto-Pause should pause active Sasayaki playback when lookup opens.");
    await panel.getByRole("button", { name: "Pause Sasayaki", exact: true }).waitFor();
    await page.getByRole("button", { name: "Probe close lookup", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-playing") === "true");
    assert((await presentation(page)).playing === "true", "Closing the lookup should resume only playback paused by lookup.");
    await page.getByRole("button", { name: "Probe word interrupt", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe rapid word interrupt", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe word duck", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe word mix", exact: true }).dispatchEvent("click");
    const coordinated = await presentation(page);
    assert(
      coordinated.playing === "true" &&
        coordinated.wordCoordinationActive === "false" &&
        coordinated.sasayakiVolume === "1",
      "Word audio coordination should restore Sasayaki playback and volume after interrupt, duck, mix, and rapid replacement.",
      coordinated,
    );
    await panel.getByRole("button", { name: "Close Sasayaki playback", exact: true }).click();
    assert((await presentation(page)).playing === "true", "Closing the playback panel should not stop active audio state.");
    await page.waitForFunction(() => document.activeElement?.id === "reader-sasayaki-trigger");
    await audioButton.click();
    await panel.waitFor();
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
    const beforeFocusedControlKeys = await events(page);
    await panel.getByLabel("Sasayaki playback speed").focus();
    await page.keyboard.press("p");
    await panel.getByLabel("Sasayaki skip action").focus();
    await page.keyboard.press("]");
    assert(
      await events(page) === beforeFocusedControlKeys,
      "Sasayaki keyboard shortcuts should not fire from focused playback controls.",
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.press("p");
    await page.keyboard.press("[");
    await page.keyboard.press("]");
    assert(
      await events(page) === "play,audio-throttled,audio-time:12.30,lookup-pause,lookup-resume,word-pause,word-resume,word-pause,word-pause,word-resume,word-duck:0.25,word-volume:1,word-mix,pause,previous:5.25,next:15.25,skip:-10,skip:10,rate:1.5,delay:-0.5,autoScroll:false,autoPause:false,skipAction:seconds15,next:30.25,play,previous:15.25,next:30.25",
      "Playback controls and keyboard shortcuts should emit stable lifecycle, cue/seconds skip, rate, delay, and coordination settings.",
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
    await page.getByRole("button", { name: "Probe lifecycle seek", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe lifecycle exit reader", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-reader-view") === "false");
    let lifecycle = await presentation(page);
    assert(
      lifecycle.lifecycleSavedPosition === "42.75" && lifecycle.lifecycleSaveAttempts === "1",
      "Leaving the reader should wait for Sasayaki playback progress to save before showing the shelf.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe reopen Sasayaki book", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-lifecycle-current-time") === "42.75");
    lifecycle = await presentation(page);
    assert(
      lifecycle.readerView === "true" && lifecycle.lifecycleCurrentTime === "42.75",
      "Reopening the book should restore the saved Sasayaki playback position.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe lifecycle failed exit", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-lifecycle-error") === "save failed");
    lifecycle = await presentation(page);
    assert(
      lifecycle.readerView === "true" && lifecycle.lifecycleSaveAttempts === "2",
      "A failed Sasayaki progress save should keep the reader open instead of silently returning to the shelf.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe lifecycle rapid exit", exact: true }).dispatchEvent("click");
    await page.waitForFunction(() => document.querySelector(".probe-state")?.getAttribute("data-reader-view") === "false");
    lifecycle = await presentation(page);
    assert(
      lifecycle.lifecycleSavedPosition === "64.25" && lifecycle.lifecycleSaveAttempts === "3",
      "Rapid repeated reader exits should coalesce behind one in-flight Sasayaki save.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe reopen Sasayaki book", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe stale Sasayaki save trace", exact: true }).dispatchEvent("click");
    lifecycle = await presentation(page);
    assert(
      lifecycle.traceEvents === "save.start:2:42.75,save.success:2:42.75,save.stale:1:0.00",
      "Sasayaki persistence should reject stale save attempts before they can overwrite a newer run.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe pre-metadata restore start", exact: true }).dispatchEvent("click");
    await page.getByRole("button", { name: "Probe pre-metadata zero timeupdate", exact: true }).dispatchEvent("click");
    lifecycle = await presentation(page);
    assert(
      lifecycle.lifecycleCurrentTime === "42.75" &&
        lifecycle.restoreSavedPositions === "" &&
        lifecycle.restorePending === "42.75",
      "Pre-metadata zero timeupdate should not overwrite the restored Sasayaki position or save 0.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe pre-metadata stop", exact: true }).dispatchEvent("click");
    lifecycle = await presentation(page);
    assert(
      lifecycle.restoreSavedPositions === "42.75",
      "Stopping before metadata restore should flush the pending restored position instead of audio 0.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe metadata restore complete", exact: true }).dispatchEvent("click");
    lifecycle = await presentation(page);
    assert(
      lifecycle.restorePending === "" &&
        lifecycle.restoreAudioTime === "42.75" &&
        lifecycle.lifecycleCurrentTime === "42.75",
      "Loaded metadata should apply and clear the pending Sasayaki restore position.",
      lifecycle,
    );
    await page.getByRole("button", { name: "Probe post-restore playback tick", exact: true }).dispatchEvent("click");
    lifecycle = await presentation(page);
    assert(
      lifecycle.restoreSavedPositions === "42.75,43.20",
      "After metadata restore, normal per-second Sasayaki persistence should resume.",
      lifecycle,
    );
    assert(
      lifecycle.restoreTraceEvents === "metadata.restore.pending:42.75,metadata.restore.skipPreRestoreSample:0.00,stop.sample:42.75,metadata.restore.success:42.75",
      "Sasayaki restore trace should expose the pre-metadata skip, guarded stop sample, and metadata restore.",
      lifecycle,
    );

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
