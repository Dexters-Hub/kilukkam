import { here, joinLink, prettyLink } from '../lib/share.js';
import { Button } from './Button.js';
import { Icon } from './Icon.js';
import { Qr } from './Qr.js';
import { toast } from './Toast.js';
import s from './CodeBlock.module.css';

/** Plain-http LAN pages have no async clipboard, so fall back to a hidden field and the copy command. */
const legacyCopy = (text: string): boolean => {
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const ok = document.execCommand('copy');
  field.remove();
  return ok;
};

const copy = async (link: string) => {
  try {
    if (navigator.clipboard) await navigator.clipboard.writeText(link);
    else if (!legacyCopy(link)) throw new Error('copy refused');
    toast('Join link copied');
  } catch {
    toast('Could not copy. Press and hold the link to copy it.', 'error');
  }
};

/** Phones get the system share sheet (WhatsApp, Messages...); elsewhere the link is copied. */
const share = async (code: string, link: string) => {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Join my Kilukkam room', text: `Join room ${code} and play with us:`, url: link });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  await copy(link);
};

/** The room code, big, with a link anyone in the room can share. The conductor's copy adds the join QR. */
export function CodeBlock({ code, conductor }: { code: string; conductor: boolean }) {
  const link = joinLink(code, here());
  return (
    <section className={s.block}>
      <span className={s.label}>{conductor ? 'Room code' : 'You are in room'}</span>
      <div className={s.code} aria-label={`Room code ${[...code].join(' ')}`}>
        {code}
      </div>
      {conductor ? (
        <div className={s.qr}>
          <Qr text={link} label={`QR code to join room ${code}`} />
        </div>
      ) : null}
      <p className={s.link}>{prettyLink(link)}</p>
      <div className={s.actions}>
        <Button variant="dark" onClick={() => void share(code, link)}>
          <Icon name="share-network" size={18} />
          {conductor ? 'Share invite' : 'Invite friends'}
        </Button>
        <Button variant="ghost" className={s.copy} onClick={() => void copy(link)}>
          <Icon name="copy" size={18} />
          Copy link
        </Button>
      </div>
    </section>
  );
}
