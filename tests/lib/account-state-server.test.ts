import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  markAdmissionsProvisioned,
  markExistingAccountAdmitted,
  markSelfSignupApproved,
  markSelfSignupDenied,
  markPasswordSetupComplete,
} from '@/lib/account-state-server';

// The students row is authoritative and the app_metadata claim is a cache of it. The
// two live in different systems and cannot be written atomically, so what this module
// must guarantee instead is: no silent partial success, and any partial failure leaves
// the account MORE restricted rather than less.

const order: string[] = [];

function client(over: {
  rowRows?: { id: string }[];
  rowError?: { message: string } | null;
  claimError?: { message: string } | null;
  claimReject?: Error;
} = {}) {
  const select = vi.fn(async () => {
    order.push('row');
    return { data: over.rowRows ?? [{ id: 'user-1' }], error: over.rowError ?? null };
  });
  const eq     = vi.fn(() => ({ select }));
  const update = vi.fn((_patch: Record<string, unknown>) => ({ eq }));
  const from   = vi.fn(() => ({ update }));
  const updateUserById = vi.fn(async () => {
    order.push('claim');
    if (over.claimReject) throw over.claimReject;
    return { error: over.claimError ?? null };
  });

  return {
    db: { from, auth: { admin: { updateUserById } } } as never,
    update,
    updateUserById,
  };
}

beforeEach(() => { order.length = 0; });

describe('what each transition writes', () => {
  it('records an admissions account as admitted and owing a password', async () => {
    const c = client();
    await markAdmissionsProvisioned(c.db, 'user-1');

    expect(c.update).toHaveBeenCalledWith(
      expect.objectContaining({ account_origin: 'admissions', access_state: 'active' }),
    );
    expect(c.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { access_state: 'active', needs_password_setup: true },
    });
  });

  // Admitting an existing account must not demand a password reset from someone whose
  // password already works, and must not rewrite how the account was created.
  it('only lifts the block when admitting an account that already exists', async () => {
    const c = client();
    await markExistingAccountAdmitted(c.db, 'user-1');

    expect(c.update).toHaveBeenCalledWith({ access_state: 'active' });
    expect(c.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { access_state: 'active' },
    });
  });

  it('records an approved self-signup', async () => {
    const c = client();
    await markSelfSignupApproved(c.db, 'user-1');

    expect(c.update).toHaveBeenCalledWith({ account_origin: 'self_signup', access_state: 'active' });
  });

  it('records a denied self-signup', async () => {
    const c = client();
    await markSelfSignupDenied(c.db, 'user-1');

    expect(c.update).toHaveBeenCalledWith({ account_origin: 'self_signup', access_state: 'denied' });
  });

  it('clears the setup claim and stamps the profile together', async () => {
    const c = client();
    await markPasswordSetupComplete(c.db, 'user-1');

    expect(c.update).toHaveBeenCalledWith(
      expect.objectContaining({ password_set_at: expect.any(String) }),
    );
    expect(c.updateUserById).toHaveBeenCalledWith('user-1', {
      app_metadata: { needs_password_setup: false },
    });
  });
});

describe('write ordering', () => {
  // Whichever write lands alone must be the restrictive one.
  it('writes the claim first when the transition restricts', async () => {
    await markSelfSignupDenied(client().db, 'user-1');
    expect(order).toEqual(['claim', 'row']);
  });

  it('writes the claim first when flagging an owed password', async () => {
    await markAdmissionsProvisioned(client().db, 'user-1');
    expect(order).toEqual(['claim', 'row']);
  });

  it('writes the row first when the transition releases', async () => {
    await markPasswordSetupComplete(client().db, 'user-1');
    expect(order).toEqual(['row', 'claim']);
  });

  it('writes the row first when admitting', async () => {
    await markSelfSignupApproved(client().db, 'user-1');
    expect(order).toEqual(['row', 'claim']);
  });
});

describe('partial failures are never silent', () => {
  // Supabase returns no error for an update matching zero rows. Without an explicit
  // check the claim would move while the authoritative record did not.
  it('throws when the patch matches no student row', async () => {
    const c = client({ rowRows: [] });

    await expect(markSelfSignupApproved(c.db, 'ghost')).rejects.toThrow(/no students row/);
  });

  it('throws when the profile write fails', async () => {
    const c = client({ rowError: { message: 'deadlock' } });

    await expect(markSelfSignupApproved(c.db, 'user-1')).rejects.toThrow(/deadlock/);
  });

  it('throws when the claim write fails', async () => {
    const c = client({ claimError: { message: 'gotrue unavailable' } });

    await expect(markSelfSignupApproved(c.db, 'user-1')).rejects.toThrow(/gotrue unavailable/);
  });

  it('normalizes a rejected auth request as a claim update failure', async () => {
    const c = client({ claimReject: new Error('network unavailable') });

    await expect(markExistingAccountAdmitted(c.db, 'user-1')).rejects.toThrow(/claim update failed.*network unavailable/);
    expect(c.update).toHaveBeenCalledWith({ access_state: 'active' });
    expect(order).toEqual(['row', 'claim']);
  });

  // A restricting transition writes the claim first, so a failed row write still leaves
  // the account gated rather than open.
  it('has already applied the restrictive claim when the row write then fails', async () => {
    const c = client({ rowError: { message: 'deadlock' } });

    await expect(markSelfSignupDenied(c.db, 'user-1')).rejects.toThrow();
    expect(c.updateUserById).toHaveBeenCalled();
    expect(order).toEqual(['claim', 'row']);
  });
});
