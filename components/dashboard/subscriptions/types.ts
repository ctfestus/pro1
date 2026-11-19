export type SubsTab = 'overview' | 'subscribers' | 'payments' | 'plans';

/** A plan with the figures every tab shows for it, worked out once on the page. */
export type PlanSummary = {
  plan: any;
  /** "From GHS 29.18" with several prices, "GHS 23" with one, "No price yet" with none. */
  priceText: string;
  priceCount: number;
  prices: { id: string; duration: string; now: string; list: string | null }[];
  live: number;
  /** A running or scheduled offer, short ("Black Friday, ends 30 Nov") and long (with the discount). */
  offer: string | null;
  offerDetail: string | null;
};
