import { NextRequest, NextResponse } from 'next/server';
import { getProductsForCourse } from '@/lib/books/store';

// GET /api/books/for-course?courseId=...  -> { products: [{ id, slug, title, coverImage, format, free, prices }] }
//
// The digital products an author recommends with a course (migration 240), for the course page and
// the "What to take next" list after it. Public, like the store: only products anyone may buy or
// download, display fields only (lib/books/store.ts), cached for a minute.
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const courseId = req.nextUrl.searchParams.get('courseId') ?? '';
  try {
    const products = (await getProductsForCourse(courseId)).map(b => ({
      id: b.id, slug: b.slug, title: b.title, coverImage: b.coverImage, format: b.format, free: b.free, prices: b.prices,
    }));
    return NextResponse.json({ products }, { headers: { 'Cache-Control': 'public, max-age=60' } });
  } catch (e: any) {
    console.error('[books/for-course]', e?.message ?? e);
    return NextResponse.json({ products: [] });
  }
}
