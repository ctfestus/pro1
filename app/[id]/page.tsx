import type { Metadata } from 'next';
import { buildShareMetadata } from '@/lib/content-share-metadata';
import { getPricingPageData } from '@/lib/get-pricing-page-data';
import { planPromotions, type PromotionTeaser } from '@/lib/pricing-offer';
import PublicFormPage from './PublicFormPage';

// Server wrapper so link previews can read ?catalogueType= (a layout never receives search
// params). The page itself is the client component in PublicFormPage.tsx.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const catalogueType = typeof query.catalogueType === 'string' ? query.catalogueType : null;
  return buildShareMetadata(id, catalogueType);
}

// Each plan's running promotion, for the scroll prompt on the detail pages. Read from the
// same cached public view as the pricing page, so the two can never quote different discounts.
// A pricing outage must not take the content page down with it, so it just means no prompt.
async function currentPromotions(): Promise<PromotionTeaser[]> {
  try {
    return planPromotions((await getPricingPageData()).plans);
  } catch {
    return [];
  }
}

export default async function Page() {
  return <PublicFormPage promotions={await currentPromotions()} />;
}
