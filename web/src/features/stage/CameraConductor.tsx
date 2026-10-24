import type { Score } from '@kilukkam/shared';
import { useEffect, useRef, useState } from 'react';
import { actions } from '../../app/controller.js';
import { DYNAMICS_LABEL } from '../../app/cues.js';
import { Button, cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { createConductor, type CueSide } from '../../lib/camera/conductor.js';
import { drawCueZones, newZoneState } from '../../lib/camera/cueZones.js';
import type { HandFrame } from '../../lib/camera/features.js';
import { CameraError, startHandTracking, type HandTracking } from '../../lib/camera/hands.js';
import { PLAYALONG_ID } from '../../lib/spotify/playalong.js';
import s from './CameraConductor.module.css';

// Conduct the live room with the laptop camera. Gestures drive the same
// controls as the buttons below: the beat sets the tempo, the size of the
// beat sets the dynamics, pointing into a third of the picture brings that
// section in, and a held fist cuts the room off. Video stays in this tab.

const SIDES: readonly CueSide[] = ['left', 'center', 'right'];
/** Ignore a cut-off in the first seconds, so raising a closed hand cannot end the piece by accident */
const CUTOFF_GRACE_MS = 3000;

const MESSAGES: Record<CameraError['reason'], string> = {
  insecure: 'Camera conducting needs https or localhost.',
  unsupported: 'This browser cannot do camera conducting. Try a recent Chrome or Safari.',
  denied: 'Camera permission was refused. Allow it in the address bar and try again.',
  'not-found': 'No camera found on this laptop.',
  'in-use': 'Another app is using the camera. Close it and try again.',
  model: 'Hand tracking does not run in this browser. Try a recent Chrome or Safari.',
};

/** Split the instruments into thirds of the picture, left to right in score order. */
const sectionsFor = (piece: Score): Record<CueSide, { ids: string[]; label: string }> => {
  const n = piece.tracks.length;
  const out = { left: { ids: [] as string[], label: '' }, center: { ids: [] as string[], label: '' }, right: { ids: [] as string[], label: '' } };
  piece.tracks.forEach((t, i) => {
    const side = SIDES[Math.min(2, Math.floor((i * 3) / Math.max(1, n)))] ?? 'right';
    out[side].ids.push(t.id);
    out[side].label = out[side].label ? `${out[side].label} + ${t.name}` : t.name;
  });
  return out;
};

type Feedback = { text: string; at: number } | null;

export function CameraConductor({ piece, startedAt }: { piece: Score; startedAt: number | null }) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ bpm: number | null; dyn: string | null; last: Feedback }>({ bpm: null, dyn: null, last: null });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracking = useRef<HandTracking | null>(null);
  const flash = useRef<{ side: CueSide; t: number } | null>(null);
  const zones = useRef(newZoneState());
  const pulse = useRef(0);
  const sections = sectionsFor(piece);
  const latest = useRef({ piece, startedAt, sections });
  latest.current = { piece, startedAt, sections };

  useEffect(() => () => tracking.current?.stop(), []);

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setError(null);
    const conductor = createConductor(
      (cue) => {
        const { piece: p, startedAt: t0, sections: sec } = latest.current;
        switch (cue.kind) {
          case 'beat':
            pulse.current = performance.now();
            return;
          case 'tempo':
            // A Spotify recording cannot follow tempo changes; leave the room locked to it.
            if (p.id === PLAYALONG_ID) return;
            actions.setTempo(cue.bpm);
            setReadout((r) => ({ ...r, bpm: cue.bpm }));
            return;
          case 'dynamics':
            actions.setDynamics(cue.level);
            setReadout((r) => ({ ...r, dyn: DYNAMICS_LABEL[cue.level] }));
            return;
          case 'cue': {
            const group = sec[cue.side];
            for (const id of group.ids) actions.setSection(id, false);
            flash.current = { side: cue.side, t: performance.now() };
            setReadout((r) => ({ ...r, last: { text: `${group.label} in`, at: Date.now() } }));
            return;
          }
          case 'cutoff':
            if (t0 !== null && Date.now() - t0 < CUTOFF_GRACE_MS) return;
            setReadout((r) => ({ ...r, last: { text: 'Cut off', at: Date.now() } }));
            actions.stopPiece();
            return;
        }
      },
      { tempo: piece.bpm },
    );
    // ?camdemo drives the live stage with a scripted hand instead of the camera:
    // big beats at 120 bpm, small beats at 90, a point into the left third, a
    // held fist. For demos without a webcam, and to test that gestures reach the room.
    if (new URLSearchParams(location.search).has('camdemo')) {
      const t0 = performance.now();
      let raf = 0;
      const step = (now: number) => {
        raf = requestAnimationFrame(step);
        const e = now - t0;
        const beatAt = (bpm: number, from: number) => ((e - from) * bpm) / 60_000;
        let p = { x: 0.62, y: 0.5 };
        let fingers: [boolean, boolean, boolean, boolean, boolean] = [true, true, true, true, true];
        let fist = false;
        if (e < 8000) {
          const f = beatAt(120, 0) % 1;
          p = { x: 0.62, y: 0.3 + 0.42 * (1 - (2 * f - 1) ** 2) };
        } else if (e < 14000) {
          const f = beatAt(90, 8000) % 1;
          p = { x: 0.62, y: 0.5 + 0.1 * (1 - (2 * f - 1) ** 2) };
        } else if (e < 16500) {
          p = { x: 0.15, y: 0.42 };
          fingers = [false, true, false, false, false];
        } else if (e < 19000) {
          p = { x: 0.55, y: 0.5 };
          fingers = [false, false, false, false, false];
          fist = true;
        } else {
          cancelAnimationFrame(raf);
          return;
        }
        const hand = {
          handedness: 'right' as const,
          score: 1,
          wrist: { x: p.x, y: p.y + 0.08 },
          indexTip: { x: p.x, y: p.y - 0.09 },
          palmCenter: p,
          size: 0.12,
          pinch: false,
          pinchDistance: 1,
          fingersUp: fingers,
          openPalm: !fist && fingers.every(Boolean),
          fist,
          landmarks: Array.from({ length: 21 }, () => p),
        };
        const frame = { t: now, aspect: 4 / 3, hands: [hand] };
        conductor.push(frame);
        draw(frame);
      };
      raf = requestAnimationFrame(step);
      tracking.current = { delegate: 'CPU', stop: () => cancelAnimationFrame(raf) };
      setOn(true);
      setBusy(false);
      return;
    }
    try {
      tracking.current = await startHandTracking(video, (frame) => {
        conductor.push(frame);
        draw(frame);
      }, {
        numHands: 2,
        onError: (err) => {
          stop();
          setError(MESSAGES[err.reason]);
        },
      });
      setOn(true);
    } catch (err) {
      setError(err instanceof CameraError ? MESSAGES[err.reason] : MESSAGES.unsupported);
    } finally {
      setBusy(false);
    }
  };

  const stop = () => {
    tracking.current?.stop();
    tracking.current = null;
    setOn(false);
  };

  const draw = (frame: HandFrame) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const lime = css.getPropertyValue('--accent').trim() || '#b6f400';
    const now = performance.now();
    // Which third cues which section, always labelled, with a hold ring while pointing.
    const sec = latest.current.sections;
    const colorOf = (side: CueSide) => {
      const id = latest.current.piece.tracks.find((tr) => sec[side].ids.includes(tr.id))?.instrument;
      return (id && css.getPropertyValue(`--${id}`).trim()) || lime;
    };
    drawCueZones(
      ctx,
      w,
      h,
      SIDES.filter((side) => sec[side].ids.length > 0).map((side) => ({ side, label: sec[side].label, color: colorOf(side) })),
      frame,
      zones.current,
      flash.current,
    );
    // Each hand as a cursor dot: the camera's view of you, without a skeleton.
    for (const hand of frame.hands) {
      ctx.fillStyle = lime;
      ctx.shadowColor = lime;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(hand.palmCenter.x * w, hand.palmCenter.y * h, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    // Beat pulse in the corner.
    const age = now - pulse.current;
    ctx.fillStyle = lime;
    ctx.globalAlpha = Math.max(0.25, 1 - age / 400);
    ctx.beginPath();
    ctx.arc(w - 16, h - 16, 7 + Math.max(0, 6 - age / 60), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  };

  return (
    <section className={s.panel} aria-label="Camera conducting">
      <div className={s.head}>
        <span className={s.label}>Conduct with your hands</span>
        {on ? (
          <Button variant="link" onClick={stop}>
            Stop camera
          </Button>
        ) : null}
      </div>
      <div className={cx(s.stage, on && s.live)}>
        <video ref={videoRef} className={s.video} muted playsInline aria-hidden="true" />
        <canvas ref={canvasRef} className={s.overlay} aria-hidden="true" />
        {on ? null : (
          <div className={s.idle}>
            <Button variant="primary" disabled={busy} onClick={() => void start()}>
              <Icon name="hand-pointing" size={20} />
              {busy ? 'Starting the camera…' : 'Use the camera'}
            </Button>
            <span>Video stays on this laptop.</span>
          </div>
        )}
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <ul className={s.legend}>
        <li className={cx(readout.bpm !== null && s.hit)}>
          <b>Beat time</b>
          <span>{readout.bpm !== null ? `${readout.bpm} bpm` : 'sets the tempo'}</span>
        </li>
        <li className={cx(readout.dyn !== null && s.hit)}>
          <b>Bigger beats</b>
          <span>{readout.dyn ?? 'play louder'}</span>
        </li>
        <li className={cx(readout.last?.text.endsWith(' in') && s.hit)}>
          <b>Point and hold</b>
          <span>{readout.last?.text.endsWith(' in') ? readout.last.text : 'brings a section in'}</span>
        </li>
        <li className={cx(readout.last?.text === 'Cut off' && s.hit)}>
          <b>Hold a fist</b>
          <span>cuts the room off</span>
        </li>
      </ul>
    </section>
  );
}
