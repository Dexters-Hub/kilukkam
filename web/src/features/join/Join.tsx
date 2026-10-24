import { CODE_LEN, MAX_NAME_LEN } from '@kilukkam/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { COMPOSERS, pickComposer } from '../../data/composers.js';
import { isCompleteCode, normalizeCode, normalizeName } from '../../lib/store.js';
import { readPref, writePref } from '../../ui/dom.js';
import { actions, store } from '../../app/controller.js';
import { useStore } from '../../app/useStore.js';
import { Avatar } from '../../components/Avatar.js';
import { Button, cx } from '../../components/Button.js';
import { Hint, Label, Notice, Screen, Title, TopBar } from '../../components/Screen.js';
import s from './Join.module.css';

const AVATAR_PREF = 'kilukkam.avatar';
const NAME_PREF = 'kilukkam.name';

export function Join() {
  const notice = useStore((st) => st.notice);
  const busy = useStore((st) => st.intent?.kind === 'join');
  const [code, setCode] = useState(() => normalizeCode(store.state.joinCode));
  const [name, setName] = useState(() => readPref(NAME_PREF) ?? '');
  const [chosen, setChosen] = useState(() => pickComposer(readPref(AVATAR_PREF)).id);
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const valid = isCompleteCode(code) && normalizeName(name).length > 0;

  useEffect(() => {
    (code ? nameRef : codeRef).current?.focus();
    // Focus once, on arrival: later edits keep the caret where the player put it.
  }, []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    const n = normalizeName(name);
    writePref(NAME_PREF, n);
    writePref(AVATAR_PREF, chosen);
    actions.joinRoom(code, n, chosen);
  };

  return (
    <Screen>
      <TopBar onBack={actions.goHome} />
      <Title>Join a room</Title>
      <Hint>Three things: the code, your name, a composer. Then you pick an instrument.</Hint>
      <Notice text={notice} />
      <form className={cx(s.form, 'stack')} onSubmit={submit}>
        <Label htmlFor="code">Room code</Label>
        <input
          ref={codeRef}
          className={s.code}
          id="code"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={CODE_LEN + 2}
          placeholder="ABCD"
          aria-describedby="code-hint"
          value={code}
          onChange={(e) => {
            const n = normalizeCode(e.target.value);
            setCode(n);
            if (n.length === CODE_LEN && !name) nameRef.current?.focus();
          }}
        />
        <Hint id="code-hint">It’s on the conductor’s screen: 4 letters, big and orange.</Hint>
        <Label htmlFor="name">Your name</Label>
        <input
          ref={nameRef}
          className={s.field}
          id="name"
          autoComplete="nickname"
          enterKeyHint="go"
          maxLength={MAX_NAME_LEN}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Label id="lineup-label">Pick your composer</Label>
        <div className={s.lineup} role="radiogroup" aria-labelledby="lineup-label">
          {COMPOSERS.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={c.id === chosen} aria-label={c.fullName} className={cx(s.pick, c.id === chosen && s.on)} onClick={() => setChosen(c.id)}>
              <Avatar id={c.id} size="lg" />
              <span className={s.pickName} aria-hidden="true">
                {c.displayName}
              </span>
            </button>
          ))}
        </div>
        <Button type="submit" variant="primary" wide disabled={busy || !valid}>
          {busy ? 'Joining…' : 'Join the ensemble'}
        </Button>
      </form>
    </Screen>
  );
}
