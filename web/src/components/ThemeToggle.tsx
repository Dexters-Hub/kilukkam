import { useState } from 'react';
import { savedTheme, setTheme, type Theme } from '../lib/theme.js';
import s from './ThemeToggle.module.css';

/** Sun and moon switch for light and dark. */
export function ThemeToggle() {
  const [theme, setLocal] = useState<Theme>(savedTheme);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={s.toggle}
      aria-label={`Switch to ${next} theme`}
      aria-pressed={theme === 'dark'}
      onClick={() => {
        setTheme(next);
        setLocal(next);
      }}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        {theme === 'dark' ? (
          <path fill="currentColor" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
            <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
          </g>
        )}
      </svg>
    </button>
  );
}
