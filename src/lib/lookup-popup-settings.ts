export type LookupPopupSettings = {
  width: number;
  height: number;
  scale: number;
};

export const LOOKUP_POPUP_WIDTH = { min: 100, max: 700, step: 10 } as const;
export const LOOKUP_POPUP_HEIGHT = { min: 100, max: 800, step: 10 } as const;
export const LOOKUP_POPUP_SCALE = { min: 0.8, max: 1.5, step: 0.05 } as const;

export const defaultLookupPopupSettings: LookupPopupSettings = {
  width: 320,
  height: 250,
  scale: 1,
};

const LOOKUP_POPUP_SETTINGS_KEY = "hoshi_reader_lookup_popup";

function normalizeStep(
  value: unknown,
  fallback: number,
  bounds: { min: number; max: number; step: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const clamped = Math.max(bounds.min, Math.min(bounds.max, value));
  const snapped = bounds.min + Math.round((clamped - bounds.min) / bounds.step) * bounds.step;
  return Number(Math.max(bounds.min, Math.min(bounds.max, snapped)).toFixed(2));
}

export function normalizeLookupPopupSettings(value: unknown): LookupPopupSettings {
  const candidate = value && typeof value === "object"
    ? value as Partial<LookupPopupSettings>
    : {};
  return {
    width: normalizeStep(candidate.width, defaultLookupPopupSettings.width, LOOKUP_POPUP_WIDTH),
    height: normalizeStep(candidate.height, defaultLookupPopupSettings.height, LOOKUP_POPUP_HEIGHT),
    scale: normalizeStep(candidate.scale, defaultLookupPopupSettings.scale, LOOKUP_POPUP_SCALE),
  };
}

export function loadLookupPopupSettings(): LookupPopupSettings {
  try {
    const raw = localStorage.getItem(LOOKUP_POPUP_SETTINGS_KEY);
    return normalizeLookupPopupSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultLookupPopupSettings;
  }
}

export function saveLookupPopupSettings(settings: LookupPopupSettings) {
  localStorage.setItem(LOOKUP_POPUP_SETTINGS_KEY, JSON.stringify(normalizeLookupPopupSettings(settings)));
}
