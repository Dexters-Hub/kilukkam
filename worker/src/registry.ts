import { DurableObject } from 'cloudflare:workers';
import { CODE_ALPHABET, CODE_LEN } from '@kilukkam/shared';
import type { Env } from './env.js';

const MAX_CODE_ATTEMPTS = 100;

/** Single instance: reserves room codes so no two live rooms share one. */
export class Registry extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, at INTEGER NOT NULL)');
  }

  /** A free code, now taken; null if none turned up (practically never: 31^4 codes). */
  async reserve(): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const code = randomCode();
      const { rowsWritten } = this.sql.exec('INSERT OR IGNORE INTO codes (code, at) VALUES (?, ?)', code, Date.now());
      if (rowsWritten > 0) return code;
    }
    return null;
  }

  async release(code: string): Promise<void> {
    this.sql.exec('DELETE FROM codes WHERE code = ?', code);
  }
}

function randomCode(): string {
  let code = '';
  for (const n of crypto.getRandomValues(new Uint32Array(CODE_LEN))) code += CODE_ALPHABET[n % CODE_ALPHABET.length];
  return code;
}
