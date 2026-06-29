export type AdvancedSettings = {
  reopenLastBookOnStartup: boolean;
  enableReadingStatistics: boolean;
  readingStatisticsAutostartMode: ReadingStatisticsAutostartMode;
  showReadingStatisticsToggle: boolean;
};

export type ReadingStatisticsAutostartMode = "off" | "pageTurn" | "on";

const ADVANCED_SETTINGS_KEY = "hoshi_advanced_settings";

export const defaultAdvancedSettings: AdvancedSettings = {
  reopenLastBookOnStartup: true,
  enableReadingStatistics: false,
  readingStatisticsAutostartMode: "off",
  showReadingStatisticsToggle: false,
};

function normalizeAutostartMode(value: unknown): ReadingStatisticsAutostartMode {
  return value === "pageTurn" || value === "on" ? value : "off";
}

export function loadAdvancedSettings(): AdvancedSettings {
  try {
    const raw = localStorage.getItem(ADVANCED_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AdvancedSettings> : {};
    return {
      reopenLastBookOnStartup: typeof parsed.reopenLastBookOnStartup === "boolean"
        ? parsed.reopenLastBookOnStartup
        : defaultAdvancedSettings.reopenLastBookOnStartup,
      enableReadingStatistics: typeof parsed.enableReadingStatistics === "boolean"
        ? parsed.enableReadingStatistics
        : defaultAdvancedSettings.enableReadingStatistics,
      readingStatisticsAutostartMode: normalizeAutostartMode(parsed.readingStatisticsAutostartMode),
      showReadingStatisticsToggle: typeof parsed.showReadingStatisticsToggle === "boolean"
        ? parsed.showReadingStatisticsToggle
        : defaultAdvancedSettings.showReadingStatisticsToggle,
    };
  } catch {
    return defaultAdvancedSettings;
  }
}

export function saveAdvancedSettings(settings: AdvancedSettings) {
  localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify(settings));
}
