// Adding open-to-everyone content to a plan now closes that open access, in the same request.
//
// Two properties matter enough to pin at source level. It must never happen unasked: closing it
// takes the content away from every learner outside a cohort or a plan, part-way through
// included. And the editors must be told, or their next save writes the flag straight back on.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const admissions = read('app/api/admissions/route.ts');
const picker = read('components/PlanAccessPicker.tsx');

describe('closing open access when content joins a plan', () => {
  it('is never done unless the caller asked for it', () => {
    expect(admissions).toContain('body.clearPublicAccess !== true');
    // The refusal survives for callers that did not ask, rather than the flag being cleared for
    // everyone who happens to add public content.
    expect(admissions).toMatch(/clearPublicAccess !== true[\s\S]{0,400}status: 400/);
  });

  it('closes it before writing the coverage row', () => {
    // The other order can leave content sold in a plan and still open to everyone, which the
    // picker then reads as needing no change -- a contradiction nothing would report.
    const close = admissions.indexOf('available_to_everyone: false');
    const coverage = admissions.indexOf("from('subscription_plan_content').upsert");
    expect(close).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(-1);
    expect(close).toBeLessThan(coverage);
  });

  it('asks the author first, and only sends the flag from that answer', () => {
    expect(picker).toContain('willClosePublic');
    // The request carries it only when the confirmation set it.
    expect(picker).toMatch(/apply\(plan, true, confirming\.willClosePublic\)/);
    expect(picker).toMatch(/clearPublicAccess \? \{ clearPublicAccess: true \} : \{\}/);
  });

  it('says what saying yes costs, in terms of who loses access', () => {
    expect(picker).toMatch(/loses it|lose access|losing access/i);
    expect(picker).toMatch(/part-way through/i);
  });

  it('tells the editor, so its next save does not undo the change', () => {
    expect(picker).toContain('onPublicAccessClosed?.()');
    for (const editor of [
      'components/FormEditor.tsx',
      'app/create/page.tsx',
      'app/create/certification/page.tsx',
    ]) {
      expect(read(editor)).toContain('onPublicAccessClosed');
    }
  });
});
