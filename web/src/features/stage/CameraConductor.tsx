import type { ClientMessage, DynamicsLevel, Score } from '@kilukkam/shared';
import { useEffect, useRef, useState } from 'react';
import { actions } from '../../app/controller.js';
import { DYNAMICS_LABEL } from '../../app/cues.js';
import { onLive } from '../../app/live.js';
import { Button, cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { demoHands } from '../../lib/camera/camdemo.js';
import { createConductor, type Conductor, type ConductorCue, type CueSide, type Hold } from '../../lib/camera/conductor.js';
import { drawCueZones, newZoneState } from '../../lib/camera/cueZones.js';
import type { HandFrame } from '../../lib/camera/features.js';
import { CameraError, startHandTracking, type HandTracking } from '../../lib/camera/hands.js';
import { PLAYALONG_ID } from '../../lib/spotify/playalong.js';
import { SIDES, messagesFor, sectionsFor } from './gestureActions.js';
import s from './CameraConductor.module.css';

// Conduct the live room with the laptop camera. Gestures drive the same
// controls as the buttons: the beat sets the tempo, its size the dynamics,
// pointing brings a section in, the stop hand rests it, a fist pauses the
// room and an open palm resumes it, and two-hand gestures build, drop and
// loop. No gesture ends the piece: that is the Stop button. Video stays here.

const MESSAGES: Record<CameraError['reason'], string> = {
  insecure: 'Camera conducting needs https or localhost.',
  unsupported: 'This browser cannot do camera conducting. Try a recent Chrome or Safari.',
  denied: 'Camera permission was refused. Allow it in the address bar and try again.',
  'not-found': 'No camera found on this laptop.',
  'in-use': 'Another app is using the camera. Close it and try again.',
  model: 'Hand tracking does not run in this browser. Try a recent Chrome or Safari.',
};

/** Gesture guide cards, in the order a conductor learns them */
type Card = 'beat' | 'dynamics' | 'cue' | 'rest' | 'pause' | 'resume' | 'build' | 'drop' | 'loop' | 'kilukkam';
const GUIDE: readonly { card: Card; title: string; hint: string }[] = [
  { card: 'beat', title: 'Beat time', hint: 'sets the tempo' },
  { card: 'dynamics', title: 'Other palm up or down', hint: 'louder or softer' },
  { card: 'cue', title: 'Point and hold', hint: 'brings a section in' },
  { card: 'rest', title: 'One palm in a third', hint: 'rests that section' },
  { card: 'pause', title: 'Both palms, held', hint: 'pauses the room' },
  { card: 'resume', title: 'One big downbeat', hint: 'plays on' },
  { card: 'build', title: 'Both palms up, rising', hint: 'build' },
  { card: 'drop', title: 'Both hands down fast', hint: 'drop' },
  { card: 'loop', title: 'Circle with a finger', hint: 'loops the bar' },
  { card: 'kilukkam', title: 'Shake like a bell', hint: 'Kilukkam!' },
];

const HOLD_LABEL: Record<Hold['kind'], string> = {
  cue: 'In',
  rest: 'Rest',
  pause: 'Pause',
  crescendo: 'Louder',
  diminuendo: 'Softer',
  build: 'Build',
  drop: 'Drop',
  loop: 'Loop',
  kilukkam: 'Kilukkam!',
};

type Lit = { card: Card; text: string; at: number } | null;

export interface CameraRoom {
  piece: Score;
  paused: boolean;
  muted: readonly string[];
  dynamics: DynamicsLevel;
}

export function CameraConductor({ room, onCamera }: { room: CameraRoom; onCamera?: (on: boolean) => void }) {
  const { piece } = room;
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readout, setReadout] = useState<{ bpm: number | null; dyn: string | null; lit: Lit }>({ bpm: null, dyn: null, lit: null });
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tracking = useRef<HandTracking | null>(null);
  const conductor = useRef<Conductor | null>(null);
  const flash = useRef<{ side: CueSide; t: number } | null>(null);
  const zones = useRef(newZoneState());
  const pulse = useRef(0);
  const looping = useRef(false);
  const sections = sectionsFor(piece);
  const latest = useRef({ room, sections });
  latest.current = { room, sections };

  useEffect(() => () => tracking.current?.stop(), []);
  useEffect(() => onCamera?.(on), [on, onCamera]);
  // The room is the truth: a pause from the button, or a resume, reaches the gesture reader too.
  useEffect(() => {
    if (conductor.current) conductor.current.paused = room.paused;
  }, [room.paused]);
  useEffect(() => {
    if (conductor.current) conductor.current.dynamics = room.dynamics;
  }, [room.dynamics]);
  useEffect(
    () =>
      onLive('dj', (e) => {
        if (e.cue === 'loop_on') looping.current = true;
        if (e.cue === 'loop_off') looping.current = false;
      }),
    [],
  );

  // A fired gesture stays lit on its card for a moment, then the card goes back to its hint.
  useEffect(() => {
    if (!readout.lit) return;
    const id = setTimeout(() => setReadout((r) => ({ ...r, lit: null })), 4000);
    return () => clearTimeout(id);
  }, [readout.lit]);

  const light = (card: Card, text: string) => setReadout((r) => ({ ...r, lit: { card, text, at: Date.now() } }));

  const dispatch = (msg: ClientMessage) => {
    switch (msg.type) {
      case 'set_tempo':
        return actions.setTempo(msg.bpm);
      case 'set_dynamics':
        return actions.setDynamics(msg.level);
      case 'set_section':
        return actions.setSection(msg.trackId, msg.muted);
      case 'pause_piece':
        return actions.pausePiece();
      case 'resume_piece':
        return actions.resumePiece();
      case 'dj':
        return actions.dj(msg.cue);
      case 'kilukkam':
        return actions.kilukkam();
      default:
        return undefined;
    }
  };

  const onCue = (cue: ConductorCue) => {
    const { room: r, sections: sec } = latest.current;
    if (cue.kind === 'beat') pulse.current = performance.now();
    const msgs = messagesFor(cue, { sections: sec, playAlong: r.piece.id === PLAYALONG_ID, paused: r.paused, looping: looping.current });
    for (const m of msgs) dispatch(m);
    switch (cue.kind) {
      case 'tempo':
        if (msgs.length) setReadout((x) => ({ ...x, bpm: cue.bpm }));
        return;
      case 'dynamics':
        setReadout((x) => ({ ...x, dyn: DYNAMICS_LABEL[cue.level] }));
        return;
      case 'kilukkam':
        if (msgs.length) light('kilukkam', 'Kilukkam!');
        return;
      case 'cue':
        flash.current = { side: cue.side, t: performance.now() };
        light('cue', `${sec[cue.side].label} in`);
        return;
      case 'rest':
        light('rest', `${sec[cue.side].label} rest`);
        return;
      case 'pause':
        if (msgs.length) light('pause', 'Paused');
        return;
      case 'resume':
        if (msgs.length) light('resume', 'Playing on');
        return;
      case 'build':
      case 'drop':
        if (msgs.length) light(cue.kind, cue.kind === 'build' ? 'Build' : 'Drop');
        return;
      case 'loop':
        if (msgs.length) light('loop', looping.current ? 'Loop off' : 'Looping');
        return;
    }
  };

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;
    setBusy(true);
    setError(null);
    const c = createConductor(onCue, { tempo: piece.bpm });
    c.paused = latest.current.room.paused;
    c.dynamics = latest.current.room.dynamics;
    conductor.current = c;
    if (new URLSearchParams(location.search).has('camdemo')) {
      const t0 = performance.now();
      let raf = 0;
      const step = (now: number) => {
        raf = requestAnimationFrame(step);
        const hands = demoHands(now - t0);
        if (!hands) {
          cancelAnimationFrame(raf);
          return;
        }
        const frame = { t: now, aspect: 4 / 3, hands };
        c.push(frame);
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
        c.push(frame);
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
    conductor.current = null;
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
    const { room: r, sections: sec } = latest.current;
    // Which third cues which section, always labelled, with a hold ring while pointing.
    const colorOf = (side: CueSide) => {
      const id = r.piece.tracks.find((tr) => sec[side].ids.includes(tr.id))?.instrument;
      return (id && css.getPropertyValue(`--${id}`).trim()) || lime;
    };
    const rests = (side: CueSide) => sec[side].ids.length > 0 && sec[side].ids.every((id) => r.muted.includes(id));
    // A finger tracing the loop circle is not pointing at a section: no section ring meanwhile.
    const circling = conductor.current?.holds.some((x) => x.kind === 'loop') ?? false;
    drawCueZones(
      ctx,
      w,
      h,
      SIDES.filter((side) => sec[side].ids.length > 0).map((side) => ({ side, label: rests(side) ? `${sec[side].label} rest` : sec[side].label, color: colorOf(side) })),
      circling ? { ...frame, hands: [] } : frame,
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
    // A progress ring for every held gesture, so you see it land before it fires.
    const px = Math.max(12, Math.round(h * 0.034));
    // (The cue zones draw the pointing ring themselves.)
    for (const hold of (conductor.current?.holds ?? []).filter((x) => x.kind !== 'cue')) {
      const x = hold.at.x * w;
      const y = hold.at.y * h;
      const rad = Math.max(20, h * 0.06);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = hold.side ? colorOf(hold.side) : lime;
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, rad, -Math.PI / 2, -Math.PI / 2 + hold.progress * Math.PI * 2);
      ctx.stroke();
      ctx.font = `800 ${Math.round(px * 0.85)}px "Inter Variable", system-ui, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = hold.side ? `${sec[hold.side].label} ${hold.kind === 'rest' ? 'rest' : 'in'}` : HOLD_LABEL[hold.kind];
      ctx.fillText(label, x, y - rad - px);
      ctx.textBaseline = 'alphabetic';
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

  const lit = readout.lit;
  const hintFor = (card: Card, hint: string): string => {
    if (card === 'beat') return readout.bpm !== null ? `${readout.bpm} bpm` : hint;
    if (card === 'dynamics') return readout.dyn ?? hint;
    if (card === 'pause' && room.paused) return 'Paused';
    return lit?.card === card ? lit.text : hint;
  };
  const isLit = (card: Card): boolean =>
    (card === 'beat' && readout.bpm !== null) || (card === 'dynamics' && readout.dyn !== null) || (card === 'pause' && room.paused) || lit?.card === card;

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
      <ul className={s.legend} aria-label="Gestures">
        {GUIDE.map(({ card, title, hint }) => (
          <li key={card} data-card={card} className={cx(isLit(card) && s.hit)}>
            <b>{title}</b>
            <span>{hintFor(card, hint)}</span>
          </li>
        ))}
      </ul>
      <p className={s.note}>Only the Stop button ends the piece.</p>
    </section>
  );
}
