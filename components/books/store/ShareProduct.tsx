'use client';

/**
 * Share buttons on a product page: WhatsApp, LinkedIn, X and Facebook, Copy link, and the device's
 * own share sheet where there is one (phones). The link's preview (cover, name, price,
 * description) comes from the product page's metadata; the message carries the name, price and a
 * line about it as well, for apps that show the text.
 */
import { useState, useSyncExternalStore } from 'react';
import { Check, Link2, Share2 } from 'lucide-react';
import { SHARE_PLATFORMS } from '@/components/share-platforms';
import { productPriceLabel } from '@/lib/books/price-label';
import { useCurrentPrices } from '@/lib/books/use-current-prices';
import type { ClientPrice } from '@/lib/books/pricing';

const ORDER = ['whatsapp', 'linkedin', 'twitter', 'facebook'] as const;
const BUTTON_SHADOW = '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)';
const noop = () => () => {};

export function ShareProduct({ url: givenUrl, title, free, prices, blurb }: {
  url: string;
  title: string;
  free: boolean;
  prices: ClientPrice[];
  blurb: string;
}) {
  const [copied, setCopied] = useState(false);
  // The same prices as the buy area: a sale that ends while the page is open, or a price checkout
  // reports as changed, updates the share message too.
  const current = useCurrentPrices(prices);
  const price = productPriceLabel({ free, prices: current });
  // Read once on the client; false on the server, so the first render matches.
  const canNativeShare = useSyncExternalStore(noop, () => typeof navigator !== 'undefined' && typeof navigator.share === 'function', () => false);
  // The server passes the tenant's address; without one configured, the address being viewed.
  const pageUrl = useSyncExternalStore(noop, () => givenUrl || window.location.href.split(/[?#]/)[0], () => givenUrl);
  if (!pageUrl) return null;

  const heading = price ? `${title} - ${price}` : title;
  const platforms = ORDER.map(id => SHARE_PLATFORMS.find(p => p.id === id)!).filter(Boolean);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', pageUrl);
    }
  }

  async function nativeShare() {
    try { await navigator.share({ title: heading, text: `${heading}\n${blurb}`, url: pageUrl }); } catch { /* closed by the person */ }
  }

  const btn = 'w-10 h-10 rounded-full inline-flex items-center justify-center transition-transform hover:-translate-y-0.5';
  const style = { background: '#ffffff', color: '#0f172a', boxShadow: BUTTON_SHADOW };
  return (
    <div className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-2">
      <span className="text-sm mr-1" style={{ color: '#64748b' }}>Share</span>
      {canNativeShare && (
        <button type="button" onClick={nativeShare} aria-label="Share" title="Share" className={btn} style={style}>
          <Share2 className="w-4 h-4" />
        </button>
      )}
      {platforms.map(p => (
        <a key={p.id} href={p.href(pageUrl, heading, blurb)} target="_blank" rel="noopener noreferrer" aria-label={`Share on ${p.label}`} title={p.label}
          className={btn} style={style}>
          {p.icon}
        </a>
      ))}
      <button type="button" onClick={copy} aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'}
        className="h-10 px-4 rounded-full inline-flex items-center gap-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
        style={{ ...style, color: copied ? '#16a34a' : '#0f172a' }}>
        {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
