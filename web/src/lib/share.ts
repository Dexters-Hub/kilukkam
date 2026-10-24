// Where phones should go to join. Pure apart from reading `location`.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const isLocalHost = (hostname: string): boolean => LOCAL_HOSTS.has(hostname);

/** Base URL a phone on the same Wi-Fi can open: the LAN address when we're on localhost. */
export const joinBase = (loc: { protocol: string; host: string; hostname: string }, lanHost: string): string =>
  isLocalHost(loc.hostname) && lanHost ? `${loc.protocol}//${lanHost}` : `${loc.protocol}//${loc.host}`;

export const joinLink = (code: string, base: string): string => `${base}/?code=${encodeURIComponent(code)}`;

/** Shown under the QR: the link without the scheme, easier to read aloud. */
export const prettyLink = (url: string): string => url.replace(/^https?:\/\//, '');

export const here = (): string => joinBase(location, __LAN_HOST__);
