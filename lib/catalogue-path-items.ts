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
  /** A course's category or an experience's industry, as Explore labels it. */
  category: string | null;
}

/** The published_path_items view says 've'; every surface that reads it says virtual_experience. */
export function normalizePathItemType(raw: unknown): PathItemType {
  return raw === 've' ? 'virtual_experience' : (raw as PathItemType);
}

/** The label Explore puts on an item: a course's category, or an experience's industry. */
export function itemCategory(row: any): string | null {
  if (row?.category) return row.category;
  const industry = typeof row?.industry === 'string' ? row.industry.trim() : '';
  return industry ? industry.charAt(0).toUpperCase() + industry.slice(1) : null;
}

/**
 * One content row as a path item.
 *
 * `description` and `category` are taken from the row when it carries them, or passed in when
 * they were looked up separately -- the two routes get them from different places, which is
 * exactly how they came to disagree about whether to include a description at all.
 */
export function pathItemFromRow(
  row: any,
  type: PathItemType,
  details?: PathItemDetails,
): CataloguePathItem {
  return {
    id: row?.id,
    type,
    title: row?.title ?? 'Untitled',
    slug: row?.slug ?? null,
    coverImage: row?.cover_image ?? row?.coverImage ?? null,
    description: details ? details.description : (row?.description ?? null),
    category: details ? details.category : itemCategory(row),
  };
}

export type PathItemDetails = { description: string | null; category: string | null };

/** The three tables a path can draw from, and the columns its details come from. */
const ITEM_TABLES = [
  ['courses', 'id, description, category'],
  ['virtual_experiences', 'id, description, industry'],
  ['certifications', 'id, description'],
] as const;

/**
 * Descriptions for a set of path items, whatever type each one is.
 *
 * A path mixes courses, experiences and certifications, and an id alone does not say which table
 * to look in -- so all three are asked and the answers merged. Only published rows, so an item
 * that has been unpublished since it was added to the path contributes nothing.
 */
export async function loadPathItemDetails(db: any, ids: string[]): Promise<Map<string, PathItemDetails>> {
  const byId = new Map<string, PathItemDetails>();
  if (!ids.length) return byId;

  const results = await Promise.all(ITEM_TABLES.map(([table, columns]) =>
    db.from(table).select(columns).in('id', ids).eq('status', 'published'),
  ));
  for (const { data } of results) {
    for (const row of data ?? []) byId.set(row.id, { description: row.description ?? null, category: itemCategory(row) });
  }
  return byId;
}
