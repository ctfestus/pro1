import 'server-only';
import { adminClient } from '@/lib/admin-client';
import { findSharedItem } from '@/lib/content-share-metadata';
import { PUBLIC_CATALOGUE_TABLE } from '@/lib/public-catalogue-item';

/** Below this the page says nothing: a new course should not advertise "2 learners". */
const MIN_SHOWN = 50;

/**
 * How many learners have started a course, experience or path, for its public page. Only for an
 * item the page already shows the public (the same lookup as the link preview), and only from
 * MIN_SHOWN up. A failure only hides the figure; it never takes the page down.
 */
export async function loadLearnerCount(ref: string, type: string | null): Promise<number | null> {
  const found = await findSharedItem(ref, type);
  if (!found || found.type === 'certification') return null;
  try {
    const { data, error } = await adminClient().rpc('content_learner_count', {
      p_table: PUBLIC_CATALOGUE_TABLE[found.type],
      p_id: found.record.id,
    });
    if (error) throw error;
    const count = Number(data);
    return Number.isFinite(count) && count >= MIN_SHOWN ? count : null;
  } catch (e: any) {
    console.error('[content-learner-count] lookup failed', e?.message ?? e);
    return null;
  }
}
