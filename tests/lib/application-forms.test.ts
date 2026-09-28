import { describe, expect, it } from 'vitest';
import {
  applicationFileAcceptAttribute,
  applicationFileContentType,
  applicationFileTypesLabel,
  isApplicationContentBlock,
  formAvailability,
  isQuestionVisible,
  newApplicationFormConfig,
  publicApplicationForm,
  validateApplicationAnswers,
  validateApplicationForm,
  type ApplicationFormRecord,
} from '@/lib/application-forms';
import { applicationThemeColors } from '@/lib/application-theme-presets';

describe('application form contract', () => {
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
});
