import { beforeEach, describe, expect, it, vi } from 'vitest';

// What this guards: deleting a cohort ran from the browser and the result was thrown away. RLS
// allows the delete only for the cohort's creator or an admin, and a cohort carrying payments is
// refused outright by ON DELETE RESTRICT -- so both refusals looked like success and the cohort
// reappeared on the next refresh.
//
// The chosen behaviour is a destructive delete: an intake's payment receipts and admission records
// go with the intake. That is only acceptable if it can never happen by accident, so the checks
// below are as much about the confirmation step as about the delete.

const authState = vi.hoisted(() => ({ requireRole: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({
  requireRole: authState.requireRole,
  isAuthError: (v: any) => !!v?.error,
}));

import { DELETE } from '@/app/api/cohorts/[id]/route';

const COHORT = { id: 'co1', name: 'Cohort A', created_by: 'owner1', cohort_kind: 'bootcamp' };

// Tables the count step reads, all empty unless a test says otherwise.
const EMPTY = {
  students: 0,
  payments: 0,
  student_payment_confirmations: 0,
  bootcamp_enrollments: 0,
  cohort_allowed_emails: 0,
  groups: 0,
  subscription_plans: 0,
  individual_subscriptions: 0,
  payment_config: 0,
};

/**
 * Hand-rolled rather than makeSupabaseStub: the count step queries `students` twice with different
 * columns (cohort_id, then original_cohort_id), and the assertions turn both on which count each
 * returns and on the order of the writes that follow.
 */
function db(opts: {
  cohort?: any;
  counts?: Partial<typeof EMPTY> & { studentsHeld?: number };
  deleteError?: { code?: string; message: string } | null;
  countError?: boolean;
  memberIds?: string[];
  heldIds?: string[];
  authDeleteError?: string;
} = {}) {
  const counts = { ...EMPTY, ...(opts.counts ?? {}) };
  const writes: string[] = [];
  const deletedUsers: string[] = [];

  return {
    writes,
    deletedUsers,
    rpc(fn: string, args: Record<string, any>) {
      writes.push(`rpc:${fn}:${args.p_cohort_id}`);
      if (opts.deleteError) return Promise.resolve({ data: null, error: opts.deleteError });
      // Members and held students come back as one set: both are rows the transaction detached.
      return Promise.resolve({
        data: {
          ok: true,
          paymentsDeleted: counts.payments,
          contentUntagged: 0,
          memberIds: [...(opts.memberIds ?? []), ...(opts.heldIds ?? [])],
        },
        error: null,
      });
    },
    auth: {
      admin: {
        deleteUser(userId: string) {
          if (opts.authDeleteError) return Promise.resolve({ error: { message: opts.authDeleteError } });
          deletedUsers.push(userId);
          return Promise.resolve({ error: null });
        },
      },
    },
    from(table: string) {
      const chain: any = {
        _columns: [] as string[],
        _write: '',
        select() { return chain; },
        delete() { chain._write = 'delete'; writes.push(`delete:${table}`); return chain; },
        update(payload: any) {
          chain._write = 'update';
          writes.push(`update:${table}:${Object.entries(payload).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(',')}`);
          return chain;
        },
        not() { return chain; },
        order() { return chain; },
        range() { return chain; },
        eq(col: string) { chain._columns.push(col); return chain; },
        maybeSingle() {
          if (table === 'cohorts') return Promise.resolve({ data: 'cohort' in opts ? opts.cohort : COHORT, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        then(onFulfilled: any, onRejected: any) {
          if (chain._write === 'delete') {
            const error = table === 'cohorts' ? (opts.deleteError ?? null) : null;
            return Promise.resolve({ error }).then(onFulfilled, onRejected);
          }
          if (chain._write === 'update') return Promise.resolve({ error: null }).then(onFulfilled, onRejected);
          if (opts.countError) return Promise.resolve({ count: null, error: { message: 'boom' } }).then(onFulfilled, onRejected);
          const count = table === 'students' && chain._columns.includes('original_cohort_id')
            ? (opts.counts?.studentsHeld ?? 0)
            : (counts as any)[table] ?? 0;
          return Promise.resolve({ count, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function del(dbStub: any, role: string, userId: string, body: any = {}) {
  authState.requireRole.mockResolvedValue({ user: { id: userId }, serviceDb: dbStub, role });
  return DELETE(
    new Request('http://localhost/api/cohorts/co1', { method: 'DELETE', body: JSON.stringify(body) }) as any,
    { params: Promise.resolve({ id: 'co1' }) },
  );
}

/** Ask, read the fingerprint back, then confirm with it -- exactly what the modal does. */
async function confirmDel(dbStub: any, role: string, userId: string, body: any = {}) {
  const asked = await del(dbStub, role, userId);
  const { fingerprint } = await asked.json();
  return del(dbStub, role, userId, { ...body, confirm: true, expect: fingerprint });
}

beforeEach(() => {
  authState.requireRole.mockReset();
});

describe('DELETE /api/cohorts/[id] -- authorization', () => {
  it('refuses an instructor who did not create the cohort', async () => {
    // RLS would delete zero rows here and report success. The route has to say so, because it
    // runs on the service-role client and RLS is not in the way any more.
    const stub = db();
    const res = await del(stub, 'instructor', 'someone-else');
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/created this cohort, or an admin/);
    expect(stub.writes).toEqual([]);
  });

  it('lets an admin delete a cohort they did not create', async () => {
    expect((await confirmDel(db(), 'admin', 'someone-else')).status).toBe(200);
  });

  it('lets staff delete a cohort they created but not one they did not', async () => {
    expect((await confirmDel(db(), 'staff', 'owner1')).status).toBe(200);
    expect((await confirmDel(db(), 'staff', 'someone-else')).status).toBe(403);
  });

  it('404s a cohort that does not exist', async () => {
    expect((await del(db({ cohort: null }), 'admin', 'admin1')).status).toBe(404);
  });
});

describe('DELETE /api/cohorts/[id] -- confirmation', () => {
  it('asks first even for a cohort nothing is attached to', async () => {
    // One click must not be able to delete a cohort, and "what will this cost me" is the whole
    // point of the round trip.
    const stub = db();
    const res = await del(stub, 'instructor', 'owner1');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.requiresConfirmation).toBe(true);
    expect(json.losses).toEqual([]);
    expect(json.error).toMatch(/Nothing is attached to it/);
    expect(stub.writes).toEqual([]);
  });

  it('deletes an empty cohort once confirmed', async () => {
    const stub = db();
    const res = await confirmDel(stub, 'instructor', 'owner1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted: [], deletedStudents: 0 });
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });

  it('refuses the first attempt and itemises everything that would be destroyed', async () => {
    const stub = db({ counts: {
      payments: 12, student_payment_confirmations: 2, bootcamp_enrollments: 30,
      cohort_allowed_emails: 4, groups: 3, students: 8, studentsHeld: 1,
    } });
    const res = await del(stub, 'admin', 'admin1');

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.requiresConfirmation).toBe(true);
    expect(json.losses).toEqual([
      '12 payment receipts',
      '2 payment confirmations',
      '30 admission and fee records',
      '4 pending admitted emails',
      '3 groups with their forums and workspaces',
    ]);
    // The members are reported separately: their fate is the choice being offered, so putting
    // them in the same list would contradict whichever way it went.
    expect(json.members).toBe(9);
    expect(json.error).toMatch(/cannot be undone/);
    // Nothing may be touched until the operator has seen that list.
    expect(stub.writes).toEqual([]);
  });

  it('destroys the payment history once confirmed, through one transactional call', async () => {
    // payment_config has no delete rule, payments is ON DELETE RESTRICT, and the cohort id also
    // sits inside every content cohort_ids array. Done as separate requests, a failure part-way
    // through left receipts deleted and the cohort standing, so all of it is one RPC.
    const stub = db({ counts: { payments: 12, payment_config: 1 } });
    const res = await confirmDel(stub, 'admin', 'admin1');

    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toEqual([
      '12 payment receipts',
      // Counted all along but once left unsaid: the delete clears this setting, and with it the
      // destination the overdue sweep moves late payers to.
      'the outstanding-payments setting, which will need pointing at another cohort before the overdue sweep can move anyone again',
    ]);
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });

  it('rolls the whole database side back as one unit', async () => {
    // Either all of it commits or none of it does, so a failure cannot leave the receipts gone
    // with the cohort still standing. Nothing may be written alongside the call.
    const stub = db({
      counts: { payments: 5, payment_config: 1, groups: 2 },
      deleteError: { message: 'connection lost' },
    });
    const res = await confirmDel(stub, 'admin', 'admin1');
    expect(res.status).toBe(500);
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });
});

describe('DELETE /api/cohorts/[id] -- what confirmation cannot override', () => {
  it('refuses a cohort that backs a subscription plan even when confirmed', async () => {
    // A plan's cohort is not an intake, and its payment history hangs off the plan through
    // several restricted references. It is deleted from the plans screen, not here.
    const stub = db({ counts: { subscription_plans: 1 } });
    const res = await confirmDel(stub, 'admin', 'admin1');
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/subscription plans screen/);
    expect(stub.writes).toEqual([]);
  });

  it('refuses a cohort with live subscriptions even when confirmed', async () => {
    const stub = db({ counts: { individual_subscriptions: 5 } });
    expect((await confirmDel(stub, 'admin', 'admin1')).status).toBe(409);
    expect(stub.writes).toEqual([]);
  });

  it('refuses a cohort that is not a bootcamp intake', async () => {
    const stub = db({ cohort: { ...COHORT, cohort_kind: 'subscription_plan' } });
    const res = await confirmDel(stub, 'admin', 'admin1');
    expect(res.status).toBe(409);
    expect(stub.writes).toEqual([]);
  });
});

describe('DELETE /api/cohorts/[id] -- failures', () => {
  it('does not delete when a count cannot be read', async () => {
    const stub = db({ countError: true });
    const res = await confirmDel(stub, 'admin', 'admin1');
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Could not check what is attached/);
    expect(stub.writes).toEqual([]);
  });

  it('reports a foreign key the counts do not know about instead of claiming success', async () => {
    const res = await confirmDel(
      db({ deleteError: { code: '23503', message: 'violates foreign key' } }),
      'admin', 'admin1',
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Something is still attached/);
  });
});

describe('DELETE /api/cohorts/[id] -- deleting the members too', () => {
  it('offers the choice by reporting how many members there are', async () => {
    const res = await del(db({ counts: { students: 8, studentsHeld: 2 } }), 'admin', 'admin1');
    const json = await res.json();
    // Both the ones in the cohort and the ones parked out of it over a balance: the hold points
    // back here, and that pointer is about to disappear.
    expect(json.members).toBe(10);
    expect(json.held).toBe(2);
    expect(json.losses).toEqual([]);
    expect(json.error).toMatch(/10 students left without a cohort/);
  });

  it('describes what deleting the accounts costs, rather than what detaching them costs', async () => {
    const res = await del(db({ counts: { students: 8, studentsHeld: 2 } }), 'admin', 'admin1', { deleteStudents: true });
    expect((await res.json()).error).toMatch(
      /10 student accounts with everything they submitted, their grades and their certificates/);
  });

  it('leaves the accounts alone by default', async () => {
    const stub = db({ counts: { students: 3 }, memberIds: ['s1', 's2', 's3'] });
    const res = await confirmDel(stub, 'admin', 'admin1');
    expect(res.status).toBe(200);
    expect(stub.deletedUsers).toEqual([]);
    expect((await res.json()).deletedStudents).toBe(0);
  });

  it('deletes the accounts when asked, including the ones held over a balance', async () => {
    const stub = db({
      counts: { students: 2, studentsHeld: 1 },
      memberIds: ['s1', 's2'], heldIds: ['s3'],
    });
    const res = await confirmDel(stub, 'admin', 'admin1', { deleteStudents: true });
    expect(res.status).toBe(200);
    expect(stub.deletedUsers).toEqual(['s1', 's2', 's3']);
    expect((await res.json()).deletedStudents).toBe(3);
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });

  it('never deletes the caller, whatever the request says', async () => {
    const stub = db({ counts: { students: 2 }, memberIds: ['s1', 'admin1'] });
    await confirmDel(stub, 'admin', 'admin1', { deleteStudents: true });
    expect(stub.deletedUsers).toEqual(['s1']);
  });

  it('reports exactly what survives when an account will not delete', async () => {
    // Removing a login is an Auth API call, so it can never join the transaction. It runs last:
    // the cohort is already gone, and what is left is students without a cohort -- the same state
    // the default choice produces, and recoverable.
    const stub = db({
      counts: { students: 2 }, memberIds: ['s1', 's2'], authDeleteError: 'auth is down',
    });
    const res = await confirmDel(stub, 'admin', 'admin1', { deleteStudents: true });
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.error).toMatch(/The cohort was deleted, but only 0 of 2 student accounts: auth is down/);
    expect(json.error).toMatch(/still exist, with no cohort/);
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });

  it('touches no account when the cohort delete itself fails', async () => {
    const stub = db({
      counts: { students: 2 }, memberIds: ['s1', 's2'],
      deleteError: { code: '23503', message: 'violates foreign key' },
    });
    const res = await confirmDel(stub, 'admin', 'admin1', { deleteStudents: true });
    expect(res.status).toBe(409);
    expect(stub.deletedUsers).toEqual([]);
  });
});

describe('DELETE /api/cohorts/[id] -- outcomes that were once unsaid', () => {
  it('warns that the overdue sweep loses its destination', async () => {
    const res = await del(db({ counts: { payment_config: 1 } }), 'admin', 'admin1');
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.losses).toEqual([
      'the outstanding-payments setting, which will need pointing at another cohort before the overdue sweep can move anyone again',
    ]);
  });

  it('returns the lifted-hold warning as its own field, not buried in a sentence', async () => {
    // A held student sits in the outstanding cohort with original_cohort_id pointing here. The
    // delete releases them outright (migration 207) rather than leaving them parked with nothing
    // to be restored to. That release changes their payment standing, and the confirmation modal
    // renders these fields rather than the joined sentence, so it needs one of its own.
    const res = await del(db({ counts: { students: 4, studentsHeld: 2 } }), 'admin', 'admin1');
    const json = await res.json();
    expect(json.error).toMatch(/6 students left without a cohort/);
    expect(json.holdWarning).toBe(
      'It also lifts 2 outstanding-balance holds, so those students stop being flagged as owing.');
    expect(json.error).toContain(json.holdWarning);
  });

  it('does not warn about holds when the accounts are going anyway', async () => {
    const res = await del(db({ counts: { students: 4, studentsHeld: 2 } }), 'admin', 'admin1', { deleteStudents: true });
    const json = await res.json();
    expect(json.error).toMatch(/6 student accounts with everything they submitted/);
    expect(json.holdWarning).toBeNull();
  });

  it('has no hold warning when nobody is held', async () => {
    const res = await del(db({ counts: { students: 4 } }), 'admin', 'admin1');
    expect((await res.json()).holdWarning).toBeNull();
  });
});

describe('DELETE /api/cohorts/[id] -- the confirmation is tied to what was shown', () => {
  it('will not delete on a confirmation that carries no fingerprint', async () => {
    const stub = db({ counts: { students: 3 } });
    const res = await del(stub, 'admin', 'admin1', { confirm: true });
    expect(res.status).toBe(409);
    expect((await res.json()).stale).toBe(true);
    expect(stub.writes).toEqual([]);
  });

  it('asks again when the cohort changed between being shown and being confirmed', async () => {
    // Agreeing to delete 3 students is not agreeing to delete 43. The fingerprint is the numbers
    // the operator actually read, so a cohort that grew in the meantime forces a fresh warning.
    const stub = db({ counts: { students: 43 } });
    const res = await del(stub, 'admin', 'admin1', { confirm: true, expect: '3:0:0:0:0:0:0:0' });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.stale).toBe(true);
    expect(json.members).toBe(43);
    expect(json.error).toMatch(/changed while you were looking at it/);
    expect(stub.writes).toEqual([]);
  });

  it('goes through when the fingerprint still matches', async () => {
    const stub = db({ counts: { students: 3 } });
    expect((await confirmDel(stub, 'admin', 'admin1')).status).toBe(200);
    expect(stub.writes).toEqual(['rpc:delete_bootcamp_cohort:co1']);
  });

  it('deletes the accounts the transaction reports detaching, not a list read beforehand', async () => {
    // The ids come from inside the transaction, captured under lock. Anything that moved in or out
    // while the route was working is therefore not acted on by mistake.
    const stub = db({ counts: { students: 2, studentsHeld: 1 }, memberIds: ['s1', 's2'], heldIds: ['s3'] });
    await confirmDel(stub, 'admin', 'admin1', { deleteStudents: true });
    expect(stub.deletedUsers).toEqual(['s1', 's2', 's3']);
  });
});
