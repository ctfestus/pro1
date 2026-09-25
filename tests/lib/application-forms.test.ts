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
    expect(config.questions.some(question => question.label === 'Full name')).toBe(true);
    expect(config.questions.every(question => question.id.startsWith('q-'))).toBe(true);
    config.questions[0].label = 'Preferred name';
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
    const form: ApplicationFormRecord = {
      id: 'form-1', ownerId: 'owner-1', ownerEmail: 'owner@example.com', slug: 'test', status: 'published',
      createdAt: '', updatedAt: '', config,
    };
    expect(formAvailability(form, new Date('2026-09-25T00:00:00.000Z'))).toBe('open');
    expect(publicApplicationForm(form).config.stages[1].name).toBe(config.stages[1].applicantLabel);
  });
});
