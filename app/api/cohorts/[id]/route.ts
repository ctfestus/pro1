import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { COHORT_KIND_BOOTCAMP } from '@/lib/cohort-kind';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id } = await params;

  const payload: Record<string, string | null> = {};
  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Cohort name is required.' }, { status: 400 });
    payload.name = name;
  }
  if ('description' in body) payload.description = String(body.description ?? '').trim() || null;
  if ('start_date' in body) payload.start_date = body.start_date ? String(body.start_date) : null;
  if ('end_date' in body) payload.end_date = body.end_date ? String(body.end_date) : null;

  if (!Object.keys(payload).length) {
    return NextResponse.json({ error: 'No editable cohort fields provided.' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('cohorts')
    .select('id, created_by')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'Cohort not found.' }, { status: 404 });
  if (role === 'instructor' && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('cohorts')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[api/cohorts] update error:', error.message);
    return NextResponse.json({ error: 'Failed to update cohort.' }, { status: 500 });
  }

  return NextResponse.json({ cohort: data });
}

/**
 * Deleting a cohort used to run straight from the browser under RLS, and the caller threw the
 * result away. Two refusals therefore looked exactly like success until the next page load:
 * an instructor who did not create the cohort deleted zero rows (the delete policy requires
 * creator or admin), and a cohort carrying payments was refused by ON DELETE RESTRICT.
 *
 * Deleting through here instead means nothing is silent. A cohort with anything attached needs an
 * explicit second confirmation carrying a count of what will be destroyed, and the delete then
 * removes the receipts the database would otherwise refuse over. That is a deliberate product
 * decision: an intake's payment history goes with the intake, and that money leaves payment
 * reporting for good.
 *
 * Members are the caller's choice. Deleting the cohort on its own leaves them with no cohort at
 * all, which is rarely what winding up an intake means, so the confirmation offers deleting the
 * accounts instead -- including the ones parked in the outstanding-payments cohort, whose way back
 * here is about to disappear. Accounts go last, after the cohort delete has committed: removing a
 * login is an Auth API call rather than SQL, so it cannot join that transaction, and putting the
 * irreversible half at the end means every failure before it changed nothing at all.
 *
 * The one thing no confirmation overrides is a cohort that backs a subscription plan. A plan's
 * cohort is not an intake -- it is how a plan grants access, it is never listed on the cohorts
 * page, and its payment history hangs off the plan through several restricted references. Those
 * are deleted from the subscription plans screen, which has its own guarded flow.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;
  const { id } = await params;

  let body: any = {};
  try { body = await req.json(); } catch { /* no body means no confirmation */ }
  const confirmed = body?.confirm === true;
  // What the caller was shown when it asked. A confirmation is only good for the situation it
  // described: if the cohort has gained or lost people since, the warning has to be shown again
  // rather than a bigger delete going through on the strength of smaller numbers.
  const expected: string | null = typeof body?.expect === 'string' ? body.expect : null;
  // Deleting the cohort leaves its members with no cohort at all, which is rarely what is wanted
  // for an intake that is being wound up. The caller may ask for the accounts to go instead.
  const deleteStudents = body?.deleteStudents === true;

  const { data: existing } = await supabase
    .from('cohorts')
    .select('id, name, created_by, cohort_kind')
    .eq('id', id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Cohort not found.' }, { status: 404 });

  // The service-role client ignores RLS, so the creator-or-admin rule the cohorts delete policy
  // enforces has to be applied here by hand.
  if (role !== 'admin' && existing.created_by !== user.id) {
    return NextResponse.json(
      { error: 'Only the person who created this cohort, or an admin, can delete it.' },
      { status: 403 },
    );
  }

  const countRows = async (table: string, column: string, studentsOnly = false) => {
    let query = supabase.from(table).select('id', { count: 'exact', head: true }).eq(column, id);
    // Only learners, matching the roster the cohort page shows and lets you move.
    if (studentsOnly) query = query.eq('role', 'student');
    const { count, error } = await query;
    if (error) throw new Error(`${table}.${column}: ${error.message}`);
    return count ?? 0;
  };

  let counts: Record<string, number>;
  try {
    const [members, held, payments, confirmations, enrollments, allowed, groups, plans, subscriptions, outstanding] =
      await Promise.all([
        countRows('students', 'cohort_id', true),
        countRows('students', 'original_cohort_id', true),
        countRows('payments', 'cohort_id'),
        countRows('student_payment_confirmations', 'cohort_id'),
        countRows('bootcamp_enrollments', 'cohort_id'),
        countRows('cohort_allowed_emails', 'cohort_id'),
        countRows('groups', 'cohort_id'),
        countRows('subscription_plans', 'cohort_id'),
        countRows('individual_subscriptions', 'cohort_id'),
        countRows('payment_config', 'outstanding_cohort_id'),
      ]);
    counts = { members, held, payments, confirmations, enrollments, allowed, groups, plans, subscriptions, outstanding };
  } catch (err: any) {
    console.error('[api/cohorts] delete precheck error:', err?.message);
    return NextResponse.json({ error: 'Could not check what is attached to this cohort.' }, { status: 500 });
  }

  if (counts.plans > 0 || counts.subscriptions > 0 || existing.cohort_kind !== COHORT_KIND_BOOTCAMP) {
    return NextResponse.json({
      error: 'This cohort is how a subscription plan grants access, not an intake. Delete it from the subscription plans screen instead.',
    }, { status: 409 });
  }

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Members of this cohort: the ones in it, plus the ones parked in the outstanding-payments
  // cohort whose way back here is about to disappear.
  const memberTotal = counts.members + counts.held;

  // What goes whatever the caller decides about the members, money first. The members are listed
  // separately because their fate is the choice being offered, so a single list would contradict
  // whichever way that choice went.
  const losses = [
    counts.payments      && plural(counts.payments, 'payment receipt'),
    counts.confirmations && plural(counts.confirmations, 'payment confirmation'),
    counts.enrollments   && plural(counts.enrollments, 'admission and fee record'),
    counts.allowed       && plural(counts.allowed, 'pending admitted email'),
    counts.groups        && `${plural(counts.groups, 'group')} with their forums and workspaces`,
    // Counted all along but never mentioned: the delete clears this setting, and with it the
    // destination the overdue sweep moves late payers to. It has to be pointed somewhere again.
    counts.outstanding   && 'the outstanding-payments setting, which will need pointing at another cohort before the overdue sweep can move anyone again',
  ].filter(Boolean) as string[];

  // Held students end up in the same place as members -- no cohort -- but only because the delete
  // releases the hold outright (migration 207). That release is a change to their payment standing,
  // so it is said out loud rather than folded into a single count.
  const memberOutcome = memberTotal
    ? (deleteStudents
        ? `${plural(memberTotal, 'student account')} with everything they submitted, their grades and their certificates`
        : `${plural(memberTotal, 'student')} left without a cohort`)
    : null;

  // Its own sentence, and its own field: this is a change to someone's payment standing, not
  // another item in a list of things being erased, and the modal renders the fields rather than
  // the joined sentence below.
  const holdWarning = (!deleteStudents && counts.held > 0)
    ? `It also lifts ${plural(counts.held, 'outstanding-balance hold')}, so those students stop being flagged as owing.`
    : null;

  // Everything the confirmation described, in one string. A confirmed request has to carry the
  // fingerprint it was given back, so a delete can never run against numbers other than the ones
  // somebody actually read and agreed to.
  const fingerprint = [
    counts.members, counts.held, counts.payments, counts.confirmations,
    counts.enrollments, counts.allowed, counts.groups, counts.outstanding,
  ].join(':');

  const askAgain = (stale: boolean) => {
    const all = [...losses, memberOutcome].filter(Boolean) as string[];
    return NextResponse.json({
      error: stale
        ? `This cohort changed while you were looking at it. It now holds ${all.length ? all.join(', ') : 'nothing'}. Check the numbers and confirm again.${holdWarning ? ` ${holdWarning}` : ''}`
        : all.length
          ? `Deleting "${existing.name}" permanently destroys ${all.join(', ')}. This cannot be undone, and any money recorded against it leaves payment reporting.${holdWarning ? ` ${holdWarning}` : ''}`
          : `Delete "${existing.name}"? Nothing is attached to it.`,
      requiresConfirmation: true,
      stale,
      losses,
      members: memberTotal,
      held:    counts.held,
      holdWarning,
      fingerprint,
    }, { status: 409 });
  };

  // Always ask, even for a cohort nothing is attached to: one click should not be able to delete
  // a cohort, and the answer to "what will this cost me" is the point of the round trip.
  if (!confirmed) return askAgain(false);
  if (expected !== fingerprint) return askAgain(true);

  // One transaction (migration 207): clearing the outstanding-payments pointer, deleting the
  // receipts that would otherwise refuse the delete, untagging the cohort from every content
  // cohort_ids array, and the cohort row itself with everything that cascades from it. Run as
  // separate requests this was a half-delete waiting to happen -- receipts gone, cohort standing.
  const { data: result, error: rpcError } = await supabase.rpc('delete_bootcamp_cohort', { p_cohort_id: id });
  if (rpcError) {
    console.error('[api/cohorts] delete rpc error:', rpcError.message);
    // 23503 is a foreign key still pointing here: a row type the counts above do not know about.
    const stillReferenced = (rpcError as { code?: string }).code === '23503';
    return NextResponse.json(
      { error: stillReferenced
          ? 'Something is still attached to this cohort, so it cannot be deleted.'
          : 'Failed to delete cohort.' },
      { status: stillReferenced ? 409 : 500 },
    );
  }

  // Accounts last, and only now that the cohort is definitely gone. Deleting a login is an Auth
  // API call rather than SQL, so it can never join the transaction above; putting it last means
  // every failure before this point changed nothing, and a failure here leaves students without a
  // cohort -- the same state the default choice produces -- rather than a cohort that will not die.
  //
  // The ids come back from the transaction itself, captured while it held locks on those rows, so
  // this acts on exactly who was detached. Never the caller, whatever the request says -- the same
  // rule /api/admin/delete-user applies.
  const detached: string[] = Array.isArray((result as any)?.memberIds) ? (result as any).memberIds : [];
  const memberIds = deleteStudents ? detached.filter((sid: string) => sid !== user.id) : [];

  let deletedStudents = 0;
  for (const studentId of memberIds) {
    const { error: userError } = await supabase.auth.admin.deleteUser(studentId);
    if (userError) {
      console.error('[api/cohorts] deleting student failed:', studentId, userError.message);
      return NextResponse.json({
        error: `The cohort was deleted, but only ${deletedStudents} of ${memberIds.length} student accounts: ${userError.message}. The rest still exist, with no cohort. Delete them individually or try again.`,
        ok: true,
        deletedStudents,
      }, { status: 207 });
    }
    deletedStudents++;
  }

  const destroyed = [...losses, memberOutcome, holdWarning].filter(Boolean) as string[];
  console.log(`[api/cohorts] deleted cohort ${id} by ${user.id}: ${destroyed.join(', ') || 'nothing attached'}`, result);
  return NextResponse.json({ ok: true, deleted: destroyed, deletedStudents });
}
