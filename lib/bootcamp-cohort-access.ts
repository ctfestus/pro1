import { NextResponse } from 'next/server';
import type { AuthedUser } from '@/lib/api-auth';
import { COHORT_KIND_BOOTCAMP } from '@/lib/cohort-kind';

type BootcampCohortAccessOptions = {
  anyCohortRoles?: string[];
};

export type BootcampCohortAccess =
  | {
      ok: true;
      profile: {
        role: string | null;
        cohort_id: string | null;
        email?: string | null;
      };
    }
  | { error: NextResponse };

export async function requireBootcampCohortAccess(
  auth: AuthedUser,
  cohortId: string,
  options: BootcampCohortAccessOptions = {},
): Promise<BootcampCohortAccess> {
  const { data: profile, error: profileError } = await auth.supabase
    .from('students')
    .select('role, cohort_id, email')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[bootcamp-cohort-access] profile lookup failed', profileError.message);
    return { error: NextResponse.json({ error: 'Could not verify cohort access.' }, { status: 500 }) };
  }
  if (!profile) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const canReadAnyBootcampCohort = options.anyCohortRoles?.includes(profile.role) ?? false;
  if (!canReadAnyBootcampCohort && profile.cohort_id !== cohortId) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  const { data: cohort, error: cohortError } = await auth.supabase
    .from('cohorts')
    .select('cohort_kind')
    .eq('id', cohortId)
    .maybeSingle();

  if (cohortError) {
    console.error('[bootcamp-cohort-access] cohort lookup failed', cohortError.message);
    return { error: NextResponse.json({ error: 'Could not verify cohort access.' }, { status: 500 }) };
  }
  if (cohort?.cohort_kind !== COHORT_KIND_BOOTCAMP) {
    return { error: NextResponse.json({ error: 'Bootcamp cohort access required.' }, { status: 403 }) };
  }

  return { ok: true, profile };
}
