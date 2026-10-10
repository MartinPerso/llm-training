import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..');
export const SECTIONS_FILE = join(ROOT, 'content', 'sections.json');
export const QUESTIONS_DIR = join(ROOT, 'content', 'questions');
export const CACHE_DIR = join(ROOT, '.cache');
export const BOOK_DIR = join(CACHE_DIR, 'book');
export const RAW_BLOCKS_FILE = join(CACHE_DIR, 'notion-blocks.json');
