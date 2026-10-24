import { afterEach, describe, expect, it, vi } from 'vitest';

// The player module is mocked so the status logic can be driven without Spotify.
const listeners: ((s: unknown) => void)[] = [];
const fake = {
  deviceId: 'd1',
  tapToStart: false,
  activate: async () => {},
  play: vi.fn(async () => ({ ok: true as const })),
  pause: vi.fn(async () => {}),
  resume: async () => {},
  seek: vi.fn(async () => {}),
  onState: (l: (s: unknown) => void) => {
    listeners.push(l);
    return () => {};
  },
  disconnect: () => {},
};
let connect: () => Promise<unknown> = async () => ({ ok: true, player: fake });
vi.mock('../src/lib/spotify/player.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/spotify/player.js')>()),
  connectPlayer: () => connect(),
}));
vi.mock('../src/components/Toast.js', () => ({ toast: () => {} }));

afterEach(() => vi.resetModules());

const track = { id: 'x'.repeat(22), name: 'Song', artists: ['Band'], durationMs: 180_000, albumArt: null, uri: `spotify:track:${'x'.repeat(22)}`, isPlayable: true };

describe('song status', () => {
  it('says why when the player cannot connect', async () => {
    connect = async () => ({ ok: false, issue: 'no_drm', message: 'This browser cannot play Spotify.' });
    const m = await import('../src/app/playalong.js');
    await m.ensurePlayer();
    expect(m.songStatus()).toMatchObject({ phase: 'error', message: 'This browser cannot play Spotify.' });
  });

  it('goes ready, waits for the room, then plays and pauses with the room', async () => {
    connect = async () => ({ ok: true, player: fake });
    const m = await import('../src/app/playalong.js');
    const seen: string[] = [];
    m.onSongStatus(() => seen.push(m.songStatus().phase));
    await m.ensurePlayer();
    expect(m.songStatus().phase).toBe('ready');
    m.choose({ track, beat: { bpm: 120, periodMs: 500, songBeatMs: 0, confidence: 1 }, beatsPerBar: 4, key: null });
    const start = m.startSong(Date.now() + 3000);
    expect(m.songStatus().phase).toBe('cued');
    await start;
    for (const l of listeners) l({ positionMs: 10, durationMs: 180_000, paused: false, track: { uri: track.uri, name: 'Song', artists: ['Band'], albumArt: null }, sampledAt: Date.now() });
    expect(m.songStatus().phase).toBe('playing');
    m.stopSong();
    expect(m.songStatus().phase).toBe('paused');
    expect(seen).toContain('cued');
  });
});
