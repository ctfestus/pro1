// The public pricing page serves a saved copy of a heavy query, filed under a tag. Nothing about
// that copy knows when an admin edits a plan, so every write that changes what the page says has
// to discard it.
//
// This is a source-level guard on purpose. The bug it exists for was not a wrong branch or a bad
// value -- it was a missing line, in a file nobody looks at while editing plans. A behavioural
// test would have to name the same handlers by hand and would pass happily the day someone adds
// a sixth one.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const ROUTES = ['app/api/payments/route.ts', 'app/api/admissions/route.ts'];

/**
 * Handlers that change a plan but not what the public page shows. `change-subscription-plan`
 * moves one learner between plans: their access changes, the catalogue on sale does not.
 */
const NOT_PUBLIC_FACING = new Set(['change-subscription-plan']);

/** Splits a route file into one chunk per `body.action === '...'` handler. */
function handlers(source: string): { action: string; body: string }[] {
  const starts = [...source.matchAll(/body\.action === '([a-z-]+)'/g)];
  return starts.map((match, i) => ({
    action: match[1],
    body: source.slice(match.index ?? 0, starts[i + 1]?.index ?? source.length),
  }));
}

const WRITES = /\.(update|insert|upsert|delete)\(|\.rpc\(/;

describe('every plan write discards the cached pricing page', () => {
  it('covers each plan-mutating handler, including ones added later', () => {
    const missing: string[] = [];
    for (const file of ROUTES) {
      for (const handler of handlers(read(file))) {
        if (!handler.action.includes('plan')) continue;
        if (NOT_PUBLIC_FACING.has(handler.action)) continue;
        if (!WRITES.test(handler.body)) continue;
        if (!handler.body.includes('revalidatePricingPage()')) {
          missing.push(`${file}: ${handler.action}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('still finds the handlers it is meant to be watching', () => {
    // Without this, a rename of the action strings would empty the sweep above and it would
    // pass by checking nothing at all.
    const found = ROUTES.flatMap(file => handlers(read(file)).map(h => h.action));
    for (const action of [
      'create-subscription-plan',
      'delete-subscription-plan',
      'update-subscription-plan',
      'save-subscription-plan-prices',
      'add-subscription-plan-content',
    ]) {
      expect(found).toContain(action);
    }
  });

  it('keeps one name for the tag, shared by the reader and the writers', () => {
    // Two ends agreeing on a string is the whole mechanism. A second literal spelt slightly
    // differently would discard nothing and fail silently.
    const helper = read('lib/revalidate-pricing.ts');
    expect(helper).toContain("PRICING_CACHE_TAG = 'pricing-page'");
    expect(read('lib/get-pricing-page-data.ts')).toContain('PRICING_CACHE_TAG');
    // The reader must not hardcode the string beside the shared constant.
    expect(read('lib/get-pricing-page-data.ts')).not.toContain("tags: ['pricing-page']");
  });

  it('never lets a failed discard fail the write that already succeeded', () => {
    // The plan change is saved by this point. Throwing here would report failure for something
    // that worked, and the stale page heals on the timer anyway.
    expect(read('lib/revalidate-pricing.ts')).toMatch(/try\s*{[\s\S]*revalidateTag[\s\S]*catch/);
  });
});
