import { useGSAP } from '@gsap/react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { coachIn, coachOut, comboPunch, dud, missShake, noteHit } from '../../lib/anim.js';
import { createLane, type Lane, type LaneSide } from '../../lib/lane.js';
import { hitName, instrumentMeta } from '../../lib/music.js';
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
import { RoomView } from './RoomView.js';
import { createHands, keyHand, sideOf, type Hand } from './hands.js';
import { assignLanes } from './lanes.js';
import { beatThump, blackout, flashCue, rise } from './cueAnim.js';
import s from './Play.module.css';

const COACHED_PREF = 'kilukkam.coached';
const TWO_HANDS_PREF = 'kilukkam.twoHands';
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
const DJ_WORD = { drop: 'Drop', build: 'Build', loop_on: 'Loop', loop_off: 'Back in' } as const;

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
  // Two hands is on unless this player switched it off; readPref and writePref swallow storage errors.
  const [twoHands, setTwoHands] = useState(() => readPref(TWO_HANDS_PREF) !== '0');

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
  /** Two hands: the lane of every event in my part, null in single-lane play */
  const sidesRef = useRef<(LaneSide | null)[] | null>(null);

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
      const key = t && rhythm && canvasRef.current ? `${st.piece?.id}/${t.id}/${st.snapshot?.startedAt}/${twoHands}` : '';
      if (laneRef.current?.key !== key) {
        laneRef.current?.lane.destroy();
        laneRef.current = null;
        if (key && t && rhythm && canvasRef.current) {
          // Resolve the instrument's colour token from the theme for the canvas.
          const theme = getComputedStyle(document.documentElement);
          const tint = theme.getPropertyValue(`--${t.instrument}`).trim() || '#ff7a1a';
          const accent = theme.getPropertyValue('--accent').trim() || '#b6f400';
          const sides = twoHands ? assignLanes(t.events, t.instrument) : null;
          sidesRef.current = sides;
          const lane = createLane(canvasRef.current, {
            events: t.events,
            instrument: t.instrument,
            grid: rhythm.grid,
            clock: rhythm.clock,
            tint,
            accent,
            beatsPerBar: st.piece?.beatsPerBar ?? 4,
            ...(sides ? { sides, keys: matchMedia('(hover: hover) and (pointer: fine)').matches } : {}),
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
        coach.append(ringEl, twoHands ? 'Tap its side when your note reaches the ring' : 'Tap when your note reaches the ring');
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
      sidesRef.current = null;
      if (coachRef.current) coachOut(coachRef.current);
      coachRef.current = null;
    };
  }, [twoHands]);

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
  // `hit` is the lane a two-hands tap landed in; single-lane play leaves it out.
  const play = (hit?: LaneSide, lateMs = 0) => {
    if (coachRef.current) {
      coachOut(coachRef.current);
      coachRef.current = null;
      writePref(COACHED_PREF, '1');
    }
    const sides = sidesRef.current;
    const result = actions.tap(hit && sides ? { sides, hit, lateMs } : undefined);
    if (result.resting) return;
    if (result.wrongSide) {
      laneRef.current?.lane.flash('miss', { lane: hit ?? 'both', wrong: true });
      if (nowRef.current) missShake(nowRef.current);
      return;
    }
    if (!result.played) {
      if (nowRef.current) dud(nowRef.current);
      return;
    }
    laneRef.current?.lane.flash(result.judgement, result.lane ? { lane: result.lane } : undefined);
    if (result.judgement === 'miss') {
      if (nowRef.current) missShake(nowRef.current);
      return;
    }
    if (nowRef.current && glowRef.current) noteHit(nowRef.current, glowRef.current);
  };
  const playRef = useRef(play);
  playRef.current = play;

  // Two hands: pair presses into hits (a chord waits up to 60 ms for the second hand), and play F/D and J/K.
  const handsRef = useRef<ReturnType<typeof createHands> | null>(null);
  useEffect(() => {
    if (!twoHands) return;
    const want = (): LaneSide | null => {
      const st = store.state;
      const t = myTrack(st);
      return t ? (sidesRef.current?.[skipRests(t.events, st.cursor)] ?? null) : null;
    };
    const hands = createHands(want, (hit, lateMs) => playRef.current(hit, lateMs));
    handsRef.current = hands;
    const onKey = (e: KeyboardEvent) => {
      const hand = keyHand(e.code);
      if (!hand || e.repeat || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      hands.press(hand, performance.now());
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      hands.cancel();
      handsRef.current = null;
    };
  }, [twoHands]);
  // Space and every play key still work as one lane when two hands is off.
  useKeyPlay(() => play(), !twoHands);

  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const hands = handsRef.current;
    if (!hands) {
      play();
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const hand: Hand = sideOf(e.clientX, box.left, box.width);
    hands.press(hand, performance.now());
  };
  const toggleHands = () => {
    writePref(TWO_HANDS_PREF, twoHands ? '0' : '1');
    setTwoHands(!twoHands);
  };

  return (
    <main ref={rootRef} className={cx(s.play, resting && s.resting)} style={meta ? ({ '--tint': meta.color } as CSSProperties) : undefined}>
      <div className={s.progress} aria-hidden="true">
        <div ref={barRef} className={s.fill} />
      </div>
      <header className={s.bar}>
        <div className={s.who}>
          {session ? <Avatar id={session.avatar} name={session.name} size="sm" /> : null}
          <span>{session?.name ?? ''}</span>
        </div>
        <div ref={comboRef} className={s.combo} aria-live="polite" />
        <div className={s.toggles}>
          <button type="button" className={s.assist} aria-pressed={twoHands} onClick={toggleHands}>
            <Icon name="hand-tap" size={18} />
            Two hands
          </button>
          <button type="button" className={s.assist} aria-pressed={assist} onClick={() => actions.setAssist(!assist)}>
            <Icon name="magic-wand" size={18} />
            Assist
          </button>
        </div>
      </header>
      <button ref={surfaceRef} type="button" className={s.surface} aria-label={resting ? 'Your section is resting' : twoHands ? 'Play your next note: left half for the left lane, right half for the right' : 'Play your next note'} onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
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
        {resting ? (
          <div className={s.rest} role="status">
            <Icon name="speaker-slash" size={30} />
            <strong>Your section is resting</strong>
            <span>Wait for the conductor to bring you back in.</span>
          </div>
        ) : null}
      </button>
      {snap && piece ? <RoomView players={snap.players} piece={piece} me={playerId} /> : null}
    </main>
  );
}
