import type { EmailTemplateKey } from '@/lib/email-template-registry';
import type { EmailTemplateVariables } from '@/lib/email-template-service';
import {
  assignmentDueReminderEmail,
  assignmentGradedEmail,
  blastEmail,
  cohortInviteEmail,
  confirmationEmail,
  courseCompletedNextUpEmail,
  courseResultEmail,
  day3CheckInEmail,
  day7EncouragementEmail,
  deadlineReminderEmail,
  gracePeriodWarningEmail,
  groupAssignedEmail,
  groupSubmissionReceivedEmail,
  individualLearnerWelcomeEmail,
  learningPathAssignedEmail,
  learningPathCertificateEmail,
  milestoneEmail,
  missedSessionEmail,
  nudgeEmail,
  openCertificateEmail,
  overdueNotificationEmail,
  paymentConfirmationAcknowledgedEmail,
  paymentConfirmationApprovedEmail,
  paymentConfirmationRejectedEmail,
  paymentReceiptEmail,
  recordingPublishedEmail,
  reminderEmail,
  studentAccountCreatedEmail,
  studentAddedToCohortEmail,
  submissionConfirmEmail,
  subscriptionActivatedEmail,
  subscriptionExpiringEmail,
  subscriptionPaymentAssignedEmail,
  veReviewedEmail,
  welcomeEmail,
  weeklyDigestEmail,
  type EmailBranding,
} from '@/lib/email-templates';

export type EmailTemplateSample = {
  subject: string;
  html: string;
  variables: EmailTemplateVariables;
};

export function buildEmailTemplateSample(key: EmailTemplateKey, branding: EmailBranding): EmailTemplateSample {
  const name = 'Ama Mensah';
  const appName = branding.appName || 'Learning Platform';
  const appUrl = branding.appUrl || 'https://example.test';
  const studentUrl = `${appUrl}/student`;
  const paymentsUrl = `${studentUrl}#payments`;
  const assignmentsUrl = `${studentUrl}#assignments`;
  const contentUrl = `${appUrl}/data-analytics-foundations`;
  const certificateUrl = `${appUrl}/certificate/sample-certificate`;
  const variables: EmailTemplateVariables = {
    student_name: name,
    app_name: appName,
    cohort_name: 'October Cohort',
    group_name: 'Team Horizon',
    plan_name: 'Professional Plan',
    period_start: '4 October 2026',
    period_end: '4 January 2027',
    content_title: 'Data Analytics Foundations',
    content_type: 'course',
    path_title: 'Data Analyst Path',
    completed_count: 2,
    in_progress_count: 1,
    not_started_count: 1,
    overdue_count: 1,
    days_left: 3,
    score: 86,
    score_display: '86/100',
    result_status: 'Passed',
    status_text: 'In progress',
    feedback: 'Strong work. Your reasoning is clear and well supported.',
    assignment_title: 'Customer Churn Analysis',
    due_text: 'tomorrow',
    due_date: '5 October 2026',
    submitted_by: 'Kofi Boateng',
    event_title: 'Career Coaching Session',
    event_date: '8 October 2026',
    event_time_display: '8 October 2026 at 10:00 AM UTC',
    event_location: 'Online',
    reminder_timing: 'tomorrow',
    recording_title: 'Data Analytics Live Sessions',
    weeks: 'Weeks 3 and 4',
    program_name: 'Data Analytics Programme',
    currency: 'GHS',
    amount: '450.00',
    reference: 'PAY-1024',
    payment_date: '4 October 2026',
    payment_method: 'Mobile Money',
    admin_notes: 'The receipt was verified.',
    duration_months: 3,
    duration: '3 months',
    grace_end_date: '11 October 2026',
  };

  const courseItems = [
    { title: 'Excel Fundamentals for Analytics', description: 'Clean and explore business data.' },
    { title: 'Customer Churn Analysis', isVE: true, description: 'Complete a realistic analyst project.' },
    { title: 'Data Analytics Certification', isCert: true, description: 'Validate the skills you developed.' },
  ];

  switch (key) {
    case 'account_setup':
      return { subject: `Your ${appName} account is ready`, html: studentAccountCreatedEmail({ name, cohortName: 'October Cohort', setupUrl: `${appUrl}/auth/setup?token=sample`, branding }), variables };
    case 'cohort_invite':
      return { subject: `You have been invited to join ${appName}`, html: cohortInviteEmail({ cohortName: 'October Cohort', signupUrl: `${appUrl}/auth?invite=sample`, branding }), variables };
    case 'cohort_added':
      return { subject: 'You have been added to October Cohort', html: studentAddedToCohortEmail({ name, cohortName: 'October Cohort', signInUrl: studentUrl, branding }), variables };
    case 'individual_learner_welcome':
      return { subject: `Your ${appName} account is ready`, html: individualLearnerWelcomeEmail({ name, planName: 'Professional Plan', durationMonths: 3, setupUrl: `${appUrl}/auth/setup?token=sample`, isRenewal: false, access: { kind: 'awaiting_payment', amount: 450, currency: 'GHS', dueDate: '2026-10-05' }, branding }), variables };
    case 'onboarding_welcome':
      return { subject: `Welcome to ${appName}, ${name}!`, html: welcomeEmail({ name, studentUrl, branding }), variables };
    case 'onboarding_day3':
      return { subject: `${name}, your courses are waiting for you`, html: day3CheckInEmail({ name, studentUrl, courseTitle: 'Data Analytics Foundations', courseUrl: contentUrl, branding }), variables };
    case 'onboarding_day7':
      return { subject: `Keep going, ${name}`, html: day7EncouragementEmail({ name, studentUrl, hasStarted: true, coursesCompleted: 2, branding }), variables };
    case 'group_assigned':
      return { subject: 'You have been added to Team Horizon', html: groupAssignedEmail({ recipientName: name, groupName: 'Team Horizon', cohortName: 'October Cohort', description: 'Your project group for the October cohort.', members: [{ full_name: name, is_leader: false }, { full_name: 'Kofi Boateng', is_leader: true }], dashboardUrl: assignmentsUrl, branding }), variables };
    case 'content_assigned':
      return { subject: 'You have been assigned: Data Analytics Foundations', html: blastEmail({ subject: 'New course assigned', body: `Hi ${name},\n\nA new course is available to you:\n\n<b>Data Analytics Foundations</b>`, senderName: branding.teamName || appName, formTitle: 'Data Analytics Foundations', formUrl: contentUrl, ctaLabel: 'Open Course', branding }), variables };
    case 'learning_path_assigned':
      return { subject: 'You have been enrolled in a new learning path: Data Analyst Path', html: learningPathAssignedEmail({ name, pathTitle: 'Data Analyst Path', pathDescription: 'Build practical analysis skills from spreadsheets through reporting.', dashboardUrl: `${studentUrl}#learning_paths`, items: courseItems, branding }), variables };
    case 'next_learning_item':
      return { subject: 'Next up in Data Analyst Path: Customer Churn Analysis', html: courseCompletedNextUpEmail({ name, pathTitle: 'Data Analyst Path', completedTitle: 'Excel Fundamentals for Analytics', completedNumber: 1, totalItems: 3, nextTitle: 'Customer Churn Analysis', nextUrl: contentUrl, nextIsVE: true, nextDescription: 'Complete a realistic analyst project.', branding }), variables };
    case 'weekly_digest':
      return { subject: 'Your weekly learning update', html: weeklyDigestEmail({ name, completed: [{ title: 'Excel Fundamentals for Analytics', contentType: 'course', score: 91 }], inProgress: [{ title: 'Advanced Excel for Analytics', contentType: 'course' }], notStarted: [{ title: 'Customer Churn Analysis', contentType: 'virtual_experience' }], missedDeadlines: [{ title: 'Dashboard Design Practice', contentType: 'course', daysOverdue: 2 }], dashboardUrl: studentUrl, branding }), variables };
    case 'inactivity_nudge':
      return { subject: 'A reminder about Data Analytics Foundations', html: nudgeEmail({ name, contentTitle: 'Data Analytics Foundations', contentType: 'course', status: 'in_progress', formUrl: contentUrl, relatedAssignmentTitle: 'Customer Churn Analysis', branding }), variables };
    case 'deadline_reminder':
      return { subject: 'Reminder: Data Analytics Foundations is due tomorrow', html: deadlineReminderEmail({ name, contentTitle: 'Data Analytics Foundations', contentType: 'course', formUrl: contentUrl, daysLeft: 1, branding }), variables };
    case 've_milestone':
      return { subject: 'You are 80% done. Finish strong!', html: milestoneEmail({ name, contentTitle: 'Customer Churn Analysis', contentType: 'virtual_experience', formUrl: contentUrl, branding }), variables };
    case 've_reviewed':
      return { subject: 'Your instructor reviewed your work: Customer Churn Analysis', html: veReviewedEmail({ name, veTitle: 'Customer Churn Analysis', score: 86, feedback: String(variables.feedback), reportCount: 2, studentUrl: contentUrl, branding }), variables };
    case 'assignment_due':
      return { subject: 'Reminder: Customer Churn Analysis is due tomorrow', html: assignmentDueReminderEmail({ name, assignmentTitle: 'Customer Churn Analysis', dueDate: '5 October 2026', daysLeft: 1, dashboardUrl: assignmentsUrl, branding }), variables };
    case 'submission_received':
      return { subject: 'Submission received: Customer Churn Analysis', html: submissionConfirmEmail({ name, assignmentTitle: 'Customer Churn Analysis', dashboardUrl: assignmentsUrl, branding }), variables };
    case 'group_submission_received':
      return { subject: 'Group submission received: Customer Churn Analysis', html: groupSubmissionReceivedEmail({ name, assignmentTitle: 'Customer Churn Analysis', groupName: 'Team Horizon', submittedByName: 'Kofi Boateng', isParticipant: true, dashboardUrl: assignmentsUrl, branding }), variables };
    case 'assignment_graded':
      return { subject: 'Your assignment has been graded: Customer Churn Analysis', html: assignmentGradedEmail({ name, assignmentTitle: 'Customer Churn Analysis', score: 86, passed: true, feedback: String(variables.feedback), studentUrl: assignmentsUrl, branding }), variables };
    case 'event_confirmation':
      return { subject: 'You are registered: Career Coaching Session', html: confirmationEmail({ name, eventTitle: 'Career Coaching Session', eventDate: '8 October 2026', eventTime: '10:00 AM', eventTimezone: 'UTC', eventLocation: 'Online', meetingLink: 'https://meet.example.test/sample', formUrl: `${appUrl}/career-coaching-session`, branding }), variables };
    case 'event_reminder':
      return { subject: 'Reminder: Career Coaching Session starts tomorrow', html: reminderEmail({ name, eventTitle: 'Career Coaching Session', eventDate: '8 October 2026', eventTime: '10:00 AM', eventTimezone: 'UTC', eventLocation: 'Online', meetingLink: 'https://meet.example.test/sample', formUrl: `${appUrl}/career-coaching-session`, branding }), variables };
    case 'missed_event':
      return { subject: 'We missed you at Career Coaching Session', html: missedSessionEmail({ name, eventTitle: 'Career Coaching Session', sessionDate: '2026-10-04', dashboardUrl: studentUrl, branding }), variables };
    case 'recording_published':
      return { subject: 'New recordings available: Data Analytics Live Sessions', html: recordingPublishedEmail({ name, recordingTitle: 'Data Analytics Live Sessions', newWeeks: [3, 4], dashboardUrl: `${studentUrl}#recordings`, branding }), variables };
    case 'course_certificate':
      return { subject: 'Your certificate for Data Analytics Foundations is ready', html: courseResultEmail({ name, courseTitle: 'Data Analytics Foundations', score: 18, total: 20, percentage: 90, passed: true, points: 100, passmark: 70, correctQuestions: 18, totalQuestions: 20, skills: [{ name: 'Data cleaning', correct: 6, total: 6, pct: 100 }, { name: 'Analysis', correct: 7, total: 8, pct: 88 }], formUrl: contentUrl, certUrl: certificateUrl, branding }), variables };
    case 'course_result':
      return { subject: 'Your result for Data Analytics Foundations', html: courseResultEmail({ name, courseTitle: 'Data Analytics Foundations', score: 9, total: 20, percentage: 45, passed: false, passmark: 70, formUrl: contentUrl, branding }), variables: { ...variables, score: 45 } };
    case 'learning_path_certificate':
      return { subject: 'Your Learning Path Certificate is ready: Data Analyst Path', html: learningPathCertificateEmail({ name, pathTitle: 'Data Analyst Path', pathDescription: 'A complete practical foundation in data analytics.', certUrl: certificateUrl, items: courseItems, branding }), variables };
    case 'open_certificate':
      return { subject: 'Your Data Analytics Programme Certificate', html: openCertificateEmail({ recipientName: name, programName: 'Data Analytics Programme', issuedDate: '4 October 2026', certUrl: certificateUrl, branding }), variables };
    case 'payment_receipt':
      return { subject: 'Payment received on your account', html: paymentReceiptEmail({ name, amount: 450, currency: 'GHS', paidAt: '4 October 2026', method: 'Mobile Money', reference: 'PAY-1024', dashboardUrl: paymentsUrl, branding }), variables };
    case 'payment_confirmation_received':
      return { subject: 'We received your payment confirmation', html: paymentConfirmationAcknowledgedEmail({ name, amount: 450, currency: 'GHS', dashboardUrl: paymentsUrl, branding }), variables };
    case 'payment_confirmation_approved':
      return { subject: 'Your payment confirmation has been approved', html: paymentConfirmationApprovedEmail({ name, amount: 450, currency: 'GHS', dashboardUrl: paymentsUrl, adminNotes: 'The receipt was verified.', branding }), variables };
    case 'payment_confirmation_rejected':
      return { subject: 'Your payment confirmation could not be verified', html: paymentConfirmationRejectedEmail({ name, amount: 450, currency: 'GHS', dashboardUrl: paymentsUrl, adminNotes: 'Please upload a clearer receipt showing the reference and amount.', branding }), variables };
    case 'payment_request':
      return { subject: 'Payment request for Professional Plan', html: subscriptionPaymentAssignedEmail({ name, planName: 'Professional Plan', amount: 450, currency: 'GHS', dueDate: '5 October 2026', dashboardUrl: paymentsUrl, branding }), variables };
    case 'subscription_activated':
      return { subject: 'Your Professional Plan subscription is active', html: subscriptionActivatedEmail({ name, planName: 'Professional Plan', durationMonths: 3, periodStart: '2026-10-04', periodEnd: '2027-01-04', isActivation: true, dashboardUrl: appUrl, branding }), variables };
    case 'subscription_expiring':
      return { subject: 'Your Professional Plan access ends soon', html: subscriptionExpiringEmail({ name, planName: 'Professional Plan', periodEnd: '2027-01-04', daysLeft: 3, dashboardUrl: appUrl, branding }), variables };
    case 'grace_period':
      return { subject: 'Your payment is overdue', html: gracePeriodWarningEmail({ name, graceEndDate: '11 October 2026', daysLeft: 3, dashboardUrl: paymentsUrl, branding }), variables };
    case 'overdue_payment':
      return { subject: 'Your account has an overdue payment', html: overdueNotificationEmail({ name, dashboardUrl: paymentsUrl, branding }), variables };
    case 'abandoned_checkout':
      return {
        subject: 'Still interested in Professional Plan?',
        html: `<p>Hi ${name.split(' ')[0]},</p><p>You started subscribing to <strong>Professional Plan</strong> for GHS 450.00 but did not finish.</p><p><a href="${paymentsUrl}">Finish your payment</a></p><p>Nothing has been charged, and you owe nothing. If you have changed your mind you can ignore this.</p>`,
        variables,
      };
  }

  const unsupportedKey: never = key;
  throw new Error(`Unsupported email template sample: ${unsupportedKey}`);
}
