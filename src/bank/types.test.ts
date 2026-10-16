import { describe, expect, it } from 'vitest';
import { BOOK_URL, sectionLink, sectionLinkLabel } from './types.ts';

describe('sectionLink', () => {
  it('deep-links book sections into the Notion page', () => {
    expect(sectionLink('2d17eb87-3605-800a-9149-c2c8aec7252c')).toBe(`${BOOK_URL}#2d17eb873605800a9149c2c8aec7252c`);
    expect(sectionLink('2d17eb87-3605', { url: undefined })).toBe(`${BOOK_URL}#2d17eb873605`);
    expect(sectionLinkLabel(undefined)).toBe('Read in the book ↗');
  });

  it('uses the url of an external-source section', () => {
    const section = { url: 'https://example.org/post/#7--ppo' };
    expect(sectionLink('ppo-trust-regions', section)).toBe('https://example.org/post/#7--ppo');
    expect(sectionLinkLabel(section)).toBe('Read the source ↗');
  });
});
