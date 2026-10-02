import { beforeEach, describe, expect, it, vi } from 'vitest';

// Exercises the real admitStudents pipeline with Supabase and Resend faked, to pin which email
// each kind of account gets: new accounts and accounts that cannot sign in yet get the
// set-password email; accounts that can already sign in get the added-to-cohort email.

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  generateLink: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  createAdmissionRecord: vi.fn(),
  students: new Map<string, any>(),
  studentUpdates: [] as Record<string, unknown>[],
}));

vi.mock('resend', () => ({ Resend: class { batch = { send: mocks.send }; } }));
vi.mock('@/lib/db-payments', () => ({ createAdmissionRecord: mocks.createAdmissionRecord, activateEnrollment: async () => undefined }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({ appUrl: 'https://academy.test', appName: 'Academy', senderName: 'Academy', supportEmail: 'help@academy.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team' }),
}));
vi.mock('@/lib/account-state-server', () => ({ markAdmissionsProvisioned: async () => undefined, markExistingAccountAdmitted: async () => undefined }));
vi.mock('@/lib/resend-audience', () => ({ addToResendAudience: async () => undefined }));

import { admitStudents } from '@/lib/admit-students';

function fakeDb() {
  return {
    from(table: string) {
      const state: { email?: string } = {};
      const builder: any = {};
      for (const method of ['select', 'upsert', 'delete', 'in', 'order']) builder[method] = () => builder;
      builder.update = (value: Record<string, unknown>) => {
        if (table === 'students') mocks.studentUpdates.push(value);
        return builder;
      };
      builder.eq = (column: string, value: unknown) => { if (column === 'email') state.email = String(value); return builder; };
      builder.maybeSingle = async () => {
        if (table === 'cohort_payment_settings') return { data: { total_fee: 3000, currency: 'GHS' }, error: null };
        if (table === 'cohorts') return { data: { name: 'October Cohort', start_date: '2026-10-20', end_date: null }, error: null };
        if (table === 'students') return { data: mocks.students.get(state.email ?? '') ?? null, error: null };
        return { data: null, error: null };
      };
      builder.single = async () => ({ data: { student_id: null }, error: null });
      builder.then = (resolve: (value: unknown) => void) => resolve({ data: null, error: null });
      return builder;
    },
    auth: { admin: { createUser: mocks.createUser, generateLink: mocks.generateLink, getUserById: mocks.getUserById, deleteUser: async () => ({}) } },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  mocks.students.clear();
  mocks.studentUpdates = [];
  mocks.createUser.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });
  mocks.createAdmissionRecord.mockResolvedValue('enrollment-1');
  mocks.generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'token-hash' } }, error: null });
  mocks.send.mockResolvedValue({ data: {}, error: null });
});

describe('admitStudents emails', () => {
  it('sends a new account the set-password email', async () => {
    const result = await admitStudents(fakeDb(), 'cohort-1', [{ email: 'new@example.com', full_name: 'Ama' }]);
    expect('error' in result).toBe(false);
    const [email] = mocks.send.mock.calls[0][0];
    expect(email.subject).toBe('Your Academy account is ready');
    expect(email.html).toContain('Set Password');
    expect(mocks.generateLink).toHaveBeenCalledOnce();
    expect((result as any).admittedEmails).toEqual(['new@example.com']);
  });

  it('sends an account that has signed in before the added-to-cohort email, with no reset link', async () => {
    mocks.students.set('kofi@example.com', { id: 'kofi', role: 'student', full_name: 'Kofi', account_provisioned_at: '2025-01-01', password_set_at: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: '2026-09-01T10:00:00Z' } }, error: null });
    await admitStudents(fakeDb(), 'cohort-1', [{ email: 'kofi@example.com', full_name: 'Kofi' }]);
    const [email] = mocks.send.mock.calls[0][0];
    expect(email.subject).toBe('You have been added to October Cohort');
    expect(email.html).toContain('Sign In');
    // The base URL is APP_URL when set, else the tenant's app URL; the path is what matters.
    expect(email.html).toMatch(/href="[^"]*\/student"/);
    expect(email.html).not.toContain('Set Password');
    expect(mocks.generateLink).not.toHaveBeenCalled();
  });

  it('treats a recorded password as able to sign in without asking auth', async () => {
    mocks.students.set('esi@example.com', { id: 'esi', role: 'student', full_name: 'Esi', account_provisioned_at: '2025-01-01', password_set_at: '2025-02-01' });
    await admitStudents(fakeDb(), 'cohort-1', [{ email: 'esi@example.com', full_name: 'Esi' }]);
    expect(mocks.send.mock.calls[0][0][0].subject).toBe('You have been added to October Cohort');
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it('keeps an account admitted when its set-password link cannot be generated', async () => {
    mocks.generateLink.mockResolvedValue({ data: { properties: {} }, error: { message: 'rate limited' } });
    const result = await admitStudents(fakeDb(), 'cohort-1', [{ email: 'new@example.com', full_name: 'Ama' }]) as any;
    expect(result.admittedEmails).toEqual(['new@example.com']);
    expect(result.errors).toEqual([{ email: 'new@example.com', error: 'Admitted, but the setup email could not be prepared: rate limited' }]);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('reports a resolved Resend error and does not stamp the setup email as sent', async () => {
    mocks.send.mockResolvedValue({ data: null, error: { message: 'batch rejected' } });
    const db = fakeDb();
    const result = await admitStudents(db, 'cohort-1', [{ email: 'new@example.com', full_name: 'Ama' }]) as any;
    expect(result.admittedEmails).toEqual(['new@example.com']);
    expect(result.setupEmailsSent).toBe(0);
    expect(result.errors).toEqual([{ email: 'new@example.com', error: 'batch rejected' }]);
    expect(mocks.studentUpdates.some(update => 'setup_email_sent_at' in update)).toBe(false);
  });

  it('refuses admin and instructor accounts', async () => {
    mocks.students.set('boss@example.com', { id: 'boss', role: 'admin', full_name: 'Boss', account_provisioned_at: '2025-01-01', password_set_at: '2025-02-01' });
    const result = await admitStudents(fakeDb(), 'cohort-1', [{ email: 'boss@example.com' }]) as any;
    expect(result.admittedEmails).toEqual([]);
    expect(result.errors).toEqual([{ email: 'boss@example.com', error: 'This email already belongs to an admin or instructor account.' }]);
    expect(mocks.createAdmissionRecord).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('still sends the set-password email to an existing account that has never signed in', async () => {
    mocks.students.set('yaw@example.com', { id: 'yaw', role: 'student', full_name: 'Yaw', account_provisioned_at: '2025-01-01', password_set_at: null });
    mocks.getUserById.mockResolvedValue({ data: { user: { last_sign_in_at: null } }, error: null });
    await admitStudents(fakeDb(), 'cohort-1', [{ email: 'yaw@example.com', full_name: 'Yaw' }]);
    expect(mocks.send.mock.calls[0][0][0].html).toContain('Set Password');
    expect(mocks.generateLink).toHaveBeenCalledOnce();
  });
});
