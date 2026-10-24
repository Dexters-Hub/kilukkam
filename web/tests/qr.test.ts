import { describe, expect, it } from 'vitest';
import { qrEncode, qrPath } from '../src/lib/qr.js';

// Decoding was verified against the browser's native BarcodeDetector; these
// pin the structure so a refactor can't silently break scanning.
const finderAt = (m: boolean[][], x0: number, y0: number): boolean => {
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if ((m[y0 + dy]?.[x0 + dx] ?? false) !== (ring !== 2)) return false;
    }
  }
  return true;
};

describe('qrEncode', () => {
  it('picks the smallest version that fits', () => {
    expect(qrEncode('HI').size).toBe(21); // version 1
    expect(qrEncode('http://192.168.1.42:5173/?code=BACH').size).toBe(29); // version 3
    expect(qrEncode('x'.repeat(150)).size).toBe(49); // version 8
  });

  it('draws the three finder patterns and the dark module', () => {
    const { size, modules } = qrEncode('http://10.0.0.2:5173/?code=K7MX');
    expect(finderAt(modules, 0, 0)).toBe(true);
    expect(finderAt(modules, size - 7, 0)).toBe(true);
    expect(finderAt(modules, 0, size - 7)).toBe(true);
    expect(modules[size - 8]?.[8]).toBe(true);
  });

  it('is deterministic', () => {
    expect(qrEncode('same').modules).toEqual(qrEncode('same').modules);
  });

  it('rejects text beyond version 10', () => {
    expect(() => qrEncode('x'.repeat(400))).toThrow();
  });

  it('emits one square per dark module, offset by the quiet zone', () => {
    const m = qrEncode('HI');
    const dark = m.modules.flat().filter(Boolean).length;
    const path = qrPath(m, 2);
    expect(path.match(/M/g)).toHaveLength(dark);
    expect(path.startsWith('M2 2h1v1h-1z')).toBe(true);
  });
});
