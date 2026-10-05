import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadPlansForContent,
  type PurchasableContentTable,
} from '@/lib/subscription-plan-access';

/**
 * What an anonymous visitor may learn about one catalogue item: the lookup and visibility gate
 * behind /api/catalogue-preview, shared with the link-preview metadata so a crawler (also
 * anonymous) is never shown more than the page shows a signed-out visitor.
 *
 * Two rules keep this safe to serve to anyone:
 *
 * 1. The projection is pinned to display fields and must never be widened. No lesson bodies, no
 *    answer keys.
 * 2. Only `status = 'published'` rows are visible, and of those only content that is open to
 *    everyone or that a sellable plan covers. Draft, archived and cohort-only content stays
 *    invisible.
 */
export type PublicCatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification';

export const PUBLIC_CATALOGUE_TABLE: Record<PublicCatalogueType, PurchasableContentTable> = {
  course: 'courses',
  learning_path: 'learning_paths',
  virtual_experience: 'virtual_experiences',
  certification: 'certifications',
};

// Learning paths carry no slug column, so they are addressable by id only.
const HAS_SLUG: Record<PublicCatalogueType, boolean> = {
  course: true,
  learning_path: false,
  virtual_experience: true,
  certification: true,
};

// Pinned. Widening this is what would turn a sales page into a content leak.
const COLUMNS: Record<PublicCatalogueType, string> = {
  course: 'id, title, slug, cover_image, description, category, available_to_everyone',
  learning_path: 'id, title, cover_image, description, item_ids, badge_image_url, available_to_everyone, overview, skills, who_should_take, tools',
  virtual_experience: 'id, title, slug, cover_image, description, available_to_everyone',
  certification: 'id, title, slug, cover_image, description, available_to_everyone',
};

const ORDER: PublicCatalogueType[] = ['course', 'virtual_experience', 'certification', 'learning_path'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PublicCatalogueItem = {
  type: PublicCatalogueType;
  record: any;
  locked: boolean;
  plans: Awaited<ReturnType<typeof loadPlansForContent>>;
};

/** Throws on a query error; returns null when nothing an anonymous visitor may see matches. */
export async function findPublicCatalogueItem(
  db: SupabaseClient,
  ref: string,
  requestedType?: string | null,
): Promise<PublicCatalogueItem | null> {
  const types: PublicCatalogueType[] = requestedType && requestedType in PUBLIC_CATALOGUE_TABLE
    ? [requestedType as PublicCatalogueType]
    : ORDER;
  const byId = UUID.test(ref);

  for (const type of types) {
    if (!byId && !HAS_SLUG[type]) continue;
    const { data: row, error } = await db
      .from(PUBLIC_CATALOGUE_TABLE[type])
      .select(COLUMNS[type])
      .eq('status', 'published')
      .eq(byId ? 'id' : 'slug', ref)
      .maybeSingle();
    if (error) throw error;
    if (!row) continue;

    const record = row as any;
    // Free means what the signed-in rule means: open to everyone itself, or inside a published
    // path that is. public_free_content already answers both, so a course reached from a free
    // path is shown as free here too rather than as something to buy.
    let locked = record.available_to_everyone !== true;
    if (locked) {
      const { data: free, error: freeError } = await db
        .from('public_free_content')
        .select('content_id')
        .eq('content_table', PUBLIC_CATALOGUE_TABLE[type])
        .eq('content_id', record.id)
        .maybeSingle();
      if (freeError) throw freeError;
      locked = !free;
    }

    // "Published and not open to everyone" is not the same as "for sale". Cohort-only content
    // -- a course built for one client's private cohort, never offered to the public -- is
    // published too, and RLS previously kept it invisible to anonymous visitors. Revealing its
    // title, blurb and cover to anyone who guessed a slug would be a leak, not a shop window.
    //
    // So the gate is whether anything actually sells it: a plan the pricing page would list
    // covering this item. Content nobody can buy stays as invisible as before. Sellable rather
    // than merely active, so this window never advertises a plan checkout would then refuse.
    const plans = locked
      ? await loadPlansForContent(
          db,
          { contentTable: PUBLIC_CATALOGUE_TABLE[type], contentId: record.id },
          { sellableOnly: true },
        )
      : [];
    if (locked && plans.length === 0) return null;

    return { type, record, locked, plans };
  }
  return null;
}
