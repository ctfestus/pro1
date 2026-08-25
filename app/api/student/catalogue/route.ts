/**
 * The full catalogue for the Explore section: everything published, each marked locked or not.
 *
 * WHY THIS ROUTE EXISTS AT ALL. RLS on courses and virtual_experiences restricts SELECT to rows the
 * student is entitled to, so the browser cannot read a locked row -- not even its title. That is
 * the right default and it is what makes the padlock real rather than cosmetic: a locked item
 * cannot be opened even by someone bypassing the UI, because the database refuses the content.
 *
 * It also means the policy cannot simply be widened to show the catalogue. RLS is row-level, so
 * allowing a locked course's row would allow `courses.questions` with it -- the answers included.
 * Hence a service-role read that returns ONLY display fields, listed explicitly below. Nothing here
 * selects questions, lessons, scenarios or answer keys, and nothing should ever be added that does.
 *
 * The `locked` flag mirrors the RLS rules rather than inventing its own, or a student would see a
 * padlock on something they can actually open.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { fetchAllRows } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

export type CatalogueType = 'course' | 'learning_path' | 'virtual_experience' | 'certification';

export interface CatalogueItem {
  id: string;
  type: CatalogueType;
  title: string;
  slug: string | null;
  coverImage: string | null;
  description: string | null;
  category: string | null;
  locked: boolean;
  pathItems?: CataloguePathItem[];
}

export interface CataloguePathItem {
  id: string;
  type: 'course' | 'virtual_experience' | 'certification';
  title: string;
  slug: string | null;
  coverImage: string | null;
}

type Row = {
  id: string;
  title: string | null;
  slug?: string | null;
  cover_image: string | null;
  description: string | null;
  category?: string | null;
  cohort_ids: string[] | null;
  available_to_everyone?: boolean | null;
};

type PathRow = Row & { item_ids?: string[] | null };

export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;

  const db = adminClient();

  const { data: profile, error: profileError } = await db
    .from('students')
    .select('cohort_id')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) {
    console.error('[student/catalogue] profile lookup failed', profileError.message);
    return NextResponse.json({ error: 'Could not load the catalogue.' }, { status: 500 });
  }
  const cohortId: string | null = profile?.cohort_id ?? null;

  // Every read is paged: a catalogue grows with the tenant, and the row cap truncates SILENTLY,
  // which here would read as "that course does not exist".
  //
  // Written out rather than looped over a table name, because a non-literal column string defeats
  // the client's row-type inference and the whole point of this route is that its projection is
  // pinned to display fields.
  try {
    const [courses, paths, ves, certifications] = await Promise.all([
      fetchAllRows<Row>((from, to) => db.from('courses')
        .select('id, title, slug, cover_image, description, category, cohort_ids, available_to_everyone', { count: 'exact' })
        .eq('status', 'published').order('id').range(from, to)),
      fetchAllRows<PathRow>((from, to) => db.from('learning_paths')
        .select('id, title, cover_image, description, cohort_ids, item_ids, available_to_everyone', { count: 'exact' })
        .eq('status', 'published').order('id').range(from, to)),
      fetchAllRows<Row>((from, to) => db.from('virtual_experiences')
        .select('id, title, slug, cover_image, description, cohort_ids, available_to_everyone', { count: 'exact' })
        .eq('status', 'published').order('id').range(from, to)),
      fetchAllRows<Row>((from, to) => db.from('certifications')
        .select('id, title, slug, cover_image, description, cohort_ids, available_to_everyone', { count: 'exact' })
        .eq('status', 'published').order('id').range(from, to)),
    ]);

    // A course or VE inside a learning path assigned to the student's cohort is reachable through
    // that path, which RLS honours. Miss this and a student sees a padlock on something they can
    // already open from their own learning.
    const grantedByPath = new Set<string>();
    for (const p of paths) {
      const reaches = p.available_to_everyone === true
        || (!!cohortId && (p.cohort_ids ?? []).includes(cohortId));
      if (!reaches) continue;
      for (const id of p.item_ids ?? []) grantedByPath.add(id);
    }

    const inCohort = (row: Row) => !!cohortId && (row.cohort_ids ?? []).includes(cohortId);

    const displayById = new Map<string, CataloguePathItem>();
    for (const r of courses) {
      displayById.set(r.id, {
        id: r.id,
        type: 'course',
        title: r.title ?? 'Untitled',
        slug: r.slug ?? null,
        coverImage: r.cover_image ?? null,
      });
    }
    for (const r of ves) {
      displayById.set(r.id, {
        id: r.id,
        type: 'virtual_experience',
        title: r.title ?? 'Untitled',
        slug: r.slug ?? null,
        coverImage: r.cover_image ?? null,
      });
    }
    for (const r of certifications) {
      displayById.set(r.id, {
        id: r.id,
        type: 'certification',
        title: r.title ?? 'Untitled',
        slug: r.slug ?? null,
        coverImage: r.cover_image ?? null,
      });
    }

    const map = (rows: Row[], type: CatalogueType, viaPath: boolean): CatalogueItem[] =>
      rows.map(r => ({
        id: r.id,
        type,
        title: r.title ?? 'Untitled',
        slug: r.slug ?? null,
        coverImage: r.cover_image ?? null,
        description: r.description ?? null,
        category: r.category ?? null,
        locked: !(
          r.available_to_everyone === true
          || inCohort(r)
          || (viaPath && grantedByPath.has(r.id))
        ),
        ...(type === 'learning_path'
          ? { pathItems: ((r as PathRow).item_ids ?? []).map(id => displayById.get(id)).filter(Boolean) as CataloguePathItem[] }
          : {}),
      }));

    const items: CatalogueItem[] = [
      // available_to_everyone exists only on courses and certifications. Paths and virtual
      // experiences are cohort-assigned, so for an account with no cohort they are all locked --
      // which is exactly what an Explore page is for.
      ...map(courses, 'course', true),
      ...map(paths, 'learning_path', false),
      ...map(ves, 'virtual_experience', true),
      ...map(certifications, 'certification', false),
    ];

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error('[student/catalogue] load failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load the catalogue.' }, { status: 500 });
  }
}
