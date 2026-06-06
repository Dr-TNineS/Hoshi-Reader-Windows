import type { EpubMeta, ReaderProgress } from "./types";

const BOOKS_KEY = "hoshi_books";
const SESSION_KEY = "hoshi_session";
const MAX_BOOKS = 12;

export type SavedSession = {
  path: string;
  chapter: number;
  chapterProgress?: number;
  bookReadChars?: number;
  totalCharacters?: number;
  percent?: number;
};

export type BookRecord = {
  path: string;
  title: string;
  chapter: number;
  totalChapters: number;
  lastOpened: number;
  chapterProgress?: number;
  bookReadChars?: number;
  totalCharacters?: number;
  percent?: number;
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.epub$/i, "") || "Untitled";
}

function clampChapter(chapter: number, total: number): number {
  return Math.max(0, Math.min(chapter, Math.max(0, total - 1)));
}

export function clampUnit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(value ?? 0, 1));
}

export function loadBooks(): BookRecord[] {
  return readJson<BookRecord[]>(BOOKS_KEY, []);
}

export function loadSession(): SavedSession | null {
  return readJson<SavedSession | null>(SESSION_KEY, null);
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function saveReadingProgress(
  books: BookRecord[],
  path: string,
  bookMeta: EpubMeta,
  chapter: number,
  progress: ReaderProgress | null,
  chapterProgressFallback = 0,
): BookRecord[] {
  const totalChapters = bookMeta.spine.length;
  const safeChapter = clampChapter(chapter, totalChapters);
  const chapterInfo = bookMeta.book_info.chapter_info[safeChapter];
  const totalCharacters = bookMeta.book_info.character_count;
  const chapterProgress = progress?.chapterIndex === safeChapter
    ? clampUnit(progress.chapterProgress)
    : clampUnit(chapterProgressFallback);
  const bookReadChars = progress?.chapterIndex === safeChapter
    ? progress.bookReadChars
    : Math.round((chapterInfo?.current_total ?? 0) + (chapterInfo?.chapter_count ?? 0) * chapterProgress);
  const percent = totalCharacters > 0 ? (bookReadChars / totalCharacters) * 100 : 0;

  localStorage.setItem(SESSION_KEY, JSON.stringify({
    path,
    chapter: safeChapter,
    chapterProgress,
    bookReadChars,
    totalCharacters,
    percent,
  }));

  const record: BookRecord = {
    path,
    title: bookMeta.title || fileName(path),
    chapter: safeChapter,
    totalChapters,
    lastOpened: Date.now(),
    chapterProgress,
    bookReadChars,
    totalCharacters,
    percent,
  };
  const nextBooks = [
    record,
    ...books.filter((book) => book.path !== path),
  ].slice(0, MAX_BOOKS);
  localStorage.setItem(BOOKS_KEY, JSON.stringify(nextBooks));
  return nextBooks;
}
