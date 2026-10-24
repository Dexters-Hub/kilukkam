import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import './style.css';
import { gsap } from 'gsap';
import { odeToJoy, type NoteEvent } from '@kilukkam/shared';
import { playNote, preloadInstrument, unlockAudio, type Voice } from './lib/audio.js';
import type { Dynamics } from './lib/baton.js';
import { createAirPlay } from './lib/camera/air.js';
import { createConductor, type CueSide } from './lib/camera/conductor.js';
import { HAND_BONES, type HandFrame } from './lib/camera/features.js';
import { CameraError, loadHandModel, startHandTracking, type Delegate, type HandTracking, type TrackingStats } from './lib/camera/hands.js';
import { h, wordmark } from './ui/dom.js';

// Camera lab: try the conductor and air play for real. Every readout is
// written through textContent; nothing here touches innerHTML.

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

const melodyTrack = odeToJoy.tracks.find((t) => t.events.some((e) => e.kind === 'note'));
const melody: NoteEvent[] = (melodyTrack?.events ?? []).filter((e): e is NoteEvent => e.kind === 'note');
const instrument = melodyTrack?.instrument ?? 'flute';
void preloadInstrument(instrument);

const VELOCITY: Record<Dynamics, number> = { pp: 40, p: 62, mf: 86, f: 106, ff: 124 };
const SIDE_LABEL: Record<CueSide, string> = { left: 'Cue left', center: 'Cue centre', right: 'Cue right' };

// ---------- view ----------

const video = h('video', { muted: true, playsinline: true, 'aria-hidden': 'true' });
const canvas = h('canvas', { 'aria-hidden': 'true' });
const zones = h('div', { class: 'zones', 'aria-hidden': 'true' }, h('div', { class: 'zone' }), h('div', { class: 'zone' }), h('div', { class: 'zone' }));
const dot = h('div', { class: 'beat-dot', 'aria-hidden': 'true' });
const empty = h('p', { class: 'cam-empty' }, 'Stand back so your hands fit in the picture.');
const stage = h('div', { class: 'cam-stage' }, video, canvas, zones, dot, empty);

const value = (text: string) => h('span', { class: 'readout-value' }, text);
const unit = (text: string) => h('span', { class: 'readout-unit' }, text);
const bpmEl = value('--');
const dynEl = value('--');
const cueEl = value('--');
const perfEl = value('--');
const fpsUnit = unit('ms');
const readout = (label: string, ...children: HTMLElement[]) => h('div', { class: 'readout' }, h('span', { class: 'label' }, label), h('span', { class: 'readout-line' }, ...children));
const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

const start = h('button', { class: 'btn btn-primary btn-xl', type: 'button' }, 'Start camera');
const stop = h('button', { class: 'link', type: 'button', hidden: true }, 'Stop camera');
const status = h('p', { class: 'hint', role: 'status' });

const airSwitch = h(
  'button',
  { class: 'switch', type: 'button', role: 'switch', 'aria-checked': 'false' },
  h('span', { class: 'switch-text' }, h('span', { class: 'switch-title' }, 'Air play'), h('span', { class: 'switch-hint' }, 'Lift a finger for the next note of Ode to Joy. Pinch to hold one.')),
  h('span', { class: 'switch-track', 'aria-hidden': 'true' }),
);

const gesture = (name: string, how: string) => h('li', {}, h('b', {}, name), h('span', {}, how));

document.getElementById('lab')?.append(
  h('header', { class: 'top' }, wordmark(), h('span', { class: 'label' }, 'Camera lab')),
  h(
    'div',
    { class: 'lab-head' },
    h('h1', { class: 'title' }, 'Conduct with your hands'),
    h('p', { class: 'privacy' }, 'Your camera stays on this device.'),
  ),
  stage,
  h('div', { class: 'actions' }, start, stop, status),
  h('div', { class: 'readouts' }, readout('Tempo', bpmEl, unit('bpm')), readout('Dynamics', dynEl), readout('Last cue', cueEl), readout('Detection', perfEl, fpsUnit)),
  airSwitch,
  h(
    'ul',
    { class: 'gestures' },
    gesture('Beat', 'Open hand, down and up. Bigger is louder.'),
    gesture('Cue', 'Point into a third of the picture and hold.'),
    gesture('Cut off', 'Close your fist and hold still.'),
  ),
  live,
);

// ---------- music ----------

let noteIndex = 0;
let bpm = odeToJoy.bpm;
let dynamics: Dynamics = 'mf';
let held: Voice | null = null;

const nextNote = (): NoteEvent | undefined => {
  const n = melody[noteIndex % Math.max(1, melody.length)];
  noteIndex++;
  return n;
};

const air = createAirPlay((cue) => {
  if (cue.kind === 'note') {
    const n = nextNote();
    if (n) playNote(instrument, n.midi, n.beats, bpm, VELOCITY[dynamics]);
  } else if (cue.kind === 'hold') {
    const n = nextNote();
    held?.release();
    held = n ? playNote(instrument, n.midi, n.beats, bpm, VELOCITY[dynamics], { held: true }) : null;
  } else {
    held?.release();
    held = null;
  }
});

const flashZone = (side: CueSide) => {
  const zone = zones.children[side === 'left' ? 0 : side === 'center' ? 1 : 2];
  if (!zone || reduced()) return;
  gsap.fromTo(zone, { opacity: 1 }, { opacity: 0, duration: 0.7, ease: 'power2.out' });
};

const conductor = createConductor(
  (cue) => {
    switch (cue.kind) {
      case 'beat':
        if (!reduced()) gsap.fromTo(dot, { scale: 1.8, opacity: 1 }, { scale: 1, opacity: 0.3, duration: 0.28, ease: 'power2.out' });
        break;
      case 'tempo':
        bpm = cue.bpm;
        bpmEl.textContent = String(cue.bpm);
        break;
      case 'dynamics':
        dynamics = cue.level;
        dynEl.textContent = cue.level;
        break;
      case 'cue':
        cueEl.textContent = SIDE_LABEL[cue.side];
        live.textContent = SIDE_LABEL[cue.side];
        flashZone(cue.side);
        break;
      case 'cutoff':
        cueEl.textContent = 'Cut off';
        live.textContent = 'Cut off';
        held?.release();
        held = null;
        noteIndex = 0;
        break;
    }
  },
  { tempo: odeToJoy.bpm },
);

// ---------- overlay ----------

const ctx = canvas.getContext('2d');
const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const draw = (frame: HandFrame) => {
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const hgt = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hgt * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);
  const accent = token('--accent', '#ff5b1f');
  const second = token('--accent-3', '#7c5cff');
  const surface = token('--surface', '#ffffff');
  for (const hand of frame.hands) {
    const p = hand.landmarks;
    ctx.strokeStyle = hand.handedness === 'right' ? accent : second;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      const pa = p[a];
      const pb = p[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * w, pa.y * hgt);
      ctx.lineTo(pb.x * w, pb.y * hgt);
    }
    ctx.stroke();
    ctx.fillStyle = surface;
    for (const pt of p) {
      ctx.beginPath();
      ctx.arc(pt.x * w, pt.y * hgt, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = hand.pinch ? second : accent;
    ctx.beginPath();
    ctx.arc(hand.palmCenter.x * w, hand.palmCenter.y * hgt, hand.fist ? 12 : 7, 0, Math.PI * 2);
    ctx.fill();
  }
};

// ---------- camera ----------

// ?delegate=cpu forces the CPU path, to compare devices.
const delegate: Delegate = new URLSearchParams(location.search).get('delegate')?.toLowerCase() === 'cpu' ? 'CPU' : 'GPU';

let tracking: HandTracking | null = null;
let airOn = false;

const onFrame = (frame: HandFrame) => {
  conductor.push(frame);
  if (airOn) air.push(frame);
  draw(frame);
};

const onStats = (s: TrackingStats) => {
  perfEl.textContent = s.detectMs.toFixed(1);
  fpsUnit.textContent = `ms · ${Math.round(s.fps)} fps · ${s.delegate}`;
  perfEl.dataset.ms = s.detectMs.toFixed(2);
  perfEl.dataset.fps = s.fps.toFixed(1);
  perfEl.dataset.skipped = String(s.skipped);
};

const MESSAGES: Record<CameraError['reason'], string> = {
  insecure: 'Camera play needs a secure page: open it on https or localhost.',
  unsupported: 'This browser cannot do camera play. Try a recent Chrome, Safari or Firefox.',
  denied: 'Camera permission was refused. Allow it in the address bar and try again.',
  'not-found': 'No front camera found on this device.',
  'in-use': 'Another app is using the camera. Close it and try again.',
  model: 'Hand tracking does not run in this browser. Try a recent Chrome or Safari.',
};

const setRunning = (on: boolean) => {
  stage.classList.toggle('live', on);
  start.hidden = on;
  stop.hidden = !on;
};

start.addEventListener('click', async () => {
  unlockAudio();
  start.disabled = true;
  status.textContent = 'Starting the camera';
  try {
    tracking = await startHandTracking(video, onFrame, {
      numHands: 2,
      delegate,
      onStats,
      onError: (err) => {
        stopAll();
        status.textContent = MESSAGES[err.reason];
      },
    });
    if (video.videoWidth && video.videoHeight) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    status.textContent = '';
    setRunning(true);
  } catch (err) {
    status.textContent = err instanceof CameraError ? MESSAGES[err.reason] : MESSAGES.unsupported;
    console.warn('Camera lab could not start', err);
  } finally {
    start.disabled = false;
  }
});

const stopAll = () => {
  tracking?.stop();
  tracking = null;
  held?.release();
  held = null;
  air.reset();
  conductor.reset();
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  setRunning(false);
};
stop.addEventListener('click', stopAll);

airSwitch.addEventListener('click', () => {
  unlockAudio();
  airOn = !airOn;
  airSwitch.setAttribute('aria-checked', String(airOn));
  if (!airOn) {
    held?.release();
    held = null;
    air.reset();
  }
});

// Warm the model while the page is read, so Start is quick.
void loadHandModel({ delegate }).catch(() => {});
window.addEventListener('pagehide', () => tracking?.stop());
