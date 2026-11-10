import type { Metadata } from 'next';
import { productPriceLabel, type Priced } from '@/lib/books/price-label';
import { descriptionText } from '@/lib/books/description';
import { socialImageUrl } from '@/lib/cloudinary-url';

export { productPriceLabel };

/**
 * A product page's link preview (WhatsApp, LinkedIn, X, Facebook): the cover as the image, the name
 * with the price as the title, the price leading the description, and product price tags.
 */
export function productMetadata(
  book: Priced & { slug: string; title: string; subtitle: string | null; description: string | null; coverImage: string | null },
  appName: string,
  appUrl: string,
): Metadata {
  const cover = book.coverImage && !book.coverImage.startsWith('data:') ? socialImageUrl(book.coverImage) : '';
  const image = cover || (appUrl ? `${appUrl}/api/og/brand` : '');
  const blurb = (book.subtitle?.trim() || descriptionText(book.description, 200)) || `${book.title}, a digital product from ${appName}.`;
  const price = productPriceLabel(book);
  const description = price ? `${price}. ${blurb}` : blurb;
  const shareTitle = price ? `${book.title} | ${price}` : book.title;
  const url = appUrl ? `${appUrl}/products/${encodeURIComponent(book.slug)}` : undefined;
  const first = book.free ? null : book.prices[0];
  return {
    title: `${book.title} - ${appName}`,
    description,
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title: shareTitle, description, siteName: appName, type: 'website', ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image, alt: `Cover of ${book.title}` }] } : {}),
    },
    twitter: { card: 'summary_large_image', title: shareTitle, description, ...(image ? { images: [image] } : {}) },
    other: first ? { 'product:price:amount': first.amount.toFixed(2), 'product:price:currency': first.currency } : undefined,
  };
}
