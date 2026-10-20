/**
 * The shape of pricing data, shared by the server that fetches it and the components that draw
 * it.
 *
 * This is a separate module for one reason: the fetching side imports the service-role client,
 * and that client is constructed the moment its module is loaded. A client component reaching
 * into it for so much as a constant drags that construction into the browser, where the key does
 * not exist -- and the page dies before it renders anything.
 *
 * So everything both sides need lives here, with no imports that cannot run anywhere.
 */
import type { PurchasableContentTable } from '@/lib/subscription-plan-access';

/** The kinds of thing a plan can grant, in the order they are shown. */
export const CONTENT_KINDS: PurchasableContentTable[] = [
  'courses',
  'learning_paths',
  'virtual_experiences',
  'certifications',
];

export type ContentCounts = Record<PurchasableContentTable, number>;

export interface PricingPrice {
  id: string;
  durationMonths: number;
  amount: number;
  listAmount?: number;
  discountType?: 'percentage' | 'fixed' | null;
  discountValue?: number | null;
  discountLabel?: string | null;
  discountAmount?: number;
  currency: string;
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string | null;
  prices: PricingPrice[];
  /** The one plan the seller puts in front of people. At most one is true. */
  recommended: boolean;
  /** How much of each kind the plan grants, for the comparison table. */
  coverage: ContentCounts;
}

export interface PricingPageData {
  plans: PricingPlan[];
  /** What an account with no plan can already open. */
  free: ContentCounts;
}

/**
 * One row of the public_pricing_plans view, as the pricing page and the learning pages read it.
 * Shared so the server render and a live re-read in the browser can never shape a plan apart.
 */
export function pricingPlanFromRow(row: any): PricingPlan {
  return {
    id: row.plan_id,
    name: row.plan_name,
    description: row.plan_description ?? null,
    recommended: row.recommended === true,
    // Already ordered by duration in the view, so the toggle reads left to right as it comes.
    prices: ((row.prices ?? []) as any[]).map((price): PricingPrice => ({
      id: price.id,
      durationMonths: Number(price.durationMonths),
      amount: Number(price.amount),
      listAmount: Number(price.listAmount ?? price.amount),
      discountType: price.discountType ?? null,
      discountValue: price.discountValue == null ? null : Number(price.discountValue),
      discountLabel: price.discountLabel ?? null,
      discountAmount: Number(price.discountAmount ?? 0),
      currency: price.currency || 'GHS',
    })),
    coverage: {
      courses: Number(row.courses ?? 0),
      learning_paths: Number(row.learning_paths ?? 0),
      virtual_experiences: Number(row.virtual_experiences ?? 0),
      certifications: Number(row.certifications ?? 0),
    },
  };
}

export const emptyContentCounts = (): ContentCounts => ({
  courses: 0,
  learning_paths: 0,
  virtual_experiences: 0,
  certifications: 0,
});
