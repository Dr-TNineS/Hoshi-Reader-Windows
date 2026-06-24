import type { SasayakiPlaybackCue } from "./types";

export function clampPlaybackTime(value: number, duration: number): number {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  return duration > 0 && Number.isFinite(duration) ? Math.min(safe, duration) : safe;
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
