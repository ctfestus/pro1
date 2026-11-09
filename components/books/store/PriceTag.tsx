import { formatMoney } from '@/lib/books/format';

type Price = { currency: string; amount: number; original?: number };

/**
 * A product's price as buyers see it: while a sale is on, the regular price crossed out next to the
 * sale price (lib/books/pricing.ts decides the sale). Several currencies are listed side by side.
 */
export function PriceTag({ prices, className, style, saleColor = '#16a34a' }: {
  prices: Price[];
  className?: string;
  style?: React.CSSProperties;
  /** Colour of a sale price, so it reads as a reduction. */
  saleColor?: string;
}) {
  if (!prices.length) return null;
  return (
    <span className={className} style={style}>
      {prices.map((p, i) => (
        <span key={p.currency} className="whitespace-nowrap">
          {i > 0 && <span style={{ opacity: 0.5 }}> / </span>}
          {p.original !== undefined && (
            <>
              <s style={{ opacity: 0.55, fontWeight: 400 }} aria-label={`Was ${formatMoney(p.original, p.currency)}`}>{formatMoney(p.original, p.currency)}</s>{' '}
            </>
          )}
          <span style={p.original !== undefined ? { color: saleColor } : undefined}>{formatMoney(p.amount, p.currency)}</span>
        </span>
      ))}
    </span>
  );
}
