import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(join(process.cwd(), 'migrations/205_subscription_plan_discounts.sql'), 'utf8');
const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');
const checkout = readFileSync(join(process.cwd(), 'app/api/student-subscriptions/route.ts'), 'utf8');

describe('subscription plan discount schema', () => {
  it('keeps the migration and fresh schema in sync', () => {
    for (const column of [
      'discount_type',
      'discount_value',
      'discount_starts_at',
      'discount_ends_at',
    ]) {
      expect(migration).toContain(column);
      expect(schema).toContain(column);
    }
    expect(schema).toContain('CONSTRAINT subscription_plans_discount_complete');
    expect(schema).toContain('CONSTRAINT subscription_plans_discount_window');
    expect(migration).toContain('DROP CONSTRAINT IF EXISTS subscription_plans_discount_complete');
    expect(migration).toContain("discount_type IS NOT NULL AND discount_type IN ('percentage', 'fixed')");
    expect(migration).toContain('discount_value IS NOT NULL AND discount_value > 0');
  });

  it('publishes both the list and effective price', () => {
    expect(migration).toContain("'listAmount', pr.amount");
    expect(migration).toContain("'amount', pr.effective_amount");
    expect(schema).toContain("'discountAmount', pr.amount - pr.effective_amount");
  });

  it('saves prices and their promotion under one plan-row lock', () => {
    expect(migration).toContain('FUNCTION public.replace_subscription_plan_prices_and_discount');
    expect(migration).toContain('WHERE id = p_plan_id FOR UPDATE');
    expect(migration).toContain('fixed discount requires one active price currency');
    expect(schema).toContain('FUNCTION public.replace_subscription_plan_prices_and_discount');
  });

  it('recalculates the amount in both purchase and resumed checkout paths', () => {
    expect(checkout).toContain('amount: effectivePrice.amount');
  });
});
