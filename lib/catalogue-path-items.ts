/**
 * What a learning path's contents look like on any catalogue surface.
 *
 * A path preview is built by two routes -- /api/student/catalogue for a signed-in learner and
 * /api/catalogue-preview for a visitor who is not -- and both fill the same page. They had grown
 * their own copies of this mapping, and the copies disagreed: the public route fetched each
 * item's description, the student one did not. So a signed-in learner without access saw the very
 * same page with every course blurb missing, and knew LESS about what they were being sold than an
 * anonymous visitor did.
 *
 * One definition of the shape, one function that builds it, one place that knows descriptions live
 * across three tables.
 */

export type PathItemType = 'course' | 'virtual_experience' | 'certification';

export interface CataloguePathItem {
  id: string;
  type: PathItemType;
  title: string;
  slug: string | null;
  coverImage: string | null;
  description: string | null;
}

/** The published_path_items view says 've'; every surface that reads it says virtual_experience. */
export function normalizePathItemType(raw: unknown): PathItemType {
  return raw === 've' ? 'virtual_experience' : (raw as PathItemType);
}

/**
 * One content row as a path item.
 *
 * `description` is taken from the row when it carries one, or passed in when it was looked up
 * separately -- the two routes get it from different places, which is exactly how they came to
 * disagree about whether to include it at all.
 */
export function pathItemFromRow(
  row: any,
  type: PathItemType,
  description?: string | null,
): CataloguePathItem {
  return {
    id: row?.id,
    type,
    title: row?.title ?? 'Untitled',
    slug: row?.slug ?? null,
    coverImage: row?.cover_image ?? row?.coverImage ?? null,
    description: description !== undefined ? description : (row?.description ?? null),
  };
}

/** The three tables a path can draw from. */
const ITEM_TABLES = ['courses', 'virtual_experiences', 'certifications'] as const;

/**
 * Descriptions for a set of path items, whatever type each one is.
 *
 * A path mixes courses, experiences and certifications, and an id alone does not say which table
 * to look in -- so all three are asked and the answers merged. Only published rows, so an item
 * that has been unpublished since it was added to the path contributes nothing.
 */
export async function loadPathItemDescriptions(db: any, ids: string[]): Promise<Map<string, string | null>> {
  const byId = new Map<string, string | null>();
  if (!ids.length) return byId;

  const results = await Promise.all(ITEM_TABLES.map(table =>
    db.from(table).select('id, description').in('id', ids).eq('status', 'published'),
  ));
  for (const { data } of results) {
    for (const row of data ?? []) byId.set(row.id, row.description ?? null);
  }
  return byId;
}
