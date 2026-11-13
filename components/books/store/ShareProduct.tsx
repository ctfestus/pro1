'use client';

/**
 * Share buttons on a product page (components/ShareButtons.tsx). The message carries the name and
 * the price as well as a line about the product, for apps that show the text.
 */
import { ShareButtons } from '@/components/ShareButtons';
import { productPriceLabel } from '@/lib/books/price-label';
import { useCurrentPrices } from '@/lib/books/use-current-prices';
import type { ClientPrice } from '@/lib/books/pricing';

export function ShareProduct({ url, title, free, prices, blurb }: {
  url: string;
  title: string;
  free: boolean;
  prices: ClientPrice[];
  blurb: string;
}) {
  // The same prices as the buy area: a sale that ends while the page is open, or a price checkout
  // reports as changed, updates the share message too.
  const current = useCurrentPrices(prices);
  const price = productPriceLabel({ free, prices: current });
  return (
    <ShareButtons url={url} title={price ? `${title} - ${price}` : title} blurb={blurb}
      className="mt-6 flex flex-wrap items-center justify-center sm:justify-start gap-2" />
  );
}
