/**
 * GET  /api/site-settings  -- returns { template, config }
 * POST /api/site-settings  -- upserts (admin/instructor only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';


export async function GET() {
  const { data } = await adminClient()
    .from('site_settings')
    .select('template, config')
    .eq('singleton', true)
    .maybeSingle();

  return NextResponse.json({ data: data ?? { template: 'momentum', config: {} } });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { user } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { template, config } = body;
  if (!template || typeof config !== 'object') {
    return NextResponse.json({ error: 'template and config are required' }, { status: 400 });
  }

  const { error } = await adminClient()
    .from('site_settings')
    .upsert(
      { singleton: true, template, config, updated_by: user.id },
      { onConflict: 'singleton' }
    );

  if (error) {
    console.error('[site-settings]', error);
    return NextResponse.json({ error: 'Failed to save site settings.' }, { status: 500 });
  }

  revalidateTag('landing-site-settings');
  return NextResponse.json({ ok: true });
}
