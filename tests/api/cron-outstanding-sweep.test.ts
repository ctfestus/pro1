import { describe, it, expect, vi, beforeEach } from 'vitest';

// Recording a payment recomputes an enrollment on the spot, but a due date passing fires nothing,
// so a student who went overdue overnight kept their real cohort until someone opened the Payments
// page. These cover the job that supplies that missing time trigger: who it moves into the
// outstanding cohort, who it moves back out, and who it tells.
//
// The notice half is the delicate part. One overdue episode earns exactly one email, however many
// times the sweep runs, however it fails, and however many workers run at once -- while a genuinely
// new episode is still notifiable. The episode store below models migration 181 so those
// guarantees are tested against the claim semantics rather than against a fixed rpc result.

const { emailSend } = vi.hoisted(() => ({
  emailSend: vi.fn((_payload: any, _opts?: any) => Promise.resolve({ data: { id: 'email-1' }, error: null })),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: emailSend }; batch = { send: vi.fn() }; } }));
vi.mock('@/lib/qstash', () => ({ verifyQStashRequest: vi.fn().mockResolvedValue({ valid: true }) }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: adminClientMock }));

import { POST } from '@/app/api/cron/outstanding-sweep/route';
import { sendOverdueNotice } from '@/lib/overdue-notice';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const CLAIM_TTL_MS = 300_000;

const STUDENT = { full_name: 'Ama Mensah', email: 'ama@example.com', cohort_id: 'co1', original_cohort_id: null, payment_exempt: false };

/** A part-paid enrollment with one installment that fell due ten days ago. */
function enrollment(over: Record<string, any> = {}) {
  return {
    id: 'e1',
    student_id: 's1',
    cohort_id: 'co1',
    access_status: 'active',
    access_until: null,
    payment_plan: 'flexible',
    total_fee: 1000,
    deposit_required: 200,
    paid_total: 200,
    bootcamp_ends_at: null,
    students: { ...STUDENT },
    payment_installments: [{ due_date: daysAgo(10), status: 'unpaid' }],
    ...over,
  };
}

/**
 * The notice state migration 181 keeps on the enrollment, applying the same rules the SQL does:
 * a claim that expires, a token that proves ownership of it, and a begun-marker written before
 * the send. Held across runs within a test, which is what lets a second sweep see what the first
 * left behind -- including what it left behind after dying.
 */
type EpisodeRow = {
  forDueDate: string | null;
  claimedAt: number | null;
  claimToken: string | null;
  sendStartedFor: string | null;
  attempts: number;
  attemptedFor: string | null;
};

function makeEpisodes() {
  const rows = new Map<string, EpisodeRow>();
  let tokenSeq = 0;
  const store = {
    now: Date.now(),
    /** Number of consecutive mark_overdue_notice_sent calls to reject. */
    markFailures: 0,
    row(id: string): EpisodeRow {
      if (!rows.has(id)) rows.set(id, { forDueDate: null, claimedAt: null, claimToken: null, sendStartedFor: null, attempts: 0, attemptedFor: null });
      return rows.get(id)!;
    },
    rpc(fn: string, args: Record<string, any>) {
      const row = store.row(args.p_enrollment_id);
      const due = args.p_due_date;

      if (fn === 'claim_overdue_notice') {
        const unheld  = row.claimedAt === null || row.claimedAt < store.now - CLAIM_TTL_MS;
        const allowed = row.attemptedFor !== due || row.attempts < 5;
        if (row.forDueDate === due || !unheld || !allowed) return { data: [], error: null };
        row.claimedAt  = store.now;
        row.claimToken = `token-${++tokenSeq}`;
        // Read as the row stood before this claim, exactly as the SQL RETURNING does.
        return { data: [{ claim_token: row.claimToken, resume_ambiguous: row.sendStartedFor === due }], error: null };
      }
      if (fn === 'begin_overdue_notice_send') {
        if (row.claimToken !== args.p_claim_token) return { data: false, error: null };
        row.sendStartedFor = due;
        return { data: true, error: null };
      }
      if (fn === 'release_overdue_notice_claim') {
        if (row.claimToken !== args.p_claim_token) return { data: false, error: null };
        row.claimedAt      = null;
        row.claimToken     = null;
        row.sendStartedFor = null;
        row.attempts       = row.attemptedFor === due ? row.attempts + 1 : 1;
        row.attemptedFor   = due;
        return { data: true, error: null };
      }
      if (fn === 'mark_overdue_notice_sent') {
        if (store.markFailures > 0) { store.markFailures--; return { data: null, error: { message: 'write rejected' } }; }
        if (row.claimToken !== args.p_claim_token) return { data: false, error: null };
        row.forDueDate     = due;
        row.claimedAt      = null;
        row.claimToken     = null;
        row.sendStartedFor = null;
        row.attempts       = 0;
        row.attemptedFor   = null;
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc "${fn}"`);
    },
  };
  return store;
}

function db(opts: {
  enrollments?: any[];
  graceDays?: number | null;
  outstandingCohort?: string | null;
  configError?: { message: string };
  statusWriteError?: { message: string };
  cohortWriteError?: { message: string };
  episodes?: ReturnType<typeof makeEpisodes>;
} = {}) {
  // The first read of bootcamp_enrollments is the scan; every later call is a status write, so a
  // write failure is expressed as the second result in call order.
  const enrollResults: any[] = [{ data: opts.enrollments ?? [enrollment()], error: null }];
  if (opts.statusWriteError) enrollResults.push({ data: null, error: opts.statusWriteError });

  return makeSupabaseStub({
    bootcamp_enrollments:   enrollResults.length > 1 ? enrollResults : enrollResults[0],
    cohort_payment_settings:{ data: [{ cohort_id: 'co1', post_bootcamp_access_months: 3, grace_period_days: opts.graceDays ?? null }], error: null },
    payment_config:         opts.configError
      ? { data: null, error: opts.configError }
      : { data: { outstanding_cohort_id: opts.outstandingCohort === undefined ? 'out1' : opts.outstandingCohort }, error: null },
    students:               { data: null, error: opts.cohortWriteError ?? null },
  }, (opts.episodes ?? makeEpisodes()).rpc);
}

const post = (query = '') =>
  POST(new Request(`http://localhost/api/cron/outstanding-sweep${query}`, { method: 'POST' }) as any);

beforeEach(() => {
  emailSend.mockClear();
  adminClientMock.mockReset();
  process.env.RESEND_API_KEY = 'test-key';
});

describe('POST /api/cron/outstanding-sweep enforcement', () => {
  it('moves a student whose installment fell due into the outstanding cohort, and tells them', async () => {
    adminClientMock.mockReturnValue(db());
    const json = await (await post()).json();
    expect(json.moved).toBe(1);
    expect(json.restored).toBe(0);
    expect(json.emailed).toBe(1);
    expect(emailSend.mock.calls[0][0].to).toBe('ama@example.com');
  });

  it('leaves a student inside their grace period alone', async () => {
    adminClientMock.mockReturnValue(db({
      enrollments: [enrollment({ payment_installments: [{ due_date: daysAgo(2), status: 'unpaid' }] })],
      graceDays: 7,
    }));
    const json = await (await post()).json();
    expect(json.moved).toBe(0);
    expect(json.emailed).toBe(0);
  });

  it('moves a settled student back to their original cohort', async () => {
    adminClientMock.mockReturnValue(db({
      enrollments: [enrollment({
        paid_total: 1000,
        access_status: 'overdue',
        students: { ...STUDENT, cohort_id: 'out1', original_cohort_id: 'co1' },
      })],
    }));
    const json = await (await post()).json();
    expect(json.restored).toBe(1);
    expect(json.moved).toBe(0);
    expect(json.emailed).toBe(0);
  });

  it('moves a student who owes on one enrollment even when another is paid up', async () => {
    adminClientMock.mockReturnValue(db({
      enrollments: [
        enrollment({ id: 'e-paid', paid_total: 1000 }),
        enrollment({ id: 'e-owing' }),
      ],
    }));
    const json = await (await post()).json();
    expect(json.moved).toBe(1);
    expect(json.restored).toBe(0);
  });

  it('does not restore an outstanding student on a settled enrollment while another still owes', async () => {
    const inOutstanding = { ...STUDENT, cohort_id: 'out1', original_cohort_id: 'co1' };
    adminClientMock.mockReturnValue(db({
      enrollments: [
        enrollment({ id: 'e-paid',  paid_total: 1000, access_status: 'overdue', students: { ...inOutstanding } }),
        enrollment({ id: 'e-owing', access_status: 'overdue', students: { ...inOutstanding } }),
      ],
    }));
    const json = await (await post()).json();
    expect(json.restored).toBe(0);
    expect(json.moved).toBe(0);
  });

  it('recomputes access but moves no one when no outstanding cohort is configured', async () => {
    adminClientMock.mockReturnValue(db({ outstandingCohort: null }));
    const json = await (await post()).json();
    expect(json.outstandingCohortConfigured).toBe(false);
    expect(json.moved).toBe(0);
    expect(json.statusWritten).toBe(1);
  });

  it('reports what it would do without writing or emailing on a dry run', async () => {
    adminClientMock.mockReturnValue(db());
    const json = await (await post('?dry=1')).json();
    expect(json.dryRun).toBe(true);
    expect(json.moves).toBe(1);
    expect(json.overdueEmails).toBe(1);
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe('POST /api/cron/outstanding-sweep write failures', () => {
  it('fails the run when the payment config cannot be read', async () => {
    adminClientMock.mockReturnValue(db({ configError: { message: 'connection reset' } }));
    const res = await post();
    expect(res.status).toBe(500);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it('fails the run when an access status write is rejected', async () => {
    adminClientMock.mockReturnValue(db({ statusWriteError: { message: 'deadlock detected' } }));
    const res  = await post();
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.statusFailed).toBe(1);
    expect(json.statusWritten).toBe(0);
  });

  it('fails the run when a cohort move is rejected', async () => {
    adminClientMock.mockReturnValue(db({ cohortWriteError: { message: 'permission denied' } }));
    const res  = await post();
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(json.cohortFailed).toBe(1);
    expect(json.moved).toBe(0);
  });
});

describe('POST /api/cron/outstanding-sweep overdue notices', () => {
  it('retries on the next run after the send failed, then stops once it lands', async () => {
    const episodes = makeEpisodes();
    emailSend.mockResolvedValueOnce({ data: null, error: { message: 'domain not verified' } } as any);

    adminClientMock.mockReturnValue(db({ episodes }));
    const first = await (await post()).json();
    expect(first.emailed).toBe(0);
    expect(first.emailFailed).toBe(1);

    // Second run sees what the first left: status written to overdue, the claim released, and no
    // delivery recorded. The notice is owed, so it goes.
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const second = await (await post()).json();
    expect(second.emailed).toBe(1);

    // Third run, same debt: delivered is now a fact about the episode, so it stands down.
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const third = await (await post()).json();
    expect(third.emailed).toBe(0);
    expect(third.emailSkipped).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(2);
  });

  it('does not tell the same student again a fortnight later while the debt is the same', async () => {
    const episodes = makeEpisodes();
    adminClientMock.mockReturnValue(db({ episodes }));
    expect((await (await post()).json()).emailed).toBe(1);

    // Well past any expiring lookup, and past the claim TTL, so only the delivered stamp can be
    // what holds it back.
    episodes.now += 14 * 86400000;
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const later = await (await post()).json();
    expect(later.emailed).toBe(0);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('tells a student again when they settle and later fall behind on a later installment', async () => {
    const episodes = makeEpisodes();
    adminClientMock.mockReturnValue(db({ episodes }));
    expect((await (await post()).json()).emailed).toBe(1);

    // The first installment is settled and a later one has now fallen due: a different episode,
    // so the delivered stamp from the first does not silence it.
    episodes.now += 30 * 86400000;
    adminClientMock.mockReturnValue(db({
      episodes,
      enrollments: [enrollment({
        access_status: 'overdue',
        paid_total: 400,
        payment_installments: [
          { due_date: daysAgo(40), status: 'paid' },
          { due_date: daysAgo(3),  status: 'unpaid' },
        ],
      })],
    }));
    const second = await (await post()).json();
    expect(second.emailed).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(2);
    expect(emailSend.mock.calls[1][1].idempotencyKey).not.toBe(emailSend.mock.calls[0][1].idempotencyKey);
  });

  it('retries a transient stamp failure in process rather than sending again', async () => {
    const episodes = makeEpisodes();
    episodes.markFailures = 1; // first attempt rejected, second succeeds

    adminClientMock.mockReturnValue(db({ episodes }));
    const first = await (await post()).json();
    expect(first.emailed).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);

    // The in-process retry recorded the delivery, so the episode is closed for good.
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const later = await (await post()).json();
    expect(later.emailed).toBe(0);
    expect(later.emailSkipped).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('closes an ambiguous episode without resending, however long after the send', async () => {
    const episodes = makeEpisodes();
    episodes.markFailures = 99; // every attempt fails, so delivery is never recorded

    adminClientMock.mockReturnValue(db({ episodes }));
    const first = await (await post()).json();
    expect(first.emailed).toBe(1);

    // Past the claim TTL and past Resend's 24-hour idempotency window, so neither is what holds
    // the second email back -- only the begun-marker the first run wrote before it sent.
    episodes.now += 25 * 3600 * 1000;
    episodes.markFailures = 0;
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const later = await (await post()).json();
    expect(later.emailed).toBe(0);
    expect(later.emailFinalizedUnsent).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);

    // And having been finalized, it is settled: no further run reconsiders it.
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const third = await (await post()).json();
    expect(third.emailFinalizedUnsent).toBe(0);
    expect(third.emailSkipped).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('reports a failure when an ambiguous episode cannot be closed', async () => {
    const episodes = makeEpisodes();
    episodes.markFailures = 99; // the stamp never lands, on this run or the next

    adminClientMock.mockReturnValue(db({ episodes }));
    expect((await (await post()).json()).emailed).toBe(1);

    // The episode is ambiguous and the close cannot be written either. Counting that as closed
    // would report a clean run at the moment the database is refusing writes.
    episodes.now += CLAIM_TTL_MS + 1000;
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const res  = await post();
    const json = await res.json();
    expect(json.emailFinalizeFailed).toBe(1);
    expect(json.emailFinalizedUnsent).toBe(0);
    expect(res.status).toBe(500);
    // Still no second email, and the episode is left open rather than wrongly marked delivered.
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(episodes.row('e1').forDueDate).toBeNull();
  });

  it('keeps an episode retryable when the send was recorded as failed', async () => {
    const episodes = makeEpisodes();
    emailSend.mockResolvedValueOnce({ data: null, error: { message: 'mailbox full' } } as any);

    adminClientMock.mockReturnValue(db({ episodes }));
    expect((await (await post()).json()).emailFailed).toBe(1);

    // A recorded failure is proof nothing was sent, so the at-most-once rule must not close this
    // one: even a day later it is still owed a notice, not finalized unsent.
    episodes.now += 25 * 3600 * 1000;
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    const retry = await (await post()).json();
    expect(retry.emailed).toBe(1);
    expect(retry.emailFinalizedUnsent).toBe(0);
  });

  it('sends one notice when two executions overlap', async () => {
    const episodes = makeEpisodes();
    const shared   = db({ episodes });
    adminClientMock.mockReturnValue(shared);

    const [a, b] = await Promise.all([post().then(r => r.json()), post().then(r => r.json())]);
    expect(a.emailed + b.emailed).toBe(1);
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it('takes no claim when the email key is missing, so a later run still tells them', async () => {
    const episodes = makeEpisodes();
    delete process.env.RESEND_API_KEY;
    adminClientMock.mockReturnValue(db({ episodes }));
    const first = await (await post()).json();
    expect(first.moved).toBe(1);
    expect(first.emailed).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();

    process.env.RESEND_API_KEY = 'test-key';
    adminClientMock.mockReturnValue(db({ episodes, enrollments: [enrollment({ access_status: 'overdue' })] }));
    expect((await (await post()).json()).emailed).toBe(1);
  });
});

// A claim that expires can be taken over, which is what stops a dead worker stranding an episode.
// The hazard that creates: the original worker was not dead, only slow, and wakes up still
// believing it owns the episode. Time cannot tell the two apart, so ownership is carried by the
// token issued with the claim. These drive the real helper and interrupt it mid-send.
describe('sendOverdueNotice claim ownership', () => {
  const DUE = '2026-07-01';
  const SETTINGS = { from: 'Team <team@app.test>', dashboardUrl: 'https://app.test', branding: {} };
  const notice = (db: any) =>
    sendOverdueNotice(db, { enrollmentId: 'e1', studentName: 'Ama Mensah', email: 'ama@example.com', dueDate: DUE }, SETTINGS);

  /** Worker B takes the episode over while worker A is inside its send. */
  function takeoverDuringSend(episodes: ReturnType<typeof makeEpisodes>, sendResult: any) {
    let workerBToken = '';
    emailSend.mockImplementationOnce(async () => {
      episodes.now += CLAIM_TTL_MS + 1000;
      const claim = episodes.rpc('claim_overdue_notice', { p_enrollment_id: 'e1', p_due_date: DUE }) as any;
      workerBToken = claim.data[0].claim_token;
      return sendResult;
    });
    return () => workerBToken;
  }

  it("rejects a stalled worker's release, leaving the newer claim intact", async () => {
    const episodes = makeEpisodes();
    const tokenB   = takeoverDuringSend(episodes, { data: null, error: { message: 'gateway timeout' } });

    // Worker A's send fails, so it tries to release -- but the claim is no longer its own.
    const outcome = await notice(makeSupabaseStub({}, episodes.rpc));
    expect(outcome).toBe('failed');

    const row = episodes.row('e1');
    expect(row.claimToken).toBe(tokenB());
    expect(row.attempts).toBe(0);          // A's failure was not recorded against B's claim
    expect(row.sendStartedFor).toBe(DUE);  // nor did it clear the marker B now relies on
  });

  it("rejects a stalled worker's completion, so the episode is not marked delivered under it", async () => {
    const episodes = makeEpisodes();
    const tokenB   = takeoverDuringSend(episodes, { data: { id: 'email-1' }, error: null });

    // Worker A's send succeeded, so it tries to finalize with a token that has been superseded.
    const outcome = await notice(makeSupabaseStub({}, episodes.rpc));
    expect(outcome).toBe('sent');

    const row = episodes.row('e1');
    expect(row.forDueDate).toBeNull();
    expect(row.claimToken).toBe(tokenB());
  });

  it('lets the next valid owner complete the episode that the stale worker could not', async () => {
    const episodes = makeEpisodes();
    const tokenB   = takeoverDuringSend(episodes, { data: null, error: { message: 'gateway timeout' } });
    await notice(makeSupabaseStub({}, episodes.rpc));

    // Worker B holds the claim, so nothing is settled yet and A left no trace on it.
    expect(episodes.row('e1').claimToken).toBe(tokenB());
    expect(episodes.row('e1').forDueDate).toBeNull();

    // B in turn goes quiet and its claim lapses. The next worker claims with a token of its own,
    // finds the begun-marker, and closes the episode -- its writes are accepted where A's were
    // refused, because the token it presents is the one currently on the row.
    episodes.now += CLAIM_TTL_MS + 1000;
    const outcome = await notice(makeSupabaseStub({}, episodes.rpc));
    expect(outcome).toBe('finalized');
    expect(episodes.row('e1').forDueDate).toBe(DUE);
    expect(episodes.row('e1').claimToken).toBeNull();
    expect(emailSend).toHaveBeenCalledTimes(1);
  });
});
