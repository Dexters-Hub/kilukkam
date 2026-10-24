import '@fontsource-variable/space-grotesk';
import '@fontsource-variable/inter';
import './style.css';
import { gsap } from 'gsap';
import { playNote, preloadInstrument, renderNote, unlockAudio, type Voice } from './lib/audio.js';
import type { Dynamics } from './lib/baton.js';
import { createConductor, type CueSide } from './lib/camera/conductor.js';
import { HAND_BONES, LM, type HandFrame, type Handedness, type Point } from './lib/camera/features.js';
import { FINGER_NAMES, createFingerPlay, fingerKey, voicesFor, type FingerVoice } from './lib/camera/fingers.js';
import { CameraError, loadHandModel, startHandTracking, type Delegate, type HandTracking, type TrackingStats } from './lib/camera/hands.js';
import { PatternCoach, boxAround, guideAt, guidePath, toBox, toFrame, type BatonGrade, type GuideBox, type Meter } from './lib/camera/pattern.js';
import { h, replace, wordmark } from './ui/dom.js';
import { icon, type IconName } from './ui/icons.js';

// Camera lab: conduct with your hand, or play with your fingers. Two modes,
// each with a live legend that lights up as the camera sees each gesture.
// Every readout goes through textContent; nothing touches innerHTML.

type Mode = 'conduct' | 'play';

const reduced = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;
const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

const VELOCITY: Record<Dynamics, number> = { pp: 40, p: 62, mf: 86, f: 106, ff: 124 };
const DYN_WORD: Record<Dynamics, string> = { pp: 'Very soft', p: 'Soft', mf: 'Medium', f: 'Loud', ff: 'Very loud' };
const SECTIONS: Record<CueSide, string> = { left: 'Violins', center: 'Flutes', right: 'Cellos' };
const GRADE_WORD: Record<BatonGrade, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', miss: 'Miss' };
const TEMPOS = [70, 90, 120] as const;
const METER: Meter = 4;
const TIPS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map((_, i) => [LM.thumb, LM.index, LM.middle, LM.ring, LM.pinky][i]?.[3] ?? 8);

const voices = voicesFor(0);
for (const id of ['piano', 'violin'] as const) void preloadInstrument(id);

// ---------- state ----------

let mode: Mode = 'conduct';
let targetBpm: number = TEMPOS[1];
let measuredBpm: number | null = null;
let dynamics: Dynamics = 'mf';
let tracking: HandTracking | null = null;
let guideStart = 0;
let lastTick = -1;
let box: GuideBox | null = null;
let boxSeed: { x: number; y: number; n: number } = { x: 0, y: 0, n: 0 };
let coach = new PatternCoach(METER);
let streak = 0;
let bestStreak = 0;
let fistSince: number | null = null;
const trail: { p: Point; t: number }[] = [];
const flashes: { p: Point; t: number; text: string; color: string }[] = [];
const held = new Map<string, Voice[]>();
const recent: { label: string; who: string; color: string }[] = [];

// ---------- view ----------

const video = h('video', { muted: true, playsinline: true, 'aria-hidden': 'true' });
const canvas = h('canvas', { 'aria-hidden': 'true' });
const hud = h('div', { class: 'hud', 'aria-live': 'polite' }, h('span', { class: 'hud-dot', 'aria-hidden': 'true' }), h('span', { class: 'hud-text' }, 'Show your hands'));
const empty = h(
  'div',
  { class: 'cam-empty' },
  h('span', { class: 'cam-empty-icon' }, icon('hand-pointing', 40)),
  h('strong', {}, 'Your camera stays on this device'),
  h('span', {}, 'Stand about an arm’s length away, palms to the camera, in even light.'),
);
const stage = h('div', { class: 'cam-stage' }, video, canvas, hud, empty);

const tab = (m: Mode, label: string, ic: IconName) =>
  h('button', { class: 'mode-tab', type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(m === mode), onclick: () => setMode(m) }, icon(ic, 20), label);
const tabs = h('div', { class: 'mode-tabs', role: 'tablist', 'aria-label': 'Mode' }, tab('conduct', 'Conduct', 'magic-wand'), tab('play', 'Play', 'hand-tap'));

const start = h('button', { class: 'btn btn-primary cam-start', type: 'button' }, icon('play', 18), 'Start camera');
const stop = h('button', { class: 'link', type: 'button', hidden: true }, 'Stop camera');
const status = h('p', { class: 'hint', role: 'status' });

// Conduct panel
const tempoChips = h(
  'div',
  { class: 'chips', role: 'radiogroup', 'aria-label': 'Practice tempo' },
  ...TEMPOS.map((b) =>
    h('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(b === targetBpm), 'data-bpm': String(b), onclick: () => setTempo(b) }, `${b} bpm`),
  ),
);
const stat = (label: string) => {
  const v = h('span', { class: 'stat-v' }, '--');
  return { el: h('div', { class: 'stat' }, h('span', { class: 'stat-l' }, label), v), v };
};
const accStat = stat('Baton accuracy');
const tempoStat = stat('Your tempo');
const dynStat = stat('Dynamics');
const streakStat = stat('Streak');

const legendCard = (id: string, ic: IconName, title: string, does: string) =>
  h('li', { class: 'gesture', 'data-g': id }, h('span', { class: 'gesture-icon' }, icon(ic, 24)), h('span', {}, h('strong', {}, title), h('span', { class: 'muted' }, does)));
const conductLegend = h(
  'ul',
  { class: 'legend' },
  legendCard('beat', 'metronome', 'Trace the pattern', 'Follow the moving dot: down, left, right, up. Each beat you land on time scores.'),
  legendCard('size', 'waveform', 'Bigger is louder', 'Big sweeping beats play loud, small careful ones soft.'),
  legendCard('cue', 'hand-pointing', 'Point to cue', 'Point into a third of the picture and hold: violins, flutes or cellos.'),
  legendCard('cutoff', 'hand-grabbing', 'Fist to stop', 'Close your fist and hold still to cut the room off.'),
);
const conductPanel = h(
  'section',
  { class: 'panel', 'aria-label': 'Conducting' },
  h('div', { class: 'panel-row' }, h('span', { class: 'label' }, 'Practice tempo'), tempoChips),
  h('div', { class: 'stats' }, accStat.el, tempoStat.el, dynStat.el, streakStat.el),
  conductLegend,
);

// Play panel
const mapItem = (hand: Handedness, f: number, v: FingerVoice) => {
  const li = h('li', { class: 'map-item', 'data-key': fingerKey(hand, f) }, h('span', { class: 'map-finger' }, FINGER_NAMES[f] ?? ''), h('span', { class: 'map-note' }, h('span', { class: 'map-dot', 'aria-hidden': 'true' }), v.label));
  li.style.setProperty('--note', voiceColor(hand, f));
  return li;
};
const handMap = (hand: Handedness, title: string, sub: string) =>
  h('section', { class: 'map', 'aria-label': title }, h('h3', { class: 'map-title' }, title, h('span', { class: 'muted' }, ` · ${sub}`)), h('ul', { class: 'map-list' }, ...voices[hand].map((v, f) => mapItem(hand, f, v))));
const recentList = h('ol', { class: 'recent' });
const playPanel = h(
  'section',
  { class: 'panel', 'aria-label': 'Finger play', hidden: true },
  h('p', { class: 'panel-lead' }, h('strong', {}, 'Raise a finger to play. '), 'Hold it up to sustain, lower it to let go. Ten fingers, ten voices, all in tune together.'),
  h('div', { class: 'maps' }, handMap('left', 'Left hand', 'chords'), handMap('right', 'Right hand', 'melody')),
  h('h3', { class: 'map-title' }, 'Recently played'),
  recentList,
);

const help = h(
  'dialog',
  { class: 'help', 'aria-labelledby': 'help-title' },
  h('h2', { id: 'help-title' }, 'How to play'),
  h(
    'ul',
    { class: 'legend' },
    legendCard('t1', 'magic-wand', 'Conduct', 'Trace the four-beat pattern with an open hand. The dot shows where to be on each beat.'),
    legendCard('t2', 'hand-tap', 'Play', 'Raise any finger to sound its note. Both hands at once for chords and melody.'),
    legendCard('t3', 'hand-pointing', 'Get good tracking', 'Even, front light. Palms to the camera, about 50 cm to 1 m away, plain background.'),
    legendCard('t4', 'device-mobile', 'Private', 'Hand tracking runs on this device. Video is never recorded or sent anywhere.'),
  ),
  h('form', { method: 'dialog' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Got it')),
);
const helpBtn = h('button', { class: 'pill', type: 'button', 'aria-label': 'How to play', onclick: () => help.showModal() }, icon('sparkle', 16), 'How to play');

const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
document.getElementById('lab')?.append(
  h('header', { class: 'top' }, wordmark(), helpBtn),
  h('div', { class: 'lab-head' }, h('h1', { class: 'title' }, 'Play with your hands'), tabs),
  h('div', { class: 'lab-grid' }, h('div', { class: 'lab-main' }, stage, h('div', { class: 'actions' }, start, stop, status)), h('div', { class: 'lab-side' }, conductPanel, playPanel)),
  help,
  live,
);

// ---------- colours ----------

function voiceColor(hand: Handedness, f: number): string {
  const left = ['--cello', '--piano', '--flute', '--violin', '--accent-2'];
  const right = ['--accent', '--violin', '--flute', '--piano', '--accent-3'];
  return `var(${(hand === 'left' ? left : right)[f] ?? '--accent'})`;
}
const resolveColor = (css: string): string => token(css.replace(/^var\(|\)$/g, ''), '#ff5b1f');

// ---------- mode + tempo ----------

function setMode(m: Mode): void {
  mode = m;
  for (const t of tabs.querySelectorAll<HTMLElement>('.mode-tab')) t.setAttribute('aria-selected', String(t.dataset.mode === m));
  conductPanel.hidden = m !== 'conduct';
  playPanel.hidden = m !== 'play';
  releaseAll();
  resetConduct();
}

function setTempo(b: number): void {
  targetBpm = b;
  for (const c of tempoChips.querySelectorAll<HTMLElement>('.chip')) c.setAttribute('aria-checked', String(Number(c.dataset.bpm) === b));
  resetConduct();
}

function resetConduct(): void {
  coach = new PatternCoach(METER);
  guideStart = performance.now();
  lastTick = -1;
  streak = 0;
  accStat.v.textContent = '--';
  streakStat.v.textContent = '0';
  trail.length = 0;
  flashes.length = 0;
}

const beatNow = (t: number): number => ((t - guideStart) * targetBpm) / 60_000;

// ---------- feedback ----------

const lightCard = (id: string) => {
  const card = conductLegend.querySelector<HTMLElement>(`[data-g="${id}"]`);
  if (!card) return;
  card.classList.add('on');
  if (!reduced()) gsap.fromTo(card, { scale: 1.03 }, { scale: 1, duration: 0.35, ease: 'power2.out' });
  window.setTimeout(() => card.classList.remove('on'), 650);
};

// ---------- sound ----------

const conductor = createConductor(
  (cue) => {
    switch (cue.kind) {
      case 'beat': {
        const b = beatNow(cue.t);
        coach.ictus((b - Math.round(b)) * (60_000 / targetBpm));
        lightCard('beat');
        break;
      }
      case 'tempo':
        measuredBpm = cue.bpm;
        tempoStat.v.textContent = `${cue.bpm}`;
        break;
      case 'dynamics':
        dynamics = cue.level;
        dynStat.v.textContent = DYN_WORD[cue.level];
        lightCard('size');
        break;
      case 'cue':
        live.textContent = `Cue ${SECTIONS[cue.side]}`;
        lightCard('cue');
        cueFlash = { side: cue.side, t: performance.now() };
        break;
      case 'cutoff':
        live.textContent = 'Cut off';
        lightCard('cutoff');
        resetConduct();
        break;
    }
  },
  { tempo: targetBpm },
);
let cueFlash: { side: CueSide; t: number } | null = null;

const fingers = createFingerPlay((cue) => {
  const key = fingerKey(cue.hand, cue.finger);
  if (cue.kind === 'up') {
    for (const v of held.get(key) ?? []) v.release();
    held.delete(key);
    return;
  }
  const v = voices[cue.hand][cue.finger];
  if (!v) return;
  unlockAudio();
  const vel = VELOCITY[dynamics];
  // Left hand: a full triad on piano. Right hand: one sustained violin note.
  const notes = cue.hand === 'left' ? [v.midi, v.midi + (v.label.endsWith('m') ? 3 : 4), v.midi + 7] : [v.midi];
  const inst = cue.hand === 'left' ? 'piano' : 'violin';
  held.set(key, notes.map((m) => playNote(inst, m, 2, 90, vel, { held: true })));
  recent.unshift({ label: v.label, who: `${cue.hand === 'left' ? 'Left' : 'Right'} ${FINGER_NAMES[cue.finger]?.toLowerCase() ?? ''}`, color: resolveColor(voiceColor(cue.hand, cue.finger)) });
  recent.length = Math.min(recent.length, 6);
  replace(recentList, ...recent.map((r) => { const li = h('li', {}, h('span', { class: 'map-dot', 'aria-hidden': 'true' }), h('strong', {}, r.label), h('span', { class: 'muted' }, r.who)); li.style.setProperty('--note', r.color); return li; }));
});

function releaseAll(): void {
  for (const vs of held.values()) for (const v of vs) v.release();
  held.clear();
  fingers.reset();
}

// A quiet click on each guide beat, accented on beat 1, so the pattern has a pulse to follow.
const tick = (accent: boolean) => {
  const c = unlockAudio();
  if (!c) return;
  const g = c.createGain();
  g.gain.value = 0.25;
  g.connect(c.destination);
  renderNote(c, g, 'piano', accent ? 84 : 79, 0.25, 120, c.currentTime + 0.005, accent ? 70 : 45, 0.6, false);
};

// ---------- overlay ----------

const ctx = canvas.getContext('2d');

const draw = (frame: HandFrame) => {
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const hh = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(hh * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hh);
  const accent = token('--accent', '#ff5b1f');
  const violet = token('--accent-3', '#7c5cff');
  const P = (p: Point) => [p.x * w, p.y * hh] as const;
  const now = frame.t;

  // Soft scrim so the guide reads on any background.
  ctx.fillStyle = 'rgba(9,9,15,0.18)';
  ctx.fillRect(0, 0, w, hh);

  for (const hand of frame.hands) {
    const lm = hand.landmarks;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [a, b] of HAND_BONES) {
      const pa = lm[a];
      const pb = lm[b];
      if (!pa || !pb) continue;
      ctx.moveTo(...P(pa));
      ctx.lineTo(...P(pb));
    }
    ctx.stroke();
  }

  if (mode === 'conduct') drawConduct(frame, w, hh, P, now, accent, violet);
  else drawPlay(frame, P);

  // Flash labels (beat grades, notes) rise and fade.
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    if (!f) continue;
    const age = now - f.t;
    if (age > 900) {
      flashes.splice(i, 1);
      continue;
    }
    const [x, y] = P(f.p);
    ctx.globalAlpha = 1 - age / 900;
    ctx.fillStyle = f.color;
    ctx.font = '700 18px "Space Grotesk Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, x, y - 26 - age * 0.03);
    ctx.globalAlpha = 1;
  }
};

function drawConduct(frame: HandFrame, w: number, hh: number, P: (p: Point) => readonly [number, number], now: number, accent: string, violet: string): void {
  const hand = frame.hands[0];
  // Place the pattern around where this conductor's hand naturally sits (first second), then hold it.
  if (hand && !box) {
    boxSeed = { x: boxSeed.x + hand.palmCenter.x, y: boxSeed.y + hand.palmCenter.y, n: boxSeed.n + 1 };
    if (boxSeed.n >= 20) {
      box = boxAround({ x: boxSeed.x / boxSeed.n, y: boxSeed.y / boxSeed.n }, frame.aspect, 0.56);
      resetConduct();
    }
  }
  if (cueFlash && now - cueFlash.t < 700) {
    const i = cueFlash.side === 'left' ? 0 : cueFlash.side === 'center' ? 1 : 2;
    if (ctx) {
      ctx.fillStyle = `${accent}33`;
      ctx.fillRect((i * w) / 3, 0, w / 3, hh);
      ctx.fillStyle = '#fff';
      ctx.font = '700 20px "Space Grotesk Variable", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(SECTIONS[cueFlash.side], ((i + 0.5) * w) / 3, 36);
    }
  }
  if (!box || !ctx) return;
  const b = box;
  const beat = beatNow(now);

  // Guide: the whole pattern, faint, with the beat numbers at each ictus.
  ctx.setLineDash([2, 10]);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  guidePath(METER).forEach((p, i) => {
    const [x, y] = P(toFrame(p, b, frame.aspect));
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.setLineDash([]);
  for (let k = 0; k < METER; k++) {
    const [x, y] = P(toFrame(guideAt(METER, k), b, frame.aspect));
    const isNext = ((Math.floor(beat) + 1) % METER + METER) % METER === k;
    ctx.fillStyle = isNext ? accent : 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = isNext ? '#fff' : '#111';
    ctx.font = '700 15px "Space Grotesk Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(k + 1), x, y + 1);
    ctx.textBaseline = 'alphabetic';
  }

  // Click on each guide beat.
  const whole = Math.floor(beat);
  if (whole !== lastTick && beat >= 0) {
    lastTick = whole;
    tick(((whole % METER) + METER) % METER === 0);
  }

  // Lead dot: where the baton should be right now.
  const [gx, gy] = P(toFrame(guideAt(METER, beat), b, frame.aspect));
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.arc(gx, gy, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  if (!hand) return;
  // Palm trail: the conductor's own follow-through, fading over 0.8 s.
  trail.push({ p: hand.palmCenter, t: now });
  while (trail.length && now - (trail[0]?.t ?? now) > 800) trail.shift();
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const c = trail[i];
    if (!a || !c) continue;
    ctx.strokeStyle = violet;
    ctx.globalAlpha = i / trail.length;
    ctx.lineWidth = 3 + (8 * i) / trail.length;
    ctx.beginPath();
    ctx.moveTo(...P(a.p));
    ctx.lineTo(...P(c.p));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Score this beat against the guide.
  const r = coach.sample(toBox(hand.palmCenter, b, frame.aspect), beat);
  if (r) {
    accStat.v.textContent = `${coach.accuracy}%`;
    streak = r.grade === 'miss' ? 0 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
    streakStat.v.textContent = streak >= 2 ? `${streak}×` : String(streak);
    const at = toFrame(guideAt(METER, r.beat), b, frame.aspect);
    flashes.push({ p: at, t: now, text: GRADE_WORD[r.grade], color: r.grade === 'miss' ? 'rgba(255,255,255,0.7)' : accent });
  }

  // Fist hold ring: fills while a cut-off is building.
  if (hand.fist) fistSince ??= now;
  else fistSince = null;
  if (fistSince !== null) {
    const p = Math.min(1, (now - fistSince) / 400);
    const [px, py] = P(hand.palmCenter);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(px, py, 30, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    ctx.stroke();
  }
}

function drawPlay(frame: HandFrame, P: (p: Point) => readonly [number, number]): void {
  if (!ctx) return;
  const active = fingers.active;
  for (const hand of frame.hands) {
    TIPS.forEach((tip, f) => {
      const pt = hand.landmarks[tip];
      const v = voices[hand.handedness][f];
      if (!pt || !v) return;
      const [x, y] = P(pt);
      const on = active.has(fingerKey(hand.handedness, f));
      const color = resolveColor(voiceColor(hand.handedness, f));
      if (on) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 28;
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = on ? '#fff' : color;
      ctx.beginPath();
      ctx.arc(x, y, on ? 7 : 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${on ? 17 : 14}px "Space Grotesk Variable", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 6;
      ctx.fillText(v.label, x, y - 22);
      ctx.shadowBlur = 0;
    });
  }
  for (const li of playPanel.querySelectorAll<HTMLElement>('.map-item')) li.classList.toggle('on', active.has(li.dataset.key ?? ''));
}

// ---------- camera ----------

// ?delegate=cpu forces the CPU path, to compare devices.
const delegate: Delegate = new URLSearchParams(location.search).get('delegate')?.toLowerCase() === 'cpu' ? 'CPU' : 'GPU';

const onFrame = (frame: HandFrame) => {
  const n = frame.hands.length;
  hud.classList.toggle('found', n > 0);
  const text = hud.querySelector('.hud-text');
  if (text) text.textContent = n === 0 ? 'Show your hands' : n === 1 ? '1 hand' : '2 hands';
  if (mode === 'conduct') conductor.push(frame);
  else fingers.push(frame);
  draw(frame);
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

const stopAll = () => {
  tracking?.stop();
  tracking = null;
  releaseAll();
  conductor.reset();
  box = null;
  boxSeed = { x: 0, y: 0, n: 0 };
  measuredBpm = null;
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  setRunning(false);
};

start.addEventListener('click', async () => {
  unlockAudio();
  start.disabled = true;
  status.textContent = 'Starting the camera…';
  try {
    tracking = await startHandTracking(video, onFrame, {
      numHands: 2,
      delegate,
      onStats: (s: TrackingStats) => {
        stage.dataset.ms = s.detectMs.toFixed(1);
      },
      onError: (err) => {
        stopAll();
        status.textContent = MESSAGES[err.reason];
      },
    });
    if (video.videoWidth && video.videoHeight) stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    status.textContent = '';
    setRunning(true);
    resetConduct();
  } catch (err) {
    status.textContent = err instanceof CameraError ? MESSAGES[err.reason] : MESSAGES.unsupported;
  } finally {
    start.disabled = false;
  }
});
stop.addEventListener('click', stopAll);

// Warm the model while the page is read, so Start is quick; show the guide on first visit.
void loadHandModel({ delegate }).catch(() => {});
try {
  if (!localStorage.getItem('kilukkam.camera.helped')) {
    help.showModal();
    localStorage.setItem('kilukkam.camera.helped', '1');
  }
} catch {
  // storage blocked: the help button still works
}
window.addEventListener('pagehide', () => tracking?.stop());
void measuredBpm;
void bestStreak;
