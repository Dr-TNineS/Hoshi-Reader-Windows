import { invoke } from "@tauri-apps/api/core";

export type ReadingStatistic = {
  title: string;
  dateKey: string;
  charactersRead: number;
  readingTime: number;
  minReadingSpeed: number;
  altMinReadingSpeed: number;
  lastReadingSpeed: number;
  maxReadingSpeed: number;
  lastStatisticModified: number;
};

export type ReaderStatisticsState = {
  isTracking: boolean;
  session: ReadingStatistic;
  today: ReadingStatistic;
  allTime: ReadingStatistic;
};

export type ReaderStatisticsClock = {
  nowMillis: () => number;
  currentDateKey: () => string;
};

export const systemReaderStatisticsClock: ReaderStatisticsClock = {
  nowMillis: () => Date.now(),
  currentDateKey: () => localDateKey(new Date()),
};

const PATH_STATISTICS_KEY = "hoshi_reading_statistics";
export const HSA_STATISTICS_INT_MAX = 2_147_483_647;

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultStatistic(title: string, dateKey: string): ReadingStatistic {
  return {
    title,
    dateKey,
    charactersRead: 0,
    readingTime: 0,
    minReadingSpeed: 0,
    altMinReadingSpeed: 0,
    lastReadingSpeed: 0,
    maxReadingSpeed: 0,
    lastStatisticModified: 0,
  };
}

function hsaStatisticInt(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(HSA_STATISTICS_INT_MAX, Math.trunc(value ?? 0)));
}

export function normalizeReadingStatistic(value: Partial<ReadingStatistic>, title: string, dateKey: string): ReadingStatistic {
  const fallback = defaultStatistic(title, dateKey);
  return {
    title: typeof value.title === "string" && value.title ? value.title : fallback.title,
    dateKey: typeof value.dateKey === "string" && value.dateKey ? value.dateKey : fallback.dateKey,
    charactersRead: hsaStatisticInt(value.charactersRead),
    readingTime: Number.isFinite(value.readingTime) ? Math.max(0, value.readingTime ?? 0) : 0,
    minReadingSpeed: hsaStatisticInt(value.minReadingSpeed),
    altMinReadingSpeed: hsaStatisticInt(value.altMinReadingSpeed),
    lastReadingSpeed: hsaStatisticInt(value.lastReadingSpeed),
    maxReadingSpeed: hsaStatisticInt(value.maxReadingSpeed),
    lastStatisticModified: Number.isFinite(value.lastStatisticModified) ? Math.max(0, Math.trunc(value.lastStatisticModified ?? 0)) : 0,
  };
}

function normalizeReadingStatistics(statistics: ReadingStatistic[]): ReadingStatistic[] {
  return statistics.map((statistic) => normalizeReadingStatistic(statistic, statistic.title || "Untitled", statistic.dateKey));
}

export function deduplicateReadingStatistics(statistics: ReadingStatistic[]): ReadingStatistic[] {
  const grouped = new Map<string, ReadingStatistic>();
  for (const statistic of statistics) {
    const existing = grouped.get(statistic.dateKey);
    if (!existing || statistic.lastStatisticModified > existing.lastStatisticModified) {
      grouped.set(statistic.dateKey, statistic);
    }
  }
  return [...grouped.values()];
}

function allTimeStatistic(title: string, dateKey: string, statistics: ReadingStatistic[]): ReadingStatistic {
  const total = statistics.reduce(
    (acc, statistic) => ({
      readingTime: acc.readingTime + statistic.readingTime,
      charactersRead: hsaStatisticInt(acc.charactersRead + statistic.charactersRead),
      lastStatisticModified: Math.max(acc.lastStatisticModified, statistic.lastStatisticModified),
    }),
    { readingTime: 0, charactersRead: 0, lastStatisticModified: 0 },
  );
  return {
    ...defaultStatistic(title, dateKey),
    charactersRead: total.charactersRead,
    readingTime: total.readingTime,
    lastReadingSpeed: readingSpeed(total.charactersRead, total.readingTime),
    lastStatisticModified: total.lastStatisticModified,
  };
}

function readingSpeed(charactersRead: number, readingTime: number): number {
  return readingTime > 0 ? hsaStatisticInt(charactersRead / readingTime * 3600) : 0;
}

function updateStatistic(statistic: ReadingStatistic, timeDiff: number, characterDiff: number, modified: number): ReadingStatistic {
  const nextReadingTime = statistic.readingTime + timeDiff;
  const nextCharactersRead = hsaStatisticInt(statistic.charactersRead + characterDiff);
  const nextReadingSpeed = readingSpeed(nextCharactersRead, nextReadingTime);
  return {
    ...statistic,
    readingTime: nextReadingTime,
    charactersRead: nextCharactersRead,
    lastReadingSpeed: nextReadingSpeed,
    maxReadingSpeed: hsaStatisticInt(Math.max(statistic.maxReadingSpeed, nextReadingSpeed)),
    minReadingSpeed: statistic.minReadingSpeed !== 0 ? hsaStatisticInt(Math.min(statistic.minReadingSpeed, nextReadingSpeed)) : nextReadingSpeed,
    altMinReadingSpeed: characterDiff !== 0
      ? (statistic.altMinReadingSpeed !== 0 ? hsaStatisticInt(Math.min(statistic.altMinReadingSpeed, nextReadingSpeed)) : nextReadingSpeed)
      : statistic.altMinReadingSpeed,
    lastStatisticModified: modified,
  };
}

function pathStatisticsStore(): Record<string, ReadingStatistic[]> {
  try {
    const raw = localStorage.getItem(PATH_STATISTICS_KEY);
    return raw ? JSON.parse(raw) as Record<string, ReadingStatistic[]> : {};
  } catch {
    return {};
  }
}

function savePathStatisticsStore(store: Record<string, ReadingStatistic[]>) {
  localStorage.setItem(PATH_STATISTICS_KEY, JSON.stringify(store));
}

export async function loadReadingStatistics(locator: { bookId?: string; path?: string }, title: string, useTauri: boolean): Promise<ReadingStatistic[]> {
  if (useTauri && locator.bookId) {
    const loaded = await invoke<ReadingStatistic[]>("reading_load_statistics", { bookId: locator.bookId });
    return deduplicateReadingStatistics(loaded.map((item) => normalizeReadingStatistic(item, title, item.dateKey)));
  }

  const key = locator.bookId ? `library:${locator.bookId}` : `path:${locator.path ?? ""}`;
  return deduplicateReadingStatistics((pathStatisticsStore()[key] ?? []).map((item) => normalizeReadingStatistic(item, title, item.dateKey)));
}

export async function saveReadingStatistics(locator: { bookId?: string; path?: string }, statistics: ReadingStatistic[], useTauri: boolean): Promise<ReadingStatistic[]> {
  const next = deduplicateReadingStatistics(normalizeReadingStatistics(statistics));
  if (useTauri && locator.bookId) {
    return invoke<ReadingStatistic[]>("reading_save_statistics", { bookId: locator.bookId, statistics: next });
  }

  const key = locator.bookId ? `library:${locator.bookId}` : `path:${locator.path ?? ""}`;
  const store = pathStatisticsStore();
  store[key] = next;
  savePathStatisticsStore(store);
  return next;
}

export class ReaderStatisticsTracker {
  private statistics: ReadingStatistic[];
  private lastTimestampMillis: number;
  private lastCharacterCount = 0;
  private hasUpdated = false;
  state: ReaderStatisticsState;

  constructor(
    private title: string,
    initialStatistics: ReadingStatistic[],
    private enabled: boolean,
    private clock: ReaderStatisticsClock = systemReaderStatisticsClock,
  ) {
    this.statistics = deduplicateReadingStatistics(normalizeReadingStatistics(initialStatistics));
    this.lastTimestampMillis = clock.nowMillis();
    const todayKey = clock.currentDateKey();
    this.state = {
      isTracking: false,
      session: defaultStatistic(title, todayKey),
      today: this.statisticForDate(todayKey),
      allTime: allTimeStatistic(title, todayKey, this.statistics),
    };
  }

  start(currentCharacter: number) {
    if (!this.enabled) return;
    this.state = { ...this.state, isTracking: true };
    this.resetBaseline(currentCharacter);
  }

  startForPageTurnIfNeeded(currentCharacter: number) {
    if (!this.state.isTracking) this.start(currentCharacter);
  }

  pause(currentCharacter: number): boolean {
    if (!this.state.isTracking) return false;
    this.update(currentCharacter);
    this.state = { ...this.state, isTracking: false };
    return true;
  }

  update(currentCharacter: number) {
    if (!this.enabled || !this.state.isTracking) return;
    this.rollTodayIfNeeded();
    const now = this.clock.nowMillis();
    const timeDiff = (now - this.lastTimestampMillis) / 1000;
    if (timeDiff <= 0) return;

    const characterDiff = currentCharacter - this.lastCharacterCount;
    const finalCharacterDiff = characterDiff < 0 && Math.abs(characterDiff) > this.state.session.charactersRead
      ? -this.state.session.charactersRead
      : characterDiff;
    const modified = this.clock.nowMillis();
    const session = updateStatistic(this.state.session, timeDiff, finalCharacterDiff, modified);
    const today = updateStatistic(this.state.today, timeDiff, finalCharacterDiff, modified);
    const allTime = updateStatistic(this.state.allTime, timeDiff, finalCharacterDiff, modified);
    this.state = { ...this.state, session, today, allTime };
    this.hasUpdated = true;
    this.lastTimestampMillis = now;
    this.lastCharacterCount = currentCharacter;
  }

  resetBaseline(currentCharacter: number) {
    this.lastCharacterCount = currentCharacter;
    this.lastTimestampMillis = this.clock.nowMillis();
  }

  statisticsForPersistenceOrNull(): ReadingStatistic[] | null {
    return this.enabled && (this.hasUpdated || this.statistics.length > 0)
      ? this.statisticsForPersistence()
      : null;
  }

  statisticsForPersistence(): ReadingStatistic[] {
    const today = this.state.today;
    const next = [...this.statistics];
    const index = next.findIndex((statistic) => statistic.dateKey === today.dateKey);
    if (index >= 0) next[index] = today;
    else next.push(today);
    this.statistics = deduplicateReadingStatistics(next);
    return this.statistics;
  }

  private rollTodayIfNeeded() {
    const currentDateKey = this.clock.currentDateKey();
    if (this.state.today.dateKey === currentDateKey) return;
    this.statisticsForPersistence();
    this.state = {
      ...this.state,
      today: this.statisticForDate(currentDateKey),
    };
  }

  private statisticForDate(dateKey: string): ReadingStatistic {
    return this.statistics.find((statistic) => statistic.dateKey === dateKey) ?? defaultStatistic(this.title, dateKey);
  }
}

export function formatStatisticsDuration(seconds: number): string {
  const totalSeconds = Math.max(0, Math.trunc(seconds));
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.trunc((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

export function formatBottomStatisticsTime(seconds: number): string {
  const totalMinutes = Math.trunc(Math.max(0, seconds) / 60);
  const hours = Math.trunc(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

export function formatReadingSpeed(speed: number): string {
  return `${Math.max(0, Math.trunc(speed)).toLocaleString()} chars/h`;
}

export function secondsRemaining(remainingCharacters: number, speed: number): number {
  return speed > 0 ? Math.max(0, remainingCharacters) / (speed / 3600) : 0;
}
