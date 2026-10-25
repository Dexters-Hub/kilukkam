import { existsSync, readFileSync } from 'node:fs';
import { MAX_AVATAR_LEN } from '@kilukkam/shared';
import { describe, expect, it } from 'vitest';
import { COMPOSERS, composerFor, pickComposer, portraitUrl } from '../src/data/composers.js';

describe('COMPOSERS', () => {
  it('has unique ids that fit the wire avatar limit', () => {
    const ids = COMPOSERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.length).toBeLessThanOrEqual(MAX_AVATAR_LEN);
  });

  it('uses 1 or 2 letter monograms', () => {
    for (const c of COMPOSERS) expect(c.monogram).toMatch(/^\p{L}{1,2}$/u);
  });

  it('gives every composer a portrait and a credit line', () => {
    const credits = readFileSync(new URL('../public/composers/CREDITS.md', import.meta.url), 'utf8');
    for (const c of COMPOSERS) {
      expect(existsSync(new URL(`../public${portraitUrl(c)}`, import.meta.url)), c.id).toBe(true);
      expect(credits, c.id).toContain(`| \`${c.id}\` |`);
    }
  });
});

describe('composerFor', () => {
  it('finds by id and ignores anything else', () => {
    expect(composerFor('rahman')?.displayName).toBe('A.R. Rahman');
    expect(composerFor('🎼')).toBeUndefined();
  });
});

describe('pickComposer', () => {
  it('keeps a valid stored choice', () => {
    expect(pickComposer('debussy').id).toBe('debussy');
  });

  it('falls back to a roster pick for stale or missing prefs', () => {
    expect(pickComposer('🦊', () => 0).id).toBe(COMPOSERS[0]?.id);
    expect(pickComposer(null, () => 0.999).id).toBe(COMPOSERS.at(-1)?.id);
  });
});
