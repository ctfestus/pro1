import { describe, expect, it } from 'vitest';
import {
  applyApplicationOptionSuggestion,
  applicationSuggestionActions,
  canApplyApplicationOptionSuggestion,
  mergeApplicationOptions,
  normalizeApplicationAiOptions,
  suggestApplicationOptions,
} from '@/lib/application-option-suggestions';
import { isQuestionVisible, type ApplicationQuestion } from '@/lib/application-forms';

describe('application option suggestions', () => {
  it('suggests editable choices across common application topics', () => {
    expect(suggestApplicationOptions('What is your gender?')?.options).toEqual(['Male', 'Female', 'Non-binary', 'Prefer to self-describe', 'Prefer not to say']);
    expect(suggestApplicationOptions('Current employment status')?.options).toContain('Self-employed');
    expect(suggestApplicationOptions('Highest qualification')?.options).toContain("Bachelor's degree");
    expect(suggestApplicationOptions('Highest level of education')?.options).toContain('Diploma');
    expect(suggestApplicationOptions('How many years of experience do you have?')?.options).toContain('3-5 years');
    expect(suggestApplicationOptions('Preferred contact method')?.options).toContain('WhatsApp');
    expect(suggestApplicationOptions('How did you hear about us?')?.options).toContain('Friend or colleague');
    expect(suggestApplicationOptions('What is your age range?')?.options).toContain('Prefer not to say');
    expect(suggestApplicationOptions('What is your internet access like?')?.options).toContain('Limited access');
  });

  it('suggests the existing yes or no question type only for likely binary questions', () => {
    expect(suggestApplicationOptions('Are you available to attend?')?.type).toBe('yes_no');
    expect(suggestApplicationOptions('Do you have a laptop?')?.options).toEqual(['Yes', 'No']);
    expect(suggestApplicationOptions('Can you describe your experience?')).toBeNull();
    expect(suggestApplicationOptions('Untitled question')).toBeNull();
  });

  it('replaces only untouched placeholders and preserves instructor-written options', () => {
    expect(mergeApplicationOptions(['Option 1', 'Option 2'], ['Online', 'In person'])).toEqual(['Online', 'In person']);
    expect(mergeApplicationOptions(['Online', 'Custom'], ['online', 'In person'])).toEqual(['Online', 'Custom', 'In person']);
  });

  it('converts a written question to choices or the dedicated yes or no type', () => {
    const question = { id: 'q1', label: 'Gender', type: 'short_text' as const, required: true, validation: { minCharacters: 3 } };
    expect(applyApplicationOptionSuggestion(question, ['Male', 'Female'], 'single_choice')).toEqual({ type: 'single_choice', options: ['Male', 'Female'], validation: undefined });
    expect(applyApplicationOptionSuggestion({ ...question, type: 'dropdown', options: ['Custom'], validation: undefined }, ['Male', 'Female'], 'single_choice')).toEqual({ type: 'dropdown', options: ['Custom', 'Male', 'Female'], validation: undefined });
    expect(applyApplicationOptionSuggestion(question, ['Yes', 'No'], 'yes_no')).toEqual({ type: 'yes_no', options: undefined, validation: undefined });
  });

  it('never replaces custom choices with Yes or No or breaks a dependent condition', () => {
    const question: ApplicationQuestion = { id: 'laptop', label: 'Do you have a laptop?', type: 'single_choice', required: true, options: ['Yes, my own', 'Yes, shared', 'No'] };
    const followUp: ApplicationQuestion = { id: 'shared', label: 'Who owns it?', type: 'short_text', required: true, condition: { questionId: 'laptop', operator: 'equals', value: 'Yes, shared' } };
    expect(isQuestionVisible(followUp, { laptop: 'Yes, shared' })).toBe(true);
    expect(canApplyApplicationOptionSuggestion(question, 'yes_no')).toBe(false);
    expect(applicationSuggestionActions(question).quick).toBeNull();
    expect(applyApplicationOptionSuggestion(question, ['Yes', 'No'], 'yes_no')).toBeNull();
    expect(question.options).toEqual(['Yes, my own', 'Yes, shared', 'No']);
  });

  it('allows Yes or No on untouched choices but blocks conversions with dependent conditions', () => {
    const question: ApplicationQuestion = { id: 'laptop', label: 'Do you have a laptop?', type: 'single_choice', required: true, options: ['Option 1', 'Option 2'] };
    expect(applicationSuggestionActions(question).quick?.type).toBe('yes_no');
    expect(applyApplicationOptionSuggestion(question, ['Yes', 'No'], 'yes_no')).toEqual({ type: 'yes_no', options: undefined, validation: undefined });
    expect(applicationSuggestionActions(question, true).quick).toBeNull();
    expect(applyApplicationOptionSuggestion(question, ['Yes', 'No'], 'yes_no', true)).toBeNull();
    const textQuestion = { ...question, type: 'short_text' as const, options: undefined };
    expect(applicationSuggestionActions(textQuestion, true)).toEqual({ quick: null, canSuggestWithAi: false });
    expect(applyApplicationOptionSuggestion(textQuestion, ['Yes', 'No'], 'yes_no', true)).toBeNull();
    expect(applyApplicationOptionSuggestion(textQuestion, ['One', 'Two'], 'single_choice', true)).toBeNull();
  });

  it('hides the panel completely for an existing Yes or No question', () => {
    const question: ApplicationQuestion = { id: 'laptop', label: 'Do you have a laptop?', type: 'yes_no', required: true };
    expect(applicationSuggestionActions(question)).toEqual({ quick: null, canSuggestWithAi: false });
    expect(applicationSuggestionActions({ ...question, type: 'number' })).toEqual({ quick: null, canSuggestWithAi: false });
    expect(canApplyApplicationOptionSuggestion({ ...question, type: 'date' }, 'yes_no')).toBe(false);
  });

  it('keeps generated options short, unique and usable', () => {
    expect(normalizeApplicationAiOptions(['  Online  ', 'online', 'In\n person', '', 5, 'a'.repeat(81)])).toEqual(['Online', 'In person']);
    expect(normalizeApplicationAiOptions(['Only one'])).toEqual([]);
  });
});
