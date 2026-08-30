// The two places the payments screen has to earn its keep: the moment someone pays, and the
// moment they compare prices. Both are pure presentation, so these pin the rules the component
// applies rather than re-rendering it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const component = readFileSync(
  join(process.cwd(), 'components/student/subscription-payments.tsx'),
  'utf8',
);
const route = readFileSync(join(process.cwd(), 'app/api/student-subscriptions/route.ts'), 'utf8');

describe('the purchase moment', () => {
  it('celebrates only a real activation, not a rejection or a review', () => {
    // needs_review and failed both resolve the return; neither is a purchase, and telling
    // someone "you are in" when their payment is under review would be a lie.
    expect(component).toContain('const [justPurchased, setJustPurchased]');
    const successBlock = component.slice(
      component.indexOf("setMessage('Payment confirmed."),
      component.indexOf("if (result.status === 'needs_review')"),
    );
    expect(successBlock).toContain('setJustPurchased(true)');
    const reviewBlock = component.slice(
      component.indexOf("if (result.status === 'needs_review')"),
      component.indexOf('if (!inFlight.has(result.status))'),
    );
    expect(reviewBlock).not.toContain('setJustPurchased(true)');
  });

  it('replaces the grey banner rather than stacking on top of it', () => {
    expect(component).toContain('{message && !justPurchased &&');
  });

  it('lists only content the learner can actually open', () => {
    // The old resolver read titles with no published filter, so the panel could promise
    // something withdrawn. The shared helper filters to published rows, and using it also
    // removes the second, drifting copy of this lookup.
    expect(route).toContain('loadPlanContents(db, [displayPlanId])');
    expect(route).not.toContain('async function resolveContent');
    expect(component).toContain('contents={data?.content ?? []}');
  });

  it('never links to a learning path, which has no page to land on', () => {
    // Paths are granted by plans but have no route of their own. A link would be a dead end,
    // so those fall back to My Learning where a path can actually be opened.
    expect(component).toContain("'/student#learning_paths'");
    expect(component).toContain('const openable = contents.find');
  });

  it('carries the content type in the link, since slugs are not unique across tables', () => {
    expect(component).toContain('?catalogueType=${CATALOGUE_TYPE[openable.contentTable]}');
  });
});

// The pricing arithmetic itself is exercised with real figures in plan-price-comparison.test.ts.
// What matters here is only that the screen uses that helper rather than doing its own sums.
describe('price comparison', () => {
  it('uses the shared, tested calculation rather than inlining its own', () => {
    expect(component).toContain("import { comparePlanPrice } from '@/lib/plan-price-comparison'");
    expect(component).toContain('comparePlanPrice(price, prices)');
    expect(component).not.toContain('Math.round((1 - perMonth');
  });

  it('shows one exact renewal total instead of repeating a monthly rate', () => {
    expect(component).toContain('money(selectedPrice.currency, selectedPrice.amount)');
    expect(component).not.toContain('money(selectedPrice.currency, comparison.perMonth)');
  });
});
