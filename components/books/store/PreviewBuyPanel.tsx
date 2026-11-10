'use client';

/**
 * The buy area as a visitor without an account sees it (BuyPanel's signed-out view), for the
 * author's page preview: the same price, buttons and sign-in line, but nothing can be clicked
 * through, so a preview never starts a checkout, a free claim or a sample download.
 */
import { Eye } from 'lucide-react';
import { PriceTag } from '@/components/books/store/PriceTag';
import { formatMoney } from '@/lib/books/format';
import type { StoreBook } from '@/lib/books/store';

const primaryBtn = 'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold cursor-default';
const secondaryBtn = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold cursor-default';
const secondaryStyle = { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
const OFF = 'Buttons do not work in the preview.';

export function PreviewBuyPanel({ book, primaryColor }: { book: StoreBook; primaryColor: string }) {
  const price = book.prices[0];
  const saleEnds = price?.saleEndsAt ? new Date(price.saleEndsAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const forSale = !book.free && !!price;

  return (
    <div>
      {book.free ? (
        <p className="text-2xl font-extrabold tracking-tight" style={{ color: '#16a34a' }}>Free</p>
      ) : price ? (
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2">
          <PriceTag prices={[price]} className="text-2xl font-extrabold tracking-tight" style={{ color: '#0f172a' }} />
          {price.original !== undefined && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#ffffff', color: '#16a34a' }}>
              Save {formatMoney(price.original - price.amount, price.currency)}{saleEnds ? ` until ${saleEnds}` : ''}
            </span>
          )}
          {book.prices.length > 1 && (
            <span className="rounded-xl px-3 py-2 text-sm" style={{ background: '#ffffff', color: '#334155' }}>{price.currency}</span>
          )}
        </div>
      ) : null}

      {(book.free || forSale) && (
        <div className="mt-5 flex flex-col sm:flex-row sm:items-start flex-wrap gap-3">
          <button type="button" aria-disabled="true" title={OFF} onClick={e => e.preventDefault()} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
            {book.free ? 'Get it free' : 'Buy now'}
          </button>
          {book.hasSample && (
            <button type="button" aria-disabled="true" title={OFF} onClick={e => e.preventDefault()} className={secondaryBtn} style={secondaryStyle}>
              <Eye className="w-4 h-4" />
              {book.format === 'epub' ? 'Download free sample' : 'Read free sample'}
            </button>
          )}
        </div>
      )}

      {(book.free || forSale) && (
        <p className="mt-4 text-sm" style={{ color: '#64748b' }}>
          Have an account? <span className="font-semibold underline underline-offset-2" style={{ color: '#0f172a' }}>Sign in</span>
          {book.free ? ' to download it now.' : ''}
        </p>
      )}
      {book.hasSample && book.format === 'epub' && (
        <p className="mt-3 text-xs" style={{ color: '#64748b' }}>Open the sample in an ebook app such as Apple Books or Google Play Books.</p>
      )}
    </div>
  );
}
