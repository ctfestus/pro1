/**
 * Sale prices for digital products, decided in one place for checkout, the store and Explore.
 *
 * A price (book_prices, migration 237) may carry a sale: a lower sale_amount and, optionally,
 * sale_ends_at. While the sale is on, the product costs the sale amount and the regular amount is
 * shown crossed out; once it ends the regular price applies again, with nothing to switch off.
 * Client-safe (no imports).
 */

export interface PriceRow {
  currency: string;
  amount: number | string;
  sale_amount?: number | string | null;
  sale_ends_at?: string | null;
}

/** What a buyer is shown and charged for one currency. */
export interface ShownPrice {
  currency: string;
  /** What checkout charges now. */
  amount: number;
  /** The regular price, only while a sale is on (shown crossed out). */
  original?: number;
  /** When the sale ends, if it has an end. */
  saleEndsAt?: string;
}

/** Whether the row's sale applies at `now`: a lower, positive sale price that has not ended. */
export function saleIsOn(row: PriceRow, now: Date = new Date()): boolean {
  const amount = Number(row.amount);
  const sale = row.sale_amount == null || row.sale_amount === '' ? NaN : Number(row.sale_amount);
  if (!Number.isFinite(sale) || sale <= 0 || !(sale < amount)) return false;
  if (row.sale_ends_at) {
    const ends = Date.parse(row.sale_ends_at);
    if (Number.isFinite(ends) && ends <= now.getTime()) return false;
  }
  return true;
}

export function shownPrice(row: PriceRow, now: Date = new Date()): ShownPrice {
  const amount = Number(row.amount);
  if (!saleIsOn(row, now)) return { currency: String(row.currency), amount };
  return {
    currency: String(row.currency),
    amount: Number(row.sale_amount),
    original: amount,
    ...(row.sale_ends_at ? { saleEndsAt: row.sale_ends_at } : {}),
  };
}

/** A shown price as the browser holds it (ShownPrice from the server, or a later update). */
export type ClientPrice = { currency: string; amount: number; original?: number; saleEndsAt?: string };

/** Prices with every sale that has ended by `now` back at its regular price. */
export function endEndedSales<P extends ClientPrice>(list: P[], now: number = Date.now()): ClientPrice[] {
  return list.map(p => (p.original !== undefined && p.saleEndsAt && Date.parse(p.saleEndsAt) <= now
    ? { currency: p.currency, amount: p.original } : p));
}

/** Milliseconds until the next sale in `list` ends, or null when none has an end. */
export function msUntilNextSaleEnd(list: ClientPrice[], now: number = Date.now()): number | null {
  const ends = list
    .map(p => (p.original !== undefined && p.saleEndsAt ? Date.parse(p.saleEndsAt) : NaN))
    .filter(Number.isFinite);
  return ends.length ? Math.max(0, Math.min(...ends) - now) : null;
}
