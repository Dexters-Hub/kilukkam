import '@fontsource-variable/inter';
import './style.css';
import { gsap } from 'gsap';
import { playNote, preloadInstrument, renderNote, unlockAudio, type Voice } from './lib/audio.js';
import type { Dynamics } from './lib/baton.js';
import { createConductor, type CueSide } from './lib/camera/conductor.js';
import { HAND_BONES, LM, type HandFrame, type Handedness, type Point } from './lib/camera/features.js';
import { voicesFor, type FingerVoice } from './lib/camera/fingers.js';
import { TOUCH, TOUCH_FINGERS, createTouchPlay, touchKey as fingerKey } from './lib/camera/touch.js';
import { CameraError, loadHandModel, startHandTracking, type Delegate, type HandTracking, type TrackingStats } from './lib/camera/hands.js';
import { drawCueZones, newZoneState } from './lib/camera/cueZones.js';
import { OneEuroFilter } from './lib/camera/filter.js';
import { TARGET_RADIUS, TargetCoach, boxAround, guideAt, guidePath, toBox, toFrame, type BatonGrade, type GuideBox, type Meter } from './lib/camera/pattern.js';
import { applyTheme, savedTheme, setTheme } from './lib/theme.js';
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
const TEMPOS = [60, 80, 100] as const;
/** Beats of count-in after calibrating, before beats are scored */
const COUNT_IN = 4;
/** How long the palm must rest in the start circle */
const HOLD_MS = 900;
/** The pattern being conducted: 4/4, 3/4 (waltz) or 2/4 (march) */
let METER: Meter = 4;
const METER_NAME: Record<Meter, string> = { 4: '4/4', 3: '3/4 waltz', 2: '2/4 march' };
/** Levels: each step changes the swish or speeds it up. Eight good beats in a row moves you on. */
const LEVELS: readonly { meter: Meter; bpm: number }[] = [
  { meter: 4, bpm: 60 },
  { meter: 4, bpm: 76 },
  { meter: 3, bpm: 72 },
  { meter: 3, bpm: 92 },
  { meter: 2, bpm: 96 },
  { meter: 4, bpm: 96 },
  { meter: 3, bpm: 112 },
  { meter: 2, bpm: 126 },
];
/** Level up on recent form: of the last 8 beats, at least 6 hits averaging 65 or better */
const LEVEL_WINDOW = 8;
const LEVEL_HITS = 6;
const LEVEL_AVERAGE = 65;
/** The scores of the latest beats in this level, newest last */
const recentScores: number[] = [];
let level = 0;
let levels = true;
let levelUpAt = -Infinity;
/** The four fingertips the thumb touches to play: index, middle, ring, little */
const TIPS = [LM.index[3], LM.middle[3], LM.ring[3], LM.pinky[3]] as const;
const FINGER_NAMES = TOUCH_FINGERS;

applyTheme(savedTheme());

const voices = voicesFor(0);
for (const id of ['piano', 'violin'] as const) void preloadInstrument(id);

// ---------- state ----------

let mode: Mode = 'conduct';
let targetBpm: number = TEMPOS[0];
let measuredBpm: number | null = null;
let dynamics: Dynamics = 'mf';
let tracking: HandTracking | null = null;
let guideStart = 0;
let lastTick = -1;
let box: GuideBox | null = null;
let holdSince: number | null = null;
let coach = new TargetCoach(METER, 60_000 / targetBpm);
const smooth = { x: new OneEuroFilter(1.2, 4), y: new OneEuroFilter(1.2, 4) };
let palm: Point | null = null;
/** Recent beat arrivals, for your tempo against the guide */
const arrivals: { beat: number; off: number }[] = [];
let streak = 0;
let bestStreak = 0;
let fistSince: number | null = null;
const trail: { p: Point; t: number }[] = [];
const flashes: { p: Point; t: number; text: string; color: string }[] = [];
/** Grade pops, particles and cheers: the show that answers every beat */
const pops: { p: Point; t: number; text: string; sub: string; color: string; size: number }[] = [];
const sparks: { x: number; y: number; vx: number; vy: number; t: number; color: string }[] = [];
let cheer: { text: string; t: number } | null = null;
let comboAt = -Infinity;
/** The free (left) hand: cues and dynamics, while the right hand beats */
let freePalm: Point | null = null;
let freeDynAt = 0;
const CHEERS: Record<number, string> = { 4: 'Nice!', 8: 'On fire!', 12: 'Maestro!', 16: 'Unstoppable!', 24: 'Legendary!' };
const GRADE_COLOR: Record<BatonGrade, string> = { perfect: '#b6f400', great: '#2fd6b8', good: '#ffffff', miss: 'rgba(255,255,255,0.6)' };
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
  legendCard('beat', 'metronome', 'Hit the targets', 'Move your hand into each numbered circle as its ring closes: down, left, right, up.'),
  legendCard('size', 'waveform', 'Bigger is louder', 'Big sweeping beats play loud, small careful ones soft.'),
  legendCard('cue', 'hand-pointing', 'Point to cue', 'Point into a third of the picture and hold: violins, flutes or cellos.'),
  legendCard('cutoff', 'hand-grabbing', 'Fist to start over', 'Close your fist and hold it to cut off and place the pattern again.'),
);
const meterChips = h(
  'div',
  { class: 'chips', role: 'radiogroup', 'aria-label': 'Pattern' },
  ...([4, 3, 2] as const).map((m) =>
    h('button', { class: 'chip', type: 'button', role: 'radio', 'aria-checked': String(m === METER), 'data-meter': String(m), onclick: () => setPattern(m, targetBpm, true) }, METER_NAME[m]),
  ),
);
const levelText = h('span', { class: 'level-text' }, 'Level 1 · 4/4 at 60');
const levelToggle = h('button', { class: 'chip', type: 'button', role: 'switch', 'aria-checked': 'true', onclick: () => setLevels(!levels) }, 'Levels on');
const levelRow = h('div', { class: 'panel-row' }, levelText, levelToggle);

// Scores sit right under the camera view, where the eyes already are.
const hudStats = h('div', { class: 'stats hud-stats' }, accStat.el, tempoStat.el, dynStat.el, streakStat.el);

const conductPanel = h(
  'section',
  { class: 'panel', 'aria-label': 'Conducting' },
  h('div', { class: 'panel-row' }, h('span', { class: 'label' }, 'Pattern'), meterChips),
  h('div', { class: 'panel-row' }, h('span', { class: 'label' }, 'Practice tempo'), tempoChips),
  levelRow,
  conductLegend,
);

// Play panel
const mapItem = (hand: Handedness, f: number, v: FingerVoice) => {
  const li = h('li', { class: 'map-item', 'data-key': fingerKey(hand, f) }, h('span', { class: 'map-finger' }, FINGER_NAMES[f] ?? ''), h('span', { class: 'map-note' }, h('span', { class: 'map-dot', 'aria-hidden': 'true' }), v.label));
  li.style.setProperty('--note', voiceColor(hand, f));
  return li;
};
const handMap = (hand: Handedness, title: string, sub: string) =>
  h('section', { class: 'map', 'aria-label': title }, h('h3', { class: 'map-title' }, title, h('span', { class: 'muted' }, ` · ${sub}`)), h('ul', { class: 'map-list' }, ...voices[hand].slice(0, TIPS.length).map((v, f) => mapItem(hand, f, v))));
const recentList = h('ol', { class: 'recent' });
const playPanel = h(
  'section',
  { class: 'panel', 'aria-label': 'Finger play', hidden: true },
  h('p', { class: 'panel-lead' }, h('strong', {}, 'Touch your thumb to a fingertip to play. '), 'Keep touching to hold the note, part them to let go. Four notes a hand, all in tune together.'),
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
    legendCard('t1', 'magic-wand', 'Conduct', 'Rest your hand in the circle, wait for 4, 3, 2, 1, then move into each numbered target as its ring closes. Follow the bright line.'),
    legendCard('t2', 'hand-tap', 'Play', 'Touch your thumb to a fingertip to sound its note; hold the touch to sustain. Left hand plays chords, right hand the melody.'),
    legendCard('t3', 'hand-pointing', 'Get good tracking', 'Even, front light. Palms to the camera, about 50 cm to 1 m away, plain background.'),
    legendCard('t4', 'device-mobile', 'Private', 'Hand tracking runs on this device. Video is never recorded or sent anywhere.'),
  ),
  h('form', { method: 'dialog' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'Got it')),
);
const helpBtn = h('button', { class: 'pill', type: 'button', 'aria-label': 'How to play', onclick: () => help.showModal() }, icon('sparkle', 16), 'How to play');

const themeBtn = h('button', { class: 'pill theme', type: 'button', 'aria-label': 'Switch theme' }, savedTheme() === 'dark' ? 'Light' : 'Dark');
themeBtn.addEventListener('click', () => {
  const next = savedTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  themeBtn.textContent = next === 'dark' ? 'Light' : 'Dark';
});

const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
document.getElementById('lab')?.append(
  h('header', { class: 'top' }, h('a', { class: 'home-link', href: '/', 'aria-label': 'Kilukkam home' }, wordmark()), h('span', { class: 'top-right' }, helpBtn, themeBtn)),
  h('div', { class: 'lab-head' }, h('h1', { class: 'title' }, 'Play with your hands'), tabs),
  h('div', { class: 'lab-grid' }, h('div', { class: 'lab-main' }, stage, hudStats, h('div', { class: 'actions' }, start, stop, status)), h('div', { class: 'lab-side' }, conductPanel, playPanel)),
  help,
  live,
);

// ---------- colours ----------

function voiceColor(hand: Handedness, f: number): string {
  const left = ['--cello', '--piano', '--flute', '--violin', '--accent-2'];
  const right = ['--violin', '--flute', '--piano', '--drums', '--accent-3'];
  return `var(${(hand === 'left' ? left : right)[f] ?? '--accent'})`;
}
const resolveColor = (css: string): string => token(css.replace(/^var\(|\)$/g, ''), '#b6f400');

// ---------- mode + tempo ----------

function setMode(m: Mode): void {
  mode = m;
  for (const t of tabs.querySelectorAll<HTMLElement>('.mode-tab')) t.setAttribute('aria-selected', String(t.dataset.mode === m));
  conductPanel.hidden = m !== 'conduct';
  hudStats.hidden = m !== 'conduct';
  playPanel.hidden = m !== 'play';
  releaseAll();
  resetConduct();
}

/** Switch the swish (and tempo) without recalibrating: the pattern restarts with a fresh count-in. */
function setPattern(m: Meter, bpm: number, manual: boolean): void {
  METER = m;
  targetBpm = bpm;
  for (const c of meterChips.querySelectorAll<HTMLElement>('.chip')) c.setAttribute('aria-checked', String(Number(c.dataset.meter) === m));
  for (const c of tempoChips.querySelectorAll<HTMLElement>('.chip')) c.setAttribute('aria-checked', String(Number(c.dataset.bpm) === bpm));
  restartPattern();
}

function setLevels(on: boolean): void {
  levels = on;
  levelToggle.setAttribute('aria-checked', String(on));
  levelToggle.textContent = on ? 'Levels on' : 'Levels off';
  paintLevel();
}

const paintLevel = () => {
  const good = recentScores.filter((x) => x >= 40).length;
  const progress = level < LEVELS.length - 1 ? ` · ${Math.min(good, LEVEL_HITS)} of ${LEVEL_HITS} good beats` : ' · top level';
  levelText.textContent = levels ? `Level ${level + 1} of ${LEVELS.length} · ${METER_NAME[METER]} at ${targetBpm}${progress}` : `Free practice · ${METER_NAME[METER]} at ${targetBpm}`;
};

function levelUp(now: number): void {
  if (!levels || level >= LEVELS.length - 1) return;
  level++;
  const next = LEVELS[level];
  if (!next) return;
  setPattern(next.meter, next.bpm, false);
  paintLevel();
  levelUpAt = now;
  live.textContent = `Level ${level + 1}: ${METER_NAME[next.meter]} at ${next.bpm} bpm`;
}

/** Keep the placed pattern, restart the guide with a count-in in the current meter and tempo. */
function restartPattern(): void {
  recentScores.length = 0;
  guideStart = performance.now();
  lastTick = -1;
  coach = new TargetCoach(METER, 60_000 / targetBpm);
  coach.startAt(COUNT_IN);
  streak = 0;
  arrivals.length = 0;
  trail.length = 0;
  streakStat.v.textContent = '0';
  tempoStat.v.textContent = '--';
  paintLevel();
}

function setTempo(b: number): void {
  setPattern(METER, b, true);
}

/** Back to the start circle: the pattern is placed again around the hand. */
function resetConduct(): void {
  box = null;
  holdSince = null;
  coach = new TargetCoach(METER, 60_000 / targetBpm);
  coach.startAt(COUNT_IN);
  guideStart = performance.now();
  lastTick = -1;
  streak = 0;
  accStat.v.textContent = '--';
  streakStat.v.textContent = '0';
  trail.length = 0;
  flashes.length = 0;
  arrivals.length = 0;
  tempoStat.v.textContent = '--';
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
      case 'beat':
        lightCard('size');
        break;
      case 'tempo':
        measuredBpm = cue.bpm;
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
const zoneState = newZoneState();

const fingers = createTouchPlay((cue) => {
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
  const accent = token('--accent', '#b6f400');
  const P = (p: Point) => [p.x * w, p.y * hh] as const;
  const now = frame.t;

  // Soft scrim so the guide reads on any background.
  ctx.fillStyle = 'rgba(9,9,15,0.18)';
  ctx.fillRect(0, 0, w, hh);

  // Conduct mode shows only the cursor; play mode keeps a faint hand so fingertips have context.
  for (const hand of mode === 'play' ? frame.hands : []) {
    const lm = hand.landmarks;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
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

  if (mode === 'conduct') drawConduct(frame, w, hh, P, now, accent);
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
    ctx.font = '700 18px "Inter Variable", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, x, y - 26 - age * 0.03);
    ctx.globalAlpha = 1;
  }
};

function drawConduct(frame: HandFrame, w: number, hh: number, P: (p: Point) => readonly [number, number], now: number, accent: string): void {
  if (!ctx) return;
  const c = ctx;
  // Two hands: the right one beats time (the baton), the left one cues and shapes the sound.
  const hand = frame.hands.find((x) => x.handedness === 'right') ?? (frame.hands.length === 1 ? frame.hands[0] : undefined) ?? frame.hands[0];
  const free = frame.hands.find((x) => x !== hand);
  freePalm = free ? free.palmCenter : null;
  if (free && !free.fist && free.fingersUp.filter(Boolean).length >= 4 && now - freeDynAt > 350) {
    // Higher left hand, louder room: the top of the picture is ff, the bottom pp.
    freeDynAt = now;
    const levels: Dynamics[] = ['ff', 'f', 'mf', 'p', 'pp'];
    const lvl = levels[Math.min(4, Math.max(0, Math.floor(((free.palmCenter.y - 0.15) / 0.7) * 5)))] ?? 'mf';
    if (lvl !== dynamics) {
      dynamics = lvl;
      dynStat.v.textContent = DYN_WORD[lvl];
      lightCard('size');
    }
  }
  // A smoothed palm is the cursor: steady when still, quick when beating.
  if (hand) palm = { x: smooth.x.filter(hand.palmCenter.x, now), y: smooth.y.filter(hand.palmCenter.y, now) };
  else {
    palm = null;
    smooth.x.reset();
    smooth.y.reset();
  }
  const font = (px: number, weight = 800) => `${weight} ${px}px "Inter Variable", system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';

  drawCueZones(c, w, hh, [
    { side: 'left', label: SECTIONS.left, color: resolveColor('var(--violin)') },
    { side: 'center', label: SECTIONS.center, color: resolveColor('var(--flute)') },
    { side: 'right', label: SECTIONS.right, color: resolveColor('var(--cello)') },
  ], frame, zoneState, cueFlash);

  // 1. Calibrate: rest an open hand in the circle; the pattern is then sized to that hand and placed around it.
  if (!box) {
    const cx = w / 2;
    const cy = hh * 0.55;
    const R = hh * 0.1;
    const inside = palm ? Math.hypot(palm.x * w - cx, palm.y * hh - cy) < R : false;
    if (inside) holdSince ??= now;
    else holdSince = null;
    const p = holdSince === null ? 0 : Math.min(1, (now - holdSince) / HOLD_MS);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 3;
    c.setLineDash([6, 8]);
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    if (p > 0) {
      c.strokeStyle = accent;
      c.lineWidth = 7;
      c.beginPath();
      c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
      c.stroke();
    }
    c.fillStyle = '#fff';
    c.font = font(Math.max(16, hh * 0.04));
    c.fillText(hand ? (inside ? 'Hold still…' : 'Move your open hand into the circle') : 'Raise one open hand', cx, cy - R - hh * 0.06);
    drawCursor(c, P, accent);
    if (p >= 1 && hand && palm) {
      const size = Math.min(0.7, Math.max(0.38, hand.size * 3.6));
      box = boxAround({ x: palm.x, y: palm.y - size * 0.25 }, frame.aspect, size);
      guideStart = now;
      lastTick = -1;
      coach = new TargetCoach(METER, 60_000 / targetBpm);
      coach.startAt(COUNT_IN);
    }
    return;
  }

  const b = box;
  const beat = beatNow(now);
  const F = (u: Point) => P(toFrame(u, b, frame.aspect));
  const unit = (b.size * hh);
  const R = TARGET_RADIUS * unit;

  // Click on each beat, accented on beat 1, so there is a pulse to move to.
  const whole = Math.floor(beat);
  if (whole !== lastTick && beat >= 0) {
    lastTick = whole;
    tick(((whole % METER) + METER) % METER === 0);
  }

  // The whole pattern, faint.
  c.setLineDash([2, 9]);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 3;
  c.beginPath();
  guidePath(METER).forEach((p, i) => {
    const [x, y] = F(p);
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  });
  c.stroke();
  c.setLineDash([]);

  // The road ahead: the next three quarters of a beat, bright, so you know where to go.
  for (let k = 1; k <= 24; k++) {
    const [x0, y0] = F(guideAt(METER, beat + ((k - 1) / 24) * 0.75));
    const [x1, y1] = F(guideAt(METER, beat + (k / 24) * 0.75));
    c.strokeStyle = accent;
    c.globalAlpha = 0.9 * (1 - k / 26);
    c.lineWidth = R * 0.5 * (1 - k / 30);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1, y1);
    c.stroke();
  }
  c.globalAlpha = 1;

  // Targets: one per beat. The next one wears a ring that closes exactly on its beat.
  const nextBeat = Math.ceil(beat - 0.02);
  for (let k = 0; k < METER; k++) {
    const [x, y] = F(guideAt(METER, k));
    const isNext = ((nextBeat % METER) + METER) % METER === k;
    c.fillStyle = isNext ? `${accent}55` : 'rgba(255,255,255,0.16)';
    c.strokeStyle = isNext ? accent : 'rgba(255,255,255,0.6)';
    c.lineWidth = isNext ? 4 : 2;
    c.beginPath();
    c.arc(x, y, R, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    if (isNext) {
      const left = nextBeat - beat;
      c.globalAlpha = Math.min(1, 1.4 - left);
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x, y, R * (1 + 2.4 * Math.max(0, left)), 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }
    c.fillStyle = isNext ? '#0a0a0a' : '#fff';
    c.font = font(Math.round(R * 0.9));
    c.fillText(String(k + 1), x, y + 1);
  }

  // A fresh level announces itself over the count-in.
  if (now - levelUpAt < 2600) {
    c.globalAlpha = Math.min(1, (2600 - (now - levelUpAt)) / 500);
    c.fillStyle = accent;
    c.font = font(Math.max(18, hh * 0.05), 900);
    c.fillText(`Level ${level + 1} · ${METER_NAME[METER]}`, w / 2, hh * 0.17);
    c.globalAlpha = 1;
  }

  // Count-in: big numbers in the middle while the guide already moves.
  if (beat < COUNT_IN) {
    const n = COUNT_IN - Math.floor(beat);
    // Below the pattern, so it never sits on a target.
    const x = w / 2;
    const y = Math.min(hh * 0.8, F({ x: 0.5, y: 1.12 })[1]);
    c.globalAlpha = 1 - (beat % 1) * 0.6;
    c.fillStyle = '#fff';
    c.font = font(Math.round(hh * 0.1), 900);
    c.fillText(String(n), x, y);
    c.font = font(Math.max(14, hh * 0.03), 700);
    c.fillText('Get ready: follow the bright line', x, y + hh * 0.075);
    c.globalAlpha = 1;
  }

  // Where the baton should be right now: a small white dot riding the line.
  const [gx, gy] = F(guideAt(METER, beat));
  c.fillStyle = '#fff';
  c.beginPath();
  c.arc(gx, gy, Math.max(5, R * 0.22), 0, Math.PI * 2);
  c.fill();

  // Your hand: the trail behind it and the cursor on top.
  if (palm) {
    trail.push({ p: palm, t: now });
  }
  while (trail.length && now - (trail[0]?.t ?? now) > 450) trail.shift();
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const d = trail[i];
    if (!a || !d) continue;
    c.strokeStyle = accent;
    c.globalAlpha = (i / trail.length) * 0.7;
    c.lineWidth = 2 + (R * 0.35 * i) / trail.length;
    c.beginPath();
    c.moveTo(...P(a.p));
    c.lineTo(...P(d.p));
    c.stroke();
  }
  c.globalAlpha = 1;
  drawCursor(c, P, accent);

  // Score each beat once its window has passed.
  for (const r of coach.sample(palm ? toBox(palm, b, frame.aspect) : null, beat)) {
    accStat.v.textContent = `${coach.accuracy}%`;
    // Your tempo: how your arrivals drift against the click. Arriving a little
    // later each beat means you are slower than the guide.
    if (Number.isFinite(r.offsetMs)) {
      arrivals.push({ beat: r.beat, off: r.offsetMs });
      if (arrivals.length > 6) arrivals.shift();
      if (arrivals.length >= 3) {
        const n = arrivals.length;
        const mb = arrivals.reduce((a, x) => a + x.beat, 0) / n;
        const mo = arrivals.reduce((a, x) => a + x.off, 0) / n;
        const slope = arrivals.reduce((a, x) => a + (x.beat - mb) * (x.off - mo), 0) / Math.max(1e-6, arrivals.reduce((a, x) => a + (x.beat - mb) ** 2, 0));
        const yours = Math.round(60_000 / (60_000 / targetBpm + slope));
        tempoStat.v.textContent = Math.abs(yours - targetBpm) <= 2 ? `${targetBpm} · steady` : `${yours} · ${yours > targetBpm ? 'rushing' : 'dragging'}`;
      }
    } else arrivals.length = 0;
    streak = r.grade === 'miss' ? 0 : streak + 1;
    bestStreak = Math.max(bestStreak, streak);
    streakStat.v.textContent = streak >= 2 ? `${streak}×` : String(streak);
    const at = toFrame(guideAt(METER, r.beat), b, frame.aspect);
    const when = r.grade === 'perfect' || r.grade === 'miss' || !Number.isFinite(r.offsetMs) || Math.abs(r.offsetMs) < 80 ? '' : r.offsetMs < 0 ? 'early' : 'late';
    pops.push({ p: at, t: now, text: GRADE_WORD[r.grade], sub: when, color: GRADE_COLOR[r.grade], size: r.grade === 'perfect' ? 1.25 : r.grade === 'miss' ? 0.8 : 1 });
    const burst = r.grade === 'perfect' ? 26 : r.grade === 'great' ? 16 : r.grade === 'good' ? 7 : 0;
    const [sx, sy] = P(at);
    for (let k = 0; k < burst; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 0.15 + Math.random() * 0.45;
      sparks.push({ x: sx, y: sy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.15, t: now, color: k % 4 === 0 ? '#ffffff' : GRADE_COLOR[r.grade] });
    }
    if (r.grade !== 'miss') {
      comboAt = now;
      lightCard('beat');
    }
    const cheerText = CHEERS[streak];
    recentScores.push(r.score);
    if (recentScores.length > LEVEL_WINDOW) recentScores.shift();
    const hits = recentScores.filter((x) => x >= 40).length;
    const average = recentScores.reduce((a, x) => a + x, 0) / Math.max(1, recentScores.length);
    const readyToLevel = levels && recentScores.length >= LEVEL_WINDOW && hits >= LEVEL_HITS && average >= LEVEL_AVERAGE;
    paintLevel();
    if (cheerText && !readyToLevel) cheer = { text: cheerText, t: now };
    if (readyToLevel) {
      levelUp(now);
      break;
    }
  }

  // Fist hold ring: fills while a cut-off is building.
  if (hand?.fist) fistSince ??= now;
  else fistSince = null;
  if (fistSince !== null && palm) {
    const p = Math.min(1, (now - fistSince) / 400);
    const [px, py] = P(palm);
    c.strokeStyle = accent;
    c.lineWidth = 5;
    c.beginPath();
    c.arc(px, py, R * 1.4, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    c.stroke();
  }
  drawFreeHand(c, P);
  drawFx(c, w, hh, P, now, R, beat < COUNT_IN);
  c.textBaseline = 'alphabetic';
}

/** The left hand's cursor, in blue, with what it does. */
function drawFreeHand(c: CanvasRenderingContext2D, P: (p: Point) => readonly [number, number]): void {
  if (!freePalm) return;
  const [x, y] = P(freePalm);
  const blue = resolveColor('var(--drums)');
  c.strokeStyle = blue;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x, y, 14, 0, Math.PI * 2);
  c.stroke();
  c.fillStyle = '#fff';
  c.font = '700 12px "Inter Variable", system-ui, sans-serif';
  c.textAlign = 'center';
  c.fillText('Left hand: point to cue, raise for louder', x, y + 30);
}

/** Grade words that spring, particles that fly, the combo and the cheers. */
function drawFx(c: CanvasRenderingContext2D, w: number, hh: number, P: (p: Point) => readonly [number, number], now: number, R: number, countIn: boolean): void {
  const font = (px: number, weight = 900) => `${weight} ${Math.round(px)}px "Inter Variable", system-ui, sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  // Particles: thrown out of the target, a little gravity, gone in 0.7 s.
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    if (!s) continue;
    const age = now - s.t;
    if (age > 700) {
      sparks.splice(i, 1);
      continue;
    }
    const x = s.x + s.vx * age;
    const y = s.y + s.vy * age + 0.0004 * age * age;
    c.globalAlpha = 1 - age / 700;
    c.fillStyle = s.color;
    c.beginPath();
    c.arc(x, y, 2.5 + 2 * (1 - age / 700), 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
  // Grade words: spring in big, settle, drift up and fade.
  for (let i = pops.length - 1; i >= 0; i--) {
    const pop = pops[i];
    if (!pop) continue;
    const age = now - pop.t;
    if (age > 1000) {
      pops.splice(i, 1);
      continue;
    }
    const spring = 1 + 0.55 * Math.exp(-age / 110) * Math.cos(age / 34);
    const [x, y0] = P(pop.p);
    const y = y0 - R * 1.7 - age * 0.035;
    c.save();
    c.translate(x, y);
    c.scale(spring, spring);
    c.globalAlpha = Math.min(1, (1000 - age) / 350);
    c.shadowColor = pop.color;
    c.shadowBlur = pop.text === 'Miss' ? 0 : 22;
    c.fillStyle = pop.color;
    c.font = font(R * 1.1 * pop.size);
    c.fillText(pop.text, 0, 0);
    c.shadowBlur = 0;
    if (pop.sub) {
      c.font = font(R * 0.5, 800);
      const tw = c.measureText(pop.sub).width;
      c.fillStyle = 'rgba(10,10,10,0.7)';
      c.beginPath();
      c.roundRect(-tw / 2 - 10, R * 0.55, tw + 20, R * 0.7, R * 0.35);
      c.fill();
      c.fillStyle = '#fff';
      c.fillText(pop.sub === 'early' ? '◂ early' : 'late ▸', 0, R * 0.9);
    }
    c.restore();
  }
  c.globalAlpha = 1;
  // The combo: big, top centre, punching on every hit.
  if (streak >= 2 && !countIn) {
    const age = now - comboAt;
    const punch = 1 + 0.35 * Math.exp(-age / 90);
    c.save();
    c.translate(w / 2, hh * 0.84);
    c.scale(punch, punch);
    c.fillStyle = '#b6f400';
    c.shadowColor = '#b6f400';
    c.shadowBlur = 24;
    c.font = font(hh * 0.085);
    c.fillText(`${streak}×`, 0, 0);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = font(hh * 0.026, 800);
    c.fillText('C O M B O', 0, hh * 0.055);
    c.restore();
  }
  // Cheers on a streak milestone: a burst of words across the middle.
  if (cheer) {
    const age = now - cheer.t;
    if (age > 1400) cheer = null;
    else {
      const s = 0.6 + 0.6 * (1 - Math.exp(-age / 120));
      c.save();
      c.translate(w / 2, hh * 0.5);
      c.rotate(-0.06);
      c.scale(s, s);
      c.globalAlpha = Math.min(1, (1400 - age) / 400);
      c.fillStyle = '#ffffff';
      c.shadowColor = '#b6f400';
      c.shadowBlur = 40;
      c.font = font(hh * 0.12);
      c.fillText(cheer.text, 0, 0);
      c.restore();
    }
  }
  c.globalAlpha = 1;
  c.shadowBlur = 0;
}

/** The hand cursor: a lime ring with a solid centre, where the camera sees your palm. */
function drawCursor(c: CanvasRenderingContext2D, P: (p: Point) => readonly [number, number], accent: string): void {
  if (!palm) return;
  const [x, y] = P(palm);
  c.shadowColor = accent;
  c.shadowBlur = 18;
  c.strokeStyle = accent;
  c.lineWidth = 4;
  c.beginPath();
  c.arc(x, y, 16, 0, Math.PI * 2);
  c.stroke();
  c.shadowBlur = 0;
  c.fillStyle = accent;
  c.beginPath();
  c.arc(x, y, 6, 0, Math.PI * 2);
  c.fill();
}

function drawPlay(frame: HandFrame, P: (p: Point) => readonly [number, number]): void {
  if (!ctx) return;
  const active = fingers.active;
  for (const hand of frame.hands) {
    // A line from the thumb to the nearest fingertip, brighter as they close in, so you can see a touch coming.
    const d = fingers.distances.get(hand.handedness);
    const thumb = hand.landmarks[LM.thumb[3]];
    if (d && thumb) {
      const k = d.indexOf(Math.min(...d));
      const tipPt = hand.landmarks[TIPS[k] ?? 8];
      const closeness = Math.max(0, Math.min(1, (TOUCH.off * 1.6 - (d[k] ?? 9)) / (TOUCH.off * 1.6 - TOUCH.on)));
      if (tipPt && closeness > 0) {
        const color = resolveColor(voiceColor(hand.handedness, k));
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.25 + 0.75 * closeness;
        ctx.lineWidth = 2 + 4 * closeness;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(...P(thumb));
        ctx.lineTo(...P(tipPt));
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(...P(thumb), 7, 0, Math.PI * 2);
      ctx.fill();
    }
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
      ctx.font = `700 ${on ? 17 : 14}px "Inter Variable", system-ui, sans-serif`;
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
  stopDemo?.();
  stopDemo = null;
  tracking?.stop();
  tracking = null;
  releaseAll();
  conductor.reset();
  box = null;
  measuredBpm = null;
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
  setRunning(false);
};

// ?demo plays a simulated conductor instead of the camera: an open hand that
// rests in the start circle, then follows the guide a little late with a
// little wobble. For presenting without a webcam, and for checking the overlay.
const DEMO = new URLSearchParams(location.search).has('demo');
const startDemo = (): (() => void) => {
  let raf = 0;
  const t0 = performance.now();
  const hand = (p: Point): HandFrame['hands'][number] => ({
    handedness: 'right',
    score: 1,
    wrist: { x: p.x, y: p.y + 0.08 },
    indexTip: { x: p.x, y: p.y - 0.1 },
    palmCenter: p,
    size: 0.14,
    pinch: false,
    pinchDistance: 1,
    fingersUp: [true, true, true, true, true],
    openPalm: true,
    fist: false,
    landmarks: Array.from({ length: 21 }, () => p),
  });
  const step = (now: number) => {
    raf = requestAnimationFrame(step);
    const at = now - t0;
    const aspect = 4 / 3;
    let p: Point = { x: 0.5 + Math.sin(at / 700) * 0.01, y: 0.55 };
    if (mode === 'play') {
      // Two open hands; each thumb taps the four fingertips in turn, resting between touches.
      const playHand = (handedness: 'left' | 'right', cx: number, phase: number): HandFrame['hands'][number] => {
        const lms: Point[] = Array.from({ length: 21 }, () => ({ x: cx, y: 0.62 }));
        const tips = [-0.06, -0.02, 0.02, 0.06].map((dx, i) => ({ x: cx + dx * (handedness === 'left' ? -1 : 1), y: 0.4 + Math.abs(i - 1.5) * 0.02 }));
        [8, 12, 16, 20].forEach((li, i) => (lms[li] = tips[i] as Point));
        const slot = Math.floor(at / 700 + phase) % 8;
        const target = slot % 2 === 0 ? tips[(slot / 2) % 4] : undefined;
        lms[4] = target ? { x: target.x + 0.004, y: target.y + 0.006 } : { x: cx + (handedness === 'left' ? 0.09 : -0.09), y: 0.55 };
        return { ...hand({ x: cx, y: 0.55 }), handedness, landmarks: lms, size: 0.18 };
      };
      onFrame({ t: now, aspect: 4 / 3, hands: [playHand('left', 0.3, 0), playHand('right', 0.7, 3)] });
      return;
    }
    let pointing = false;
    if (box) {
      const g = toFrame(guideAt(METER, beatNow(now) - 0.06), box, aspect);
      p = { x: g.x + Math.sin(at / 230) * 0.008, y: g.y + Math.cos(at / 310) * 0.008 };
      // In the fourth bar the demo points at the left third to cue its section.
      if (Math.floor(beatNow(now) / METER) === 3) {
        pointing = true;
        p = { x: 0.16, y: 0.42 };
      }
    }
    const h = hand(p);
    onFrame({ t: now, aspect, hands: [pointing ? { ...h, fingersUp: [false, true, false, false, false], openPalm: false, indexTip: { x: p.x, y: p.y - 0.09 } } : h] });
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
};
let stopDemo: (() => void) | null = null;

start.addEventListener('click', async () => {
  if (DEMO) {
    unlockAudio();
    stage.style.aspectRatio = '4 / 3';
    setRunning(true);
    resetConduct();
    stopDemo = startDemo();
    return;
  }
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
