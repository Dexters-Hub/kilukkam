import { describe, expect, it } from 'vitest';
import { isCompleteCode, normalizeCode, normalizeName } from '../src/store.js';

describe('normalizeCode', () => {
  it('uppercases and trims to 4', () => {
    expect(normalizeCode('abcd')).toBe('ABCD');
    expect(normalizeCode('abcdef')).toBe('ABCD');
  });
  it('drops spaces, punctuation and ambiguous chars (0 O 1 I)', () => {
    expect(normalizeCode(' a-b c ')).toBe('ABC');
    expect(normalizeCode('O0I1k7')).toBe('K7');
  });
  it('validates completeness', () => {
    expect(isCompleteCode('K7MX')).toBe(true);
    expect(isCompleteCode('K7M')).toBe(false);
    expect(isCompleteCode('k7mx')).toBe(false);
  });
});

describe('normalizeName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeName('  Anu   Mol  ')).toBe('Anu Mol');
  });
  it('caps at 20 UTF-16 units without splitting emoji', () => {
    expect(normalizeName('x'.repeat(30))).toHaveLength(20);
    const n = normalizeName('a'.repeat(19) + '🎻');
    expect(n).toBe('a'.repeat(19));
  });
});
