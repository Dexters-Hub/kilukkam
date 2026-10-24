/** `#3` → slide index 2, clamped to the deck; anything else → 0. */
export const slideFromHash = (hash: string, count: number): number => {
  const n = Number.parseInt(hash.replace(/^#/, ''), 10);
  if (!Number.isFinite(n) || count <= 0) return 0;
  return Math.max(0, Math.min(count - 1, n - 1));
};
