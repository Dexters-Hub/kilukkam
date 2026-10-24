// Light or dark, picked by the viewer and remembered on this device. Light is
// the default; nothing follows the system setting unless the viewer asks.

export type Theme = 'light' | 'dark';

const KEY = 'kilukkam.theme';
const BAR: Record<Theme, string> = { light: '#fafaf9', dark: '#0a0a0a' };

export const savedTheme = (): Theme => {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme]);
};

export const setTheme = (theme: Theme): void => {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage blocked: the choice lasts for this visit only
  }
};
