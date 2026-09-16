/**
 * GET  /api/ai-limits -- the limits in force, per feature, per plan. Staff only.
 * POST /api/ai-limits -- save them. Every value is validated against its ceiling here, not only in
 *                        the form, because these numbers are money and a form is not a gate.
 *
 * Separate from /api/platform-settings on purpose: that route saves the whole branding row in one
 * POST, and folding a numeric policy into it would mean a branding save could carry a limit change
 * nobody made.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import {
  AI_FEATURES,
  mergeAiLimits,
  validateAiLimit,
  type AiLimits,
} from '@/lib/ai-limits';
import { clearAiLimitsCache } from '@/lib/ai-limits-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  const { data, error } = await adminClient()
    .from('platform_settings')
    .select('ai_limits')
    .eq('id', 'default')
    .maybeSingle();

  // Say the read failed rather than answering with defaults. Defaults would look like a platform
  // nobody has configured, and an admin who then pressed Save would overwrite the real settings
  // with them. Learner enforcement still falls back safely -- there the defaults are the old
  // behaviour; here they would be a lie about what is stored.
  if (error) return NextResponse.json({ error: 'Could not read the AI limits. Try again.' }, { status: 500 });

  return NextResponse.json({ limits: mergeAiLimits(data?.ai_limits) });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Built from the known features only. Anything else in the payload is dropped rather than
  // stored, so the column cannot accumulate settings no route reads.
  const incoming: Partial<AiLimits> = {};
  const rejected: string[] = [];

  for (const spec of AI_FEATURES) {
    const row = body?.[spec.key];
    if (row === undefined) continue;

    const free = validateAiLimit(spec.key, row?.free);
    const paid = validateAiLimit(spec.key, row?.paid);
    if (free === null || paid === null) { rejected.push(spec.label); continue; }
    incoming[spec.key] = { free, paid };
  }

  // Refuse the whole save rather than storing the half that parsed. A partial save would report
  // success while leaving the admin with a mix of what they typed and what was already there.
  if (rejected.length) {
    return NextResponse.json({
      error: `Check ${rejected.join(', ')}. Each limit must be a whole number from 0 to its maximum, where 0 means no access on that plan.`,
    }, { status: 400 });
  }

  // Merge over what is stored rather than replacing the column. A caller that sends one feature
  // must not reset the rest: the write is a whole-column overwrite, so anything left out would
  // silently fall back to the shipped default. The settings tab sends every feature, but the
  // endpoint should not depend on its caller being thorough.
  //
  // Read-modify-write, so two admins saving at the same moment could lose one of the two changes.
  // That is one row, edited by one or two people, rarely -- a lock or a jsonb-merge function would
  // be more machinery than the risk earns.
  const db = adminClient();
  const { data: existing, error: readError } = await db
    .from('platform_settings')
    .select('ai_limits')
    .eq('id', 'default')
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  const merged = { ...((existing?.ai_limits ?? {}) as Partial<AiLimits>), ...incoming };

  const { error } = await db
    .from('platform_settings')
    .upsert({ id: 'default', ai_limits: merged, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // The serverless instance that handled this save is not the one holding every cached copy, so
  // this only clears its own. The others age out within the minute, which is why the page says
  // changes apply shortly rather than immediately.
  clearAiLimitsCache();

  return NextResponse.json({ limits: mergeAiLimits(merged) });
}
