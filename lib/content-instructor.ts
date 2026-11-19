import 'server-only';
import { adminClient } from '@/lib/admin-client';
import { loadInstructor, type StoreInstructor } from '@/lib/books/store';

/**
 * Who teaches a course or learning path, for its public page: the creator's own profile from
 * Settings, the same one events show under "Hosted by" and products under their author.
 *
 * Only for a published item that is publicly offered (publicly_offered_content, the gate the
 * landing page uses). The page tells a visitor nothing about a cohort-only link, and its HTML
 * must not either: a name in the payload would confirm the item exists.
 */
const SOURCE = {
  course: { table: 'courses', owner: 'user_id', bySlug: true },
  learning_path: { table: 'learning_paths', owner: 'instructor_id', bySlug: false },
} as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A failure only hides the card; it never takes the page down. */
export async function loadContentInstructor(ref: string, type: string | null): Promise<StoreInstructor | null> {
  if (type !== 'course' && type !== 'learning_path') return null;
  const source = SOURCE[type];
  const byId = UUID.test(ref);
  if (!byId && !source.bySlug) return null;
  try {
    const db = adminClient();
    const { data: row } = await db.from(source.table)
      .select(`id, ${source.owner}`)
      .eq('status', 'published')
      .eq(byId ? 'id' : 'slug', ref)
      .maybeSingle();
    if (!row) return null;
    const { data: offered } = await db.from('publicly_offered_content')
      .select('content_id')
      .eq('content_table', source.table)
      .eq('content_id', (row as any).id)
      .maybeSingle();
    if (!offered) return null;
    return await loadInstructor(db, (row as any)[source.owner]);
  } catch (e: any) {
    console.error('[content-instructor] lookup failed', e?.message ?? e);
    return null;
  }
}
