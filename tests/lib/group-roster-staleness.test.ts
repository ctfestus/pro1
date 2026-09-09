import { describe, it, expect, vi, beforeEach } from 'vitest';

// What this guards: group_members rows survive a cohort move. A student moved onto a subscription
// stayed a stored member of their old cohort's group, so every group-targeted assignment email
// kept reaching them. Leaving the cohort means leaving its groups, so the stored membership is
// checked against each member's current cohort before anything is sent.

const { batchSend } = vi.hoisted(() => ({
  batchSend: vi.fn((_payloads: any[]) => Promise.resolve({ data: null, error: null })),
}));
vi.mock('resend', () => ({ Resend: class { emails = { send: vi.fn() }; batch = { send: batchSend }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: vi.fn().mockResolvedValue({
    appName: 'App', appUrl: 'https://app.test', senderName: 'Team', supportEmail: 'team@app.test',
    logoUrl: '', emailBannerUrl: '', teamName: 'Team',
  }),
}));

const { adminClientMock } = vi.hoisted(() => ({ adminClientMock: vi.fn() }));
vi.mock('@/lib/admin-client', () => ({ adminClient: adminClientMock }));

import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';

// s1 is still in cohort co1, which group g1 belongs to. s2 was moved onto a subscription plan
// cohort and left behind a group_members row for g1.
const STUDENTS = [
  { id: 's1', role: 'student', cohort_id: 'co1', full_name: 'Ama', email: 'ama@example.test' },
  { id: 's2', role: 'student', cohort_id: 'plan1', full_name: 'Kofi', email: 'kofi@example.test' },
];
const COHORTS = [
  { id: 'co1', cohort_kind: 'bootcamp' },
  { id: 'plan1', cohort_kind: 'subscription_plan' },
];

function db() {
  return {
    from(table: string) {
      // The id filter has to be honoured: the recipient list is built by narrowing one, so a stub
      // that ignored it would report a pass however the filtering went.
      const chain: any = {
        _col: '', _values: [] as string[],
        select() { return chain; },
        eq() { return chain; },
        in(col: string, values: string[]) { chain._col = col; chain._values = values; return chain; },
        order() { return chain; },
        range() { return chain; },
        then(onFulfilled: any, onRejected: any) {
          const match = (row: any) => !chain._col || chain._values.includes(row[chain._col]);
          const rows = (
            table === 'group_members' ? [{ group_id: 'g1', student_id: 's1' }, { group_id: 'g1', student_id: 's2' }]
            : table === 'groups'      ? [{ id: 'g1', cohort_id: 'co1' }]
            : table === 'cohorts'     ? COHORTS
            : table === 'students'    ? STUDENTS
            : []
          ).filter(match);
          return Promise.resolve({ data: rows, count: rows.length, error: null }).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };
}

function recipients() {
  return batchSend.mock.calls.flatMap(([payloads]: any[]) => (payloads ?? []).map((p: any) => p.to));
}

beforeEach(() => {
  batchSend.mockClear();
  adminClientMock.mockReturnValue(db());
  process.env.RESEND_API_KEY = 'test-key';
});

describe('group-targeted assignment notifications', () => {
  it('emails a current group member and not one who moved out of the cohort', async () => {
    await sendAssignmentNotifications({
      cohortIds: [], groupIds: ['g1'], title: 'Group Task', contentType: 'assignment',
    });
    expect(recipients()).toEqual(['ama@example.test']);
  });

  it('still emails the cohort recipients when a group is targeted alongside them', async () => {
    // The two audiences are gathered independently; narrowing the group half must not cost the
    // cohort half its recipients.
    await sendAssignmentNotifications({
      cohortIds: ['co1'], groupIds: ['g1'], title: 'Group Task', contentType: 'assignment',
    });
    expect(recipients()).toEqual(['ama@example.test']);
    expect(recipients()).not.toContain('kofi@example.test');
  });
});
