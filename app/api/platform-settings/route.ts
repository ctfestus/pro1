/**
 * GET  /api/platform-settings  -- returns the singleton branding row
 * POST /api/platform-settings  -- upserts (admin only), busts tenant cache
 */
import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';


export async function GET() {
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const { data } = await anon
    .from('platform_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const safeUrl = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!s) return null;
    try {
      const { protocol } = new URL(s);
      if (protocol !== 'https:' && protocol !== 'http:') return null;
    } catch {
      if (!s.startsWith('/')) return null;
    }
    return s;
  };

  const record: Record<string, any> = { id: 'default', updated_at: new Date().toISOString() };
  if (body.appName        !== undefined) record.app_name        = body.appName.trim()        || null;
  if (body.orgName        !== undefined) record.org_name        = body.orgName.trim()        || null;
  if (body.appUrl         !== undefined) record.app_url         = safeUrl(body.appUrl);
  if (body.logoUrl        !== undefined) record.logo_url        = safeUrl(body.logoUrl);
  if (body.logoDarkUrl    !== undefined) record.logo_dark_url   = safeUrl(body.logoDarkUrl);
  if (body.brandColor     !== undefined) record.brand_color     = body.brandColor.trim()     || null;
  if (body.senderName     !== undefined) record.sender_name     = body.senderName.trim()     || null;
  if (body.teamName       !== undefined) record.team_name       = body.teamName.trim()       || null;
  if (body.supportEmail   !== undefined) record.support_email   = body.supportEmail.trim()   || null;
  if (body.appDescription !== undefined) record.app_description = body.appDescription.trim() || null;
  if (body.faviconUrl     !== undefined) record.favicon_url     = safeUrl(body.faviconUrl);
  if (body.emailBannerUrl !== undefined) record.email_banner_url = safeUrl(body.emailBannerUrl);
  if (body.whatsappCommunityUrl !== undefined) record.whatsapp_community_url = safeUrl(body.whatsappCommunityUrl);
  // Coerced with === true rather than trusted: a form can send the string 'false', which is
  // truthy, and this one field decides whether strangers can create accounts on the platform.
  if (body.publicSignupEnabled !== undefined) record.public_signup_enabled = body.publicSignupEnabled === true;

  const { error } = await adminClient()
    .from('platform_settings')
    .upsert(record, { onConflict: 'id' });

  if (error) {
    console.error('[platform-settings]', error);
    return NextResponse.json({ error: 'Failed to save platform settings.' }, { status: 500 });
  }

  revalidateTag('tenant-settings');
  return NextResponse.json({ ok: true });
}
