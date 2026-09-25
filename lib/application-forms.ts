export const APPLICATION_QUESTION_TYPES = [
  'short_text', 'long_text', 'email', 'phone', 'number', 'date', 'single_choice',
  'multiple_choice', 'dropdown', 'yes_no', 'file', 'consent',
] as const;

export type ApplicationQuestionType = typeof APPLICATION_QUESTION_TYPES[number];
export type ApplicationFormStatus = 'draft' | 'published' | 'paused' | 'closed';
export type ApplicationSubmissionState = 'draft' | 'submitted';

export interface ApplicationCondition {
  questionId: string;
  operator: 'equals' | 'not_equals' | 'contains';
  value: string;
}

export interface ApplicationQuestion {
  id: string;
  label: string;
  type: ApplicationQuestionType;
  required: boolean;
  helpText?: string;
  placeholder?: string;
  options?: string[];
  condition?: ApplicationCondition;
}

export interface ApplicationStage {
  id: string;
  name: string;
  applicantLabel: string;
}

export interface ApplicationPostSubmission {
  type: 'default' | 'redirect' | 'button' | 'events' | 'notice';
  redirectUrl?: string;
  buttonLabel?: string;
  buttonUrl?: string;
  relatedEventIds?: string[];
  noticeTitle?: string;
  noticeBody?: string;
}

export interface ApplicationFormConfig {
  title: string;
  description: string;
  eligibility: string;
  opensAt: string;
  closesAt: string;
  confirmationMessage: string;
  questions: ApplicationQuestion[];
  stages: ApplicationStage[];
  postSubmission: ApplicationPostSubmission;
}

export interface ApplicationFormRecord {
  id: string;
  ownerId: string;
  ownerEmail: string;
  slug: string;
  status: ApplicationFormStatus;
  createdAt: string;
  updatedAt: string;
  config: ApplicationFormConfig;
}

export interface ApplicationFileAnswer {
  url: string;
  publicId: string;
  name: string;
  size: number;
  type: string;
}

export type ApplicationAnswer = string | string[] | number | boolean | ApplicationFileAnswer | null;

export interface ApplicationStatusEvent {
  id: string;
  stageId: string;
  stageName: string;
  actorEmail: string;
  occurredAt: string;
  messageType?: string;
}

export interface ApplicationPrivateNote {
  id: string;
  body: string;
  authorEmail: string;
  createdAt: string;
}

export interface ApplicationMessage {
  id: string;
  type: 'interview' | 'acceptance' | 'waitlist' | 'decline' | 'custom';
  subject: string;
  body: string;
  sentAt: string;
  sentBy: string;
}

export interface ApplicationSubmissionRecord {
  id: string;
  formId: string;
  reference: string;
  email: string;
  state: ApplicationSubmissionState;
  stageId: string;
  assignedReviewerId: string;
  assignedReviewerEmail: string;
  score: number | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string;
  tokenHash: string;
  answers: Record<string, ApplicationAnswer>;
  privateNotes: ApplicationPrivateNote[];
  statusHistory: ApplicationStatusEvent[];
  messages: ApplicationMessage[];
}

export interface ApplicationAuditRecord {
  id: string;
  entityType: 'form' | 'submission';
  entityId: string;
  action: string;
  actorId: string;
  actorEmail: string;
  occurredAt: string;
  details: Record<string, unknown>;
}

export const DEFAULT_APPLICATION_STAGES: ApplicationStage[] = [
  { id: 'submitted', name: 'Submitted', applicantLabel: 'Application received' },
  { id: 'screening', name: 'Screening', applicantLabel: 'Under review' },
  { id: 'interview', name: 'Interview', applicantLabel: 'Interview stage' },
  { id: 'accepted', name: 'Accepted', applicantLabel: 'Accepted' },
  { id: 'waitlisted', name: 'Waitlisted', applicantLabel: 'Waitlisted' },
  { id: 'declined', name: 'Declined', applicantLabel: 'Decision made' },
];

function id(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function question(label: string, type: ApplicationQuestionType, required = false, options?: string[]): ApplicationQuestion {
  return { id: id('q'), label, type, required, ...(options ? { options } : {}) };
}

export const APPLICATION_STARTER_TEMPLATES = {
  bootcamp: {
    label: 'Bootcamp application',
    description: 'A practical starting point for cohort-based training programmes.',
    questions: () => [
      question('Full name', 'short_text', true),
      question('Phone number', 'phone', true),
      question('Why do you want to join this bootcamp?', 'long_text', true),
      question('Current experience level', 'dropdown', true, ['Beginner', 'Intermediate', 'Advanced']),
      question('Can you commit to the programme schedule?', 'yes_no', true),
      question('Upload your CV or resume', 'file'),
      question('I confirm that the information provided is accurate.', 'consent', true),
    ],
  },
  scholarship: {
    label: 'Scholarship application',
    description: 'A starting point for merit-based or needs-based awards.',
    questions: () => [
      question('Full name', 'short_text', true),
      question('Phone number', 'phone', true),
      question('Tell us why you are applying for this scholarship.', 'long_text', true),
      question('Current school, employer, or organisation', 'short_text'),
      question('Requested support amount', 'number'),
      question('Upload supporting documents', 'file'),
      question('I consent to the review of the information and documents submitted.', 'consent', true),
    ],
  },
  internship: {
    label: 'Internship application',
    description: 'A starting point for internship and early-career opportunities.',
    questions: () => [
      question('Full name', 'short_text', true),
      question('Phone number', 'phone', true),
      question('Area of interest', 'dropdown', true, ['Engineering', 'Data', 'Design', 'Marketing', 'Operations', 'Other']),
      question('Why are you interested in this internship?', 'long_text', true),
      question('Portfolio or LinkedIn URL', 'short_text'),
      question('Earliest available start date', 'date'),
      question('Upload your CV or resume', 'file', true),
      question('I confirm that the information provided is accurate.', 'consent', true),
    ],
  },
} as const;

export type ApplicationTemplateKey = keyof typeof APPLICATION_STARTER_TEMPLATES;

export function newApplicationFormConfig(template: ApplicationTemplateKey = 'bootcamp'): ApplicationFormConfig {
  const starter = APPLICATION_STARTER_TEMPLATES[template];
  return {
    title: starter.label,
    description: starter.description,
    eligibility: '',
    opensAt: '',
    closesAt: '',
    confirmationMessage: 'Thank you. Your application has been received and our team will review it.',
    questions: starter.questions(),
    stages: DEFAULT_APPLICATION_STAGES.map(stage => ({ ...stage })),
    postSubmission: { type: 'default' },
  };
}

export function isQuestionVisible(question: ApplicationQuestion, answers: Record<string, ApplicationAnswer>): boolean {
  const condition = question.condition;
  if (!condition?.questionId) return true;
  const raw = answers[condition.questionId];
  const values = Array.isArray(raw) ? raw.map(String) : [String(raw ?? '')];
  if (condition.operator === 'equals') return values.some(value => value === condition.value);
  if (condition.operator === 'not_equals') return values.every(value => value !== condition.value);
  return values.some(value => value.toLowerCase().includes(condition.value.toLowerCase()));
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function validateApplicationForm(config: ApplicationFormConfig, status?: ApplicationFormStatus): string[] {
  const errors: string[] = [];
  if (!config.title?.trim()) errors.push('Title is required.');
  if (!config.description?.trim()) errors.push('Description is required.');
  if (!config.confirmationMessage?.trim()) errors.push('Confirmation message is required.');
  if (!Array.isArray(config.questions) || config.questions.length === 0) errors.push('Add at least one question.');
  const ids = new Set<string>();
  for (const item of config.questions ?? []) {
    if (!item.id || ids.has(item.id)) errors.push('Every question must have a unique ID.');
    ids.add(item.id);
    if (!item.label?.trim()) errors.push('Every question needs a label.');
    if (!APPLICATION_QUESTION_TYPES.includes(item.type)) errors.push(`Unsupported question type: ${item.type}`);
    if (['single_choice', 'multiple_choice', 'dropdown'].includes(item.type) && (item.options ?? []).filter(Boolean).length < 2) {
      errors.push(`${item.label || 'Choice question'} needs at least two options.`);
    }
    if (item.condition?.questionId && !ids.has(item.condition.questionId)) {
      errors.push(`${item.label || 'Conditional question'} must depend on an earlier question.`);
    }
  }
  if ((config.postSubmission?.type === 'redirect') && !isSafeHttpUrl(config.postSubmission.redirectUrl ?? '')) {
    errors.push('Enter a valid HTTP or HTTPS redirect URL.');
  }
  if ((config.postSubmission?.type === 'button') && !isSafeHttpUrl(config.postSubmission.buttonUrl ?? '')) {
    errors.push('Enter a valid HTTP or HTTPS button URL.');
  }
  if (status === 'published') {
    if (config.opensAt && Number.isNaN(new Date(config.opensAt).getTime())) errors.push('Opening date is invalid.');
    if (config.closesAt && Number.isNaN(new Date(config.closesAt).getTime())) errors.push('Closing date is invalid.');
    if (config.opensAt && config.closesAt && new Date(config.opensAt) >= new Date(config.closesAt)) {
      errors.push('Closing date must be after the opening date.');
    }
  }
  return [...new Set(errors)];
}

export function formAvailability(form: ApplicationFormRecord, now = new Date()): 'open' | 'not_open' | 'closed' | 'paused' {
  if (form.status === 'paused') return 'paused';
  if (form.status !== 'published') return 'closed';
  if (form.config.opensAt && now < new Date(form.config.opensAt)) return 'not_open';
  if (form.config.closesAt && now > new Date(form.config.closesAt)) return 'closed';
  return 'open';
}

function present(value: ApplicationAnswer): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object') return Boolean(value.url);
  return true;
}

export function validateApplicationAnswers(
  config: ApplicationFormConfig,
  answers: Record<string, ApplicationAnswer>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of config.questions) {
    if (!isQuestionVisible(item, answers)) continue;
    const value = answers[item.id];
    if (item.required && !present(value)) {
      errors[item.id] = 'This question is required.';
      continue;
    }
    if (!present(value)) continue;
    const text = String(value);
    if (text.length > (item.type === 'long_text' ? 50_000 : 2_000)) errors[item.id] = 'This answer is too long.';
    if (item.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) errors[item.id] = 'Enter a valid email address.';
    if (item.type === 'phone' && !/^[+()\-\s0-9]{7,30}$/.test(text)) errors[item.id] = 'Enter a valid phone number.';
    if (item.type === 'number' && !Number.isFinite(Number(value))) errors[item.id] = 'Enter a valid number.';
    if (item.type === 'date' && Number.isNaN(new Date(text).getTime())) errors[item.id] = 'Enter a valid date.';
    if (['single_choice', 'dropdown'].includes(item.type) && !(item.options ?? []).includes(text)) errors[item.id] = 'Select a valid option.';
    if (item.type === 'multiple_choice' && (!Array.isArray(value) || value.some(option => !(item.options ?? []).includes(String(option))))) errors[item.id] = 'Select valid options.';
    if (item.type === 'consent' && value !== true && value !== 'true') errors[item.id] = 'Consent is required.';
    if (item.type === 'file') {
      const file = value as ApplicationFileAnswer;
      if (!file?.url || !file?.publicId || !file.publicId.startsWith('applications/')) errors[item.id] = 'Upload a valid file.';
    }
  }
  return errors;
}

export function slugifyApplicationTitle(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'application';
}

export function publicApplicationForm(form: ApplicationFormRecord) {
  return {
    id: form.id,
    slug: form.slug,
    status: form.status,
    config: {
      ...form.config,
      stages: form.config.stages.map(stage => ({ id: stage.id, name: stage.applicantLabel, applicantLabel: stage.applicantLabel })),
    },
    availability: formAvailability(form),
  };
}
