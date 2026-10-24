import { useMemo } from 'react';
import { qrEncode, qrPath } from '../lib/qr.js';
import s from './Qr.module.css';

/** A scannable QR for `text`, drawn as one SVG path (dark modules on a light tile in both themes). */
export function Qr({ text, label }: { text: string; label: string }) {
  const { d, size } = useMemo(() => {
    const m = qrEncode(text);
    return { d: qrPath(m), size: m.size + 4 };
  }, [text]);
  return (
    <svg className={s.qr} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={d} />
    </svg>
  );
}
