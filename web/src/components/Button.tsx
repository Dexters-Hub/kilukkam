import type { ButtonHTMLAttributes } from 'react';
import s from './Button.module.css';

/**
 * primary: the one solid accent pill per view. surface: a calm secondary.
 * ghost: quiet top-bar action. dark: the stop button. link: the text-link alternative.
 * pill: small rounded chip (the home "Conduct" entry).
 */
export type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'dark' | 'link' | 'pill';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Full width, for the main action in a dock */
  wide?: boolean;
}

export const cx = (...names: (string | false | null | undefined)[]): string => names.filter(Boolean).join(' ');

export function Button({ variant = 'surface', wide, className, type = 'button', ...rest }: ButtonProps) {
  const base = variant === 'link' ? s.link : variant === 'pill' ? s.pill : cx(s.btn, s[variant]);
  return <button type={type} className={cx(base, wide && s.wide, className)} {...rest} />;
}

export function IconButton({ className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={cx(s.iconBtn, className)} {...rest} />;
}
