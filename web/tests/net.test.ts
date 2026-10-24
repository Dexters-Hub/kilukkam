import { describe, expect, it } from 'vitest';
import { backoffDelay, wsUrl } from '../src/net.js';

describe('wsUrl', () => {
  it('uses the page host and /ws', () => {
    expect(wsUrl({ protocol: 'http:', host: '192.168.1.5:5173' })).toBe('ws://192.168.1.5:5173/ws');
    expect(wsUrl({ protocol: 'https:', host: 'kilukkam.example' })).toBe('wss://kilukkam.example/ws');
  });
});

describe('backoffDelay', () => {
  const mid = () => 0.5; // no jitter
  it('grows exponentially and caps', () => {
    expect(backoffDelay(0, 400, 8000, mid)).toBe(400);
    expect(backoffDelay(3, 400, 8000, mid)).toBe(3200);
    expect(backoffDelay(10, 400, 8000, mid)).toBe(8000);
  });
  it('jitters within ±25%', () => {
    expect(backoffDelay(2, 400, 8000, () => 0)).toBe(1200);
    expect(backoffDelay(2, 400, 8000, () => 1)).toBe(2000);
  });
});
