import { useSyncExternalStore } from 'react';
import type { AppState } from '../lib/store.js';
import { store } from './controller.js';

const subscribe = (fn: () => void) => store.subscribe(fn);

/**
 * Read one slice of app state. The selector must return a primitive or an
 * object already in the state (snapshot, piece, session), so a component
 * re-renders only when that slice changes: cursor and tally moves on every
 * tap never wake a screen that does not ask for them.
 */
export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(store.state));
}
