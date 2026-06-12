import { invoke } from "@tauri-apps/api/core";
import type { EpubMeta, ReaderProgress } from "./types";

const BOOKS_KEY = "hoshi_books";
const SESSION_KEY = "hoshi_session";
const MAX_BOOKS = 12;

export type LibraryBookRecord = {
  bookId: string;
  title: string | null;
  sourcePath: string;
  libraryPath: string;
  contentHash: string;
  sizeBytes: number;
  importedAt: number;
};

export type BookLocator = {
  bookId?: string;
  path?: string;
  sourcePath?: string;
  libraryPath?: string;
};

export type SavedSession = {
  bookId?: string;
  path?: string;
  sourcePath?: string;
  libraryPath?: string;
  chapter: number;
  chapterProgress?: number;
  bookReadChars?: number;
  totalCharacters?: number;
  percent?: number;
};

export type BookRecord = {
  bookId?: string;
  path?: string;
  sourcePath?: string;
  libraryPath?: string;
  title: string;
  chapter: number;
  totalChapters: number;
  lastOpened: number;
  chapterProgress?: number;
  bookReadChars?: number;
  totalCharacters?: number;
  percent?: number;
};

export type ReadingState = {
  books: BookRecord[];
  session: SavedSession | null;
};

export type ReadingProgressUpdate = {
  record: BookRecord;
  session: SavedSession;
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

function locatorKey(locator: BookLocator): string {
  if (locator.bookId) return `library:${locator.bookId}`;
  return `path:${locator.path ?? ""}`;
}

function displayPath(locator: BookLocator): string {
  return locator.sourcePath || locator.path || locator.libraryPath || "";
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

export async function importLegacyReadingState(useTauri: boolean): Promise<ReadingState> {
  if (!useTauri) {
    return {
      books: loadBooks(),
      session: loadSession(),
    };
  }

  return invoke<ReadingState>("reading_import_legacy_state", {
    books: loadBooks(),
    session: loadSession(),
  });
}

export async function loadReadingState(useTauri: boolean): Promise<ReadingState> {
  if (!useTauri) {
    return {
      books: loadBooks(),
      session: loadSession(),
    };
  }

  return invoke<ReadingState>("reading_load_state");
}

export async function clearReadingSession(useTauri: boolean): Promise<void> {
  if (!useTauri) {
    clearSession();
    return;
  }

  await invoke("reading_clear_session");
}

export function bookRecordKey(book: BookRecord): string {
  return locatorKey(book);
}

export function bookRecordPath(book: BookRecord): string {
  return displayPath(book);
}

export function locatorFromLibraryBook(book: LibraryBookRecord): BookLocator {
  return {
    bookId: book.bookId,
    sourcePath: book.sourcePath,
    libraryPath: book.libraryPath,
  };
}

export function mergeLibraryBooks(books: BookRecord[], libraryBooks: LibraryBookRecord[]): BookRecord[] {
  const existingKeys = new Set(books.map(bookRecordKey));
  const importedRecords = libraryBooks
    .filter((book) => !existingKeys.has(locatorKey(locatorFromLibraryBook(book))))
    .map((book) => ({
      bookId: book.bookId,
      sourcePath: book.sourcePath,
      libraryPath: book.libraryPath,
      title: book.title || fileName(book.sourcePath || book.libraryPath),
      chapter: 0,
      totalChapters: 0,
      lastOpened: book.importedAt * 1000,
    }));

  return [...books, ...importedRecords].slice(0, MAX_BOOKS);
}

export function buildReadingProgressUpdate(
  locator: BookLocator,
  bookMeta: EpubMeta,
  chapter: number,
  progress: ReaderProgress | null,
  chapterProgressFallback = 0,
): ReadingProgressUpdate {
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

  const session: SavedSession = {
    bookId: locator.bookId,
    path: locator.path,
    sourcePath: locator.sourcePath,
    libraryPath: locator.libraryPath,
    chapter: safeChapter,
    chapterProgress,
    bookReadChars,
    totalCharacters,
    percent,
  };

  const record: BookRecord = {
    bookId: locator.bookId,
    path: locator.path,
    sourcePath: locator.sourcePath,
    libraryPath: locator.libraryPath,
    title: bookMeta.title || fileName(displayPath(locator)),
    chapter: safeChapter,
    totalChapters,
    lastOpened: Date.now(),
    chapterProgress,
    bookReadChars,
    totalCharacters,
    percent,
  };

  return { record, session };
}

export function upsertReadingProgressBook(books: BookRecord[], record: BookRecord): BookRecord[] {
  const key = bookRecordKey(record);
  return [
    record,
    ...books.filter((book) => bookRecordKey(book) !== key),
  ].slice(0, MAX_BOOKS);
}

export async function persistReadingProgress(
  record: BookRecord,
  session: SavedSession,
  useTauri: boolean,
): Promise<BookRecord[]> {
  if (useTauri) {
    return invoke<BookRecord[]>("reading_save_progress", { record, session });
  }

  const nextBooks = upsertReadingProgressBook(loadBooks(), record);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  localStorage.setItem(BOOKS_KEY, JSON.stringify(nextBooks));
  return nextBooks;
}
