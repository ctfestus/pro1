import 'server-only';
import { cache } from 'react';
import type { Metadata } from 'next';
import type { StoreInstructor } from '@/lib/books/store';
import { adminClient } from '@/lib/admin-client';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { IMG_SOCIAL, socialImageUrl } from '@/lib/cloudinary-url';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { findPublicCatalogueItem, type PublicCatalogueType } from '@/lib/public-catalogue-item';

/**
 * Link-preview metadata (Open Graph / Twitter) for the shared detail route, app/[id].
 *
 * Crawlers are anonymous, so a preview shows exactly what the page shows a signed-out visitor:
 * the /api/catalogue-preview lookup, through the same findPublicCatalogueItem gate. Draft,
 * archived and cohort-only content, and events (cohort-only under RLS), get no preview, and
 * ?catalogueType= picks the same item the page opens when slugs collide across types.
 */
export type ShareContent = {
  id: string;
  type: PublicCatalogueType;
  title: string;
  description: string | null;
  coverImage: string | null;
};

// Types /api/og/[id] can serve a data: cover for.
const PROXIED_COVER = new Set<PublicCatalogueType>(['course', 'virtual_experience']);

/**
 * The preview image for a piece of content. Always returns one: content without a usable cover
 * gets the tenant brand card from /api/og/brand, so a share never falls back to text only.
 * `sized` is true only when the image is known to be 1200x630.
 */
export function shareImage(content: Pick<ShareContent, 'id' | 'type' | 'coverImage'>, appUrl: string): { url: string; sized: boolean } {
  const brand = { url: `${appUrl}/api/og/brand`, sized: true };
  const ref = content.coverImage?.trim() ?? '';
  if (ref.startsWith('data:')) {
    return PROXIED_COVER.has(content.type) ? { url: `${appUrl}/api/og/${content.id}`, sized: false } : brand;
  }
  const url = socialImageUrl(ref);
  if (url.startsWith('https://images.pexels.com')) {
    return { url: `${url.split('?')[0]}?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop`, sized: true };
  }
  if (url) return { url, sized: url.includes(IMG_SOCIAL) };
  return brand;
}

/**
 * The public item for a page, once per request: the link preview and the search data below both
 * need it. A failed lookup must not take the page down with it; it just gets neither.
 */
const findSharedItem = cache((id: string, catalogueType: string | null) =>
  findPublicCatalogueItem(adminClient(), id, catalogueType).catch(error => {
    console.error('[share-metadata] lookup failed', error?.message ?? error);
    return null;
  }));

export async function buildShareMetadata(id: string, catalogueType?: string | null): Promise<Metadata> {
  const [found, tenant] = await Promise.all([findSharedItem(id, catalogueType ?? null), getTenantSettings()]);
  // A missing public preview does not mean the route itself is missing. A signed-in learner may
  // still be allowed to open cohort-only content, and the client will replace this generic title
  // with the content title once that access-controlled row loads. Keep private metadata private,
  // but never stream a misleading "Not Found" title over a page the learner is already using.
  if (!found) return tenant.appName ? { title: tenant.appName } : {};
  const data: ShareContent = {
    id: found.record.id,
    type: found.type,
    title: found.record.title ?? 'Untitled',
    description: found.record.description ?? null,
    coverImage: found.record.cover_image ?? null,
  };

  // The tenant's configured domain first, so custom-domain deployments publish their own URLs.
  // Only an absolute http(s) origin is accepted; a relative or malformed value falls through.
  const appUrl = normalizeAbsoluteBaseUrl(
    tenant.appUrl,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ) || 'http://localhost:3000';

  // Strip HTML tags so og:description is plain text (descriptions are rich text)
  const stripped = (data.description || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  // LinkedIn requires at least 100 characters -- pad with a generic suffix if short
  const suffix = tenant.appName ? ` Powered by ${tenant.appName}.` : '.';
  const plainDescription = stripped.length >= 100
    ? stripped
    : (stripped ? `${stripped}${suffix}` : `${data.title}${suffix}`).slice(0, 200);

  const image = shareImage(data, appUrl);
  const query = catalogueType ? `?catalogueType=${encodeURIComponent(catalogueType)}` : '';

  return {
    title: data.title,
    description: plainDescription,
    openGraph: {
      type: 'website',
      url: `${appUrl}/${encodeURIComponent(id)}${query}`,
      siteName: tenant.appName || undefined,
      title: data.title,
      description: plainDescription,
      images: [image.sized ? { url: image.url, width: 1200, height: 630 } : { url: image.url }],
    },
    twitter: {
      card: 'summary_large_image',
      title: data.title,
      description: plainDescription,
      images: [image.url],
    },
  };
}

/**
 * schema.org Course data for a course or learning path page, so search results can show it with
 * its provider, price and instructor. Built from the same public lookup as the link preview, so a
 * crawler learns nothing a signed-out visitor is not shown; anything else gets none.
 */
export async function buildContentJsonLd(
  id: string,
  catalogueType: string | null,
  instructor: StoreInstructor | null,
): Promise<Record<string, unknown> | null> {
  if (catalogueType !== 'course' && catalogueType !== 'learning_path') return null;
  const [found, tenant] = await Promise.all([findSharedItem(id, catalogueType), getTenantSettings()]);
  if (!found) return null;
  const appUrl = normalizeAbsoluteBaseUrl(tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  const record = found.record;
  const description = String(record.description ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  // The same best value the page's price card leads with: lowest a month across the plans.
  const prices = found.plans.flatMap(plan => plan.prices);
  const best = prices.length
    ? prices.reduce((a, b) => (b.amount / b.durationMonths < a.amount / a.durationMonths ? b : a))
    : null;
  const image = appUrl ? shareImage({ id: record.id, type: found.type, coverImage: record.cover_image ?? null }, appUrl).url : undefined;
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: record.title ?? 'Untitled',
    description: description || record.title || undefined,
    url: appUrl ? `${appUrl}/${encodeURIComponent(id)}?catalogueType=${catalogueType}` : undefined,
    image,
    provider: { '@type': 'Organization', name: tenant.appName || undefined, sameAs: appUrl || undefined },
    offers: found.locked
      ? (best ? [{ '@type': 'Offer', category: 'Subscription', price: best.amount, priceCurrency: best.currency }] : undefined)
      : [{ '@type': 'Offer', category: 'Free', price: 0, priceCurrency: best?.currency ?? 'GHS' }],
    hasCourseInstance: instructor
      ? [{ '@type': 'CourseInstance', courseMode: 'Online', instructor: [{ '@type': 'Person', name: instructor.name }] }]
      : undefined,
  };
}
