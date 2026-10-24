import { here, joinLink, prettyLink } from '../lib/share.js';
import { Qr } from './Qr.js';
import s from './CodeBlock.module.css';

/** The room code, big. The conductor's copy adds the join QR and link so phones can scan in. */
export function CodeBlock({ code, conductor }: { code: string; conductor: boolean }) {
  const link = conductor ? joinLink(code, here()) : '';
  return (
    <section className={s.block}>
      <span className={s.label}>{conductor ? 'Room code' : 'You are in room'}</span>
      <div className={s.code} aria-label={`Room code ${[...code].join(' ')}`}>
        {code}
      </div>
      {conductor ? (
        <>
          <div className={s.qr}>
            <Qr text={link} label={`QR code to join room ${code}`} />
          </div>
          <p className={s.link}>{prettyLink(link)}</p>
        </>
      ) : null}
    </section>
  );
}
