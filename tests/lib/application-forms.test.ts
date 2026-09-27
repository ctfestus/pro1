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

describe('application form contract', () => {
  it('creates editable starter forms without fixed system questions', () => {
    const config = newApplicationFormConfig('internship');
    expect(config.coverImage).toBe('');
    expect(config.coverImageAlt).toBe('');
    expect(config.coverImagePlacement).toBe('header');
    expect(config.theme).toBe('platform');
    expect(config.customTheme?.primary).toMatch(/^#[0-9A-F]{6}$/i);
    expect(config.questions.some(question => question.label === 'Full name')).toBe(true);
    expect(config.questions.every(question => question.id.startsWith('q-'))).toBe(true);
    config.questions[0].label = 'Preferred name';
    expect(validateApplicationForm(config)).toEqual([]);
  });

  it('validates custom application themes without changing the sheet contract', () => {
    const config = newApplicationFormConfig();
    config.theme = 'custom';
    config.customTheme = { background: '#071316', surface: '#0C2024', primary: '#23E6C8', accent: '#FFB547', text: '#F2FFFD' };
    expect(validateApplicationForm(config)).toEqual([]);
    config.customTheme.primary = 'green';
    expect(validateApplicationForm(config)).toContain('Custom theme colors must use six-digit hex values.');
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
