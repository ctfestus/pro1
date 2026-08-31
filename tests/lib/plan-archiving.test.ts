// Archiving a subscription plan.
//
// A plan carrying any history cannot be deleted -- that would orphan the record of what people
// paid and what they got -- so archiving is the only way the plan list ever gets shorter. The
// properties worth pinning are the ones where a mistake loses money or hides something.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const route = read('app/api/payments/route.ts');
const db = read('lib/db-subscriptions.ts');
const picker = read('components/PlanAccessPicker.tsx');
const migration = read('migrations/198_archive_subscription_plans.sql');
const schema = read('festman-fresh-schema.sql');

describe('archiving a plan', () => {
  it('refuses to archive a plan that is still on sale', () => {
    // Archiving an active plan would take it off the pricing page as a side effect of tidying a
    // list, which is not what tidying a list means.
    expect(route).toMatch(/archiving && plan\.status === 'active'/);
    expect(route).toMatch(/archiving && plan\.status === 'active'[\s\S]{0,400}status: 409/);
  });

  it('does not switch a plan back on when it is restored', () => {
    // Restoring returns it to the list. Putting it back on sale is a separate decision, and one
    // nobody would expect a "restore" button to make for them.
    const handler = route.slice(route.indexOf("'set-subscription-plan-archived'"));
    const body = handler.slice(0, handler.indexOf('if (body.action', 10));
    expect(body).toContain('archived_at');
    expect(body).not.toMatch(/status:\s*'active'/);
  });

  it('hides archived plans by default, and only on request shows them', () => {
    expect(db).toContain('includeArchived');
    expect(db).toMatch(/!includeArchived[\s\S]{0,120}is\('archived_at', null\)/);
  });

  it('never hides an attachment just because the plan is archived', () => {
    // An archived plan is not offered, but one that still holds this content is shown ticked.
    // Hiding it is how content ends up somewhere nobody can see and nobody remembers.
    expect(picker).toMatch(/plans\.filter\(plan => !plan\.archived_at \|\| attached\.includes\(plan\.id\)\)/);
    expect(picker).toContain('includeArchived=true');
  });

  it('adds the column without rewriting existing rows', () => {
    // Every existing plan stays exactly as it is: null means not archived.
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS archived_at timestamptz');
    expect(migration).not.toMatch(/\bUPDATE\b|\bDROP\b/);
  });

  it('is mirrored into the fresh schema, so a new database matches a migrated one', () => {
    expect(schema).toContain('archived_at timestamptz');
    expect(schema).toContain('idx_subscription_plans_not_archived');
  });
});
