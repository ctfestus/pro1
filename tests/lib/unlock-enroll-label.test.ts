// What a locked course, path or experience offers.
//
// No figure appears on these panels any more. A price beside one course reads as the price of
// that course, when what is on sale is access to the whole catalogue -- so the panel names the
// plan and the pricing page carries the lengths and the money.
import { describe, expect, it } from 'vitest';
import { enrollLabel, unlockPlanName } from '@/lib/unlock-pricing';

const pro = {
  plans: [{ id: 'p1', name: 'Pro', prices: [{ id: 'x', durationMonths: 12, amount: 900, currency: 'GHS' }] }],
};

describe('enrollLabel', () => {
  it('names the plan when one plan opens the item', () => {
    expect(unlockPlanName(pro)).toBe('Pro');
    expect(enrollLabel(pro)).toBe('Enroll with Pro');
  });

  it('never names a tenant, only whatever the plan is actually called', () => {
    const other = { plans: [{ id: 'p1', name: 'Full access', prices: pro.plans[0].prices }] };
    expect(enrollLabel(other)).toBe('Enroll with Full access');
  });

  it('stays generic when several plans open it', () => {
    // Naming one of several implies the others will not do, and the panel gives the learner no
    // way to tell which is which.
    const many = { plans: [pro.plans[0], { id: 'p2', name: 'Teams', prices: pro.plans[0].prices }] };
    expect(unlockPlanName(many)).toBeNull();
    expect(enrollLabel(many)).toBe('Enroll with a plan');
  });

  it('stays generic when a plan has nothing on sale, or there is no plan at all', () => {
    expect(enrollLabel({ plans: [{ id: 'p1', name: 'Pro', prices: [] }] })).toBe('Enroll with a plan');
    expect(enrollLabel(null)).toBe('Enroll with a plan');
    expect(enrollLabel(undefined)).toBe('Enroll with a plan');
  });

  it('stays generic rather than saying "Enroll with" and trailing off', () => {
    const blank = { plans: [{ id: 'p1', name: '   ', prices: pro.plans[0].prices }] };
    expect(enrollLabel(blank)).toBe('Enroll with a plan');
  });
});
