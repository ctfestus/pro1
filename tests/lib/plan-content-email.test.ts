// What a subscriber is told when content is added to their plan.
//
// This reused the email an instructor sends when assigning work to a cohort, so every addition
// arrived as "You've been assigned" / "You have been enrolled", with a button saying View Course
// and a line telling them to start. None of that is true for someone who pays for a catalogue
// that grew. These tests hold the two apart.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { learningPathAssignedEmail } from '@/lib/email-templates';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const notifier = read('lib/send-assignment-notification.ts');
const pathSender = read('lib/send-path-notification.ts');
const admissions = read('app/api/admissions/route.ts');

describe('a single item added to a plan', () => {
  it('is announced, not assigned, and spelt out rather than contracted', () => {
    expect(notifier).toContain('`New ${typeLabel}: ${title}`');
    expect(notifier).toContain('We have added a new ${typeLabel} to ${t.appName}:');
  });

  it('keeps the assignment wording for actual assignments', () => {
    // The cohort case is unchanged: somebody really is being asked to do this.
    expect(notifier).toContain("`You've been assigned: ${title}`");
    expect(notifier).toContain('Click the button below to open your ${typeLabel}.');
  });

  it('names the platform from settings rather than hardcoding a tenant', () => {
    expect(notifier).toContain('${t.appName}');
    expect(notifier).not.toMatch(/AI Skills Africa/);
  });

  it('uses one button label for the plan case, whatever the content type', () => {
    expect(notifier).toContain("const PLAN_CTA = 'View Now'");
    expect(notifier).toContain('forPlan ? PLAN_CTA :');
  });
});

describe('a learning path added to a plan', () => {
  const items = [
    { title: 'Excel for Data Analysis', description: 'Clean and summarise real data' },
    { title: 'SQL Fundamentals' },
    { title: 'Power BI Dashboards', isVE: true },
    { title: 'Data Analyst Certification', isCert: true },
  ];
  const base = {
    name: 'Kofi',
    pathTitle: 'Data Analytics Foundations',
    pathDescription: 'Build the core skills for working with data.',
    dashboardUrl: 'https://example.test/student#learning_paths',
    items,
  };

  it('says what was added, not that the learner was enrolled', () => {
    const html = learningPathAssignedEmail({ ...base, reason: 'plan', appName: 'Test Academy' });
    expect(html).toContain('We have added a new learning path to Test Academy:');
    expect(html).not.toContain('You have been enrolled');
  });

  it('still shows what is inside the path, which is the point of this email', () => {
    const html = learningPathAssignedEmail({ ...base, reason: 'plan', appName: 'Test Academy' });
    for (const item of items) expect(html).toContain(item.title);
    expect(html).toContain('Data Analytics Foundations');
    expect(html).toContain('Build the core skills for working with data.');
  });

  it('leaves the assignment version alone', () => {
    const html = learningPathAssignedEmail(base);
    expect(html).toContain('You have been enrolled in a new learning path');
    expect(html).toContain('Start Learning Now');
  });

  it('escapes the platform name rather than pasting it into the markup', () => {
    const html = learningPathAssignedEmail({
      ...base, reason: 'plan', appName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('gets the matching subject from its sender', () => {
    expect(pathSender).toContain('`New learning path: ${lp.title}`');
    expect(pathSender).toContain("`You've been enrolled in a new learning path: ${lp.title}`");
  });
});

describe('the plan path asks for the plan wording', () => {
  it('marks all four content types, not just the ones with a shared sender', () => {
    // Courses, virtual experiences and certifications go through one sender; learning paths have
    // their own. Missing either leaves that type still telling people they were enrolled.
    expect(admissions.match(/reason: 'plan'/g)).toHaveLength(3);
    expect(admissions).toContain("sendPathNotification(db, content, [cohortId], 'plan')");
  });
});
