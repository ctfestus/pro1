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
 * 1. The projection is pinned to display fields and must never be widened. No `questions`, no
 *    lesson bodies, no answer keys, no outline. The authenticated preview may show a lesson
 *    outline because a signed-in learner already sees titles across the catalogue; an anonymous
 *    caller gets the cover, the blurb and the price, and nothing else.
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
  learning_path: 'id, title, cover_image, description, available_to_everyone',
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
      const item = {
        id: record.id as string,
        type,
        title: (record.title as string) ?? 'Untitled',
        slug: (record.slug as string) ?? null,
        coverImage: (record.cover_image as string) ?? null,
        description: (record.description as string) ?? null,
        category: (record.category as string) ?? null,
        locked,
        ...(locked
          ? { unlock: { plans: await loadPlansForContent(db, { contentTable: TABLE_BY_TYPE[type], contentId: record.id }) } }
          : {}),
      };
      return NextResponse.json({ item });
    }
    return NextResponse.json({ item: null });
  } catch (e: any) {
    console.error('[catalogue-preview] lookup failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load this content.' }, { status: 500 });
  }
}
