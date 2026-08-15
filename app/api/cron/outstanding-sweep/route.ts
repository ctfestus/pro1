/**
 * Daily cron -- outstanding balance sweep.
 * Triggered by QStash at 06:00 every day, ahead of the 08:00 learning emails.
 *
 * Payment events already recompute an enrollment the moment they happen: recording, editing or
 * waiving a payment all run recomputeEnrollmentAccess, which moves the student in or out of the
 * outstanding cohort. A due date passing is not an event -- nothing in the app fires on it. So a
 * student who went overdue overnight kept their real cohort until a human happened to open the
 * Payments page, which is the only other place the move ran. That delay leaked learning email to
 * unpaid students (the email jobs pick recipients by cohort) and it silently restricted people
 * without telling them, because the page-load path sends no notice.
 *
 * This job supplies the missing time trigger. It recomputes every live enrollment, applies the
 * same move/restore decision the Payments page uses, and mails the overdue notice to anyone who
 * crossed into overdue since the last run.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { computeAccess } from '@/lib/enrollment-access';
import { getOutstandingCohortAction, applyCohortAction, type CohortAction } from '@/lib/db-payments';
import { sendOverdueNotice, loadOverdueNoticeSettings } from '@/lib/overdue-notice';
import { fetchAllRows } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';
// The sweep reads every live enrollment and writes one row per status change and per cohort move,
// so its cost grows with the platform. The default serverless budget is short enough that a large
// tenant would be cut off mid-enforcement, leaving some students moved and the rest not.
export const maxDuration = 300;

// Cohort moves and status writes are one request per row, so they are run a few at a time rather
// than all at once -- a large tenant would otherwise open hundreds of connections in one tick.
const WRITE_CONCURRENCY = 25;
// Each notice is a claim, a send and a stamp, so these are kept well below the write concurrency.
const EMAIL_CONCURRENCY = 8;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) {
    console.error('[cron/outstanding-sweep] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // A dry run reports what the sweep would change without writing or emailing. Publish a one-off
  // request to ?dry=1 from the QStash console before enabling the schedule to see the first run's
  // blast radius -- on a platform that has never swept, every already-overdue student is caught at
  // once and would be mailed together.
  const dryRun = new URL(req.url).searchParams.get('dry') === '1';

  const db = adminClient();

  // Live enrollments only. A pre-signup row has no student to move, and a released enrollment
  // (migration 171) keeps its payment history but its student has left the cohort -- moving them
  // back in would re-attach someone who was deliberately removed.
  const [enrollments, cohortSettings, configRes] = await Promise.all([
    fetchAllRows<any>((from, to) => db
      .from('bootcamp_enrollments')
      .select(`
        id,
        student_id,
        cohort_id,
        access_status,
        access_until,
        payment_plan,
        total_fee,
        deposit_required,
        paid_total,
        bootcamp_ends_at,
        students ( full_name, email, cohort_id, original_cohort_id, payment_exempt ),
        payment_installments ( due_date, status )
      `, { count: 'exact' })
      .not('student_id', 'is', null)
      .is('released_at', null)
      .order('id').range(from, to)),
    fetchAllRows<any>((from, to) => db
      .from('cohort_payment_settings')
      .select('cohort_id, post_bootcamp_access_months, grace_period_days', { count: 'exact' })
      .order('cohort_id').range(from, to)),
    db.from('payment_config').select('outstanding_cohort_id').eq('id', 'default').maybeSingle(),
  ]);

  // A failed read here is not the same as an unset cohort. Treating it as unset would sweep the
  // whole platform, move nobody, and report a clean run -- so the day the config table is briefly
  // unreachable, enforcement silently stops.
  if (configRes.error) {
    console.error('[cron/outstanding-sweep] payment_config read failed:', configRes.error.message);
    return NextResponse.json({ error: 'Failed to read payment config' }, { status: 500 });
  }

  const outstandingCohortId: string | null = configRes.data?.outstanding_cohort_id ?? null;

  const accessMonthsByCohort = new Map<string, number>();
  const graceDaysByCohort    = new Map<string, number | null>();
  for (const s of cohortSettings) {
    accessMonthsByCohort.set(s.cohort_id, s.post_bootcamp_access_months ?? 3);
    graceDaysByCohort.set(s.cohort_id, s.grace_period_days ?? null);
  }

  const statusUpdates: { id: string; access_status: string; access_until: string | null }[] = [];
  const overdueCandidates: { enrollmentId: string; email: string; studentName: string; dueDate: string }[] = [];
  // Cohort membership belongs to the student, not to one enrollment, so the decision is made once
  // per student over all of their enrollments. Deciding per enrollment lets someone holding two --
  // one settled, one still owing -- be restored on the strength of the settled one while the debt
  // stands, and lets a move and a restore for the same student race within the same run.
  type StudentStanding = {
    cohortId: string;
    originalCohortId: string | null;
    exempt: boolean;
    statuses: string[];
  };
  const byStudent = new Map<string, StudentStanding>();

  for (const e of enrollments) {
    const student = e.students ?? null;
    if (!student) continue;

    const access = computeAccess({
      payment_plan:                e.payment_plan,
      total_fee:                   Number(e.total_fee),
      deposit_required:            Number(e.deposit_required),
      paid_total:                  Number(e.paid_total),
      bootcamp_ends_at:            e.bootcamp_ends_at ? new Date(e.bootcamp_ends_at) : null,
      post_bootcamp_access_months: accessMonthsByCohort.get(e.cohort_id) ?? 3,
      grace_period_days:           graceDaysByCohort.get(e.cohort_id) ?? null,
      installments:                (e.payment_installments ?? []).map((i: any) => ({ due_date: new Date(i.due_date), status: i.status })),
    });

    const nextUntil = access.access_until ? access.access_until.toISOString().slice(0, 10) : null;
    if (access.access_status !== e.access_status || nextUntil !== (e.access_until ?? null)) {
      statusUpdates.push({ id: e.id, access_status: access.access_status, access_until: nextUntil });
    }

    // The student's own cohort_id is what the email jobs read, so that -- not the cohort recorded
    // on the enrollment -- is what decides whether a move is needed. A student sitting in no cohort
    // at all is skipped: releasing a student or cancelling a subscription clears cohort_id, and
    // moving them would write an empty origin cohort to restore them to later.
    if (student.cohort_id) {
      const held: StudentStanding = byStudent.get(e.student_id) ?? {
        cohortId:         student.cohort_id,
        originalCohortId: student.original_cohort_id ?? null,
        exempt:           student.payment_exempt ?? false,
        statuses:         [],
      };
      held.statuses.push(access.access_status);
      byStudent.set(e.student_id, held);
    }

    // Candidacy is the live status, never the crossing from the stored one: this run writes the
    // new status before it sends, so a "changed since last time" gate would make a rejected send
    // unretryable. Sending at most once is decided per episode instead, by the claim in
    // sendOverdueNotice. access_until carries the due date of the installment that caused the
    // overdue status, which is what identifies the episode.
    const email = ((student.email as string) ?? '').trim().toLowerCase();
    if (access.access_status === 'overdue' && !student.payment_exempt && email && nextUntil) {
      overdueCandidates.push({
        enrollmentId: e.id,
        email,
        studentName:  student.full_name || 'there',
        dueDate:      nextUntil,
      });
    }
  }

  // One decision per student, taken on their least settled enrollment. Restoring is only reached
  // when nothing they hold is unpaid, because the two restrictive statuses are preferred here.
  const cohortActions: CohortAction[] = [];
  for (const [studentId, held] of byStudent) {
    const action = getOutstandingCohortAction({
      studentId,
      accessStatus:            held.statuses.find(s => s === 'overdue')
                            ?? held.statuses.find(s => s === 'pending_deposit')
                            ?? held.statuses[0],
      studentCohortId:         held.cohortId,
      studentOriginalCohortId: held.originalCohortId,
      paymentExempt:           held.exempt,
      outstandingCohortId,
    });
    if (action) cohortActions.push(action);
  }

  const moves    = cohortActions.filter(a => a.type === 'move').length;
  const restores = cohortActions.length - moves;

  if (!outstandingCohortId) {
    // getOutstandingCohortAction returns nothing without a configured cohort, so the sweep can
    // still correct access statuses but cannot enforce them. Say so rather than reporting a clean
    // run: on this platform no student has ever been moved.
    console.warn('[cron/outstanding-sweep] no outstanding cohort configured -- statuses recomputed, no student moved');
  }

  if (dryRun) {
    console.log(`[cron/outstanding-sweep] DRY RUN scanned=${enrollments.length} statusUpdates=${statusUpdates.length} moves=${moves} restores=${restores} overdueEmails=${overdueCandidates.length}`);
    return NextResponse.json({
      ok: true, dryRun: true, scanned: enrollments.length,
      statusUpdates: statusUpdates.length, moves, restores,
      overdueEmails: overdueCandidates.length,
      outstandingCohortConfigured: !!outstandingCohortId,
    });
  }

  // -- Persist recomputed access ---
  let statusWritten = 0, statusFailed = 0;
  for (const group of chunk(statusUpdates, WRITE_CONCURRENCY)) {
    const results = await Promise.allSettled(group.map(u => db
      .from('bootcamp_enrollments')
      .update({ access_status: u.access_status, access_until: u.access_until, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .then(({ error }) => { if (error) throw new Error(error.message); })));
    for (const r of results) {
      if (r.status === 'fulfilled') { statusWritten++; continue; }
      statusFailed++;
      console.error('[cron/outstanding-sweep] access status write failed:', r.reason);
    }
  }

  // -- Apply cohort moves and restores ---
  // Settled, not all: one student whose write is rejected must not abort the rest of the sweep.
  let moved = 0, restored = 0, cohortFailed = 0;
  for (const group of chunk(cohortActions, WRITE_CONCURRENCY)) {
    const results = await Promise.allSettled(group.map(a => applyCohortAction(db, a)));
    results.forEach((r, i) => {
      if (r.status !== 'fulfilled') {
        cohortFailed++;
        console.error(`[cron/outstanding-sweep] cohort ${group[i].type} failed for ${group[i].studentId}:`, r.reason);
        return;
      }
      if (group[i].type === 'move') moved++; else restored++;
    });
  }

  // -- Overdue notices ---
  // Each is claimed before it is sent, so a second worker, a QStash retry of this same run, or a
  // recorded payment happening at the same moment cannot produce a second email for one episode.
  // Sent one at a time rather than batched: the claim and the idempotency key are per episode,
  // and a batch would collapse them into a single all-or-nothing call.
  let emailed = 0, emailSkipped = 0, emailFailed = 0, emailFinalizedUnsent = 0, emailFinalizeFailed = 0;
  if (overdueCandidates.length) {
    if (!process.env.RESEND_API_KEY) {
      // The move still happened; only the notice was skipped. No claim was taken, so a run made
      // once the key is configured still tells them.
      console.warn(`[cron/outstanding-sweep] RESEND_API_KEY missing -- ${overdueCandidates.length} overdue notice(s) not sent`);
      emailSkipped += overdueCandidates.length;
    } else {
      const settings = await loadOverdueNoticeSettings();
      for (const group of chunk(overdueCandidates, EMAIL_CONCURRENCY)) {
        const outcomes = await Promise.all(group.map(c => sendOverdueNotice(db, c, settings)));
        for (const outcome of outcomes) {
          if (outcome === 'sent')                 emailed++;
          else if (outcome === 'failed')          emailFailed++;
          else if (outcome === 'finalized')       emailFinalizedUnsent++;
          else if (outcome === 'finalize_failed') emailFinalizeFailed++;
          else                                    emailSkipped++;
        }
      }
    }
  }

  // Reported, not just logged. Each is an episode whose send outcome was never recorded, closed
  // unsent under the at-most-once policy -- so the student may or may not have been mailed. A
  // count that stops being zero means workers are dying mid-send and is worth investigating.
  if (emailFinalizedUnsent) {
    console.warn(`[cron/outstanding-sweep] ${emailFinalizedUnsent} ambiguous episode(s) closed without resending`);
  }
  if (emailFinalizeFailed) {
    console.error(`[cron/outstanding-sweep] ${emailFinalizeFailed} ambiguous episode(s) could not be closed`);
  }

  const summary = {
    scanned: enrollments.length, statusWritten, statusFailed, moved, restored, cohortFailed,
    emailed, emailSkipped, emailFailed, emailFinalizedUnsent, emailFinalizeFailed,
    outstandingCohortConfigured: !!outstandingCohortId,
  };
  console.log(`[cron/outstanding-sweep] ${Object.entries(summary).map(([k, v]) => `${k}=${v}`).join(' ')}`);

  // A partly enforced sweep is worse than a failed one: the students whose write was rejected keep
  // their cohort and keep receiving learning email while their peers are restricted. Reporting a
  // failure is what gets the run retried -- every step is idempotent, so a retry re-applies only
  // what did not land, and no student can be mailed twice.
  //
  // A failed close counts too, because it means the database is refusing writes. The retry cannot
  // repair that particular episode until its claim lapses -- it will be claimed by nobody and
  // skipped until then -- so this is a signal rather than a repair. It cannot cause a resend: on
  // any retry the episode is either still claimed, or ambiguous and closed without sending.
  if (statusFailed || cohortFailed || emailFinalizeFailed) {
    return NextResponse.json({ ok: false, error: 'Some enforcement writes failed', ...summary }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ...summary });
}
