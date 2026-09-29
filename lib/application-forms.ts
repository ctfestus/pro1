import {
  APPLICATION_THEME_IDS,
  type ApplicationCustomTheme,
  type ApplicationThemeId,
  type ApplicationThemeMode,
} from '@/lib/application-theme-presets';

export const APPLICATION_QUESTION_TYPES = [
  'short_text', 'long_text', 'email', 'phone', 'number', 'date', 'single_choice',
  'multiple_choice', 'dropdown', 'yes_no', 'file', 'consent', 'text_block', 'image',
] as const;

export type ApplicationQuestionType = typeof APPLICATION_QUESTION_TYPES[number];

/**
 * How an image sits in its frame. The form cover and image blocks share this shape so they
 * crop, reposition, and zoom the same way. Missing values mean cover fit, centered, 100%.
 */
export interface ApplicationImageFrame {
  fit?: 'cover' | 'contain';
  positionX?: number;
  positionY?: number;
  zoom?: number;
}

export interface ApplicationImageBlock extends ApplicationImageFrame {
  url: string;
  alt?: string;
}

/** Display-only form items: shown to applicants but never answered, exported, or used in conditions. */
export function isApplicationContentBlock(question: Pick<ApplicationQuestion, 'type'>): boolean {
  return question.type === 'text_block' || question.type === 'image';
}

// Upload formats a file question can accept. Each extension maps to the content type the
// server stores it with, so the storage bucket can enforce the same list.
export const APPLICATION_FILE_TYPES = {
  pdf: { label: 'PDF', extensions: { pdf: 'application/pdf' } },
  word: {
    label: 'Word',
    extensions: {
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  },
  jpg: { label: 'JPG', extensions: { jpg: 'image/jpeg', jpeg: 'image/jpeg' } },
  png: { label: 'PNG', extensions: { png: 'image/png' } },
} as const satisfies Record<string, { label: string; extensions: Record<string, string> }>;

export type ApplicationFileType = keyof typeof APPLICATION_FILE_TYPES;
export const APPLICATION_FILE_TYPE_IDS = Object.keys(APPLICATION_FILE_TYPES) as ApplicationFileType[];
export type ApplicationFormStatus = 'draft' | 'published' | 'paused' | 'closed';
export type ApplicationSubmissionState = 'draft' | 'submitted';
/** 'steps' shows one question at a time; 'list' shows every question on one scrolling page. */
export type ApplicationFormLayout = 'steps' | 'list';

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
  richText?: string;
  placeholder?: string;
  options?: string[];
  /** File questions only. Missing or empty means every type in APPLICATION_FILE_TYPES. */
  allowedFileTypes?: ApplicationFileType[];
  /** Image blocks only. The question label is used as an optional caption. */
  image?: ApplicationImageBlock;
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

export const APPLICATION_FEE_TYPES = {
  application: { name: 'Application fee', due: 'When you apply', description: 'A one-time fee to process your application.' },
  commitment: { name: 'Commitment fee', due: 'After acceptance', description: 'This one-time fee secures your place if you are accepted.' },
  certificate: { name: 'Certificate fee', due: 'After completion', description: 'A one-time fee for your completion certificate.' },
  other: { name: 'Other fee', due: '', description: '' },
} as const;

export type ApplicationFeeType = keyof typeof APPLICATION_FEE_TYPES;
export const APPLICATION_FEE_CURRENCIES = [
  { code: 'GHS', name: 'Ghanaian cedi' },
  { code: 'NGN', name: 'Nigerian naira' },
  { code: 'KES', name: 'Kenyan shilling' },
  { code: 'ZAR', name: 'South African rand' },
  { code: 'XOF', name: 'West African CFA franc' },
  { code: 'XAF', name: 'Central African CFA franc' },
  { code: 'UGX', name: 'Ugandan shilling' },
  { code: 'TZS', name: 'Tanzanian shilling' },
  { code: 'RWF', name: 'Rwandan franc' },
  { code: 'USD', name: 'US dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'GBP', name: 'British pound' },
] as const;

export interface ApplicationFee {
  type: ApplicationFeeType;
  name: string;
  amount: number;
  currency: string;
  due: string;
  description?: string;
}

export function newApplicationFee(type: ApplicationFeeType = 'commitment'): ApplicationFee {
  return { type, ...APPLICATION_FEE_TYPES[type], amount: 0, currency: 'GHS' };
}

export function formatApplicationFeeAmount(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return 'Set amount';
  return amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatApplicationFee(fee: Pick<ApplicationFee, 'amount' | 'currency'>): string {
  if (!Number.isFinite(fee.amount) || fee.amount <= 0) return 'Set amount';
  return `${fee.currency || 'Currency'} ${formatApplicationFeeAmount(fee.amount)}`;
}

export interface ApplicationFormConfig {
  title: string;
  description: string;
  coverImage?: string;
  coverImageAlt?: string;
  coverImagePlacement?: 'header' | 'inside';
  coverImageFit?: 'cover' | 'contain';
  coverImagePosition?: 'top' | 'center' | 'bottom';
  coverImagePositionX?: number;
  coverImagePositionY?: number;
  coverImageZoom?: number;
  eligibility: string;
  fee?: ApplicationFee;
  opensAt: string;
  closesAt: string;
  confirmationMessage: string;
  emailPrompt?: string;
  emailHelpText?: string;
  themeColor?: string;
  themeMode?: ApplicationThemeMode;
  /** Missing means 'steps', the layout forms had before this setting existed. */
  layout?: ApplicationFormLayout;
  // Legacy fields retained for forms saved before the single-color theme control.
  theme?: ApplicationThemeId;
  customTheme?: ApplicationCustomTheme;
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
  questionLabels?: Record<string, string>;
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
    coverImage: '',
    coverImageAlt: '',
    coverImagePlacement: 'header',
    coverImageFit: 'cover',
    coverImagePosition: 'center',
    coverImagePositionX: 50,
    coverImagePositionY: 50,
    coverImageZoom: 1,
    eligibility: '',
    opensAt: '',
    closesAt: '',
    confirmationMessage: 'Thank you. Your application has been received and our team will review it.',
    emailPrompt: 'What is your email address?',
    emailHelpText: 'For confirmation and status updates.',
    themeColor: '',
    themeMode: 'light',
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

export function applicationQuestionFileTypes(question: Pick<ApplicationQuestion, 'allowedFileTypes'>): ApplicationFileType[] {
  const selected = APPLICATION_FILE_TYPE_IDS.filter(type => question.allowedFileTypes?.includes(type));
  return selected.length ? selected : [...APPLICATION_FILE_TYPE_IDS];
}

function fileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Content type to store the file with, or null when the question does not accept it. */
export function applicationFileContentType(question: Pick<ApplicationQuestion, 'allowedFileTypes'>, fileName: string): string | null {
  const extension = fileExtension(fileName);
  for (const type of applicationQuestionFileTypes(question)) {
    const extensions: Record<string, string> = APPLICATION_FILE_TYPES[type].extensions;
    if (extensions[extension]) return extensions[extension];
  }
  return null;
}

export function applicationFileAcceptAttribute(question: Pick<ApplicationQuestion, 'allowedFileTypes'>): string {
  return applicationQuestionFileTypes(question)
    .flatMap(type => Object.keys(APPLICATION_FILE_TYPES[type].extensions).map(extension => `.${extension}`))
    .join(',');
}

/** "PDF", "PDF or Word", "PDF, Word, JPG or PNG". */
export function applicationFileTypesLabel(question: Pick<ApplicationQuestion, 'allowedFileTypes'>): string {
  const labels = applicationQuestionFileTypes(question).map(type => APPLICATION_FILE_TYPES[type].label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}` : labels[0];
}

// Same limits as the cover image: zoom tops out at 2.5 (APPLICATION_COVER_TARGET.maximumZoom).
function imageBlockErrors(image: ApplicationImageBlock | undefined, name: string): string[] {
  if (!image?.url || !isSafeHttpUrl(image.url)) return [`${name} needs an image.`];
  const errors: string[] = [];
  if (image.fit && !['cover', 'contain'].includes(image.fit)) errors.push(`${name} image fit is invalid.`);
  for (const [value, axis] of [[image.positionX, 'horizontal'], [image.positionY, 'vertical']] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) errors.push(`${name} ${axis} position is invalid.`);
  }
  if (image.zoom !== undefined && (!Number.isFinite(image.zoom) || image.zoom < 1 || image.zoom > 2.5)) errors.push(`${name} zoom is invalid.`);
  if ((image.alt?.length ?? 0) > 500) errors.push(`${name} description is too long.`);
  return errors;
}

export function validateApplicationForm(config: ApplicationFormConfig, status?: ApplicationFormStatus): string[] {
  const errors: string[] = [];
  if (!config.title?.trim()) errors.push('Title is required.');
  if (!config.description?.trim()) errors.push('Description is required.');
  if (config.coverImage && !isSafeHttpUrl(config.coverImage)) errors.push('Cover image URL is invalid.');
  if (config.coverImagePlacement && !['header', 'inside'].includes(config.coverImagePlacement)) errors.push('Cover image placement is invalid.');
  if (config.coverImageFit && !['cover', 'contain'].includes(config.coverImageFit)) errors.push('Cover image fit is invalid.');
  if (config.coverImagePosition && !['top', 'center', 'bottom'].includes(config.coverImagePosition)) errors.push('Cover image position is invalid.');
  if (config.coverImagePositionX !== undefined && (!Number.isFinite(config.coverImagePositionX) || config.coverImagePositionX < 0 || config.coverImagePositionX > 100)) errors.push('Cover image horizontal position is invalid.');
  if (config.coverImagePositionY !== undefined && (!Number.isFinite(config.coverImagePositionY) || config.coverImagePositionY < 0 || config.coverImagePositionY > 100)) errors.push('Cover image vertical position is invalid.');
  if (config.coverImageZoom !== undefined && (!Number.isFinite(config.coverImageZoom) || config.coverImageZoom < 1 || config.coverImageZoom > 2.5)) errors.push('Cover image zoom is invalid.');
  if (config.fee !== undefined) {
    const fee = config.fee;
    if (!fee || typeof fee !== 'object' || Array.isArray(fee)) {
      errors.push('Fee details are invalid.');
    } else {
      if (!Object.hasOwn(APPLICATION_FEE_TYPES, fee.type)) errors.push('Select a valid fee type.');
      if (typeof fee.name !== 'string' || !fee.name.trim() || fee.name.length > 80) errors.push('Fee name must be between 1 and 80 characters.');
      if (typeof fee.amount !== 'number' || !Number.isFinite(fee.amount) || fee.amount <= 0 || fee.amount > 1_000_000_000
        || Math.abs(fee.amount * 100 - Math.round(fee.amount * 100)) > 0.000001) errors.push('Enter a positive fee amount with no more than two decimal places.');
      if (typeof fee.currency !== 'string' || !/^[A-Z]{3}$/.test(fee.currency)
        || !Intl.supportedValuesOf('currency').includes(fee.currency)) errors.push('Select a valid three-letter currency code.');
      if (typeof fee.due !== 'string' || !fee.due.trim() || fee.due.length > 120) errors.push('Explain when the fee is due in 120 characters or fewer.');
      if (fee.description !== undefined && (typeof fee.description !== 'string' || fee.description.length > 500)) errors.push('Fee description must be 500 characters or fewer.');
    }
  }
  if (!config.confirmationMessage?.trim()) errors.push('Confirmation message is required.');
  if (config.emailPrompt !== undefined && !config.emailPrompt.trim()) errors.push('Email question prompt is required.');
  if ((config.emailPrompt?.length ?? 0) > 160) errors.push('Email question prompt must be 160 characters or fewer.');
  if ((config.emailHelpText?.length ?? 0) > 240) errors.push('Email question help text must be 240 characters or fewer.');
  if (config.themeColor && !/^#[0-9a-f]{6}$/i.test(config.themeColor)) errors.push('Theme color must use a six-digit hex value.');
  if (config.themeMode && !['light', 'dark'].includes(config.themeMode)) errors.push('Theme mode is invalid.');
  if (config.layout && !['steps', 'list'].includes(config.layout)) errors.push('Question layout is invalid.');
  if (config.theme && !APPLICATION_THEME_IDS.includes(config.theme)) errors.push('Application theme is invalid.');
  if (config.theme === 'custom') {
    const customColors = Object.values(config.customTheme ?? {});
    if (customColors.length !== 5 || customColors.some(value => !/^#[0-9a-f]{6}$/i.test(value))) errors.push('Custom theme colors must use six-digit hex values.');
  }
  if (!Array.isArray(config.questions) || config.questions.length === 0) errors.push('Add at least one question.');
  const ids = new Set<string>();
  const conditionSources = new Set<string>();
  for (const item of config.questions ?? []) {
    if (!item.id || ids.has(item.id)) errors.push('Every question must have a unique ID.');
    ids.add(item.id);
    if (!item.label?.trim() && item.type !== 'image') errors.push('Every question needs a label.');
    if (!APPLICATION_QUESTION_TYPES.includes(item.type)) errors.push(`Unsupported question type: ${item.type}`);
    if (item.type === 'image') errors.push(...imageBlockErrors(item.image, item.label?.trim() || 'Image block'));
    if (item.type === 'text_block' && !item.richText?.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) errors.push(`${item.label || 'Text block'} needs content.`);
    if ((item.richText?.length ?? 0) > 100_000) errors.push(`${item.label || 'Text block'} content is too long.`);
    if (['single_choice', 'multiple_choice', 'dropdown'].includes(item.type) && (item.options ?? []).filter(Boolean).length < 2) {
      errors.push(`${item.label || 'Choice question'} needs at least two options.`);
    }
    if (item.allowedFileTypes !== undefined
      && (!Array.isArray(item.allowedFileTypes) || item.allowedFileTypes.some(type => !APPLICATION_FILE_TYPE_IDS.includes(type)))) {
      errors.push(`${item.label || 'File question'} has an unsupported file type.`);
    }
    if (item.condition?.questionId && !conditionSources.has(item.condition.questionId)) {
      errors.push(`${item.label || 'Conditional question'} must depend on an earlier question.`);
    }
    if (!isApplicationContentBlock(item)) conditionSources.add(item.id);
  }
  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    errors.push('Add at least one review stage.');
  } else {
    const stageIds = new Set<string>();
    for (const stage of config.stages) {
      if (!stage || typeof stage.id !== 'string' || !stage.id || stageIds.has(stage.id)) {
        errors.push('Every review stage must have a unique ID.');
        continue;
      }
      stageIds.add(stage.id);
      if (typeof stage.name !== 'string' || !stage.name.trim()
        || typeof stage.applicantLabel !== 'string' || !stage.applicantLabel.trim()) {
        errors.push('Every review stage needs an internal name and applicant status.');
      }
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
  if (typeof value === 'object') return Boolean(value.publicId);
  return true;
}

export function validateApplicationAnswers(
  config: ApplicationFormConfig,
  answers: Record<string, ApplicationAnswer>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const item of config.questions) {
    if (!isQuestionVisible(item, answers)) continue;
    if (isApplicationContentBlock(item)) continue;
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
      if (!file?.publicId || !file.publicId.startsWith('supabase/')) {
        errors[item.id] = 'Upload a valid file.';
      }
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
