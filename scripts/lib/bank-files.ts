import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BankFile } from './check.ts';
import { QUESTIONS_DIR } from './paths.ts';

export interface LoadedBank {
  files: BankFile[];
  parseErrors: { file: string; message: string }[];
}

/** Reads content/questions/*.json (files starting with `_` are ignored). A missing folder is an empty bank. */
export function loadBankFiles(dir = QUESTIONS_DIR): LoadedBank {
  const files: BankFile[] = [];
  const parseErrors: LoadedBank['parseErrors'] = [];
  if (!existsSync(dir)) return { files, parseErrors };
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith('.json') || name.startsWith('_')) continue;
    try {
      files.push({ name, data: JSON.parse(readFileSync(join(dir, name), 'utf8')) });
    } catch (e) {
      parseErrors.push({ file: name, message: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  return { files, parseErrors };
}
