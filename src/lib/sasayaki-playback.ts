import type { SasayakiPlaybackCue, SasayakiPlaybackSession, SasayakiSkipAction } from "./types";

export const SASAYAKI_TIME_UI_INTERVAL_MS = 250;
export const SASAYAKI_MIN_RATE = 0.5;
export const SASAYAKI_MAX_RATE = 2;

export function clampPlaybackTime(value: number, duration: number): number {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return duration > 0 && Number.isFinite(duration) ? Math.min(safe, duration) : safe;
}

export function shouldCommitPlaybackTime(
  currentTime: number,
  lastCommittedTime: number,
  nowMs: number,
  lastCommittedAtMs: number,
  force = false,
): boolean {
  if (force) return true;
  if (!Number.isFinite(currentTime)) return false;
  return nowMs - lastCommittedAtMs >= SASAYAKI_TIME_UI_INTERVAL_MS
    || Math.abs(currentTime - lastCommittedTime) >= SASAYAKI_TIME_UI_INTERVAL_MS / 1000;
}

export function shouldPersistPlaybackSecond(
  currentTime: number,
  lastPersistedSecond: number,
  force = false,
): boolean {
  if (!Number.isFinite(currentTime) || currentTime < 0) return false;
  if (force) return true;
  return Math.floor(currentTime) !== lastPersistedSecond;
}

export function normalizeSasayakiRate(rate: number): number {
  return Number.isFinite(rate)
    ? Math.max(SASAYAKI_MIN_RATE, Math.min(SASAYAKI_MAX_RATE, rate))
    : 1;
}

export function applySasayakiAudioRate(audio: HTMLMediaElement | null, rate: number | null | undefined): number | null {
  if (!audio || rate === null || rate === undefined) return null;
  const normalized = normalizeSasayakiRate(rate);
  audio.defaultPlaybackRate = normalized;
  audio.playbackRate = normalized;
  return normalized;
}

export function mergeSasayakiPlaybackSaveResult(
  current: SasayakiPlaybackSession | null,
  saved: SasayakiPlaybackSession,
  lastPosition: number,
): SasayakiPlaybackSession {
  if (!current) return { ...saved, lastPosition };
  const sameAudioSource = current.audioPath === saved.audioPath
    && current.audioFileName === saved.audioFileName
    && current.audioStorage === saved.audioStorage;
  return {
    ...current,
    configured: saved.configured,
    audioAvailable: sameAudioSource ? saved.audioAvailable : current.audioAvailable,
    lastPosition,
  };
}

export function nextCueTime(cues: SasayakiPlaybackCue[], currentTime: number, delay: number): number | null {
  const playbackTime = Math.max(0, currentTime - delay);
  const current = cues.find((cue) => playbackTime >= cue.startTime && playbackTime < cue.endTime);
  const anchor = current?.startTime ?? playbackTime;
  const next = cues.find((cue) => cue.startTime > anchor);
  return next ? Math.max(0, next.startTime + delay) : null;
}

export function previousCueTime(cues: SasayakiPlaybackCue[], currentTime: number, delay: number): number {
  const playbackTime = Math.max(0, currentTime - delay);
  const current = cues.find((cue) => playbackTime >= cue.startTime && playbackTime < cue.endTime);
  const anchor = current?.startTime ?? playbackTime;
  const previous = [...cues].reverse().find((cue) => cue.startTime < anchor);
  return Math.max(0, (previous?.startTime ?? 0) + delay);
}

export function activeCueAtTime(
  cues: SasayakiPlaybackCue[],
  currentTime: number,
  delay: number,
): SasayakiPlaybackCue | null {
  const playbackTime = Math.max(0, currentTime - delay);
  return cues.find((cue) => playbackTime >= cue.startTime && playbackTime < cue.endTime) ?? null;
}

export function cuePresentationAtTime(
  cues: SasayakiPlaybackCue[],
  currentTime: number,
  delay: number,
  currentChapterIndex: number,
  autoScroll: boolean,
  hasPlayedOnce: boolean,
  forceReveal = false,
): {
  cue: SasayakiPlaybackCue | null;
  reveal: boolean;
  chapterToLoad: number | null;
} {
  const cue = activeCueAtTime(cues, currentTime, delay);
  const reveal = Boolean(cue && autoScroll && (hasPlayedOnce || forceReveal));
  return {
    cue,
    reveal,
    chapterToLoad: cue && reveal && cue.chapterIndex !== currentChapterIndex
      ? cue.chapterIndex
      : null,
  };
}

export function shouldAutoPauseSasayaki(autoPause: boolean, playing: boolean): boolean {
  return autoPause && playing;
}

export function skipActionSeconds(action: SasayakiSkipAction): number | null {
  switch (action) {
    case "seconds5": return 5;
    case "seconds10": return 10;
    case "seconds15": return 15;
    case "seconds30": return 30;
    default: return null;
  }
}

export function sasayakiSkipTarget(
  cues: SasayakiPlaybackCue[],
  currentTime: number,
  delay: number,
  action: SasayakiSkipAction,
  direction: -1 | 1,
): number | null {
  const seconds = skipActionSeconds(action);
  if (seconds !== null) return Math.max(0, currentTime + seconds * direction);
  return direction < 0
    ? previousCueTime(cues, currentTime, delay)
    : nextCueTime(cues, currentTime, delay);
}
