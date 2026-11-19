import type { Metadata } from 'next';
import { buildContentJsonLd, buildShareMetadata } from '@/lib/content-share-metadata';
import { getPricingPageData } from '@/lib/get-pricing-page-data';
import { planPromotions, type PromotionTeaser } from '@/lib/pricing-offer';
import { publicEventRedirect } from '@/lib/events/store';
import PublicFormPage from './PublicFormPage';
import { paystackIsConfigured } from '@/lib/paystack';
import { loadContentInstructor } from '@/lib/content-instructor';
import { loadLearnerCount } from '@/lib/content-learner-count';

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

// An event open to public registration has its one page at /events/<slug>. The client sends
// everyone there once its usual lookup has run: slugs are unique per table, so a course,
// experience or path with the same slug must keep this page.
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const catalogueType = typeof query.catalogueType === 'string' ? query.catalogueType : null;
  const [publicEvent, promotions, instructor, learnerCount] = await Promise.all([
    publicEventRedirect(id),
    currentPromotions(),
    loadContentInstructor(id, catalogueType),
    loadLearnerCount(id, catalogueType),
  ]);
  const publicEventPath = publicEvent ? `/events/${encodeURIComponent(publicEvent.slug)}` : null;
  const jsonLd = await buildContentJsonLd(id, catalogueType, instructor);
  return <>
    {/* JSON in a script tag: escape "<" so a title can never close the tag. */}
    {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />}
    <PublicFormPage promotions={promotions} publicEventPath={publicEventPath} paystackEnabled={paystackIsConfigured()} instructor={instructor} learnerCount={learnerCount} />
  </>;
}
