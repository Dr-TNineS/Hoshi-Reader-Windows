<script lang="ts">
  import ReaderControls from "./ReaderControls.svelte";
  import SasayakiPlayerPanel from "./SasayakiPlayerPanel.svelte";
  import {
    cuePresentationAtTime,
    sasayakiSkipTarget,
    shouldAutoPauseSasayaki,
  } from "./sasayaki-playback";
  import type { SasayakiPlaybackSession } from "./types";

  let open = $state(false);
  let playing = $state(false);
  let currentTime = $state(12);
  let events = $state<string[]>([]);
  let hasPlayedOnce = $state(false);
  let pausedByLookup = $state(false);
  let chapterIndex = $state(0);
  let session = $state<SasayakiPlaybackSession>({
    configured: true,
    audioPath: "C:/Books/audio.wav",
    audioAvailable: true,
    audioFileName: "星の音.wav",
    audioStorage: "external",
    lastPosition: 12,
    delay: 0.25,
    rate: 1.25,
    autoScroll: true,
    autoPause: true,
    skipAction: "cue",
    cues: [
      { id: "1", startTime: 5, endTime: 8, chapterIndex: 0, start: 8, length: 4 },
      { id: "2", startTime: 15, endTime: 19, chapterIndex: 1, start: 3, length: 5 },
    ],
  });
  let presentation = $derived(cuePresentationAtTime(
    session.cues,
    currentTime,
    session.delay,
    chapterIndex,
    session.autoScroll,
    hasPlayedOnce,
  ));
</script>

<main class="probe" data-ui-portal-root>
  <div class="reader-copy">Reader content remains visible until the Audio panel is opened.</div>
  <ReaderControls
    onPrevChapter={() => {}}
    onNextChapter={() => {}}
    onToggleToc={() => {}}
    onBackToShelf={() => events = [...events, "shelf"]}
    onToggleSasayaki={() => open = !open}
    sasayakiOpen={open}
    sasayakiAvailable={session.configured}
  />
  {#if open}
    <div id="sasayaki-player">
      <button
        class="probe-action"
        aria-label="Probe open lookup"
        onclick={() => {
          if (shouldAutoPauseSasayaki(session.autoPause, playing)) {
            playing = false;
            pausedByLookup = true;
            events = [...events, "lookup-pause"];
          }
        }}
      >Lookup</button>
      <button
        class="probe-action"
        aria-label="Probe close lookup"
        onclick={() => {
          if (pausedByLookup) {
            pausedByLookup = false;
            playing = true;
            events = [...events, "lookup-resume"];
          }
        }}
      >Close lookup</button>
      <SasayakiPlayerPanel
        {session}
        {playing}
        {currentTime}
        duration={120}
        onClose={() => {
          open = false;
          requestAnimationFrame(() => document.getElementById("reader-sasayaki-trigger")?.focus());
        }}
        onToggle={() => {
          playing = !playing;
          if (playing) hasPlayedOnce = true;
          else pausedByLookup = false;
          events = [...events, playing ? "play" : "pause"];
        }}
        onSeek={(seconds) => {
          currentTime = seconds;
          events = [...events, `seek:${seconds}`];
        }}
        onSkip={(seconds) => events = [...events, `skip:${seconds}`]}
        onSkipAction={(direction) => {
          const next = sasayakiSkipTarget(
            session.cues,
            currentTime,
            session.delay,
            session.skipAction,
            direction,
          );
          if (next !== null) currentTime = next;
          events = [...events, `${direction < 0 ? "previous" : "next"}:${currentTime}`];
        }}
        onRateChange={(rate) => {
          session = { ...session, rate };
          events = [...events, `rate:${rate}`];
        }}
        onDelayChange={(delay) => {
          session = { ...session, delay };
          events = [...events, `delay:${delay}`];
        }}
        onAutoScrollChange={(autoScroll) => {
          session = { ...session, autoScroll };
          events = [...events, `autoScroll:${autoScroll}`];
        }}
        onAutoPauseChange={(autoPause) => {
          session = { ...session, autoPause };
          events = [...events, `autoPause:${autoPause}`];
        }}
        onSkipActionChange={(skipAction) => {
          session = { ...session, skipAction };
          events = [...events, `skipAction:${skipAction}`];
        }}
        onRelink={() => events = [...events, "relink"]}
      />
    </div>
  {/if}
  <div
    class="probe-state"
    data-events={events.join(",")}
    data-open={open}
    data-playing={playing}
    data-active-cue={presentation.cue?.id ?? ""}
    data-cue-reveal={presentation.reveal}
    data-chapter-to-load={presentation.chapterToLoad ?? ""}
    data-chapter-index={chapterIndex}
  ></div>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; overflow: hidden; font-family: "Segoe UI", sans-serif; }
  .probe {
    --app-bg: #000;
    --app-text: #fff;
    --app-muted: #999;
    --app-surface: #121212;
    --app-border: #333;
    --app-control: #1b1b1b;
    --app-control-hover: #262626;
    --app-primary: #d0bcff;
    --app-error: #ffb4ab;
    --app-shadow: rgba(0, 0, 0, 0.48);
    --ui-focus-ring-width: 2px;
    --ui-focus-ring-color: #d0bcff;
    --ui-focus-ring-offset: 2px;
    width: 100vw;
    height: 100vh;
    padding: 32px;
    color: var(--app-text);
    background: var(--app-bg);
  }
  .reader-copy { writing-mode: vertical-rl; margin: auto; color: #ddd; font-size: 24px; }
  .probe-action { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
  .probe-state { position: fixed; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
</style>
