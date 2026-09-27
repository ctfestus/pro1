import { describe, expect, it } from 'vitest';
import {
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
    expect(validateApplicationForm(config)).toEqual([]);
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

  it('enforces publication dates and hides internal stage names publicly', () => {
    const config = newApplicationFormConfig();
    config.opensAt = '2026-10-10T00:00:00.000Z';
    config.closesAt = '2026-10-01T00:00:00.000Z';
    expect(validateApplicationForm(config, 'published')).toContain('Closing date must be after the opening date.');
    config.opensAt = '2026-09-01T00:00:00.000Z';
    config.coverImage = 'https://cdn.example.com/application-cover.webp';
    config.coverImageAlt = 'Photo by Example Photographer';
    config.coverImagePlacement = 'inside';
    const form: ApplicationFormRecord = {
      id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'test', status: 'published',
      createdAt: '', updatedAt: '', config,
    };
    expect(formAvailability(form, new Date('2026-09-25T00:00:00.000Z'))).toBe('open');
    expect(publicApplicationForm(form).config.stages[1].name).toBe(config.stages[1].applicantLabel);
    expect(publicApplicationForm(form).config.coverImage).toBe(config.coverImage);
    expect(publicApplicationForm(form).config.coverImageAlt).toBe(config.coverImageAlt);
    expect(publicApplicationForm(form).config.coverImagePlacement).toBe('inside');
  });
});
