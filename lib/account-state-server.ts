// The ONLY writers of account_origin, access_state, and their cached app_metadata
// claims. Nothing else may set them: drift between independently-written copies of the
// same fact is exactly the bug this module exists to prevent -- see the header of
// lib/account-state.ts.
//
// HONEST LIMITS OF THE GUARANTEE. The students row lives in Postgres and the claim
// lives in GoTrue, so the two writes cannot be atomic and this module does not pretend
// otherwise. What it does guarantee:
//
//   * The row is authoritative; the claim is a cache that may briefly lag it.
//   * A partial failure always leaves the account MORE restricted, never less. That is
//     why restricting transitions write the claim first and releasing transitions write
//     the row first -- whichever write lands alone is the safe one.
//   * A transition that does not match a student row is an error, not a silent success.
//     Supabase returns no error for an update matching zero rows, which would otherwise
//     let the claim move while the authoritative record did not.
//   * Any failure throws. A caller that swallows it is claiming a transition happened
//     when it did not.
//
// Server only: these need the service-role client. lib/account-state.ts holds the pure
// predicates that edge middleware reads.

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  ACCESS_STATE_CLAIM,
  PASSWORD_SETUP_CLAIM,
  type AccessState,
  type AccountOrigin,
} from '@/lib/account-state';

interface Transition {
  origin?: AccountOrigin;
  accessState?: AccessState;
  /** undefined leaves the password-setup claim untouched. */
  needsPasswordSetup?: boolean;
  /** Stamp students.password_set_at as part of this transition. */
  stampPasswordSet?: boolean;
}

/**
 * Apply a transition to both the row and the cached claims.
 *
 * Throws if either write fails. Callers decide what that means for their flow; what
 * they must not do is continue as though the account had moved state.
 */
async function applyTransition(db: SupabaseClient, userId: string, change: Transition): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (change.origin)           patch.account_origin = change.origin;
  if (change.accessState)      patch.access_state   = change.accessState;
  if (change.stampPasswordSet) patch.password_set_at = new Date().toISOString();

  const appMetadata: Record<string, unknown> = {};
  if (change.accessState)                      appMetadata[ACCESS_STATE_CLAIM]   = change.accessState;
  if (change.needsPasswordSetup !== undefined) appMetadata[PASSWORD_SETUP_CLAIM] = change.needsPasswordSetup;

  const writeRow = async () => {
    if (Object.keys(patch).length === 0) return;
    // .select() so a patch that matched nothing is visible. Without it, updating a
    // user with no students row succeeds silently and the claim moves alone.
    const { data, error } = await db.from('students').update(patch).eq('id', userId).select('id');
    if (error) throw new Error(`account-state: profile update failed -- ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`account-state: no students row for ${userId}; transition not applied`);
    }
  };

  const writeClaims = async () => {
    if (Object.keys(appMetadata).length === 0) return;
    let result: { error: { message: string } | null };
    try {
      result = await db.auth.admin.updateUserById(userId, { app_metadata: appMetadata });
    } catch (error) {
      throw new Error(`account-state: claim update failed -- ${(error as Error).message || 'unknown error'}`);
    }
    const { error } = result;
    if (error) throw new Error(`account-state: claim update failed -- ${error.message}`);
  };

  // Order so that whichever write lands alone is the restrictive one.
  const restricts = change.accessState === 'pending'
    || change.accessState === 'denied'
    || change.needsPasswordSetup === true;

  if (restricts) {
    await writeClaims();
    await writeRow();
  } else {
    await writeRow();
    await writeClaims();
  }
}

/**
 * An admin created this account through the admissions pipeline. It is admitted from
 * the start, and it owes a password: the setup link signs the student in before they
 * have ever chosen one.
 */
export function markAdmissionsProvisioned(db: SupabaseClient, userId: string) {
  return applyTransition(db, userId, {
    origin: 'admissions',
    accessState: 'active',
    needsPasswordSetup: true,
  });
}

/**
 * An admin admitted an account that already existed -- a student moving cohort, a
 * pending signup, or one previously denied. Admission by an admin is an override, so it
 * clears any block.
 *
 * It deliberately does NOT touch the password claim: this account may already have a
 * working password, and demanding a reset would be a regression. Nor does it touch
 * origin: admitting an account does not change how it was created.
 */
export function markExistingAccountAdmitted(db: SupabaseClient, userId: string) {
  return applyTransition(db, userId, { accessState: 'active' });
}

/** A self-signup whose email was on a cohort allowlist. */
export function markSelfSignupApproved(db: SupabaseClient, userId: string) {
  return applyTransition(db, userId, { origin: 'self_signup', accessState: 'active' });
}

/**
 * A self-signup that no cohort allowlist covers. The account is kept rather than
 * deleted -- losing a real learner is unrecoverable, keeping a junk account is not --
 * and this state is what stops it being used.
 */
export function markSelfSignupDenied(db: SupabaseClient, userId: string) {
  return applyTransition(db, userId, { origin: 'self_signup', accessState: 'denied' });
}

/**
 * The student has chosen a password. Clears the setup claim and stamps the profile in
 * one transition so the gate and the admin progress column cannot disagree.
 */
export function markPasswordSetupComplete(db: SupabaseClient, userId: string) {
  return applyTransition(db, userId, { needsPasswordSetup: false, stampPasswordSet: true });
}
