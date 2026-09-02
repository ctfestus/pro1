/**
 * GET ?ref=<id|slug>&type=<catalogue type>  -- PUBLIC, no auth.
 *
 * Display metadata and purchase prices for one published catalogue item, for a visitor who is
 * not signed in.
 *
 * RLS hides paid content from the browser entirely and the student catalogue needs a session, so
 * without this a shared link to a paid course rendered "Not found" -- a broken page where the
 * sales page should be, and the end of every word-of-mouth referral. It also meant the prices on
 * a locked item were invisible to exactly the people who have not bought yet.
 *
 * Two rules keep this safe to serve to anyone:
 *
 * 1. The projection is pinned to display fields and must never be widened. No lesson bodies, no
 *    answer keys. Course previews may include a title-only outline so the sales page can match
 *    the normal course overview without leaking the course material.
 * 2. Only `status = 'published'` rows are visible. Draft and archived content stays invisible.
 *
 * An anonymous viewer belongs to no cohort, so `locked` reduces to "is this offered to everyone",
 * which is the authenticated rule in app/api/student/catalogue evaluated with no viewer.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import {
  loadPlansForContent,
  type PurchasableContentTable,
} from '@/lib/subscription-plan-access';
import { courseContentCounts, courseXpOnOffer } from '@/lib/course-progress';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';

export const dynamic = 'force-dynamic';

type PreviewType = 'course' | 'learning_path' | 'virtual_experience' | 'certification';

const TABLE_BY_TYPE: Record<PreviewType, PurchasableContentTable> = {
  course: 'courses',
  learning_path: 'learning_paths',
  virtual_experience: 'virtual_experiences',
  certification: 'certifications',
};

// Learning paths carry no slug column, so they are addressable by id only.
const HAS_SLUG: Record<PreviewType, boolean> = {
  course: true,
  learning_path: false,
  virtual_experience: true,
  certification: true,
};

// Pinned. Widening this is what would turn a sales page into a content leak.
const COLUMNS: Record<PreviewType, string> = {
  course: 'id, title, slug, cover_image, description, category, available_to_everyone',
  learning_path: 'id, title, cover_image, description, item_ids, badge_image_url, available_to_everyone',
  virtual_experience: 'id, title, slug, cover_image, description, available_to_everyone',
  certification: 'id, title, slug, cover_image, description, available_to_everyone',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get('ref')?.trim();
  if (!ref) return NextResponse.json({ error: 'ref is required' }, { status: 400 });

  const requestedType = req.nextUrl.searchParams.get('type') as PreviewType | null;
  const types: PreviewType[] = requestedType && requestedType in TABLE_BY_TYPE
    ? [requestedType]
    : ['course', 'virtual_experience', 'certification', 'learning_path'];

  const db = adminClient();
  const byId = UUID.test(ref);

  try {
    for (const type of types) {
      if (!byId && !HAS_SLUG[type]) continue;
      const { data: row, error } = await db
        .from(TABLE_BY_TYPE[type])
        .select(COLUMNS[type])
        .eq('status', 'published')
        .eq(byId ? 'id' : 'slug', ref)
        .maybeSingle();
      if (error) throw error;
      if (!row) continue;

      const record = row as any;
      const locked = record.available_to_everyone !== true;

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
            { contentTable: TABLE_BY_TYPE[type], contentId: record.id },
            { sellableOnly: true },
          )
        : [];
      if (locked && plans.length === 0) return NextResponse.json({ item: null });

      const item = {
        id: record.id as string,
        type,
        title: (record.title as string) ?? 'Untitled',
        slug: (record.slug as string) ?? null,
        coverImage: (record.cover_image as string) ?? null,
        description: (record.description as string) ?? null,
        category: (record.category as string) ?? null,
        locked,
        ...(locked ? { unlock: { plans } } : {}),
      };

      if (type === 'learning_path') {
        const { data: pathItems, error: pathItemsError } = await db
          .from('published_path_items')
          .select('path_id,id,title,cover_image,slug,type,position')
          .eq('path_id', record.id)
          .order('position');
        if (pathItemsError) throw pathItemsError;
        const pathItemIds = (pathItems ?? []).map((pathItem: any) => pathItem.id);
        const [
          { data: courseDescriptions },
          { data: veDescriptions },
          { data: certDescriptions },
        ] = await Promise.all([
          pathItemIds.length
            ? db.from('courses').select('id, description').in('id', pathItemIds).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          pathItemIds.length
            ? db.from('virtual_experiences').select('id, description').in('id', pathItemIds).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          pathItemIds.length
            ? db.from('certifications').select('id, description').in('id', pathItemIds).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
        ]);
        const descriptionById = new Map<string, string | null>();
        for (const row of courseDescriptions ?? []) descriptionById.set(row.id, row.description ?? null);
        for (const row of veDescriptions ?? []) descriptionById.set(row.id, row.description ?? null);
        for (const row of certDescriptions ?? []) descriptionById.set(row.id, row.description ?? null);

        return NextResponse.json({
          item: {
            ...item,
            itemIds: (record.item_ids ?? []) as string[],
            badgeImageUrl: (record.badge_image_url as string) ?? null,
            pathItems: (pathItems ?? []).map((pathItem: any) => ({
              id: pathItem.id,
              title: pathItem.title,
              slug: pathItem.slug,
              coverImage: pathItem.cover_image,
              description: descriptionById.get(pathItem.id) ?? null,
              type: pathItem.type === 've' ? 'virtual_experience' : pathItem.type,
            })),
          },
        });
      }

      if (type === 'course') {
        // Appearance and the "what you get" counts ride along with the outline. They are
        // presentation, not content: without them the locked detail page falls back to its own
        // defaults and shows the wrong theme, accent and font for the course being sold, and it
        // can say nothing about the exercises the outline withholds.
        const { data: course, error: outlineError } = await db
          .from('courses')
          .select('questions, mode, theme, font, custom_accent, points_enabled, points_base, points_system')
          .eq('id', record.id)
          .maybeSingle();
        if (outlineError) throw outlineError;
        const outline = ((course?.questions ?? []) as any[]).flatMap(question => {
          if (question?.isSection && question.sectionTitle) {
            return [{ id: String(question.id), type: 'section', title: String(question.sectionTitle) }];
          }
          if (question?.lesson?.title) {
            return [{ id: String(question.id), type: 'lesson', title: String(question.lesson.title) }];
          }
          return [];
        });
        const contentCounts = courseContentCounts((course as any)?.questions ?? []);
        return NextResponse.json({ item: {
          ...item,
          outline,
          mode: (course as any)?.mode ?? null,
          theme: (course as any)?.theme ?? null,
          font: (course as any)?.font ?? null,
          customAccent: (course as any)?.custom_accent ?? null,
          lessonCount: contentCounts.lessons,
          exerciseCount: contentCounts.exercises,
          xpOnOffer: courseXpOnOffer((course as any)?.questions ?? [], pointsSystemFromCourseRow(course)),
        } });
      }

      return NextResponse.json({ item });
    }
    return NextResponse.json({ item: null });
  } catch (e: any) {
    console.error('[catalogue-preview] lookup failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load this content.' }, { status: 500 });
  }
}
