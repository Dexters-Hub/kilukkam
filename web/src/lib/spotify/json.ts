// Small guards for JSON that comes from Spotify or its SDK. Everything from
// outside is `unknown` until one of these says otherwise: no blind casts.

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const nonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export const finiteNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Only https URLs reach an <img src>; anything else is dropped. */
export const httpsUrl = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
};

export const safeJson = (raw: string | null): unknown => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};
