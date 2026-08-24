import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { sendAssignmentReminders } from '@/lib/remind-unsubmitted';

export const dynamic = 'force-dynamic';

// On-demand: email students who have not submitted an assignment. Instructor/admin only.
// Used by the MCP remind_unsubmitted tool.
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { assignmentId, cooldownDays } = body;
  if (!assignmentId) return NextResponse.json({ error: 'assignmentId is required' }, { status: 400 });

  const result = await sendAssignmentReminders(supabase, assignmentId, { cooldownDays: cooldownDays ?? 0 });
  if (result.error) {
    const status = result.error === 'Assignment not found' ? 404 : 500;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true, ...result });
}
