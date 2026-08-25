/**
 * GET    /api/tool-icons  -- public list of { name, image }
 * POST   /api/tool-icons  -- add or replace one icon (admin/instructor)
 * DELETE /api/tool-icons  -- remove one icon (admin/instructor)
 *
 * The GET is deliberately unauthenticated: these logos render on the public landing page and on
 * public profile pages, and the table's RLS makes the same read public. Writes follow the same
 * rule as the other platform-appearance surfaces.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { normalizeToolName } from '@/lib/tool-icons';

export const dynamic = 'force-dynamic';

/**
 * A stored reference is either a bare Cloudinary public_id or a full https URL, matching what
 * lib/cloudinary-url.ts knows how to resolve. Validated rather than trusted because the value
 * lands in an <img src>: a scheme like `javascript:` has no business reaching the browser even
 * where it would not execute, and an unbounded string has no business reaching the column.
 */
const PUBLIC_ID = /^[\w\-./%]+$/;

function validImageRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value || value.length > 500) return null;
  if (value.startsWith('https://')) {
    try { new URL(value); return value; } catch { return null; }
  }
  return PUBLIC_ID.test(value) ? value : null;
}

export async function GET() {
  const { data, error } = await adminClient()
    .from('tool_icons')
    .select('name, image')
    .order('name');

  if (error) {
    // A missing logo must never break the page it decorates, so a failed read reports an empty
    // list and every consumer falls back to the built-in defaults in lib/tool-icons.ts.
    console.error('[tool-icons] GET error:', error);
    return NextResponse.json({ icons: [] });
  }
  return NextResponse.json({ icons: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = normalizeToolName(body?.name);
  if (!name) {
    return NextResponse.json({ error: 'A tool name is required.' }, { status: 400 });
  }
  if (name.length > 80) {
    return NextResponse.json({ error: 'That tool name is too long.' }, { status: 400 });
  }
  const image = validImageRef(body?.image);
  if (!image) {
    return NextResponse.json({ error: 'An uploaded image is required.' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('tool_icons')
    .upsert({ name, image, created_by: auth.user.id }, { onConflict: 'name' });

  if (error) {
    console.error('[tool-icons] upsert error:', error);
    return NextResponse.json({ error: 'Could not save that icon.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, name });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const name = normalizeToolName(body?.name);
  if (!name) return NextResponse.json({ error: 'A tool name is required.' }, { status: 400 });

  const { error } = await adminClient().from('tool_icons').delete().eq('name', name);
  if (error) {
    console.error('[tool-icons] delete error:', error);
    return NextResponse.json({ error: 'Could not remove that icon.' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
