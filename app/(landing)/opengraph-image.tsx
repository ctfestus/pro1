import { brandOgImage } from '@/lib/brand-og-image';

export const alt = 'Learning platform course catalogue';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

export default function OpenGraphImage() {
  return brandOgImage();
}
