import { useGSAP } from '@gsap/react';
import { useEffect, useRef, type CSSProperties, type PointerEvent } from 'react';
import { coachIn, coachOut, dud, noteHit } from '../../lib/anim.js';
import { createLane, type Lane } from '../../lib/lane.js';
import { instrumentMeta, noteName } from '../../lib/music.js';
import { myTrack, nextEvents, progress, type AppState } from '../../lib/store.js';
import { readPref, writePref } from '../../ui/dom.js';
import { COUNT_IN_BEATS, actions, store } from '../../app/controller.js';
import { countdownLabel } from '../../app/cues.js';
import { onLive, type DjEvent } from '../../app/live.js';
import { useStore } from '../../app/useStore.js';
import { holdWakeLock } from '../../app/wakeLock.js';
import { Avatar } from '../../components/Avatar.js';
import { cx } from '../../components/Button.js';
import { Icon } from '../../components/Icon.js';
import { RoomView } from './RoomView.js';
import { beatThump, blackout, flashCue, rise } from './cueAnim.js';
import s from './Play.module.css';

const COACHED_PREF = 'kilukkam.coached';
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

  const resting = !!track && (snap?.mutedTracks.includes(track.id) ?? false);
  const meta = track ? instrumentMeta(track.instrument) : null;

  // Cursor and tally change on every tap: paint them straight into the DOM.
  useEffect(() => {
    const coached = () => readPref(COACHED_PREF) !== null;
    const paint = (st: AppState) => {
      const t = myTrack(st);
      const tally = st.tally;
      comboRef.current?.replaceChildren(
        ...(tally.combo >= 3 ? [Object.assign(document.createElement('strong'), { textContent: `${tally.combo}×` })] : []),
        ...(tally.notes ? [Object.assign(document.createElement('span'), { textContent: `${Math.round(tally.accuracy)}%` })] : []),
      );
      const rhythm = actions.rhythm();
      const key = t && rhythm && canvasRef.current ? `${st.piece?.id}/${t.id}/${st.snapshot?.startedAt}` : '';
      if (laneRef.current?.key !== key) {
        laneRef.current?.lane.destroy();
        laneRef.current = null;
        if (key && t && rhythm && canvasRef.current) {
          // Resolve the instrument's colour token from the theme for the canvas.
          const tint = getComputedStyle(document.documentElement).getPropertyValue(`--${t.instrument}`).trim() || '#ff5b1f';
          laneRef.current = { key, lane: createLane(canvasRef.current, { events: t.events, grid: rhythm.grid, clock: rhythm.clock, tint }) };
        }
      }
      if (!t) {
        if (barRef.current) barRef.current.style.width = '0%';
        if (nowRef.current) nowRef.current.textContent = '';
        if (idleRef.current) idleRef.current.textContent = 'Pick an instrument in the lobby to join the next run.';
        return;
      }
      laneRef.current?.lane.setCursor(st.cursor);
      const [cur] = nextEvents(t.events, st.cursor, 1);
      if (barRef.current) barRef.current.style.width = `${progress(t.events, st.cursor) * 100}%`;
      if (nowRef.current) nowRef.current.textContent = cur ? noteName(cur.note.midi) : '';
      if (idleRef.current) idleRef.current.textContent = cur ? '' : 'You’ve played every note. Listen to the room finish!';
      surfaceRef.current?.classList.toggle(s.done ?? 'done', !cur);
      if (cur && !coached() && !coachRef.current && surfaceRef.current) {
        const coach = document.createElement('div');
        coach.className = s.coach ?? '';
        coach.setAttribute('role', 'status');
        const ringEl = document.createElement('span');
        ringEl.className = 'coach-ring';
        ringEl.setAttribute('aria-hidden', 'true');
        coach.append(ringEl, 'Tap when your note reaches the line');
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
      if (coachRef.current) coachOut(coachRef.current);
      coachRef.current = null;
    };
  }, []);

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
  const onDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (coachRef.current) {
      coachOut(coachRef.current);
      coachRef.current = null;
      writePref(COACHED_PREF, '1');
    }
    const result = actions.tap();
    if (result.resting) return;
    if (!result.played) {
      if (nowRef.current) dud(nowRef.current);
      return;
    }
    if (nowRef.current && glowRef.current) noteHit(nowRef.current, glowRef.current);
    if (result.judgement) laneRef.current?.lane.flash(result.judgement);
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
        <button type="button" className={s.assist} aria-pressed={assist} onClick={() => actions.setAssist(!assist)}>
          <Icon name="magic-wand" size={18} />
          Assist
        </button>
      </header>
      <button ref={surfaceRef} type="button" className={s.surface} aria-label={resting ? 'Your section is resting' : 'Play your next note'} onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
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
