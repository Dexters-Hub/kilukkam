import { useGSAP } from '@gsap/react';
import { useRef, type ReactNode } from 'react';
import { enterScreen } from '../lib/anim.js';
import { cx, IconButton } from './Button.js';
import { Icon } from './Icon.js';
import s from './Screen.module.css';

/** A screen column. It slides in through lib/anim once, on mount. */
export function Screen({ className, children }: { className?: string | undefined; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (ref.current) enterScreen(ref.current);
  }, { scope: ref });
  return (
    <main ref={ref} className={cx(s.screen, className)}>
      {children}
    </main>
  );
}

/** Kilukkam in Latin display type with the Malayalam name beside it. */
export function Wordmark() {
  return (
    <span className={s.wordmark}>
      <img className={s.mark} src="/icon.svg" alt="" width={30} height={30} />
      <span className={s.en}>Kilukkam</span>
      <span className={s.ml} lang="ml">
        കിലുക്കം
      </span>
    </span>
  );
}

export function TopBar({ onBack, right }: { onBack?: () => void; right?: ReactNode }) {
  return (
    <header className={s.top}>
      {onBack ? (
        <IconButton aria-label="Back" onClick={onBack}>
          <Icon name="arrow-left" size={26} />
        </IconButton>
      ) : (
        <Wordmark />
      )}
      {right}
    </header>
  );
}

export const Title = ({ children }: { children: ReactNode }) => <h1 className={s.title}>{children}</h1>;

/** One short line telling a first-timer what this screen wants from them. */
export const Hint = ({ children, id }: { children: ReactNode; id?: string }) => (
  <p className={s.hint} id={id}>
    {children}
  </p>
);

export const Notice = ({ text }: { text: string | null }) =>
  text ? (
    <p className={s.notice} role="status">
      {text}
    </p>
  ) : null;

/** Sticky bottom area for the screen's main action. */
export const Dock = ({ children }: { children: ReactNode }) => <div className={s.dock}>{children}</div>;

export const Label = ({ children, htmlFor, id }: { children: ReactNode; htmlFor?: string; id?: string }) =>
  htmlFor ? (
    <label className={s.label} htmlFor={htmlFor}>
      {children}
    </label>
  ) : (
    <span className={s.label} id={id}>
      {children}
    </span>
  );
