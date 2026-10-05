import { brandOgImage } from '@/lib/brand-og-image';

// Public, no auth: the fallback og:image for shared content without a cover. Crawlers fetch it
// anonymously, and it only renders what the landing page preview already shows.
export const dynamic = 'force-dynamic';

export function GET() {
  return brandOgImage();
}
