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
  currency: string;
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string | null;
  prices: PricingPrice[];
  /** How much of each kind the plan grants, for the comparison table. */
  coverage: ContentCounts;
}

export interface PricingPageData {
  plans: PricingPlan[];
  /** What an account with no plan can already open. */
  free: ContentCounts;
}

export const emptyContentCounts = (): ContentCounts => ({
  courses: 0,
  learning_paths: 0,
  virtual_experiences: 0,
  certifications: 0,
});
