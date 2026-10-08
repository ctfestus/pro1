import 'server-only';
import type { Metadata } from 'next';
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

export async function buildShareMetadata(id: string, catalogueType?: string | null): Promise<Metadata> {
  // A failed lookup must not take the page down with it; it just gets no preview.
  const [found, tenant] = await Promise.all([
    findPublicCatalogueItem(adminClient(), id, catalogueType).catch(error => {
      console.error('[share-metadata] lookup failed', error?.message ?? error);
      return null;
    }),
    getTenantSettings(),
  ]);
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
