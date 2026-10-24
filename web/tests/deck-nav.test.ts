import { describe, expect, it } from 'vitest';
import { slideFromHash } from '../src/demo/nav.js';

describe('slideFromHash', () => {
  it('maps 1-based hashes to 0-based slides', () => {
    expect(slideFromHash('#1', 10)).toBe(0);
    expect(slideFromHash('#4', 10)).toBe(3);
  });
  it('clamps and falls back', () => {
    expect(slideFromHash('#99', 10)).toBe(9);
    expect(slideFromHash('#0', 10)).toBe(0);
    expect(slideFromHash('', 10)).toBe(0);
    expect(slideFromHash('#abc', 10)).toBe(0);
  });
});
