import { describe, expect, it } from 'vitest';
import {
  APPLICATION_OTHER_OPTION,
  applicationChoiceAnswerText,
  applicationFileAcceptAttribute,
  applicationFileContentType,
  applicationFileTypesLabel,
  applicationQuestionValidationHint,
  isAcceptedStage,
  isApplicationContentBlock,
  formAvailability,
  isQuestionVisible,
  formatApplicationFee,
  newApplicationFee,
  newApplicationFormConfig,
  publicApplicationForm,
  suggestedNameQuestionId,
  validateApplicationAnswers,
  validateApplicationForm,
  type ApplicationFormRecord,
} from '@/lib/application-forms';
import { applicationThemeColors } from '@/lib/application-theme-presets';

describe('application form contract', () => {
  it('validates an Other detail on single, multiple, and dropdown choices', () => {
    const config = newApplicationFormConfig();
    config.questions = [
      { id: 'single', label: 'Track', type: 'single_choice', required: true, options: ['Data', 'Design'], allowOther: true },
      { id: 'multi', label: 'Skills', type: 'multiple_choice', required: true, options: ['SQL', 'Python'], allowOther: true, validation: { minSelections: 2 } },
      { id: 'dropdown', label: 'Location', type: 'dropdown', required: false, options: ['Accra', 'Lagos'], allowOther: true },
      { id: 'detail', label: 'Detail', type: 'short_text', required: true, condition: { questionId: 'single', operator: 'equals', value: APPLICATION_OTHER_OPTION } },
    ];
    const other = { kind: 'other_choice' as const, selections: [APPLICATION_OTHER_OPTION], otherText: 'Research' };
    const answers = { single: other, multi: { ...other, selections: ['SQL', APPLICATION_OTHER_OPTION] }, dropdown: 'Accra', detail: 'Details here' };
    expect(validateApplicationForm(config)).toEqual([]);
    expect(isQuestionVisible(config.questions[3], answers)).toBe(true);
    expect(validateApplicationAnswers(config, answers)).toEqual({});
    expect(applicationChoiceAnswerText(answers.multi)).toBe('SQL, Other (please specify): Research');
    expect(validateApplicationAnswers(config, { ...answers, single: { ...other, otherText: '   ' } }).single).toBe('Please specify your other answer.');
    expect(validateApplicationAnswers(config, { ...answers, single: APPLICATION_OTHER_OPTION }).single).toBe('Select a valid option.');
    expect(validateApplicationAnswers(config, { ...answers, multi: { ...other, selections: ['SQL', 'SQL', APPLICATION_OTHER_OPTION] } }).multi).toBe('Select valid options.');
    expect(validateApplicationAnswers(config, { ...answers, dropdown: { ...other, otherText: 'X'.repeat(501) } }).dropdown).toBe('Select a valid option.');
    expect(validateApplicationAnswers(config, { ...answers, single: 'Data', detail: '' })).toEqual({});
  });

  it('rejects Other settings outside choice questions and duplicate Other labels', () => {
    const config = newApplicationFormConfig();
    config.questions = [{ id: 'q', label: 'Question', type: 'short_text', required: false, allowOther: true }];
    expect(validateApplicationForm(config)).toContain('Question can only use Other on a choice question.');
    config.questions = [{ id: 'q', label: 'Question', type: 'dropdown', required: false, allowOther: true, options: ['Yes', APPLICATION_OTHER_OPTION] }];
    expect(validateApplicationForm(config)).toContain('Question already has an option named Other (please specify).');
  });
  it('creates editable starter forms without fixed system questions', () => {
    const config = newApplicationFormConfig('internship');
    expect(config.coverImage).toBe('');
    expect(config.coverImageAlt).toBe('');
    expect(config.coverImagePlacement).toBe('header');
    expect(config.coverImageFit).toBe('cover');
    expect(config.coverImagePosition).toBe('center');
    expect(config.coverImagePositionX).toBe(50);
    expect(config.coverImagePositionY).toBe(50);
    expect(config.coverImageZoom).toBe(1);
    expect(config.emailPrompt).toBe('What is your email address?');
    expect(config.emailHelpText).toBe('For confirmation and status updates.');
    expect(config.themeColor).toBe('');
    expect(config.themeMode).toBe('light');
    expect(config.questions.some(question => question.label === 'Full name')).toBe(true);
    expect(config.questions.every(question => question.id.startsWith('q-'))).toBe(true);
    config.questions[0].label = 'Preferred name';
    expect(validateApplicationForm(config)).toEqual([]);
  });

  it('validates the single application theme color', () => {
    const config = newApplicationFormConfig();
    config.themeColor = '#23E6C8';
    expect(validateApplicationForm(config)).toEqual([]);
    config.themeColor = 'green';
    expect(validateApplicationForm(config)).toContain('Theme color must use a six-digit hex value.');
    config.themeColor = '#23E6C8';
    config.themeMode = 'dark';
    expect(validateApplicationForm(config)).toEqual([]);
    config.themeMode = 'dim' as 'dark';
    expect(validateApplicationForm(config)).toContain('Theme mode is invalid.');
  });

  it('uses neutral form controls in light and dark application modes', () => {
    const base = { cta: '#00BF63' } as Parameters<typeof applicationThemeColors>[0];
    const light = applicationThemeColors(base, '#0056D2', 'platform', undefined, 'light');
    const dark = applicationThemeColors(base, '#0056D2', 'platform', undefined, 'dark');
    expect(light.input).toBe('#FFFFFF');
    expect(light.inputBorder).toBe('#DDE1E7');
    expect(dark.input).toBe('#191D26');
    expect(dark.inputBorder).toBe('#343B48');
    expect(light.cta).toBe('#0056D2');
    expect(dark.cta).toBe('#0056D2');
  });

  it('validates applicant cover images and their placement', () => {
    const config = newApplicationFormConfig();
    config.coverImage = 'not-a-url';
    expect(validateApplicationForm(config)).toContain('Cover image URL is invalid.');
    config.coverImage = 'https://cdn.example.com/application-cover.webp';
    config.coverImageAlt = 'Students working together';
    config.coverImagePlacement = 'inside';
    config.coverImageFit = 'contain';
    config.coverImagePosition = 'top';
    config.coverImagePositionX = 35;
    config.coverImagePositionY = 20;
    config.coverImageZoom = 1.4;
    expect(validateApplicationForm(config)).toEqual([]);
    config.coverImageZoom = 3;
    expect(validateApplicationForm(config)).toContain('Cover image zoom is invalid.');
  });

  it('validates one optional applicant fee and preserves its currency in the public form', () => {
    const config = newApplicationFormConfig();
    expect(config.fee).toBeUndefined();
    const fee = { ...newApplicationFee('commitment'), amount: 150.5, currency: 'KES' };
    config.fee = fee;
    expect(validateApplicationForm(config, 'published')).toEqual([]);
    expect(formatApplicationFee(fee)).toBe('KES 150.5');

    const form: ApplicationFormRecord = {
      id: 'form-fee', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'fee', status: 'published',
      createdAt: '', updatedAt: '', config,
    };
    expect(publicApplicationForm(form).config.fee).toEqual(fee);

    config.fee = { ...fee, amount: -1, currency: 'not-a-code', due: '' };
    expect(validateApplicationForm(config)).toEqual(expect.arrayContaining([
      'Enter a positive fee amount with no more than two decimal places.',
      'Select a valid three-letter currency code.',
      'Explain when the fee is due in 120 characters or fewer.',
    ]));
    config.fee = { ...fee, amount: 10.999 };
    expect(validateApplicationForm(config)).toContain('Enter a positive fee amount with no more than two decimal places.');
    config.fee = { ...fee, currency: 'ABC' };
    expect(validateApplicationForm(config)).toContain('Select a valid three-letter currency code.');
  });

  it('validates conditional required answers only when visible', () => {
    const config = newApplicationFormConfig('bootcamp');
    const trigger = config.questions[0];
    config.questions.push({
      id: 'conditional', label: 'Explain', type: 'long_text', required: true,
      condition: { questionId: trigger.id, operator: 'equals', value: 'Show' },
    });
    const hiddenAnswers = Object.fromEntries(config.questions.filter(question => question.required).map(question => [question.id, question.type === 'consent' ? true : question.type === 'yes_no' ? 'Yes' : 'Answer']));
    hiddenAnswers[trigger.id] = 'Hide';
    expect(isQuestionVisible(config.questions.at(-1)!, hiddenAnswers)).toBe(false);
    expect(validateApplicationAnswers(config, hiddenAnswers).conditional).toBeUndefined();
    hiddenAnswers[trigger.id] = 'Show';
    delete hiddenAnswers.conditional;
    expect(validateApplicationAnswers(config, hiddenAnswers).conditional).toBe('This question is required.');
  });

  it('checks configurable response rules and shows applicants the same criteria', () => {
    const config = newApplicationFormConfig();
    config.questions = [
      { id: 'site', label: 'Portfolio URL', type: 'short_text', required: true, validation: { minCharacters: 10, maxCharacters: 40, requireUrl: true } },
      { id: 'essay', label: 'Motivation', type: 'long_text', required: false, validation: { minWords: 3, maxWords: 5 } },
      { id: 'score', label: 'Score', type: 'number', required: true, validation: { minNumber: -2, maxNumber: 10 } },
      { id: 'start', label: 'Start date', type: 'date', required: true, validation: { minDate: '2026-10-01', maxDate: '2026-10-31' } },
      { id: 'skills', label: 'Skills', type: 'multiple_choice', required: true, options: ['SQL', 'Python', 'Excel'], validation: { minSelections: 2, maxSelections: 2 } },
    ];
    expect(validateApplicationForm(config, 'published')).toEqual([]);
    expect(applicationQuestionValidationHint(config.questions[0])).toContain('HTTP or HTTPS URL');
    expect(applicationQuestionValidationHint(config.questions[1])).toContain('At least 3 words');
    const answers = { site: 'ftp://example.com', essay: 'One two', score: -3, start: '2026-09-30', skills: ['SQL'] };
    expect(validateApplicationAnswers(config, answers)).toEqual({
      site: 'Enter a valid HTTP or HTTPS URL.',
      essay: 'Enter at least 3 words.',
      score: 'Enter a number of at least -2.',
      start: 'Choose a date on or after 2026-10-01.',
      skills: 'Choose at least 2 options.',
    });
    expect(validateApplicationAnswers(config, { site: 'https://example.com', essay: '', score: 5, start: '2026-10-15', skills: ['SQL', 'Python'] })).toEqual({});
    expect(validateApplicationAnswers(config, { site: 'short', essay: 'one two three four five six', score: 11, start: '2026-11-01', skills: ['SQL', 'Python', 'Excel'] })).toEqual({
      site: 'Enter at least 10 characters.',
      essay: 'Enter no more than 5 words.',
      score: 'Enter a number no greater than 10.',
      start: 'Choose a date on or before 2026-10-31.',
      skills: 'Choose no more than 2 options.',
    });
    expect(validateApplicationAnswers(config, { site: 'https://example.com', score: 5, start: '2026-10-15', skills: ['SQL', 'SQL'] }).skills).toBe('Select valid options.');
    expect(validateApplicationAnswers(config, { site: `https://example.com/${'a'.repeat(40)}`, score: 5, start: '2026-10-15', skills: ['SQL', 'Python'] }).site).toBe('Enter no more than 40 characters.');
    expect(validateApplicationAnswers(config, { site: '    short    ', score: 5, start: '2026-10-15', skills: ['SQL', 'Python'] }).site).toBe('Enter at least 10 characters.');
    expect(validateApplicationAnswers(config, { site: `${' '.repeat(25)}https://example.com${' '.repeat(25)}`, score: 5, start: '2026-10-15', skills: ['SQL', 'Python'] }).site).toBeUndefined();
    expect(validateApplicationAnswers(config, { site: '   ', score: 5, start: '2026-10-15', skills: ['SQL', 'Python'] }).site).toBe('This question is required.');
  });

  it('rejects impossible or mismatched response rules before a form is published', () => {
    const config = newApplicationFormConfig();
    config.questions = [
      { id: 'site', label: 'Website', type: 'short_text', required: false, validation: { minCharacters: 20, maxCharacters: 10 } },
      { id: 'essay', label: 'Essay', type: 'long_text', required: false, validation: { minWords: 0 } },
      { id: 'score', label: 'Score', type: 'number', required: false, validation: { minNumber: 10, maxNumber: 1 } },
      { id: 'date', label: 'Date', type: 'date', required: false, validation: { minDate: '2026-02-30' } },
      { id: 'skills', label: 'Skills', type: 'multiple_choice', required: false, options: ['SQL', 'Python'], validation: { minSelections: 3 } },
      { id: 'email', label: 'Email', type: 'email', required: false, validation: { requireUrl: true } },
    ];
    expect(validateApplicationForm(config)).toEqual(expect.arrayContaining([
      'Website minimum characters cannot exceed the maximum.',
      'Essay minimum words must be between 1 and 10000.',
      'Score minimum number cannot exceed the maximum.',
      'Date earliest date is invalid.',
      'Skills minimum selections must be between 1 and 2.',
      'Email has a response rule that does not apply to its question type.',
    ]));
  });

  it('limits file questions to PDF, Word, JPG and PNG, narrowed per question', () => {
    const anyType = { allowedFileTypes: undefined };
    expect(applicationFileTypesLabel(anyType)).toBe('PDF, Word, JPG or PNG');
    expect(applicationFileAcceptAttribute(anyType)).toBe('.pdf,.doc,.docx,.jpg,.jpeg,.png');
    expect(applicationFileContentType(anyType, 'CV.PDF')).toBe('application/pdf');
    expect(applicationFileContentType(anyType, 'data.xlsx')).toBeNull();
    expect(applicationFileContentType(anyType, 'no-extension')).toBeNull();

    const cvOnly = { allowedFileTypes: ['word', 'pdf'] as const };
    expect(applicationFileTypesLabel({ allowedFileTypes: [...cvOnly.allowedFileTypes] })).toBe('PDF or Word');
    expect(applicationFileContentType({ allowedFileTypes: [...cvOnly.allowedFileTypes] }, 'photo.png')).toBeNull();

    const config = newApplicationFormConfig('bootcamp');
    config.questions.push({ id: 'cv', label: 'CV', type: 'file', required: true, allowedFileTypes: ['pdf'] });
    expect(validateApplicationForm(config)).toEqual([]);
    config.questions[config.questions.length - 1].allowedFileTypes = ['zip' as never];
    expect(validateApplicationForm(config)).toContain('CV has an unsupported file type.');
  });

  it('accepts the step-by-step and one-page question layouts only', () => {
    const config = newApplicationFormConfig('bootcamp');
    expect(config.layout).toBeUndefined();
    expect(validateApplicationForm({ ...config, layout: 'steps' })).toEqual([]);
    expect(validateApplicationForm({ ...config, layout: 'list' })).toEqual([]);
    expect(validateApplicationForm({ ...config, layout: 'grid' as never })).toContain('Question layout is invalid.');
  });

  it('supports image blocks framed like the cover, never treated as answers or condition sources', () => {
    const config = newApplicationFormConfig('bootcamp');
    const image = { id: 'banner', label: '', type: 'image' as const, required: false };
    config.questions.splice(1, 0, image);
    expect(validateApplicationForm(config)).toContain('Image block needs an image.');

    config.questions[1] = { ...image, image: { url: 'https://images.pexels.com/photos/1/banner.jpeg', alt: 'Students', fit: 'cover', positionX: 30, positionY: 70, zoom: 1.5 } };
    expect(validateApplicationForm(config)).toEqual([]);
    expect(isApplicationContentBlock(config.questions[1])).toBe(true);
    expect(validateApplicationAnswers(config, {})).not.toHaveProperty('banner');

    config.questions[1] = { ...config.questions[1], image: { url: 'javascript:alert(1)' } };
    expect(validateApplicationForm(config)).toContain('Image block needs an image.');
    config.questions[1] = { ...config.questions[1], label: 'Campus', image: { url: 'https://images.pexels.com/photos/1/banner.jpeg', zoom: 4, positionX: 120 } };
    expect(validateApplicationForm(config)).toEqual(expect.arrayContaining(['Campus zoom is invalid.', 'Campus horizontal position is invalid.']));

    config.questions[1] = { ...config.questions[1], image: { url: 'https://images.pexels.com/photos/1/banner.jpeg' } };
    config.questions[2] = { ...config.questions[2], condition: { questionId: 'banner', operator: 'equals', value: 'x' } };
    expect(validateApplicationForm(config)).toContain(`${config.questions[2].label} must depend on an earlier question.`);
  });

  it('supports rich text blocks without treating them as applicant answers', () => {
    const config = newApplicationFormConfig('bootcamp');
    config.questions.splice(1, 0, {
      id: 'programme-context',
      label: 'Before you continue',
      type: 'text_block',
      required: false,
      richText: '<p>Review the <strong>programme requirements</strong>.</p>',
    });
    expect(validateApplicationForm(config)).toEqual([]);
    expect(validateApplicationAnswers(config, {})).not.toHaveProperty('programme-context');
    config.questions[1].richText = '<p><br></p>';
    expect(validateApplicationForm(config)).toContain('Before you continue needs content.');
  });

  it('enforces publication dates and hides internal stage names publicly', () => {
    const config = newApplicationFormConfig();
    config.opensAt = '2026-10-10T00:00:00.000Z';
    config.closesAt = '2026-10-01T00:00:00.000Z';
    expect(validateApplicationForm(config, 'published')).toContain('Closing date must be after the opening date.');
    config.opensAt = '2026-09-01T00:00:00.000Z';
    config.coverImage = 'https://cdn.example.com/application-cover.webp';
    config.coverImageAlt = 'Photo by Example Photographer';
    config.coverImagePlacement = 'inside';
    config.coverImageFit = 'cover';
    config.coverImagePosition = 'bottom';
    config.coverImagePositionX = 42;
    config.coverImagePositionY = 76;
    config.coverImageZoom = 1.25;
    const form: ApplicationFormRecord = {
      id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'test', status: 'published',
      createdAt: '', updatedAt: '', config,
    };
    expect(formAvailability(form, new Date('2026-09-25T00:00:00.000Z'))).toBe('open');
    expect(publicApplicationForm(form).config.stages[1].name).toBe(config.stages[1].applicantLabel);
    expect(publicApplicationForm(form).config.coverImage).toBe(config.coverImage);
    expect(publicApplicationForm(form).config.coverImageAlt).toBe(config.coverImageAlt);
    expect(publicApplicationForm(form).config.coverImagePlacement).toBe('inside');
    expect(publicApplicationForm(form).config.coverImageFit).toBe('cover');
    expect(publicApplicationForm(form).config.coverImagePosition).toBe('bottom');
    expect(publicApplicationForm(form).config.coverImagePositionX).toBe(42);
    expect(publicApplicationForm(form).config.coverImagePositionY).toBe(76);
    expect(publicApplicationForm(form).config.coverImageZoom).toBe(1.25);
  });

  it('validates the admission cohort and name question, and keeps admission out of the public form', () => {
    const config = newApplicationFormConfig('bootcamp');
    const cohortId = '11111111-1111-4111-8111-111111111111';
    config.questions.unshift({ id: 'full-name', label: 'Full name', type: 'short_text', required: true });
    expect(validateApplicationForm({ ...config, admission: { cohortId, nameQuestionId: 'full-name' } })).toEqual([]);
    expect(validateApplicationForm({ ...config, admission: { cohortId: 'not-a-cohort' } })).toContain('Select a valid cohort for admission.');
    expect(validateApplicationForm({ ...config, admission: { cohortId, nameQuestionId: 'missing' } })).toContain('Choose a short answer question for the applicant name.');

    const form = {
      id: 'form-1', ownerId: 'owner', ownerEmail: '', slug: 'bootcamp', status: 'published', createdAt: '', updatedAt: '',
      config: { ...config, admission: { cohortId } },
    } as ApplicationFormRecord;
    expect(publicApplicationForm(form).config).not.toHaveProperty('admission');
  });

  it('suggests the name question and recognises accepted stages', () => {
    expect(suggestedNameQuestionId([
      { id: 'q1', label: 'Email of a referee', type: 'short_text', required: false },
      { id: 'q2', label: 'Your full name', type: 'short_text', required: true },
    ])).toBe('q2');
    expect(suggestedNameQuestionId([{ id: 'q1', label: 'Username', type: 'short_text', required: false }])).toBeUndefined();
    expect(isAcceptedStage({ id: 'accepted', name: 'Accepted', applicantLabel: 'Accepted' })).toBe(true);
    expect(isAcceptedStage({ id: 'stage-1', name: 'Offer', applicantLabel: 'Admitted' })).toBe(true);
    expect(isAcceptedStage({ id: 'screening', name: 'Screening', applicantLabel: 'Under review' })).toBe(false);
    expect(isAcceptedStage(undefined)).toBe(false);
  });
});
