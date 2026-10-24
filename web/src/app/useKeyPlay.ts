import { useEffect, useRef } from 'react';

/** Keys that play a note on a laptop: the space bar, or either home-row hand. */
export const PLAY_KEYS: ReadonlySet<string> = new Set(['Space', 'KeyF', 'KeyJ', 'KeyD', 'KeyK']);

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

/**
 * Play with the keyboard as well as by tapping. A held key plays once (no
 * auto-repeat), and keys typed into a form field are left alone.
 */
export function useKeyPlay(play: () => void, enabled = true): void {
  const latest = useRef(play);
  latest.current = play;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!PLAY_KEYS.has(e.code) || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
