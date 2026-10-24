import type { Tally } from '../../lib/rhythm.js';

// The result card a player can post: a 1080 by 1350 image drawn on a canvas
// (portrait, the size feeds and stories crop well), shared as a file where
// the phone allows it and downloaded everywhere else.

export interface CardData {
  name: string;
  piece: string;
  instrument: string;
  grade: string;
  tally: Tally;
  roomNotes: number | null;
  color: string;
}

const W = 1080;
const H = 1350;

export async function drawCard(d: CardData): Promise<Blob | null> {
  await document.fonts.ready;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  const lime = '#b6f400';
  g.fillStyle = '#0a0a0a';
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W * 0.75, H * 0.2, 0, W * 0.75, H * 0.2, W * 0.9);
  glow.addColorStop(0, `${d.color}cc`);
  glow.addColorStop(1, 'transparent');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);

  g.fillStyle = '#ffffff';
  g.font = '800 54px "Inter Variable", sans-serif';
  g.fillText('Kilukkam', 80, 130);
  const en = g.measureText('Kilukkam ').width;
  g.font = '400 58px "RIT Ala", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.fillText('കിലുക്കം', 80 + en, 130);

  g.fillStyle = lime;
  g.beginPath();
  g.arc(W / 2, 470, 210, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#0a0a0a';
  g.font = '900 260px "Inter Variable", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(d.grade, W / 2, 485);
  g.textBaseline = 'alphabetic';

  g.fillStyle = '#ffffff';
  g.font = '800 76px "Inter Variable", sans-serif';
  g.fillText(d.name, W / 2, 790);
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '600 40px "Inter Variable", sans-serif';
  g.fillText(`${d.instrument} · ${d.piece}`, W / 2, 850);

  const stats: [string, string][] = [
    [`${Math.round(d.tally.accuracy)}%`, 'on the beat'],
    [`${d.tally.bestCombo}×`, 'best combo'],
    [`${d.tally.perfect}`, 'perfect'],
  ];
  stats.forEach(([v, l], i) => {
    const x = 80 + i * 320;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(x, 930, 280, 190, 36);
    g.fill();
    g.fillStyle = i === 0 ? lime : '#ffffff';
    g.font = '900 84px "Inter Variable", sans-serif';
    g.fillText(v, x + 140, 1035);
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.font = '600 32px "Inter Variable", sans-serif';
    g.fillText(l, x + 140, 1085);
  });

  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '600 36px "Inter Variable", sans-serif';
  g.fillText(d.roomNotes ? `The room played ${d.roomNotes.toLocaleString()} notes together` : 'A room full of phones became an orchestra', W / 2, 1210);
  g.fillStyle = lime;
  g.font = '800 34px "Inter Variable", sans-serif';
  g.fillText('Play yours: one conductor, one code, every phone', W / 2, 1270);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

/** Share the card as an image where the phone can, otherwise download it. */
export async function shareCard(d: CardData): Promise<'shared' | 'downloaded' | 'failed'> {
  const blob = await drawCard(d);
  if (!blob) return 'failed';
  const file = new File([blob], 'kilukkam-result.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'My Kilukkam result', text: `I played ${d.instrument} in ${d.piece} on Kilukkam.` });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
