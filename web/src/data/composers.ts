// The avatar roster: a festival lineup of composers. Pure data, no DOM,
// so it can be unit tested. The id is what join_room sends as `avatar`.

/** One tint per era; the avatar disc builds its gradient from it. */
export const ERA_COLORS = {
  baroque: '#b8862b',
  classical: '#3f6fb5',
  romantic: '#8c3f8f',
  impressionist: '#2a9488',
  contemporary: '#d9465f',
} as const;

export interface Composer {
  id: string;
  /** Billing name, as on a festival poster */
  displayName: string;
  fullName: string;
  /** 1 or 2 letters set in serif on the disc */
  monogram: string;
  eraColor: string;
}

export const COMPOSERS = [
  { id: 'bach', displayName: 'Bach', fullName: 'Johann Sebastian Bach', monogram: 'B', eraColor: ERA_COLORS.baroque },
  { id: 'vivaldi', displayName: 'Vivaldi', fullName: 'Antonio Vivaldi', monogram: 'V', eraColor: ERA_COLORS.baroque },
  { id: 'haydn', displayName: 'Haydn', fullName: 'Joseph Haydn', monogram: 'H', eraColor: ERA_COLORS.classical },
  { id: 'mozart', displayName: 'Mozart', fullName: 'Wolfgang Amadeus Mozart', monogram: 'M', eraColor: ERA_COLORS.classical },
  { id: 'beethoven', displayName: 'Beethoven', fullName: 'Ludwig van Beethoven', monogram: 'Be', eraColor: ERA_COLORS.classical },
  { id: 'schubert', displayName: 'Schubert', fullName: 'Franz Schubert', monogram: 'S', eraColor: ERA_COLORS.romantic },
  { id: 'chopin', displayName: 'Chopin', fullName: 'Frédéric Chopin', monogram: 'C', eraColor: ERA_COLORS.romantic },
  { id: 'schumann-c', displayName: 'Clara Schumann', fullName: 'Clara Schumann', monogram: 'CS', eraColor: ERA_COLORS.romantic },
  { id: 'brahms', displayName: 'Brahms', fullName: 'Johannes Brahms', monogram: 'Br', eraColor: ERA_COLORS.romantic },
  { id: 'tchaikovsky', displayName: 'Tchaikovsky', fullName: 'Pyotr Ilyich Tchaikovsky', monogram: 'T', eraColor: ERA_COLORS.romantic },
  { id: 'debussy', displayName: 'Debussy', fullName: 'Claude Debussy', monogram: 'D', eraColor: ERA_COLORS.impressionist },
  { id: 'rahman', displayName: 'A.R. Rahman', fullName: 'A.R. Rahman', monogram: 'AR', eraColor: ERA_COLORS.contemporary },
] as const satisfies readonly Composer[];

/** The conductor's existing identity, as the server assigns it; never a composer. */
export const CONDUCTOR_AVATAR = '🎼';

const BY_ID: ReadonlyMap<string, Composer> = new Map(COMPOSERS.map((c) => [c.id, c]));

export const composerFor = (id: string): Composer | undefined => BY_ID.get(id);

/** Square portrait served from public/composers (credits in CREDITS.md there). */
export const portraitUrl = (composer: Composer): string => `/composers/${composer.id}.jpg`;

/** A stored or random choice, always a valid roster id. */
export const pickComposer = (preferred: string | null, rand: () => number = Math.random): Composer =>
  (preferred === null ? undefined : composerFor(preferred)) ??
  COMPOSERS[Math.floor(rand() * COMPOSERS.length)] ??
  COMPOSERS[0];
