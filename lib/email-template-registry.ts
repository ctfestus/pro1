export type EmailTemplateCategory =
  | 'Access and onboarding'
  | 'Learning and engagement'
  | 'Assignments and events'
  | 'Achievements'
  | 'Payments and subscriptions';

export type EmailTemplateDefinition = {
  key: string;
  label: string;
  category: EmailTemplateCategory;
  description: string;
  schedule: string;
  tags: string[];
};

const d = <const T extends EmailTemplateDefinition>(definition: T) => definition;

export const EMAIL_TEMPLATE_DEFINITIONS = [
  d({ key: 'account_setup', label: 'Account setup', category: 'Access and onboarding', description: 'Sent when a learner account is created and needs a password.', schedule: 'Immediately after account creation', tags: ['student_name', 'app_name'] }),
  d({ key: 'cohort_invite', label: 'Cohort invitation', category: 'Access and onboarding', description: 'Sent to an email address invited to join a cohort.', schedule: 'When an invitation is created', tags: ['student_name', 'cohort_name', 'app_name'] }),
  d({ key: 'cohort_added', label: 'Added to cohort', category: 'Access and onboarding', description: 'Sent to an existing learner added to a cohort.', schedule: 'When an existing learner is admitted', tags: ['student_name', 'cohort_name', 'app_name'] }),
  d({ key: 'individual_learner_welcome', label: 'Subscription learner welcome', category: 'Access and onboarding', description: 'Combines account setup and subscription access for a new learner.', schedule: 'When staff enrolls a new subscription learner', tags: ['student_name', 'app_name', 'plan_name', 'period_end', 'amount', 'currency', 'due_date'] }),
  d({ key: 'onboarding_welcome', label: 'Onboarding welcome', category: 'Access and onboarding', description: 'Welcomes a learner after onboarding.', schedule: 'Immediately after onboarding', tags: ['student_name', 'app_name'] }),
  d({ key: 'onboarding_day3', label: 'Day 3 check-in', category: 'Access and onboarding', description: 'Checks in shortly after onboarding.', schedule: '3 days after onboarding', tags: ['student_name', 'content_title', 'app_name'] }),
  d({ key: 'onboarding_day7', label: 'Day 7 encouragement', category: 'Access and onboarding', description: 'Encourages progress one week after onboarding.', schedule: '7 days after onboarding', tags: ['student_name', 'completed_count', 'app_name'] }),
  d({ key: 'group_assigned', label: 'Added to group', category: 'Access and onboarding', description: 'Tells a learner they were added to a learning group.', schedule: 'When group membership is assigned', tags: ['student_name', 'group_name', 'cohort_name'] }),
  d({ key: 'content_assigned', label: 'Content assigned', category: 'Learning and engagement', description: 'Covers assigned courses, events, virtual experiences, assignments and certifications.', schedule: 'When content is assigned or added through a plan', tags: ['student_name', 'content_title', 'content_type', 'app_name'] }),
  d({ key: 'learning_path_assigned', label: 'Learning path assigned', category: 'Learning and engagement', description: 'Sent when a learning path becomes available.', schedule: 'When a learning path is assigned', tags: ['student_name', 'path_title', 'app_name'] }),
  d({ key: 'next_learning_item', label: 'Next learning item', category: 'Learning and engagement', description: 'Points the learner to the next item in a path.', schedule: 'After completing a path item', tags: ['student_name', 'path_title', 'content_title'] }),
  d({ key: 'weekly_digest', label: 'Weekly learning update', category: 'Learning and engagement', description: 'Summarizes completed, active, overdue and not-started learning.', schedule: 'Every Monday at 08:00', tags: ['student_name', 'completed_count', 'in_progress_count', 'not_started_count', 'overdue_count'] }),
  d({ key: 'inactivity_nudge', label: 'Learning progress reminder', category: 'Learning and engagement', description: 'Encourages a learner to begin, continue or retry assigned work.', schedule: 'After inactivity or when an instructor sends a nudge', tags: ['student_name', 'content_title', 'content_type', 'status_text'] }),
  d({ key: 'deadline_reminder', label: 'Content deadline reminder', category: 'Learning and engagement', description: 'Warns about a course, event or virtual experience deadline.', schedule: 'Daily, normally from 3 days before the deadline', tags: ['student_name', 'content_title', 'content_type', 'due_text'] }),
  d({ key: 've_milestone', label: 'Virtual experience milestone', category: 'Learning and engagement', description: 'Encourages a learner who reaches 80 percent progress.', schedule: 'Once at 80 percent completion', tags: ['student_name', 'content_title'] }),
  d({ key: 've_reviewed', label: 'Instructor review ready', category: 'Learning and engagement', description: 'Tells a learner their virtual experience work was reviewed.', schedule: 'When a meaningful review is saved', tags: ['student_name', 'content_title', 'score', 'feedback'] }),
  d({ key: 'assignment_due', label: 'Assignment due reminder', category: 'Assignments and events', description: 'Reminds learners who have not submitted an assignment.', schedule: 'Daily for assignments due within 2 days', tags: ['student_name', 'assignment_title', 'due_date', 'due_text'] }),
  d({ key: 'submission_received', label: 'Submission received', category: 'Assignments and events', description: 'Confirms an individual or virtual experience assignment submission.', schedule: 'Immediately after submission', tags: ['student_name', 'assignment_title'] }),
  d({ key: 'group_submission_received', label: 'Group submission received', category: 'Assignments and events', description: 'Confirms a group assignment submission to group members.', schedule: 'Immediately after group submission', tags: ['student_name', 'submitted_by', 'assignment_title', 'group_name'] }),
  d({ key: 'assignment_graded', label: 'Assignment graded', category: 'Assignments and events', description: 'Tells learners their assignment was graded.', schedule: 'When an instructor saves a grade', tags: ['student_name', 'assignment_title', 'score', 'score_display', 'result_status', 'feedback'] }),
  d({ key: 'event_confirmation', label: 'Event registration confirmation', category: 'Assignments and events', description: 'Confirms an event registration or automatic cohort registration.', schedule: 'Immediately after registration', tags: ['student_name', 'event_title', 'event_time_display', 'event_location'] }),
  d({ key: 'event_reminder', label: 'Event reminder', category: 'Assignments and events', description: 'Reminds registered learners about an upcoming event.', schedule: 'One day or one hour before the event', tags: ['student_name', 'event_title', 'reminder_timing', 'event_time_display', 'event_location'] }),
  d({ key: 'missed_event', label: 'Missed session follow-up', category: 'Assignments and events', description: 'Follows up with learners absent from a live session.', schedule: 'When an instructor nudges absent learners', tags: ['student_name', 'event_title', 'event_date'] }),
  d({ key: 'recording_published', label: 'Recording published', category: 'Assignments and events', description: 'Tells learners that new session recordings are available.', schedule: 'When new recording weeks are published', tags: ['student_name', 'recording_title', 'weeks'] }),
  d({ key: 'course_certificate', label: 'Course or certification certificate', category: 'Achievements', description: 'Delivers a certificate after a qualifying course, certification or virtual experience completion.', schedule: 'After a qualifying completion', tags: ['student_name', 'content_title'] }),
  d({ key: 'course_result', label: 'Course result without certificate', category: 'Achievements', description: 'Shares a course or virtual experience result when no certificate was earned.', schedule: 'After a non-passing completion', tags: ['student_name', 'content_title', 'score'] }),
  d({ key: 'learning_path_certificate', label: 'Learning path certificate', category: 'Achievements', description: 'Delivers a certificate for a completed learning path.', schedule: 'After completing every path item', tags: ['student_name', 'path_title'] }),
  d({ key: 'open_certificate', label: 'Open certificate', category: 'Achievements', description: 'Delivers a certificate issued outside a course attempt.', schedule: 'When an open certificate is issued', tags: ['student_name', 'program_name'] }),
  d({ key: 'payment_receipt', label: 'Payment receipt', category: 'Payments and subscriptions', description: 'Confirms a payment recorded on the learner account.', schedule: 'Immediately after payment is recorded', tags: ['student_name', 'currency', 'amount', 'reference', 'payment_date', 'payment_method'] }),
  d({ key: 'payment_confirmation_received', label: 'Payment confirmation received', category: 'Payments and subscriptions', description: 'Acknowledges a learner-submitted payment confirmation.', schedule: 'Immediately after confirmation is submitted', tags: ['student_name', 'currency', 'amount'] }),
  d({ key: 'payment_confirmation_approved', label: 'Payment confirmation approved', category: 'Payments and subscriptions', description: 'Confirms that staff approved a payment confirmation.', schedule: 'When staff approves confirmation', tags: ['student_name', 'currency', 'amount', 'admin_notes'] }),
  d({ key: 'payment_confirmation_rejected', label: 'Payment confirmation not verified', category: 'Payments and subscriptions', description: 'Explains that a payment confirmation could not be verified.', schedule: 'When staff rejects confirmation', tags: ['student_name', 'currency', 'amount', 'admin_notes'] }),
  d({ key: 'payment_request', label: 'Subscription payment request', category: 'Payments and subscriptions', description: 'Asks an existing learner to pay for assigned subscription access.', schedule: 'When staff creates a payment request', tags: ['student_name', 'plan_name', 'currency', 'amount', 'due_date'] }),
  d({ key: 'subscription_activated', label: 'Subscription activated or extended', category: 'Payments and subscriptions', description: 'Confirms plan access after activation or renewal.', schedule: 'After subscription payment is processed', tags: ['student_name', 'plan_name', 'period_start', 'period_end', 'duration_months'] }),
  d({ key: 'subscription_expiring', label: 'Subscription expiring', category: 'Payments and subscriptions', description: 'Warns before subscription access expires.', schedule: 'Once within 7 days of period end', tags: ['student_name', 'plan_name', 'period_end', 'days_left'] }),
  d({ key: 'grace_period', label: 'Payment grace period', category: 'Payments and subscriptions', description: 'Warns when a grace period starts and one day before it ends.', schedule: 'At grace-period start and one day before expiry', tags: ['student_name', 'grace_end_date', 'days_left'] }),
  d({ key: 'overdue_payment', label: 'Overdue payment', category: 'Payments and subscriptions', description: 'Warns that a learner account has an overdue balance.', schedule: 'During the outstanding-payment sweep or a manual reminder', tags: ['student_name'] }),
  d({ key: 'abandoned_checkout', label: 'Abandoned checkout reminder', category: 'Payments and subscriptions', description: 'Reminds a learner about a checkout they started but did not finish.', schedule: 'About 1 hour, 1 day and 3 days after checkout', tags: ['student_name', 'plan_name', 'currency', 'amount', 'duration'] }),
] as const;

export type EmailTemplateKey = typeof EMAIL_TEMPLATE_DEFINITIONS[number]['key'];

export const EMAIL_TEMPLATE_BY_KEY = new Map<string, EmailTemplateDefinition>(
  EMAIL_TEMPLATE_DEFINITIONS.map(definition => [definition.key, definition]),
);

export function getEmailTemplateDefinition(key: string) {
  return EMAIL_TEMPLATE_BY_KEY.get(key) ?? null;
}
