import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { groupAssignedEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { loadCohortMembership, isStillInGroupCohort } from '@/lib/cohort-roster';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);


export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  const body = await req.json().catch(() => ({}));
  const { group_id } = body as { group_id?: string };
  if (!group_id) return NextResponse.json({ error: 'group_id required' }, { status: 400 });

  const supabase = adminClient();
  const [{ data: group }, settings] = await Promise.all([
    supabase
      .from('groups')
      .select('id, name, description, cohort_id, cohorts(name), group_members(student_id, is_leader, students(id, full_name, email))')
      .eq('id', group_id)
      .single(),
    getTenantSettings(),
  ]);

  if (!group) return NextResponse.json({ error: 'Group not found' }, { status: 404 });

  // Leaving a cohort means leaving that cohort's groups (migration 206 prunes the membership rows
  // when a cohort changes). This check is the net for a database behind on that migration: someone
  // who left is neither mailed nor listed as a member to everybody else. See lib/cohort-roster.
  const storedMembers = (group.group_members as any[]) ?? [];
  let members = storedMembers;
  try {
    const membership     = await loadCohortMembership(supabase, storedMembers.map((m: any) => m.student_id as string));
    members = storedMembers.filter((m: any) =>
      isStillInGroupCohort(membership.get(m.student_id), (group.cohort_id as string | null) ?? null));
  } catch (err) {
    console.error('[groups/notify] roster lookup failed for group', group_id, err);
    return NextResponse.json({ error: 'Could not check who is still in this cohort.' }, { status: 500 });
  }
  if (members.length === 0) return NextResponse.json({ sent: 0 });

  const cohortName = (group.cohorts as any)?.name ?? '';
  const dashboardUrl = `${settings.appUrl}/student`;
  const fromEmail = process.env.RESEND_FROM_EMAIL || `${settings.senderName} <${settings.supportEmail}>`;
  const branding = {
    logoUrl:       settings.logoUrl,
    emailBannerUrl: settings.emailBannerUrl,
    teamName:      settings.teamName,
    appName:       settings.appName,
    appUrl:        settings.appUrl,
  };

  const memberList = members.map((m: any) => ({
    full_name: m.students?.full_name ?? 'Member',
    is_leader: m.is_leader ?? false,
  }));

  let sent = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < members.length; i += BATCH_SIZE) {
    const batch = members.slice(i, i + BATCH_SIZE);
    const emails: { from: string; to: string; subject: string; html: string }[] = [];

    for (const m of batch) {
      const student = m.students as any;
      if (!student?.email) continue;

      const dedupeKey = `group-notify-${group_id}-${student.id}`;
      // Skip only if already successfully sent (pending = previous attempt failed, retry is allowed)
      const { data: existing } = await supabase
        .from('email_dedup')
        .select('id')
        .eq('dedupe_key', dedupeKey)
        .eq('type', 'group_assigned')
        .eq('status', 'sent')
        .maybeSingle();
      if (existing) continue;

      // Upsert to pending (overwrites any stale pending from a previous failed attempt)
      await supabase.from('email_dedup').upsert(
        { dedupe_key: dedupeKey, type: 'group_assigned', status: 'pending' },
        { onConflict: 'dedupe_key,type', ignoreDuplicates: false }
      );

      emails.push({
        from: fromEmail,
        to: student.email,
        subject: `You have been added to ${group.name}`,
        html: groupAssignedEmail({
          recipientName: student.full_name ?? 'there',
          groupName: group.name,
          cohortName,
          description: group.description ?? undefined,
          members: memberList,
          dashboardUrl,
          branding,
        }),
      });
    }

    if (emails.length === 0) continue;

    const { error: sendError } = await resend.batch.send(emails);
    if (sendError) {
      return NextResponse.json({ error: `Email send failed: ${(sendError as any).message ?? sendError}`, sent }, { status: 500 });
    }
    sent += emails.length;
    const keys = emails.map(e => {
      const member = batch.find((m: any) => m.students?.email === e.to);
      return `group-notify-${group_id}-${member?.students?.id}`;
    }).filter(Boolean);
    await supabase
      .from('email_dedup')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in('dedupe_key', keys)
      .eq('type', 'group_assigned');
  }

  return NextResponse.json({ sent });
}
