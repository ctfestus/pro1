// Public by design: this id travels inside every logo URL Brandfetch serves, so it is not a
// secret. Empty means the tenant has not configured Brandfetch, and every entry point must fall
// back to the image library rather than offering a search that cannot work.
export const BRANDFETCH_CLIENT_ID = (process.env.NEXT_PUBLIC_BRANDFETCH_CLIENT_ID ?? '').trim();

export interface BrandfetchBrand {
  name: string;
  domain: string;
  icon: string;
  brandId: string;
  claimed: boolean;
}

export function normalizeBrandDomain(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    if (!hostname || !hostname.includes('.') || /[^a-z0-9.-]/i.test(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

export function buildBrandfetchLogoUrl(domain: string, clientId: string): string {
  const normalized = normalizeBrandDomain(domain);
  if (!normalized || !clientId.trim()) return '';
  return `https://cdn.brandfetch.io/domain/${normalized}/w/128/h/128/fallback/lettermark/type/icon?c=${encodeURIComponent(clientId.trim())}`;
}

export function parseBrandfetchResults(value: unknown): BrandfetchBrand[] {
  if (!Array.isArray(value)) return [];

  const results: BrandfetchBrand[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    const domain = typeof candidate.domain === 'string' ? normalizeBrandDomain(candidate.domain) : null;
    if (!domain) continue;
    results.push({
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : domain,
      domain,
      // Rendered straight into an <img src>, so only accept a real web URL from the API.
      icon: typeof candidate.icon === 'string' && /^https?:\/\//i.test(candidate.icon.trim()) ? candidate.icon.trim() : '',
      brandId: typeof candidate.brandId === 'string' ? candidate.brandId : '',
      claimed: candidate.claimed === true,
    });
    if (results.length === 20) break;
  }
  return results;
}

/**
 * The logo URL to actually render for a saved accordion logo.
 *
 * A stored Brandfetch URL carries the client id of the day it was picked, so rotating that id
 * would silently break every logo already saved in a lesson. When the brand domain was recorded
 * the URL is rebuilt from it with the current id; anything else (a library upload, a pre-existing
 * logo, or an unconfigured tenant) falls back to what was saved.
 */
export function resolveBrandLogoUrl(
  logoUrl: string,
  brandDomain?: string | null,
  clientId: string = BRANDFETCH_CLIENT_ID,
): string {
  const rebuilt = brandDomain ? buildBrandfetchLogoUrl(brandDomain, clientId) : '';
  return rebuilt || logoUrl || '';
}

export async function searchBrandfetch(query: string, clientId: string, signal?: AbortSignal): Promise<BrandfetchBrand[]> {
  const needle = query.trim();
  if (needle.length < 2 || !clientId.trim()) return [];

  const response = await fetch(`https://api.brandfetch.io/v2/search/${encodeURIComponent(needle)}?c=${encodeURIComponent(clientId.trim())}`, { signal });
  if (!response.ok) throw new Error(`Brand search failed (${response.status})`);
  return parseBrandfetchResults(await response.json());
}
