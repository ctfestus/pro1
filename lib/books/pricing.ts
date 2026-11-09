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
