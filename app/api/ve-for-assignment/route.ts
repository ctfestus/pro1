import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

// GET /api/ve-for-assignment?veId=xxx
// Returns VE config using the service-role client so RLS never blocks a student
// who has access to an assignment that embeds this VE. Access requires one of:
// - the caller owns the VE, or is an instructor/admin
// - a published assignment embeds this VE (config.ve_form_id) and targets the
// caller's cohort or one of their groups
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  const veId = new URL(req.url).searchParams.get('veId');
  if (!veId) return NextResponse.json({ error: 'veId required' }, { status: 400 });

  const { data: ve, error } = await supabase
    .from('virtual_experiences')
    .select('id, title, slug, modules, company, role, industry, tagline, description, cover_image, manager_name, manager_title, guide_id, guide_snapshot, dataset, background, difficulty, duration, tools, tool_logos, learn_outcomes, theme, mode, font, custom_accent, is_short_course, badge_image_url, user_id')
    .eq('id', veId)
    .single();

  if (error || !ve) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let allowed = ve.user_id === user.id;

  if (!allowed) {
    const { data: caller } = await supabase
      .from('students')
      .select('role, cohort_id')
      .eq('id', user.id)
      .maybeSingle();

    if (caller?.role === 'admin' || caller?.role === 'instructor') {
      allowed = true;
    } else {
      // Student path: a published assignment must embed this VE and target them.
      const [{ data: assignments }, { data: memberships }] = await Promise.all([
        supabase
          .from('assignments')
          .select('cohort_ids, group_ids')
          .eq('status', 'published')
          .eq('config->>ve_form_id', veId),
        supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', user.id),
      ]);
      const myGroups = new Set((memberships ?? []).map((m: any) => m.group_id as string));
      allowed = (assignments ?? []).some((a: any) =>
        (caller?.cohort_id && (a.cohort_ids ?? []).includes(caller.cohort_id)) ||
        (a.group_ids ?? []).some((g: string) => myGroups.has(g))
      );
    }
  }

  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Do not leak the owner id to the player
  const { user_id: _owner, ...veConfig } = ve as any;
  return NextResponse.json({ ve: veConfig });
}
