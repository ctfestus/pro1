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
import { courseContentCounts, courseXpOnOffer } from '@/lib/course-progress';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';
import {
  loadPlansForContent,
  type PlanWithPrices,
  type PurchasableContentTable,
} from '@/lib/subscription-plan-access';

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
  /** Only ever set on a single-item lookup of a locked item. */
  unlock?: { plans: PlanWithPrices[] };
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

const CONTENT_TABLE_BY_TYPE: Record<CatalogueType, PurchasableContentTable> = {
  course: 'courses',
  learning_path: 'learning_paths',
  virtual_experience: 'virtual_experiences',
  certification: 'certifications',
};

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
      ...map(certifications, 'certification', true),
    ];

    const ref = req.nextUrl.searchParams.get('ref')?.trim();
    if (ref) {
      const requestedType = req.nextUrl.searchParams.get('type') as CatalogueType | null;
      const item = items.find(candidate =>
        (candidate.id === ref || candidate.slug === ref)
        && (!requestedType || candidate.type === requestedType),
      ) ?? null;
      if (!item) return NextResponse.json({ item: null });

      // A locked item is a shop window, so it has to be able to say what opening it costs.
      // The answer is whatever an admin actually configured -- a plan selling only six months
      // has exactly one price here -- rather than a sentence naming durations that may not be
      // on sale. Prices only, never the plan's full contents: this route still describes a
      // locked item without handing over what is inside it.
      //
      // Sellable plans only. No renewal exemption belongs here: a locked item is by definition
      // one the learner's own plan does not open, so their plan is never the answer.
      if (item.locked) {
        item.unlock = {
          plans: await loadPlansForContent(
            db,
            {
              contentTable: CONTENT_TABLE_BY_TYPE[item.type],
              contentId: item.id,
            },
            { sellableOnly: true },
          ),
        };
      }

      if (item.type === 'course' && item.locked) {
        // Appearance and the "what you get" counts join the title-only outline. They are
        // presentation, not content: without them the locked detail page falls back to its own
        // defaults and shows the wrong theme, accent and font for the course being sold, and it
        // can say nothing about the exercises the outline withholds.
        const { data: course } = await db
          .from('courses')
          .select('questions, mode, theme, font, custom_accent, points_enabled, points_base, points_system')
          .eq('id', item.id)
          .maybeSingle();
        const outline = ((course?.questions ?? []) as any[]).flatMap(question => {
          if (question?.isSection && question.sectionTitle) {
            return [{ id: String(question.id), type: 'section', title: String(question.sectionTitle) }];
          }
          if (question?.lesson?.title) {
            return [{ id: String(question.id), type: 'lesson', title: String(question.lesson.title) }];
          }
          return [];
        });
        const contentCounts = courseContentCounts(course?.questions ?? []);
        return NextResponse.json({ item: {
          ...item,
          outline,
          mode: course?.mode ?? null,
          theme: course?.theme ?? null,
          font: course?.font ?? null,
          customAccent: course?.custom_accent ?? null,
          lessonCount: contentCounts.lessons,
          exerciseCount: contentCounts.exercises,
          xpOnOffer: courseXpOnOffer(course?.questions ?? [], pointsSystemFromCourseRow(course)),
        } });
      }
      return NextResponse.json({ item });
    }

    return NextResponse.json({ items });
  } catch (e: any) {
    console.error('[student/catalogue] load failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load the catalogue.' }, { status: 500 });
  }
}
