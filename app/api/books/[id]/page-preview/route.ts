import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { loadPreviewBook } from '@/lib/books/store';

// GET /api/books/[id]/page-preview -> { book, blockers }
//
// For the editor's "Preview page": the product's public page as buyers will see it, in any status
// (drafts included), plus what still keeps it off the store. Only for the product's owning
// instructor or an admin, the same rule as editing it (app/api/books/route.ts). The book is built
// by lib/books/store.ts, so it carries no file paths.
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Product not found.' }, { status: 404, headers: NO_STORE });

  const db = auth.serviceDb;
  try {
    const { data: owner, error } = await db.from('books').select('id, user_id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!owner) return NextResponse.json({ error: 'Product not found.' }, { status: 404, headers: NO_STORE });
    if (auth.role !== 'admin' && (owner as any).user_id !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
    }
    const preview = await loadPreviewBook(id, db);
    if (!preview) return NextResponse.json({ error: 'Product not found.' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(preview, { headers: NO_STORE });
  } catch (e: any) {
    console.error('[books/page-preview]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not load the preview.' }, { status: 500, headers: NO_STORE });
  }
}
