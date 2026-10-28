import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reconciliation must be safe under BOTH failure modes:
//
// 1. Concurrency -- two dashboard loads can both see an unfinalized progress row and run
//    reconcilePathCompletion at the same time. The partial unique index (migration 140)
//    makes the losing certificate insert fail with 23505 (ensureCertificate re-reads the
//    winner), and the email_dedup insert-as-lock lets exactly one request send each email.
//
// 2. Crash recovery -- a run can die between the certificate insert and the email (or the
//    cert_id backfill). Because the cert_id backfill runs LAST (the commit marker) and the
//    emails are gated by email_dedup rather than isNew, the next reconciliation retries
//    and sends the email exactly once.
//
// The stub serializes what is really concurrent: both calls are configured to read the
// same pre-write state, exactly as two simultaneous requests would.

const sendSpy = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { id: 'email1' }, error: null }));
vi.mock('resend', () => ({ Resend: class { emails = { send: sendSpy }; } }));

vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@test.co',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team', appName: 'App',
  }),
}));

import { reconcilePathCompletion, updateLearningPathProgress } from '@/lib/learning-path-progress';
import { makeSupabaseStub } from '../helpers/supabaseStub';

// Completion is finalized by complete_learning_path_progress (migration 226): the row id when it
// finalized, as for an unchanged path and the same track.
const completeRpc = (fn: string) => {
  if (fn !== 'complete_learning_path_progress') throw new Error(`unexpected rpc ${fn}`);
  return { data: 'prog1', error: null };
};

beforeEach(() => {
  sendSpy.mockClear();
  process.env.RESEND_API_KEY = 'test-key';
});

describe('reconcilePathCompletion declines', () => {
  it('issues nothing when completion is declined (the path changed or the track switched)', async () => {
    const path = { id: 'lp1', title: 'Data Path', item_ids: ['c1'], next_path_id: null, updated_at: '2026-10-01T00:00:00Z' };
    const rpc = vi.fn(() => ({ data: null, error: null }));
    const db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_path_progress: { data: null, error: null },
    }, rpc);
    await reconcilePathCompletion(db, 's1', path, ['c1']);
    expect(rpc).toHaveBeenCalledWith('complete_learning_path_progress', expect.objectContaining({ p_path_updated_at: '2026-10-01T00:00:00Z', p_track_id: null }));
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('updateLearningPathProgress declines', () => {
  it('saves the progress without completing when completion is declined', async () => {
    const rpc = vi.fn(() => ({ data: null, error: null }));
    const db = makeSupabaseStub({
      students: { data: { cohort_id: 'co1' }, error: null },
      learning_paths: { data: [{ id: 'lp1', title: 'P', item_ids: ['c1', 'c2'], tracks: [], next_path_id: null, updated_at: '2026-10-01T00:00:00Z' }], error: null },
      // The read (c2 already done), then the plain progress save.
      learning_path_progress: [{ data: { completed_item_ids: ['c2'], track_id: null }, error: null }, { data: { id: 'prog1' }, error: null }],
    }, rpc);
    // c1 comes before c2, so a wrongly sent "next up" email would look up its items; the strict
    // stub has no item tables, and that failure is logged.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    await updateLearningPathProgress(db, 's1', 'c1');
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    // No certificate, no completion email, and no "next up" email for a path that is done.
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('reconcilePathCompletion concurrency', () => {
  it('issues one certificate and one email when two reconciliations race', async () => {
    const path = { id: 'lp1', title: 'Data Path', item_ids: ['c1'], next_path_id: null, updated_at: '2026-10-01T00:00:00Z' };
    const db = makeSupabaseStub({
      students: [
        { data: { cohort_id: 'co1' }, error: null },                                  // call1: reconcile
        { data: { full_name: 'Student One', email: 's@x.co' }, error: null },         // call1: effects
        { data: { cohort_id: 'co1' }, error: null },                                  // call2: reconcile
        { data: { full_name: 'Student One', email: 's@x.co' }, error: null },         // call2: effects
      ],
      learning_path_progress: [
        { data: null, error: null },              // call1: select -- not finalized
        { data: null, error: null },              // call1: cert_id backfill (commit marker)
        { data: null, error: null },              // call2: select -- concurrent, still sees nothing
        { data: null, error: null },              // call2: cert_id backfill with the winner's id
      ],
      certificates: [
        { data: null, error: null },                            // call1: ensure pre-check
        { data: { id: 'certA' }, error: null },                 // call1: insert wins
        { data: null, error: null },                            // call2: pre-check -- concurrent snapshot
        { data: null, error: { code: '23505' } },               // call2: insert loses on the unique index
        { data: { id: 'certA' }, error: null },                 // call2: re-read resolves to the winner
      ],
      learning_paths: [
        { data: { badge_image_url: null }, error: null },                                   // call1: pathMeta
        { data: { title: 'Data Path', description: null, item_ids: ['c1'] }, error: null }, // call1: fullPath
        { data: { badge_image_url: null }, error: null },                                   // call2: pathMeta
        { data: { title: 'Data Path', description: null, item_ids: ['c1'] }, error: null }, // call2: fullPath
      ],
      courses:             { data: [{ id: 'c1', title: 'Course 1', cover_image: null, description: null }], error: null },
      virtual_experiences: { data: [], error: null },
      certifications:      { data: [], error: null },
      email_dedup: [
        { data: null, error: null },                     // call1: insert-as-lock acquired
        { data: null, error: null },                     // call1: mark sent
        { data: null, error: { code: '23505' } },        // call2: lock already taken
        { data: { status: 'sent' }, error: null },       // call2: winner already sent -- skip
      ],
    }, completeRpc);

    await reconcilePathCompletion(db, 's1', path, ['c1']);
    await reconcilePathCompletion(db, 's1', path, ['c1']);

    // The losing call attempts the email too, but the email_dedup lock blocks the send --
    // if the arbitration regressed, sendSpy would be 2.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].subject).toContain('Learning Path Certificate');
  });

  it('sends the next-path enrollment email once when two completions race', async () => {
    // cert_id already set (hadCertId) isolates the next-path block.
    const path = { id: 'lp1', title: 'Data Path', item_ids: ['c1'], next_path_id: 'lp2', updated_at: '2026-10-01T00:00:00Z' };
    const prog = { id: 'prog1', completed_at: null, cert_id: 'certX', completed_item_ids: ['c1'] };
    const db = makeSupabaseStub({
      students: [
        { data: { cohort_id: 'co1' }, error: null },                             // call1: reconcile
        { data: { full_name: 'Student One', email: 's@x.co' }, error: null },    // call1: enrollment email
        { data: { cohort_id: 'co1' }, error: null },                             // call2: reconcile
        { data: { full_name: 'Student One', email: 's@x.co' }, error: null },    // call2: enrollment email attempt
      ],
      learning_path_progress: [
        { data: prog, error: null },              // call1: select
        { data: prog, error: null },              // call2: select
      ],
      learning_paths: [
        { data: { id: 'lp2', cohort_ids: [], title: 'Next Path', description: null, item_ids: [] }, error: null }, // call1: nextPath
        { data: [{ id: 'lp2' }], error: null },   // call1: conditional update enrolls the cohort
        { data: { id: 'lp2', cohort_ids: [], title: 'Next Path', description: null, item_ids: [] }, error: null }, // call2: concurrent snapshot
        { data: [], error: null },                // call2: filter matches nothing -- already enrolled
      ],
      email_dedup: [
        { data: null, error: null },                     // call1: lock acquired
        { data: null, error: null },                     // call1: mark sent
        { data: null, error: { code: '23505' } },        // call2: lock already taken
        { data: { status: 'sent' }, error: null },       // call2: already sent -- skip
      ],
    }, completeRpc);

    await reconcilePathCompletion(db, 's1', path, ['c1']);
    await reconcilePathCompletion(db, 's1', path, ['c1']);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].subject).toContain('enrolled in a new learning path');
  });

  it('recovers a certificate email missed by a crash between insert and send', async () => {
    // State left by a run that died after inserting the certificate: cert exists,
    // progress finalized-in-part (completed_at set, cert_id still null), no email lock.
    const path = { id: 'lp1', title: 'Data Path', item_ids: ['c1'], next_path_id: null, updated_at: '2026-10-01T00:00:00Z' };
    const db = makeSupabaseStub({
      students: [
        { data: { cohort_id: 'co1' }, error: null },
        { data: { full_name: 'Student One', email: 's@x.co' }, error: null },
      ],
      learning_path_progress: [
        { data: { id: 'prog1', completed_at: '2026-07-17T00:00:00Z', cert_id: null, completed_item_ids: ['c1'] }, error: null },
        { data: null, error: null },              // cert_id backfill
      ],
      certificates: [
        { data: { id: 'certA' }, error: null },   // ensure pre-check finds the crashed run's cert
      ],
      learning_paths: [
        { data: { badge_image_url: null }, error: null },
        { data: { title: 'Data Path', description: null, item_ids: ['c1'] }, error: null },
      ],
      courses:             { data: [{ id: 'c1', title: 'Course 1', cover_image: null, description: null }], error: null },
      virtual_experiences: { data: [], error: null },
      certifications:      { data: [], error: null },
      email_dedup: [
        { data: null, error: null },   // lock free -- the crashed run never got here
        { data: null, error: null },   // mark sent
      ],
    }, completeRpc);

    await reconcilePathCompletion(db, 's1', path, ['c1']);

    // ensureCertificate returned isNew=false, but the email must STILL go out -- gating
    // it on isNew is exactly the bug this test pins.
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0].subject).toContain('Learning Path Certificate');
  });
});
