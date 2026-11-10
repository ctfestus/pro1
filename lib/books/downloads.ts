import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The download log (migration 239): one row each time a download link for a full product is handed
 * out, so instructors and admins can see how often a product is downloaded and by whom. Owners' and
 * admins' own previews are not logged. A failure to log never blocks the download.
 */
export async function logBookDownload(
  db: SupabaseClient,
  entry: { bookId: string; studentId?: string | null; purchaseId?: string | null; repeatable?: boolean },
): Promise<void> {
  const row = entry.purchaseId
    ? { book_id: entry.bookId, purchase_id: entry.purchaseId, student_id: null, source: 'guest' }
    : { book_id: entry.bookId, student_id: entry.studentId ?? null, purchase_id: null, source: 'account' };
  if (row.source === 'account' && !row.student_id) return;
  try {
    // Repeat requests from one account within ten minutes count once, so the log measures people
    // downloading rather than clicks (and cannot be flooded). Guest downloads are already limited to
    // five; a guest's link opens are not (repeatable), so they count once per ten minutes too.
    if (row.source === 'account' || entry.repeatable) {
      const recentQuery = db.from('book_download_events').select('id').eq('book_id', row.book_id);
      const { data: recent, error: recentError } = await (row.source === 'account'
        ? recentQuery.eq('student_id', row.student_id as string)
        : recentQuery.eq('purchase_id', row.purchase_id as string))
        .gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString()).limit(1).maybeSingle();
      if (recentError) throw recentError;
      if (recent) return;
    }
    const { error } = await db.from('book_download_events').insert(row);
    if (error) throw error;
  } catch (e: any) {
    console.error('[books/downloads] could not log a download', entry.bookId, e?.message ?? e);
  }
}
