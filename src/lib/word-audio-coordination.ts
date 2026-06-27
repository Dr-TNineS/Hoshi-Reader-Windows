import type { AudioPlaybackMode } from "./types";

export interface WordAudioCoordinationState {
  id: number;
  mode: AudioPlaybackMode;
  pausedSasayaki: boolean;
  duckedSasayaki: boolean;
  previousVolume: number;
}

export interface WordAudioCoordinationInput {
  id: number;
  mode: AudioPlaybackMode;
  sasayakiPlaying: boolean;
  hasSasayakiAudio: boolean;
  currentVolume: number;
}

export interface WordAudioCoordinationPlan {
  state: WordAudioCoordinationState;
  pauseSasayaki: boolean;
  setSasayakiVolume: number | null;
}

export function beginWordAudioCoordination(input: WordAudioCoordinationInput): WordAudioCoordinationPlan {
  const previousVolume = Number.isFinite(input.currentVolume)
    ? Math.max(0, Math.min(1, input.currentVolume))
    : 1;
  const state: WordAudioCoordinationState = {
    id: input.id,
    mode: input.mode,
    pausedSasayaki: input.mode === "interrupt" && input.sasayakiPlaying && input.hasSasayakiAudio,
    duckedSasayaki: input.mode === "duck" && input.hasSasayakiAudio,
    previousVolume,
  };

  return {
    state,
    pauseSasayaki: state.pausedSasayaki,
    setSasayakiVolume: state.duckedSasayaki ? Math.min(previousVolume, 0.25) : null,
  };
}

export interface EndWordAudioCoordinationInput {
  state: WordAudioCoordinationState;
  id: number;
  hasSasayakiAudio: boolean;
  sasayakiPlaying: boolean;
}

export interface EndWordAudioCoordinationPlan {
  resumeSasayaki: boolean;
  restoreSasayakiVolume: number | null;
}

export function endWordAudioCoordination(input: EndWordAudioCoordinationInput): EndWordAudioCoordinationPlan {
  if (input.id !== input.state.id) {
    return { resumeSasayaki: false, restoreSasayakiVolume: null };
  }
  return {
    resumeSasayaki: input.state.pausedSasayaki && input.hasSasayakiAudio && !input.sasayakiPlaying,
    restoreSasayakiVolume: input.state.duckedSasayaki && input.hasSasayakiAudio
      ? input.state.previousVolume
      : null,
  };
}
