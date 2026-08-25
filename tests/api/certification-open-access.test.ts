import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Before migration 174 an empty cohort_ids meant "everyone" for certifications, so removing
// the last cohort tag published a certification platform-wide. Subscription work reaches that
// state routinely: remove the certification from its final plan, or delete the plan, and
// toggle_content_cohort_tag untags it. The rule is now explicit, and these pin it at the two
// places that decide access plus the two that persist the flag -- a regression in any one of
// them re-opens the hole silently, because nothing about it is visible in the UI.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

describe('certification open access is explicit', () => {
  const accessRoute = read('app/api/certification-attempt/route.ts');
  const writeRoute = read('app/api/certifications/route.ts');
  const migration = read('migrations/174_available_to_everyone.sql');
  const schema = read('festman-fresh-schema.sql');

  it('never grants access from an empty cohort list', () => {
    // The single-certification gate and the listing filter must both key off the flag.
    expect(accessRoute).toContain('const cohortAllowed = (cert as any).available_to_everyone === true');
    expect(accessRoute).toContain('return r.available_to_everyone === true || (cohortId && cids.includes(cohortId))');
    // The superseded rule must be gone from both, or an untagged certification is open again.
    expect(accessRoute).not.toMatch(/cohortIds\.length === 0 \|\|/);
    expect(accessRoute).not.toMatch(/cids\.length === 0 \|\|/);
  });

  it('selects the flag everywhere it reads cohort_ids', () => {
    // A select that omits the column makes available_to_everyone undefined, which reads as
    // "not open" and would lock out a genuinely open certification.
    const selects = accessRoute.match(/'id, user_id, status, cohort_ids[^']*'/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) expect(select).toContain('available_to_everyone');
  });

  it('does not leak the access columns to the client', () => {
    expect(accessRoute).toContain('({ cohort_ids, available_to_everyone, ...m }: any) => m');
  });

  it('persists the flag on create and update', () => {
    expect(writeRoute).toContain('available_to_everyone: available_to_everyone === true');
    expect(writeRoute).toContain('const submittedCohorts = Array.isArray(cohort_ids) && cohort_ids.length > 0');
    expect(writeRoute).toContain('available_to_everyone: effectiveAvailableToEveryone');
    expect(writeRoute).toContain('const next = payload.cohort_ids ?? []');
  });

  it('backfills only certifications, preserving current behaviour', () => {
    expect(migration).toMatch(/UPDATE public\.certifications\s+SET available_to_everyone = true\s+WHERE cohort_ids = '\{\}'/);
    expect(migration).toContain("attname = 'available_to_everyone'");
    expect(migration.indexOf('UPDATE public.certifications')).toBeLessThan(migration.indexOf('END;\n$migration$;'));
    // Courses must NOT be backfilled: their direct-access route would change behaviour.
    expect(migration).not.toMatch(/UPDATE public\.courses/);
  });

  // Four tables now: courses and certifications from migration 174, plus virtual_experiences and
  // learning_paths from migration 186. Bump this when another content type gains open access -- a
  // drop means the fresh schema has stopped matching what the migrations build.
  it('is mirrored in the fresh schema for every table with open access', () => {
    expect(schema.match(/available_to_everyone boolean NOT NULL DEFAULT false/g)?.length).toBe(4);
  });
});
