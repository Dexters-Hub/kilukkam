import { useEffect, useState } from 'react';
import s from './Toast.module.css';

// Short messages over the bottom of the screen. `toast()` can be called from
// anywhere (the controller has no React); the one <Toaster /> renders them.

type Kind = 'error' | 'info';
interface Item {
  id: number;
  text: string;
  kind: Kind;
  shown: boolean;
}

let items: Item[] = [];
let seq = 0;
const listeners = new Set<(list: Item[]) => void>();
const publish = (next: Item[]) => {
  items = next;
  for (const l of listeners) l(items);
};

export const toast = (text: string, kind: Kind = 'info', ms = 3200): void => {
  const id = ++seq;
  publish([...items, { id, text, kind, shown: false }].slice(-3));
  requestAnimationFrame(() => publish(items.map((t) => (t.id === id ? { ...t, shown: true } : t))));
  setTimeout(() => {
    publish(items.map((t) => (t.id === id ? { ...t, shown: false } : t)));
    setTimeout(() => publish(items.filter((t) => t.id !== id)), 300);
  }, ms);
};

export function Toaster() {
  const [list, setList] = useState(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return (
    <div className={s.toasts} aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={[s.toast, t.kind === 'error' && s.error, t.shown && s.in].filter(Boolean).join(' ')} role={t.kind === 'error' ? 'alert' : 'status'}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
