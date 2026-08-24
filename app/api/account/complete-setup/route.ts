import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { markPasswordSetupComplete } from '@/lib/account-state-server';

export const dynamic = 'force-dynamic';

// Completes first-time password setup for a student signed in by their setup link.
//
// The password change happens HERE rather than on the client, so the setup claim can
// only be cleared by an actual password change. If this endpoint merely cleared the
// claim, anyone holding the recovery session could call it directly and walk past the
// middleware gate without ever choosing a password.
//
// Password and claim go out in a single admin update so the gate can never be
// released without the password landing with it. app_metadata is service-role only,
// which is what stops the client from clearing the claim itself.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const password = body.password;
  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateError) {
    console.error('[account/complete-setup]', updateError.message);
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  // Only after the password actually lands. lib/account-state-server is the sole writer
  // of the claim, so the gate and the stored profile move together.
  try {
    await markPasswordSetupComplete(supabase, user.id);
  } catch (e: any) {
    console.error('[account/complete-setup]', e?.message ?? e);
    return NextResponse.json({ error: 'Could not complete password setup.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
