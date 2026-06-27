<script lang="ts">
  import ReaderControls from "./ReaderControls.svelte";
  import SasayakiPlayerPanel from "./SasayakiPlayerPanel.svelte";
  import {
    cuePresentationAtTime,
    sasayakiSkipTarget,
    shouldAutoPauseSasayaki,
    shouldCommitPlaybackTime,
  } from "./sasayaki-playback";
  import { sasayakiShortcutAction } from "./sasayaki-shortcuts";
  import {
    beginWordAudioCoordination,
    endWordAudioCoordination,
    type WordAudioCoordinationState,
  } from "./word-audio-coordination";
  import type { AudioPlaybackMode, SasayakiPlaybackSession } from "./types";

  let open = $state(false);
  let playing = $state(false);
  let currentTime = $state(12);
  let events = $state<string[]>([]);
  let hasPlayedOnce = $state(false);
  let pausedByLookup = $state(false);
  let chapterIndex = $state(0);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let probeNow = 1000;
  let lastCommittedAt = 1000;
  let audioTimeCommits = $state(0);
  let repaintSentinel = $state(0);
  let coordinationRun = 0;
  let wordAudioCoordination = $state<WordAudioCoordinationState | null>(null);
  let sasayakiVolume = $state(1);
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

  function probeAudioTimeUpdate(delta: number, elapsedMs: number) {
    if (!audioEl) return;
    const target = Math.max(0, currentTime + delta);
    try {
      audioEl.currentTime = target;
    } catch {
      // Browsers may reject seeking a source-less probe element; the App path
      // uses a real media source, while this probe still validates throttling.
    }
    const observedTime = Number.isFinite(audioEl.currentTime) && audioEl.currentTime > 0
      ? audioEl.currentTime
      : target;
    probeNow += elapsedMs;
    repaintSentinel += 1;
    if (shouldCommitPlaybackTime(observedTime, currentTime, probeNow, lastCommittedAt)) {
      currentTime = observedTime;
      lastCommittedAt = probeNow;
      audioTimeCommits += 1;
      events = [...events, `audio-time:${currentTime.toFixed(2)}`];
      return;
    }
    events = [...events, "audio-throttled"];
  }

  function restoreWordAudioCoordination(id = wordAudioCoordination?.id) {
    const active = wordAudioCoordination;
    if (!active || id !== active.id) return;
    const plan = endWordAudioCoordination({
      state: active,
      id,
      hasSasayakiAudio: true,
      sasayakiPlaying: playing,
    });
    wordAudioCoordination = null;
    if (plan.restoreSasayakiVolume !== null) {
      sasayakiVolume = plan.restoreSasayakiVolume;
      events = [...events, `word-volume:${sasayakiVolume}`];
    }
    if (plan.resumeSasayaki) {
      playing = true;
      events = [...events, "word-resume"];
    }
  }

  function replaceWordAudioCoordination(): boolean {
    const active = wordAudioCoordination;
    if (!active) return false;
    if (active.duckedSasayaki) sasayakiVolume = active.previousVolume;
    wordAudioCoordination = null;
    return active.pausedSasayaki;
  }

  function beginWordAudio(mode: AudioPlaybackMode): number {
    const wasPausedByPreviousWordAudio = replaceWordAudioCoordination();
    const id = ++coordinationRun;
    const plan = beginWordAudioCoordination({
      id,
      mode,
      sasayakiPlaying: playing || wasPausedByPreviousWordAudio,
      hasSasayakiAudio: true,
      currentVolume: sasayakiVolume,
    });
    wordAudioCoordination = plan.state;
    if (plan.setSasayakiVolume !== null) {
      sasayakiVolume = plan.setSasayakiVolume;
      events = [...events, `word-duck:${sasayakiVolume}`];
    }
    if (plan.pauseSasayaki) {
      playing = false;
      events = [...events, "word-pause"];
    }
    if (!plan.pauseSasayaki && plan.setSasayakiVolume === null) events = [...events, `word-${mode}`];
    return id;
  }

  function togglePlayback() {
    playing = !playing;
    if (playing) hasPlayedOnce = true;
    else pausedByLookup = false;
    events = [...events, playing ? "play" : "pause"];
  }

  function applySkipAction(direction: -1 | 1) {
    const next = sasayakiSkipTarget(
      session.cues,
      currentTime,
      session.delay,
      session.skipAction,
      direction,
    );
    if (next !== null) currentTime = next;
    events = [...events, `${direction < 0 ? "previous" : "next"}:${currentTime}`];
  }

  function handleSasayakiShortcut(event: KeyboardEvent) {
    if (!session.configured || !session.audioAvailable) return;
    const action = sasayakiShortcutAction(event);
    if (!action) return;

    event.preventDefault();
    if (action === "togglePlayback") togglePlayback();
    else applySkipAction(action === "previous" ? -1 : 1);
  }
</script>

<svelte:window onkeydown={handleSasayakiShortcut} />

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
      <button
        class="probe-action"
        aria-label="Probe throttled audio tick"
        onclick={() => probeAudioTimeUpdate(0.01, 50)}
      >Audio tick throttled</button>
      <button
        class="probe-action"
        aria-label="Probe committed audio tick"
        onclick={() => probeAudioTimeUpdate(0.3, 250)}
      >Audio tick committed</button>
      <button
        class="probe-action"
        aria-label="Probe word interrupt"
        onclick={() => {
          const id = beginWordAudio("interrupt");
          restoreWordAudioCoordination(id);
        }}
      >Word interrupt</button>
      <button
        class="probe-action"
        aria-label="Probe rapid word interrupt"
        onclick={() => {
          beginWordAudio("interrupt");
          const second = beginWordAudio("interrupt");
          restoreWordAudioCoordination(second);
        }}
      >Rapid word interrupt</button>
      <button
        class="probe-action"
        aria-label="Probe word duck"
        onclick={() => {
          const id = beginWordAudio("duck");
          restoreWordAudioCoordination(id);
        }}
      >Word duck</button>
      <button
        class="probe-action"
        aria-label="Probe word mix"
        onclick={() => {
          const id = beginWordAudio("mix");
          restoreWordAudioCoordination(id);
        }}
      >Word mix</button>
      <audio class="sasayaki-probe-audio" bind:this={audioEl} preload="metadata"></audio>
      <SasayakiPlayerPanel
        {session}
        {playing}
        {currentTime}
        duration={120}
        onClose={() => {
          open = false;
          requestAnimationFrame(() => document.getElementById("reader-sasayaki-trigger")?.focus());
        }}
        onToggle={togglePlayback}
        onSeek={(seconds) => {
          currentTime = seconds;
          events = [...events, `seek:${seconds}`];
        }}
        onSkip={(seconds) => events = [...events, `skip:${seconds}`]}
        onSkipAction={applySkipAction}
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
    data-audio-element={Boolean(audioEl)}
    data-audio-time-commits={audioTimeCommits}
    data-repaint-sentinel={repaintSentinel}
    data-word-coordination-active={Boolean(wordAudioCoordination)}
    data-sasayaki-volume={sasayakiVolume}
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
