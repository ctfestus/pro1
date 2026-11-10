import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { normalizeProductAddress, PRODUCT_ADDRESS, RESERVED_PRODUCT_ADDRESSES } from '@/lib/books/product-type';
import { refreshBookStore } from '@/lib/books/store-cache';

// PATCH /api/books/address { id, slug, expectedUpdatedAt } -> { slug, updatedAt }
//
// Change a product's web address (/products/<slug>). The author's own products only (an admin any).
// Lowercase letters, digits and hyphens; not an address the store itself uses; not another
// product's (books.slug is unique, so the database has the last word). The old address stops
// working: links already shared will not find the product.
//
// It takes part in the editor's version check, like save_book: the change applies only if the
// product is still at the version the editor loaded, and it moves the version on, so another tab
// open on the older version cannot save over it (and cut a sample with the old address in it).
export const dynamic = 'force-dynamic';

const ROLES = ['admin', 'instructor'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ROLES);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  const id = typeof body?.id === 'string' && UUID.test(body.id) ? body.id : null;
  if (!id) return NextResponse.json({ error: 'A valid product id is required.' }, { status: 400 });
  const expected = typeof body?.expectedUpdatedAt === 'string' && !Number.isNaN(Date.parse(body.expectedUpdatedAt)) ? body.expectedUpdatedAt : null;
  if (!expected) return NextResponse.json({ error: 'Reload the product and try again.' }, { status: 400 });
  const slug = normalizeProductAddress(body?.slug);
  if (!PRODUCT_ADDRESS.test(slug)) {
    return NextResponse.json({ error: 'Use 2 to 120 lowercase letters, numbers and hyphens.' }, { status: 400 });
  }
  if (RESERVED_PRODUCT_ADDRESSES.has(slug)) return NextResponse.json({ error: 'That address is reserved. Choose another.' }, { status: 400 });

  const db = auth.serviceDb;
  try {
    const { data: book, error } = await db.from('books').select('id, user_id, slug, updated_at').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!book) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    if (auth.role !== 'admin' && book.user_id !== auth.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const changed = () => NextResponse.json({ error: 'This product was changed since you opened it. Reload to see the latest version.' }, { status: 409 });
    if (Date.parse(book.updated_at) !== Date.parse(expected)) return changed();
    if (book.slug === slug) return NextResponse.json({ slug, updatedAt: book.updated_at });

    const { data: saved, error: updateError } = await db.from('books')
      .update({ slug, updated_at: new Date().toISOString() })
      .eq('id', id).eq('updated_at', book.updated_at)
      .select('slug, updated_at').maybeSingle();
    if (updateError) {
      if ((updateError as any).code === '23505') return NextResponse.json({ error: 'Another product already uses that address.' }, { status: 409 });
      if ((updateError as any).code === '23514') return NextResponse.json({ error: 'Use 2 to 120 lowercase letters, numbers and hyphens.' }, { status: 400 });
      throw updateError;
    }
    // Someone saved between our read and the update: the version moved on, so nothing changed.
    if (!saved) return changed();
    refreshBookStore();
    return NextResponse.json({ slug: saved.slug, updatedAt: saved.updated_at });
  } catch (e: any) {
    console.error('[books/address] failed', e?.message ?? e);
    return NextResponse.json({ error: 'Could not change the address.' }, { status: 500 });
  }
}
