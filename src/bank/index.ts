import { bankFromGlobs, buildBank, type Bank } from './load.ts';
import { sampleBank } from '../dev/sampleBank.ts';

// Both globs tolerate zero matches (content/ may not exist yet).
const sectionGlob = import.meta.glob('../../content/sections.json', { eager: true, import: 'default' });
const questionGlob = import.meta.glob('../../content/questions/*.json', { eager: true, import: 'default' });

function load(): { bank: Bank; sample: boolean } {
  const real = bankFromGlobs(sectionGlob, questionGlob);
  // The fixture only exists in dev builds: `import.meta.env.DEV` is a compile-time `false` in
  // production, so the branch (and the fixture module) is removed from the bundle.
  if (import.meta.env.DEV && real.concepts.length === 0) {
    return { bank: buildBank(sampleBank.sections, sampleBank.files), sample: true };
  }
  return { bank: real, sample: false };
}

const loaded = load();
export const bank: Bank = loaded.bank;
/** True when the dev fixture is shown because the real bank is empty. */
export const usingSampleBank: boolean = loaded.sample;
export type { Bank } from './load.ts';
