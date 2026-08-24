import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  // Prevent self-deletion of admin accounts via this endpoint
  const { data: profile } = await supabase
    .from('students')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role === 'admin') {
    return NextResponse.json({ error: 'Admin accounts cannot be self-deleted.' }, { status: 403 });
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[account/delete]', deleteError.message);
    return NextResponse.json({ error: 'Failed to delete account. Please try again.' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
