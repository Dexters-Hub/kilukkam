import { useLayoutEffect, useRef } from 'react';
import { icon, type IconName } from '../ui/icons.js';

/** Phosphor duotone or instrument glyph from ui/icons, built with createElementNS (no markup strings). */
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(icon(name, size));
  }, [name, size]);
  return <span ref={ref} aria-hidden="true" style={{ display: 'inline-flex', width: size, height: size, flex: 'none' }} />;
}
