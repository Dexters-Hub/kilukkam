import { useGSAP } from '@gsap/react';
import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from 'react';
import { coachIn, coachOut, comboPunch, dud, missShake, noteHit } from '../../lib/anim.js';
import { createLane, type Lane } from '../../lib/lane.js';
import { hitName, instrumentMeta } from '../../lib/music.js';
import { HOLD_RELEASE_MS, onsets, type Judgement } from '../../lib/rhythm.js';
import { myTrack, nextEvents, progress, skipRests, type AppState } from '../../lib/store.js';
import { readPref, writePref } from '../../ui/dom.js';
import { COUNT_IN_BEATS, actions, store } from '../../app/controller.js';
import { countdownLabel } from '../../app/cues.js';
import { onLive, type DjEvent } from '../../app/live.js';
import { useStore } from '../../app/useStore.js';
import { holdWakeLock } from '../../app/wakeLock.js';
import { useKeyPlay } from '../../app/useKeyPlay.js';
import { Avatar } from '../../components/Avatar.js';
import { cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { ConductorCue } from './ConductorCue.js';
import { RoomView } from './RoomView.js';
import { FLICK_MS, KEY_CAPS, isFlick, keyLane, laneAt } from './hands.js';
import { assignLanes, flickNotes, holdNotes } from './lanes.js';
import { LEVELS, LEVEL_NAME, isLevel, laneCount, loadLevel, lookahead, noteTypes, saveLevel, type Level } from './levels.js';
import { beatThump, blackout, flashCue, rise } from './cueAnim.js';
import { startOrchestra } from './orchestra.js';
import s from './Play.module.css';

const COACHED_PREF = 'kilukkam.coached';
const BAND_PREF = 'kilukkam.orchestra';
/** Off by default: in a room everyone hears the phones; turn it on in headphones. */
const loadBand = (): boolean => {
  try {
    return localStorage.getItem(BAND_PREF) === 'on';
  } catch {
    return false;
  }
};
const saveBand = (on: boolean): void => {
  try {
    localStorage.setItem(BAND_PREF, on ? 'on' : 'off');
  } catch {
    // Private mode: the choice lasts this visit only.
  }
};
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
const DJ_WORD = { drop: 'Drop', build: 'Build', loop_on: 'Loop', loop_off: 'Back in' } as const;
const COACH: Record<Level, string> = {
  easy: 'Tap each tile as it reaches the bottom',
  normal: 'Tap each tile in its column as it reaches the bottom',
  hard: 'Tap each tile in its column as it reaches the bottom',
  expert: 'Tap each tile as it reaches the bottom, hold long tiles, swipe up on arrows',
};
const SURFACE_LABEL: Record<Level, string> = {
  easy: 'Play your next note: tap anywhere as each tile reaches the bottom',
  normal: 'Play your next note: tap the tile in its column, left half or right half',
  hard: 'Play your next note: four columns, tap each tile in its column',
  expert: 'Play your next note: four columns, hold long tiles, swipe up on arrow tiles',
};

/** Where a press came from: a finger (pointer id) or a key (its code) */
type Source = number | string;

/** A hold note being held down */
interface Held {
  index: number;
  lane: number;
  source: Source;
  hit: Judgement;
  /** Server ms the tail ends, and the hold's length */
  endMs: number;
  holdMs: number;
}

/** A finger on a flick note, waiting to see whether it swipes up */
interface PendingFlick {
  pointerId: number;
  lane: number;
  x: number;
  y: number;
  at: number;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The player's instrument. React renders the frame when room state changes;
 * everything a tap touches (sound, note name, progress, combo, ripples, lane)
 * runs on refs from the pointer handler and a store subscription.
 */
export function Play() {
  const snap = useStore((st) => st.snapshot);
  const piece = useStore((st) => st.piece);
  const session = useStore((st) => st.session);
  const playerId = useStore((st) => st.playerId);
  const assist = useStore((st) => st.assist);
  const track = useStore(myTrack);
  // The level this phone last played; loadLevel and saveLevel swallow storage errors.
  const [level, setLevel] = useState<Level>(() => loadLevel());
  const [band, setBand] = useState(loadBand);
  // In headphones you cannot hear the room: play the other parts here, locked to the beat.
  useEffect(() => (band && piece ? startOrchestra() : undefined), [band, piece]);
  const count = laneCount(level);

  const rootRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nowRef = useRef<HTMLDivElement>(null);
  const idleRef = useRef<HTMLParagraphElement>(null);
  const countRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const riseRef = useRef<HTMLDivElement>(null);
  const loopRef = useRef<HTMLDivElement>(null);
  const laneRef = useRef<{ key: string; lane: Lane } | null>(null);
  const coachRef = useRef<HTMLElement | null>(null);
  /** Lanes: the lane of every event in my part, null in single-lane play */
  const lanesRef = useRef<(number | null)[] | null>(null);
  /** Expert: which events are holds and flicks */
  const holdsRef = useRef<boolean[] | null>(null);
  const flicksRef = useRef<boolean[] | null>(null);
  const heldRef = useRef<Held | null>(null);
  const flickRef = useRef<PendingFlick | null>(null);
  /** The lane each finger came down on, so lifting it dims the right receptor */
  const fingersRef = useRef(new Map<number, number>());

  const resting = !!track && (snap?.mutedTracks.includes(track.id) ?? false);
  const meta = track ? instrumentMeta(track.instrument) : null;

  // Cursor and tally change on every tap: paint them straight into the DOM.
  useEffect(() => {
    const coached = () => readPref(COACHED_PREF) !== null;
    let lastCombo = 0;
    const paint = (st: AppState) => {
      const t = myTrack(st);
      const tally = st.tally;
      const streak = tally.combo >= 3 ? Object.assign(document.createElement('strong'), { textContent: `${tally.combo}×` }) : null;
      comboRef.current?.replaceChildren(
        ...(streak ? [streak] : []),
        ...(tally.notes ? [Object.assign(document.createElement('span'), { textContent: `${Math.round(tally.accuracy)}%` })] : []),
      );
      if (streak && tally.combo > lastCombo) comboPunch(streak);
      lastCombo = tally.combo;
      const rhythm = actions.rhythm();
      const key = t && rhythm && canvasRef.current ? `${st.piece?.id}/${t.id}/${st.snapshot?.startedAt}/${level}` : '';
      if (laneRef.current?.key !== key) {
        laneRef.current?.lane.destroy();
        laneRef.current = null;
        heldRef.current = null;
        if (key && t && rhythm && canvasRef.current) {
          // Resolve the instrument's colour token from the theme for the canvas.
          const theme = getComputedStyle(document.documentElement);
          const tint = theme.getPropertyValue(`--${t.instrument}`).trim() || '#ff7a1a';
          const accent = theme.getPropertyValue('--accent').trim() || '#b6f400';
          const perBar = st.piece?.beatsPerBar ?? 4;
          const lanes = count > 1 ? assignLanes(t.events, t.instrument, count) : null;
          const holds = noteTypes(level) ? holdNotes(t.events) : null;
          const flicks = noteTypes(level) ? flickNotes(t.events, perBar) : null;
          lanesRef.current = lanes;
          holdsRef.current = holds;
          flicksRef.current = flicks;
          const laptop = matchMedia('(hover: hover) and (pointer: fine)').matches;
          const lane = createLane(canvasRef.current, {
            events: t.events,
            instrument: t.instrument,
            grid: rhythm.grid,
            clock: rhythm.clock,
            tint,
            accent,
            beatsPerBar: perBar,
            lookahead: lookahead(level),
            ...(lanes && count !== 1 ? { lanes, laneCount: count, ...(laptop ? { keys: KEY_CAPS[count] } : {}) } : {}),
            ...(holds && flicks ? { holds, flicks } : {}),
          });
          laneRef.current = { key, lane };
        }
      }
      if (!t) {
        if (barRef.current) barRef.current.style.width = '0%';
        if (nowRef.current) nowRef.current.textContent = '';
        if (idleRef.current) idleRef.current.textContent = 'Pick an instrument in the lobby to join the next run.';
        return;
      }
      laneRef.current?.lane.setCursor(st.cursor);
      laneRef.current?.lane.setCombo(tally.combo);
      laneRef.current?.lane.setResting(st.snapshot?.mutedTracks.includes(t.id) ?? false);
      const [cur] = nextEvents(t.events, st.cursor, 1);
      if (barRef.current) barRef.current.style.width = `${progress(t.events, st.cursor) * 100}%`;
      if (nowRef.current) nowRef.current.textContent = cur ? hitName(t.instrument, cur.note.midi) : '';
      if (idleRef.current) idleRef.current.textContent = cur ? '' : 'You’ve played every note. Listen to the room finish!';
      surfaceRef.current?.classList.toggle(s.done ?? 'done', !cur);
      if (cur && !coached() && !coachRef.current && surfaceRef.current) {
        const coach = document.createElement('div');
        coach.className = s.coach ?? '';
        coach.setAttribute('role', 'status');
        const ringEl = document.createElement('span');
        ringEl.className = 'coach-ring';
        ringEl.setAttribute('aria-hidden', 'true');
        coach.append(ringEl, COACH[level]);
        surfaceRef.current.append(coach);
        coachIn(coach);
        coachRef.current = coach;
      }
    };
    paint(store.state);
    const off = store.subscribe(paint);
    const release = holdWakeLock();
    return () => {
      off();
      release();
      laneRef.current?.lane.destroy();
      laneRef.current = null;
      lanesRef.current = null;
      holdsRef.current = null;
      flicksRef.current = null;
      heldRef.current = null;
      if (coachRef.current) coachOut(coachRef.current);
      coachRef.current = null;
    };
  }, [level, count]);

  // Count-in: "Get ready", then 4 3 2 1 on the room's shared beat, on its own frame loop.
  useEffect(() => {
    let raf = 0;
    let last: string | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = actions.rhythm();
      const el = countRef.current;
      if (!el) return;
      const ms = r && r.clock.ready ? r.grid.timeOf(0) - r.clock.now() : 0;
      const beatMs = r ? 60_000 / r.grid.bpm : 1;
      // The note lane counts the last beats itself; before that (or with no lane) this overlay speaks.
      const label = !laneRef.current ? countdownLabel(ms, beatMs, COUNT_IN_BEATS) : ms / beatMs > COUNT_IN_BEATS + 0.5 ? 'Get ready' : null;
      if (label === last) return;
      last = label;
      el.hidden = label === null;
      el.textContent = label ?? '';
      if (label && label !== 'Get ready') beatThump(el);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  // Conductor cues arrive as live frames, never as React state; useGSAP reverts their tweens on unmount.
  useGSAP((_ctx, contextSafe) => {
    const safe = contextSafe ?? (<T,>(fn: T) => fn);
    const secondsUntil = (serverMs: number | null) => {
      const r = actions.rhythm();
      return serverMs === null || !r ? 1 : Math.max(0.2, (serverMs - r.clock.now()) / 1000);
    };
    const offs = [
      onLive(
        'tempo',
        safe(({ bpm }: { bpm: number }) => {
          if (cueRef.current) flashCue(cueRef.current, `${bpm} bpm`);
        }),
      ),
      onLive(
        'dynamics',
        safe((level: string) => {
          if (cueRef.current) flashCue(cueRef.current, level, 0.7);
        }),
      ),
      onLive(
        'dj',
        safe((e: DjEvent) => {
        if (cueRef.current) flashCue(cueRef.current, DJ_WORD[e.cue], 0.6);
        if (e.cue === 'drop' && darkRef.current) blackout(darkRef.current, secondsUntil(e.until));
        if (e.cue === 'build' && riseRef.current) rise(riseRef.current, secondsUntil(e.until));
        if (loopRef.current) {
          if (e.cue === 'loop_on') loopRef.current.hidden = false;
          if (e.cue === 'loop_off') loopRef.current.hidden = true;
        }
        }),
      ),
    ];
    return () => offs.forEach((off) => off());
  }, { scope: rootRef });

  // pointerdown, not click: fires on touch start so the note sounds at once,
  // and preventDefault stops double-tap zoom and ghost clicks.
  // `hit` is the lane a tap landed in; single-lane play leaves it out.
  const play = (hit?: number, source?: Source, lateMs = 0, flicked = false) => {
    if (coachRef.current) {
      coachOut(coachRef.current);
      coachRef.current = null;
      writePref(COACHED_PREF, '1');
    }
    const lanes = lanesRef.current;
    const flicks = flicksRef.current;
    const result = actions.tap(hit !== undefined && lanes ? { lanes, hit, lateMs, flicked, ...(flicks ? { flicks } : {}) } : undefined);
    if (result.resting) return;
    if (result.wrongLane) {
      laneRef.current?.lane.flash('miss', { lane: hit ?? 0, wrong: true });
      if (nowRef.current) missShake(nowRef.current);
      return;
    }
    if (!result.played) {
      if (nowRef.current) dud(nowRef.current);
      return;
    }
    laneRef.current?.lane.flash(result.judgement, result.lane !== null ? { lane: result.lane } : undefined);
    if (result.index !== null && result.judgement !== 'miss') laneRef.current?.lane.played(result.index);
    if (result.judgement === 'miss') {
      if (nowRef.current) missShake(nowRef.current);
      return;
    }
    if (nowRef.current && glowRef.current) noteHit(nowRef.current, glowRef.current);
    // Expert: a hold note keeps going until its tail ends; remember which finger or key holds it.
    const index = result.index;
    const rhythm = actions.rhythm();
    const t = myTrack(store.state);
    if (index !== null && source !== undefined && result.judgement && holdsRef.current?.[index] && rhythm && t) {
      const start = onsets(t.events)[index] ?? 0;
      const endMs = rhythm.grid.timeOf(start + (t.events[index]?.beats ?? 0));
      heldRef.current = { index, lane: result.lane ?? 0, source, hit: result.judgement, endMs, holdMs: endMs - rhythm.grid.timeOf(start) };
      laneRef.current?.lane.hold(index);
    }
  };
  const playRef = useRef(play);
  playRef.current = play;

  /** A finger or key lifted: if it held a hold note, judge how long it stayed down */
  const letGo = (source: Source) => {
    const held = heldRef.current;
    const rhythm = actions.rhythm();
    if (!held || held.source !== source) return;
    heldRef.current = null;
    if (!rhythm) return;
    const earlyMs = held.endMs - rhythm.clock.now();
    if (earlyMs <= HOLD_RELEASE_MS) return;
    actions.releaseHold(held.hit, earlyMs, held.holdMs);
    laneRef.current?.lane.letGo();
    laneRef.current?.lane.flash('miss', { lane: held.lane, text: 'Let go early' });
    if (nowRef.current) missShake(nowRef.current);
  };
  const letGoRef = useRef(letGo);
  letGoRef.current = letGo;

  /** Expert: is the next note a flick? */
  const nextIsFlick = (): boolean => {
    const st = store.state;
    const t = myTrack(st);
    return !!t && !!flicksRef.current?.[skipRests(t.events, st.cursor)];
  };
  /** Fire a finger's pending flick note, flicked or not */
  const settleFlick = (flicked: boolean) => {
    const f = flickRef.current;
    if (!f) return;
    clearTimeout(f.timer);
    flickRef.current = null;
    play(f.lane, f.pointerId, Math.max(0, performance.now() - f.at), flicked);
  };

  // Lanes: D F J K (or F/D and J/K for two lanes) play their lane; Shift with the key flicks.
  useEffect(() => {
    if (count === 1) return;
    const lit = new Map<string, number>();
    const onDown = (e: KeyboardEvent) => {
      const lane = keyLane(e.code, count);
      if (lane === null || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      lit.set(e.code, lane);
      laneRef.current?.lane.press(lane);
      playRef.current(lane, e.code, 0, e.shiftKey);
    };
    const onUp = (e: KeyboardEvent) => {
      const lane = lit.get(e.code);
      if (lane === undefined) return;
      lit.delete(e.code);
      laneRef.current?.lane.release(lane);
      letGoRef.current(e.code);
    };
    const onBlur = () => {
      for (const [code, lane] of lit) {
        laneRef.current?.lane.release(lane);
        letGoRef.current(code);
      }
      lit.clear();
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [count]);
  // Easy: Space and every play key play the one lane.
  useKeyPlay(() => play(), count === 1);

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      // Keep the lift on this surface even if the finger slides off it.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone: its pointerup still reaches us or never comes.
    }
    const box = e.currentTarget.getBoundingClientRect();
    const lane = laneAt(e.clientX, box.left, box.width, count);
    fingersRef.current.set(e.pointerId, lane);
    laneRef.current?.lane.press(lane);
    if (count === 1) {
      play();
      return;
    }
    // A second finger lands while one waits on a flick: settle that one as a plain tap first.
    settleFlick(false);
    if (noteTypes(level) && nextIsFlick()) {
      const at = performance.now();
      flickRef.current = { pointerId: e.pointerId, lane, x: e.clientX, y: e.clientY, at, timer: setTimeout(() => settleFlick(false), FLICK_MS) };
      return;
    }
    play(lane, e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLButtonElement>) => {
    const f = flickRef.current;
    if (f && f.pointerId === e.pointerId && isFlick(e.clientX - f.x, e.clientY - f.y, performance.now() - f.at)) settleFlick(true);
  };
  const onUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (flickRef.current?.pointerId === e.pointerId) settleFlick(false);
    const lane = fingersRef.current.get(e.pointerId);
    fingersRef.current.delete(e.pointerId);
    if (lane !== undefined) laneRef.current?.lane.release(lane);
    letGo(e.pointerId);
  };
  useEffect(
    () => () => {
      if (flickRef.current) clearTimeout(flickRef.current.timer);
      flickRef.current = null;
    },
    [],
  );
  const changeLevel = (e: ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    if (!isLevel(next)) return;
    saveLevel(next);
    setLevel(next);
  };

  return (
    <main ref={rootRef} className={cx(s.play, resting && s.resting)} style={meta ? ({ '--tint': meta.color } as CSSProperties) : undefined}>
      <div className={s.progress} aria-hidden="true">
        <div ref={barRef} className={s.fill} />
      </div>
      <header className={s.bar}>
        <div className={s.who}>
          {session ? <Avatar id={session.avatar} name={session.name} size="sm" /> : null}
          <span className={s.name}>{session?.name ?? ''}</span>
        </div>
        <div ref={comboRef} className={s.combo} aria-live="polite" />
        <div className={s.toggles}>
          <label className={s.level}>
            <span className={s.levelIcon}>
              <Icon name="sliders-horizontal" size={18} />
            </span>
            <select aria-label="Level" value={level} onChange={changeLevel}>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_NAME[l]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={s.assist}
            aria-pressed={band}
            aria-label="Hear the orchestra"
            title="Hear the orchestra in headphones"
            onClick={() => {
              setBand(!band);
              saveBand(!band);
            }}
          >
            <Icon name="headphones" size={18} />
          </button>
          <button type="button" className={s.assist} aria-pressed={assist} onClick={() => actions.setAssist(!assist)}>
            <Icon name="magic-wand" size={18} />
            Assist
          </button>
        </div>
      </header>
      <button ref={surfaceRef} type="button" className={s.surface} aria-label={resting ? 'Your section is resting' : SURFACE_LABEL[level]} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onContextMenu={(e) => e.preventDefault()}>
        <div ref={glowRef} className={s.glow} aria-hidden="true" />
        <div ref={riseRef} className={s.rise} aria-hidden="true" />
        <canvas ref={canvasRef} className={s.lane} aria-hidden="true" />
        <div ref={nowRef} className={s.now} aria-live="polite" />
        <p ref={idleRef} className={s.idle} />
        <div ref={darkRef} className={s.dark} aria-hidden="true" />
        <div ref={countRef} className={s.count} aria-live="assertive" hidden />
        <div ref={cueRef} className={s.cue} aria-live="polite" />
        <div ref={loopRef} className={s.loop} hidden>
          <Icon name="arrows-clockwise" size={16} />
          Loop
        </div>
        <ConductorCue />
      </button>
      {snap && piece ? <RoomView players={snap.players} piece={piece} me={playerId} /> : null}
    </main>
  );
}
