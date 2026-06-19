export type AdvancedSettings = {
  reopenLastBookOnStartup: boolean;
};

const ADVANCED_SETTINGS_KEY = "hoshi_advanced_settings";

export const defaultAdvancedSettings: AdvancedSettings = {
  reopenLastBookOnStartup: true,
};

export function loadAdvancedSettings(): AdvancedSettings {
  try {
    const raw = localStorage.getItem(ADVANCED_SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<AdvancedSettings> : {};
    return {
      reopenLastBookOnStartup: typeof parsed.reopenLastBookOnStartup === "boolean"
        ? parsed.reopenLastBookOnStartup
        : defaultAdvancedSettings.reopenLastBookOnStartup,
    };
  } catch {
    return defaultAdvancedSettings;
  }
}

export function saveAdvancedSettings(settings: AdvancedSettings) {
  localStorage.setItem(ADVANCED_SETTINGS_KEY, JSON.stringify(settings));
}
