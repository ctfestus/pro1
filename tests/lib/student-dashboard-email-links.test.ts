import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const assignmentEmailSources = [
  'app/api/assignments/complete-ve-assignment/route.ts',
  'app/api/assignments/grade-notify/route.ts',
  'app/api/assignments/submit-confirm/route.ts',
  'app/api/cron/deadline-reminders/route.ts',
  'lib/group-submission-notifications.ts',
  'lib/remind-unsubmitted.ts',
];

const paymentEmailSources = [
  'app/api/cron/grace-period-reminders/route.ts',
  'app/api/payments/route.ts',
  'app/api/student-payments/route.ts',
  'app/api/student-subscriptions/route.ts',
  'lib/db-payments.ts',
  'lib/notify-paystack-cart.ts',
  'lib/notify-subscription-expiring.ts',
  'lib/notify-subscription-payment-request.ts',
  'lib/overdue-notice.ts',
];

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolutePath);
    return /\.tsx?$/.test(entry.name) ? [absolutePath] : [];
  });
}

describe('student dashboard email links', () => {
  it.each(assignmentEmailSources)('%s opens the assignments section', source => {
    const contents = read(source);
    expect(contents).toContain('/student#assignments');
    expect(contents).not.toContain('/student?section=assignments');
  });

  it.each(paymentEmailSources)('%s opens the payments section', source => {
    const contents = read(source);
    expect(contents).toContain('/student#payments');
    expect(contents).not.toContain('/student?section=payments');
  });

  it('does not use ignored query-string routing anywhere in learner-facing source', () => {
    const offenders = ['app', 'components', 'lib']
      .flatMap(directory => sourceFiles(path.join(root, directory)))
      .filter(file => read(path.relative(root, file)).includes('/student?section='))
      .map(file => path.relative(root, file));

    expect(offenders).toEqual([]);
  });

  it('sends other learner CTAs to the section named by the action', () => {
    expect(read('app/api/nudge-student/route.ts')).toContain('/student/assignments/${formId}');
    expect(read('app/api/recording-notify/route.ts')).toContain('/student#recordings');
    expect(read('lib/email-templates.ts')).toContain('/student#badges');
    expect(read('lib/notify-subscription-activated.ts')).toContain('/student#learning_paths');
  });
});
