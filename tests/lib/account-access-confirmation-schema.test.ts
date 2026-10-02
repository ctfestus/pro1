import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('account access confirmation schema', () => {
  it('adds and backfills the durable confirmation marker', () => {
    const migration = read('migrations/218_access_state_confirmation.sql');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS access_state_confirmed text');
    expect(migration).toContain('SET access_state_confirmed = access_state');
    expect(migration).toContain("ALTER COLUMN access_state_confirmed SET DEFAULT 'pending'");
  });

  it('keeps the fresh schema in sync', () => {
    const schema = read('festman-fresh-schema.sql');
    expect(schema).toContain("access_state_confirmed text    NOT NULL DEFAULT 'pending'");
    expect(schema).toContain("CHECK (access_state_confirmed IN ('pending','active','denied'))");
  });
});
