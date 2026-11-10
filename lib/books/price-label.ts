import { formatMoney } from '@/lib/books/format';

/** Client-safe (no server imports): used by link previews on the server and the share row in the browser. */
export type Priced = { free: boolean; prices: { currency: string; amount: number; original?: number }[] };

/**
 * A product's price as one short line for link previews and share messages: "Free", "GHS 120",
 * "GHS 120 (was GHS 200)" during a sale, and other currencies after a slash.
 */
export function productPriceLabel(book: Priced): string {
  if (book.free) return 'Free';
  if (!book.prices.length) return '';
  const [first, ...rest] = book.prices;
  const lead = first.original !== undefined
    ? `${formatMoney(first.amount, first.currency)} (was ${formatMoney(first.original, first.currency)})`
    : formatMoney(first.amount, first.currency);
  return [lead, ...rest.map(p => formatMoney(p.amount, p.currency))].join(' / ');
}

