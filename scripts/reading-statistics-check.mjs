import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const port = Number(process.env.HSW_READING_STATISTICS_PORT || 5178);
const origin = `http://127.0.0.1:${port}`;

function assert(condition, message, details = {}) {
  if (condition) return;
  const suffix = Object.keys(details).length ? `\n${JSON.stringify(details, null, 2)}` : "";
  throw new Error(`${message}${suffix}`);
}

async function waitForServer(proc) {
  let output = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Vite did not become ready.\n${output}`)), 60000);
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
    await page.goto(`${origin}/?readingStatisticsProbe=1`);
    const state = await page.locator(".probe-state").evaluate((element) => ({
      tracking: element.getAttribute("data-tracking"),
      sessionChars: Number(element.getAttribute("data-session-chars")),
      sessionTime: Number(element.getAttribute("data-session-time")),
      sessionSpeed: Number(element.getAttribute("data-session-speed")),
      todayKey: element.getAttribute("data-today-key"),
      todayChars: Number(element.getAttribute("data-today-chars")),
      allTimeChars: Number(element.getAttribute("data-all-time-chars")),
      persisted: JSON.parse(element.getAttribute("data-persisted") ?? "[]"),
    }));

    assert(state.tracking === "false", "Tracker should pause after explicit pause.", state);
    assert(state.sessionChars === 0, "Large backward jumps should clamp to zero session characters.", state);
    assert(state.sessionTime === 30, "Tracker should accumulate active reading seconds.", state);
    assert(state.sessionSpeed === 0, "Clamped zero characters should produce zero current speed.", state);
    assert(state.todayKey === "2026-05-14", "Tracker should roll today when the local date changes.", state);
    assert(state.todayChars === 0, "Rolled day should clamp negative progress safely.", state);
    assert(state.allTimeChars === 100, "All-time statistics should include the persisted previous day after clamping.", state);
    assert(state.persisted.some((item) => item.dateKey === "2026-05-13" && item.charactersRead === 30), "Persistence should include the first active day.", state);
    assert(state.persisted.some((item) => item.dateKey === "2026-05-14" && item.charactersRead === 0), "Persistence should include the rolled current day.", state);
    console.log(JSON.stringify(state, null, 2));
  } finally {
    if (browser) await browser.close();
    stopServer(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
