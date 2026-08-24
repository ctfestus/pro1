import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: db, role } = auth;

  const { userId } = await req.json();
  if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });

  if (userId === user.id) {
    return NextResponse.json({ error: 'You cannot delete your own account.' }, { status: 400 });
  }

  const { data: target } = await db.from('students').select('role').eq('id', userId).single();
  if (!target) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  if (target.role !== 'student') {
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admins can delete staff accounts.' }, { status: 403 });
    }
  }

  const { error } = await db.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
