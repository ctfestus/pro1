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

  it('uses the resolved plan contents the API already returns', () => {
    // The endpoint has always returned this and nothing read it -- queries paid for on every
    // load, spent on nothing. It is what "here is what you can open now" is built from.
    expect(route).toContain('content: await resolveContent(db, displayPlanId)');
    expect(component).toContain('contents={data?.content ?? []}');
  });

  it('never links to a learning path, which has no page to land on', () => {
    // Paths are granted by plans but have no route of their own. A link would be a dead end,
    // so those fall back to My Learning where a path can actually be opened.
    expect(component).toContain("'/student#learning_paths'");
    expect(component).toContain('const openable = contents.find');
  });

  it('carries the content type in the link, since slugs are not unique across tables', () => {
    expect(component).toContain('?catalogueType=${CATALOGUE_TYPE[openable.content_table]}');
  });
});

describe('price comparison', () => {
  it('shows what a plan costs per month, not just the total', () => {
    // A year of access reads as a big number next to a month of it. The per-month figure is
    // what makes the longer option legible as the cheaper one.
    expect(component).toContain('const perMonth = price.amount / price.durationMonths');
    expect(component).toContain('a month');
  });

  it('measures the saving against the shortest plan on offer, not a hardcoded month', () => {
    // A tenant selling only 6 and 12 months has no monthly price to compare against. Anchoring
    // on the shortest option they actually sell keeps the figure honest.
    expect(component).toContain('plan.prices.reduce');
    expect(component).toContain('price.durationMonths > shortest.durationMonths');
  });

  it('shows no saving on the shortest option itself', () => {
    // Guarded by the same comparison: the anchor cannot save against itself, and a zero or
    // negative figure is never rendered.
    expect(component).toContain('saving > 0 &&');
  });
});
