import { PIECES } from '@kilukkam/shared';
import { guidePath } from '../../lib/camera/pattern.js';
import { Icon } from '../../components/Icon.js';
import { Qr } from '../../components/Qr.js';
import { Cover } from '../create/Cover.js';
import s from './Previews.module.css';

// Small live previews of the real screens, for the landing page: the music
// shelf, the room code, the play screen, and the camera conductor. They are
// drawn with the same pieces the app uses, so what you see is what you get.

const hero = PIECES.find((p) => p.id === 'hallowed-depths') ?? PIECES[0];

export function StepPreviews() {
  return (
    <ol className={s.steps}>
      <li>
        <div className={s.frame}>
          {hero ? <Cover piece={hero} playing /> : null}
          <span className={s.coverTitle}>{hero?.title}</span>
          <span className={s.play} aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
        </div>
        <b>1. Pick the music</b>
        <span>The conductor picks a piece, or any song on Spotify, and opens a room.</span>
      </li>
      <li>
        <div className={`${s.frame} ${s.lime}`}>
          <span className={s.codeLabel}>Room code</span>
          <span className={s.code}>KOCH</span>
          <span className={s.qr}>
            <Qr text="https://kilukkam.app/?code=KOCH" label="Example join code" />
          </span>
        </div>
        <b>2. Everyone joins</b>
        <span>Phones scan the QR or type the code. Each one gets an instrument.</span>
      </li>
      <li>
        <div className={`${s.frame} ${s.dark}`}>
          <span className={s.lane} aria-hidden="true">
            <i style={{ animationDelay: '0s' }}>E5</i>
            <i style={{ animationDelay: '-0.7s' }}>D5</i>
            <i style={{ animationDelay: '-1.4s' }}>C5</i>
          </span>
          <span className={s.hit} aria-hidden="true" />
          <span className={s.combo}>24×</span>
        </div>
        <b>3. The room plays</b>
        <span>Tap when your note lands. Every phone plays its part, on the beat, together.</span>
      </li>
    </ol>
  );
}

export function CameraPreview() {
  const d = guidePath(4, 18)
    .map((p, i) => `${i ? 'L' : 'M'}${(10 + p.x * 80).toFixed(1)} ${(8 + p.y * 80).toFixed(1)}`)
    .join(' ');
  return (
    <div className={s.camera}>
      <svg className={s.pattern} viewBox="0 0 100 100" aria-hidden="true">
        <path d={d} className={s.trace} />
        <path d={d} className={s.trail} pathLength={100} />
        <circle r="4" className={s.dot}>
          <animateMotion dur="2.4s" repeatCount="indefinite" path={d} />
        </circle>
        {[0, 1, 2, 3].map((k) => {
          const pts = [
            [50, 78],
            [23, 59],
            [79, 61],
            [52, 24],
          ][k] ?? [50, 50];
          return (
            <text key={k} x={pts[0]} y={(pts[1] ?? 50) + 1.5} className={s.num}>
              {k + 1}
            </text>
          );
        })}
      </svg>
      <ul className={s.gestures}>
        <li>
          <b>Beat time</b> sets the tempo
        </li>
        <li>
          <b>Bigger beats</b> play louder
        </li>
        <li>
          <b>Point</b> to bring a section in
        </li>
        <li>
          <b>A fist</b> cuts the room off
        </li>
      </ul>
    </div>
  );
}
