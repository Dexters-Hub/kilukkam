/** Keep the screen awake while playing; best effort, not all browsers have it. */
export function holdWakeLock(): () => void {
  let lock: WakeLockSentinel | null = null;
  let released = false;
  const request = () => {
    if (released || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(
      (l) => {
        if (released) void l.release();
        else lock = l;
      },
      () => {},
    );
  };
  document.addEventListener('visibilitychange', request);
  request();
  return () => {
    released = true;
    document.removeEventListener('visibilitychange', request);
    void lock?.release();
  };
}
