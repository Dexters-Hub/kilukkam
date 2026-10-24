import { describe, expect, it } from 'vitest';
import { joinBase, joinLink, prettyLink } from '../src/lib/share.js';

const loc = (host: string, protocol = 'http:') => ({ protocol, host, hostname: host.replace(/:\d+$/, '') });

describe('joinBase', () => {
  it('swaps localhost for the LAN address phones can reach', () => {
    expect(joinBase(loc('localhost:5173'), '192.168.1.5:5173')).toBe('http://192.168.1.5:5173');
    expect(joinBase(loc('127.0.0.1:5173'), '10.0.0.9:5173')).toBe('http://10.0.0.9:5173');
  });
  it('keeps a real host as-is', () => {
    expect(joinBase(loc('192.168.1.5:5173'), '10.0.0.9:5173')).toBe('http://192.168.1.5:5173');
    expect(joinBase(loc('kilukkam.app', 'https:'), '')).toBe('https://kilukkam.app');
  });
  it('falls back to the current host when the LAN is unknown', () => {
    expect(joinBase(loc('localhost:5173'), '')).toBe('http://localhost:5173');
  });
});

describe('joinLink / prettyLink', () => {
  it('builds a scannable code link', () => {
    const url = joinLink('K7MX', 'http://192.168.1.5:5173');
    expect(url).toBe('http://192.168.1.5:5173/?code=K7MX');
    expect(prettyLink(url)).toBe('192.168.1.5:5173/?code=K7MX');
  });
});
