import { useEffect, useRef, useState } from 'react';
import { audioNow, playBuffer, renderTake } from '../../lib/audio.js';
import { defaultMix, encodeMidi, encodeWav, fillGaps, takeFileName, takeLength, takeNotes } from '../../lib/recording.js';
import { Icon } from '../../components/Icon.js';
import { toast } from '../../components/Toast.js';
import { lastTake } from '../stage/take.js';
import s from './Replay.module.css';

// The conductor's replay: the room's performance, rendered through the same
// instruments, drawn as a waveform you can play, scrub, download as WAV or
// MIDI, and share. Only the conductor keeps a take (it hears every note).
// "As played" is exactly what the room tapped; "Polished" fills the notes it
// missed from the score, on the room's own timing, so the piece sounds whole.

const BARS = 120;
type Mode = 'polished' | 'played';
/** Silence kept before the first note */
const LEAD_IN = 0.3;

type Ready = { buffer: AudioBuffer; peaks: number[]; wav: () => ArrayBuffer; midi: () => Uint8Array; name: (ext: string) => string; title: string };

const peaksOf = (buffer: AudioBuffer): number[] => {
  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / BARS));
  const peaks: number[] = [];
  for (let b = 0; b < BARS; b++) {
    let max = 0;
    for (let i = b * step; i < Math.min(data.length, (b + 1) * step); i += 16) max = Math.max(max, Math.abs(data[i] ?? 0));
    peaks.push(max);
  }
  const top = Math.max(0.0001, ...peaks);
  return peaks.map((p) => p / top);
};

const clock = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

const download = (data: BlobPart, type: string, name: string): void => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

export function Replay() {
  const [ready, setReady] = useState<Ready | null>(null);
  const [state, setState] = useState<'rendering' | 'ready' | 'none' | 'failed'>('rendering');
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<Mode>('polished');
  /** Bumped to redraw the paused playhead after a seek */
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const play = useRef<{ stop: () => void; startedAt: number; offset: number } | null>(null);
  const position = useRef(0);

  useEffect(() => {
    const got = lastTake();
    if (!got) {
      setState('none');
      return;
    }
    const { piece, take } = got;
    let live = true;
    play.current?.stop();
    play.current = null;
    position.current = 0;
    setPlaying(false);
    setState('rendering');
    // One note per slot already (the take keeps each once), so every note plays at full part level.
    const played = takeNotes(piece, take, defaultMix(piece)).map((n) => ({ ...n, level: 1 }));
    const notes = (mode === 'polished' ? [...played, ...fillGaps(piece, take, piece.bpm)] : played).sort((a, b) => a.t - b.t);
    const first = notes[0]?.t ?? 0;
    const shifted = notes.map((n) => ({ ...n, t: Math.max(0, n.t - first + LEAD_IN) }));
    const when = new Date();
    void renderTake(shifted, takeLength(shifted, piece.bpm), piece.bpm).then(
      (buffer) => {
        if (!live) return;
        if (!buffer) return setState('failed');
        const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
        setReady({
          buffer,
          peaks: peaksOf(buffer),
          wav: () => encodeWav(channels, buffer.sampleRate),
          midi: () => encodeMidi(piece, shifted),
          name: (ext) => takeFileName(piece.id, when, ext),
          title: `${piece.title}, played by the room on Kilukkam`,
        });
        setState('ready');
      },
      () => live && setState('failed'),
    );
    return () => {
      live = false;
      play.current?.stop();
    };
  }, [mode]);

  // Waveform and playhead, redrawn every frame while playing.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const draw = () => {
      const c = canvasRef.current;
      const g = c?.getContext('2d');
      if (c && g) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth;
        const h = c.clientHeight;
        if (c.width !== Math.round(w * dpr)) {
          c.width = Math.round(w * dpr);
          c.height = Math.round(h * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        const css = getComputedStyle(c);
        const on = css.getPropertyValue('--wave-on').trim() || '#b6f400';
        const off = css.getPropertyValue('--wave-off').trim() || '#d6d6d0';
        const p = play.current;
        const at = p ? Math.min(ready.buffer.duration, p.offset + audioNow() - p.startedAt) : position.current;
        const done = at / ready.buffer.duration;
        const bw = w / BARS;
        ready.peaks.forEach((v, i) => {
          const bh = Math.max(3, v * (h - 6));
          g.fillStyle = i / BARS <= done ? on : off;
          g.beginPath();
          g.roundRect(i * bw + bw * 0.18, (h - bh) / 2, bw * 0.64, bh, bw * 0.32);
          g.fill();
        });
        if (timeRef.current) timeRef.current.textContent = `${clock(at)} / ${clock(ready.buffer.duration)}`;
      }
      if (play.current) raf = requestAnimationFrame(draw);
    };
    draw();
    if (playing) raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [ready, playing, frame]);

  if (state === 'none') return null;

  const startAt = (buffer: AudioBuffer, offset: number) => {
    const stop = playBuffer(buffer, offset, () => {
      play.current = null;
      position.current = 0;
      setPlaying(false);
    });
    play.current = { stop, startedAt: audioNow(), offset };
    setPlaying(true);
  };

  const toggle = () => {
    if (!ready) return;
    const p = play.current;
    if (p) {
      position.current = Math.min(ready.buffer.duration, p.offset + audioNow() - p.startedAt);
      p.stop();
      play.current = null;
      setPlaying(false);
      return;
    }
    startAt(ready.buffer, position.current >= ready.buffer.duration - 0.05 ? 0 : position.current);
  };

  /** Tap the waveform to jump there. */
  const seek = (clientX: number) => {
    const c = canvasRef.current;
    if (!ready || !c) return;
    const r = c.getBoundingClientRect();
    position.current = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * ready.buffer.duration;
    if (play.current) {
      play.current.stop();
      startAt(ready.buffer, position.current);
    } else setFrame((n) => n + 1);
  };

  const share = async () => {
    if (!ready) return;
    const file = new File([ready.wav()], ready.name('wav'), { type: 'audio/wav' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: ready.title });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    download(file, 'audio/wav', file.name);
    toast('Recording saved');
  };

  return (
    <section className={s.card} aria-label="Replay the room">
      <div className={s.head}>
        <span className={s.kicker}>Replay the room</span>
        <span className={s.modes} role="radiogroup" aria-label="Replay">
          {(['polished', 'played'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={s.mode} onClick={() => setMode(m)}>
              {m === 'polished' ? 'Polished' : 'As played'}
            </button>
          ))}
        </span>
        <span ref={timeRef} className={s.time} aria-live="off">
          {state === 'rendering' ? 'Mixing the performance…' : ''}
        </span>
      </div>
      <div className={s.player}>
        <button type="button" className={s.play} onClick={toggle} disabled={!ready} aria-label={playing ? 'Pause the replay' : 'Play the replay'}>
          <Icon name={playing ? 'stop' : 'play'} size={24} />
        </button>
        <canvas
          ref={canvasRef}
          className={s.wave}
          role="img"
          aria-label="Waveform of the room's performance"
          onPointerDown={(e) => seek(e.clientX)}
        />
      </div>
      {state === 'failed' ? <p className={s.note}>This browser cannot mix the recording.</p> : null}
      <div className={s.actions}>
        <button type="button" className={s.action} disabled={!ready} onClick={() => ready && download(ready.wav(), 'audio/wav', ready.name('wav'))}>
          <Icon name="download-simple" size={18} />
          WAV
        </button>
        <button type="button" className={s.action} disabled={!ready} onClick={() => ready && download(ready.midi().slice().buffer, 'audio/midi', ready.name('mid'))}>
          <Icon name="music-notes" size={18} />
          MIDI
        </button>
        <button type="button" className={s.action} disabled={!ready} onClick={() => void share()}>
          <Icon name="share-network" size={18} />
          Share
        </button>
      </div>
    </section>
  );
}
