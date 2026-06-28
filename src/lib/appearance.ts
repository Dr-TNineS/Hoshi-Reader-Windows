export type ReaderTheme = "light" | "dark";

export type ReaderAppearance = {
  theme: ReaderTheme;
};

export type ReaderAppearancePalette = {
  readerBackground: string;
  readerText: string;
  readerInfo: string;
  lookupHighlight: string;
  sasayakiHighlightText: string;
  sasayakiHighlightBackground: string;
  appBackground: string;
  appText: string;
  appMuted: string;
  appSurface: string;
  appSurfaceHover: string;
  appBorder: string;
  appControl: string;
  appControlHover: string;
  appPrimary: string;
  appPrimaryHover: string;
  appError: string;
  appStatus: string;
  appShadow: string;
};

const APPEARANCE_KEY = "hoshi_reader_appearance";

export const defaultReaderAppearance: ReaderAppearance = {
  theme: "light",
};

export const readerThemeLabels: Record<ReaderTheme, string> = {
  light: "浅色",
  dark: "深色",
};

export function loadReaderAppearance(): ReaderAppearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<ReaderAppearance> : {};
    return {
      theme: parsed.theme === "light" || parsed.theme === "dark"
        ? parsed.theme
        : defaultReaderAppearance.theme,
    };
  } catch {
    return defaultReaderAppearance;
  }
}

export function saveReaderAppearance(appearance: ReaderAppearance) {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
}

export function readerAppearancePalette(appearance: ReaderAppearance): ReaderAppearancePalette {
  if (appearance.theme === "light") {
    return {
      readerBackground: "#fff",
      readerText: "#000",
      readerInfo: "#999999",
      lookupHighlight: "rgba(160, 160, 160, 0.32)",
      sasayakiHighlightText: "#000000",
      sasayakiHighlightBackground: "rgba(135, 206, 235, 0.4)",
      appBackground: "#fff",
      appText: "#000",
      appMuted: "#666666",
      appSurface: "#f6f6f6",
      appSurfaceHover: "#eeeeee",
      appBorder: "#dddddd",
      appControl: "#f1f1f1",
      appControlHover: "#e6e6e6",
      appPrimary: "#6650a4",
      appPrimaryHover: "#5a4696",
      appError: "#b3261e",
      appStatus: "#4f6358",
      appShadow: "rgba(0, 0, 0, 0.18)",
    };
  }

  return {
    readerBackground: "#000",
    readerText: "#fff",
    readerInfo: "#999999",
    lookupHighlight: "rgba(255, 255, 255, 0.32)",
    sasayakiHighlightText: "#ffffff",
    sasayakiHighlightBackground: "rgba(135, 206, 235, 0.4)",
    appBackground: "#000",
    appText: "#fff",
    appMuted: "#999999",
    appSurface: "#121212",
    appSurfaceHover: "#1d1d1d",
    appBorder: "#333333",
    appControl: "#1b1b1b",
    appControlHover: "#262626",
    appPrimary: "#d0bcff",
    appPrimaryHover: "#c1a9fb",
    appError: "#ffb4ab",
    appStatus: "#cce8d5",
    appShadow: "rgba(0, 0, 0, 0.48)",
  };
}

export function readerAppearanceCssVars(palette: ReaderAppearancePalette): string {
  return [
    `--reader-bg:${palette.readerBackground}`,
    `--reader-text:${palette.readerText}`,
    `--reader-info:${palette.readerInfo}`,
    `--lookup-highlight-color:${palette.lookupHighlight}`,
    `--sasayaki-highlight-text:${palette.sasayakiHighlightText}`,
    `--sasayaki-highlight-background:${palette.sasayakiHighlightBackground}`,
    `--app-bg:${palette.appBackground}`,
    `--app-text:${palette.appText}`,
    `--app-muted:${palette.appMuted}`,
    `--app-surface:${palette.appSurface}`,
    `--app-surface-hover:${palette.appSurfaceHover}`,
    `--app-border:${palette.appBorder}`,
    `--app-control:${palette.appControl}`,
    `--app-control-hover:${palette.appControlHover}`,
    `--app-primary:${palette.appPrimary}`,
    `--app-primary-hover:${palette.appPrimaryHover}`,
    `--app-error:${palette.appError}`,
    `--app-status:${palette.appStatus}`,
    `--app-shadow:${palette.appShadow}`,
  ].join(";");
}
