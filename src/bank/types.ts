// Shared contract between the content pipeline (scripts/) and the app (src/).
// All text fields are Markdown with $inline$ / $$display$$ LaTeX.

export interface Section {
  id: string;           // Notion block id (with dashes); deep link uses it without dashes
  chapter: string;      // H1 title
  title: string;        // heading title (equals chapter for the H1 itself)
  level: 1 | 2 | 3;
  order: number;        // position in the book
  hash: string;         // sha256 of the section's Markdown at last fetch
  coveredHash?: string; // hash when questions were last written for it
}

export type Question =
  | { kind: "numeric"; prompt: string; answer: number; tolerance?: number; unit?: string; explanation: string }
  | { kind: "recall"; prompt: string; answer: string; explanation?: string }
  | { kind: "mcq"; prompt: string; choices: string[]; correct: number; explanation: string }
  | { kind: "truefalse"; prompt: string; answer: boolean; explanation: string };

export interface Concept {
  id: string;            // permanent, e.g. "inference.kv-cache.bytes-per-token"; never reused
  section: string;       // Section.id
  variants: Question[];  // 1–3 angles on the same idea
  retired?: true;
}

// One file per chapter: content/questions/<chapter-slug>.json
export interface ChapterFile {
  chapter: string;       // must match Section.chapter
  concepts: Concept[];
}

// Numeric tolerance is relative; default 5%, 0 = exact.
export const DEFAULT_TOLERANCE = 0.05;

export const BOOK_URL = "https://alisawuffles.notion.site/alisa-s-book-of-llms";
export const sectionLink = (sectionId: string) => `${BOOK_URL}#${sectionId.replaceAll("-", "")}`;
