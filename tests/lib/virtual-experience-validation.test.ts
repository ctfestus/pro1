import { describe, expect, it } from 'vitest';
import { validateVirtualExperienceForPublish } from '@/lib/virtual-experience-validation';

const validConfig = () => ({
  company: 'AFC',
  role: 'Financial Analyst',
  tagline: 'Build a decision-ready model.',
  modules: [{
    id: 'm1',
    title: 'Analysis',
    lessons: [{
      id: 'l1',
      title: 'Review the data',
      body: '<p>Read the brief.</p>',
      requirements: [{ id: 'r1', type: 'task', label: 'Complete the analysis', description: '' }],
    }],
  }],
});

describe('validateVirtualExperienceForPublish', () => {
  it('accepts a complete experience', () => {
    expect(validateVirtualExperienceForPublish(validConfig())).toEqual([]);
  });

  it('rejects empty experiences', () => {
    const issues = validateVirtualExperienceForPublish({ modules: [] });
    expect(issues.map(issue => issue.message)).toEqual(expect.arrayContaining([
      'Add the company or organization name.',
      'Add the learner role.',
      'Add a short experience tagline.',
      'Add at least one module.',
    ]));
  });

  it('rejects incomplete multiple-choice and decision tasks', () => {
    const config: any = validConfig();
    config.modules[0].lessons[0].requirements = [
      { id: 'mcq', type: 'mcq', label: 'Choose', description: '', options: ['Only'], correctAnswer: '' },
      { id: 'decision', type: 'decision', label: 'Decide', description: '', options: ['A', 'B'], correctAnswer: 'C' },
    ];
    const messages = validateVirtualExperienceForPublish(config).map(issue => issue.message);
    expect(messages.some(message => message.includes('at least two answer options'))).toBe(true);
    expect(messages.some(message => message.includes('valid correct answer'))).toBe(true);
    expect(messages.some(message => message.includes('recommended path'))).toBe(true);
  });

  it('reads every AI review pass mark out of 100, as the graders score', () => {
    const withScore = (type: string, minScore: number) => {
      const config: any = validConfig();
      config.modules[0].lessons[0].requirements = [{ id: 'r', type, label: 'Review', description: '', minScore }];
      return validateVirtualExperienceForPublish(config).map(issue => issue.message);
    };
    for (const type of ['code_review', 'excel_review', 'dashboard_critique', 'document_review']) {
      expect(withScore(type, 70)).toEqual([]);
      expect(withScore(type, 101).some(message => message.includes('invalid minimum score'))).toBe(true);
    }
  });

  it('only accepts web links for the dataset and solution links learners open', () => {
    const config: any = validConfig();
    config.dataset = { filename: 'data.csv', description: '', url: 'javascript:alert(1)' };
    config.modules[0].solutionVideo = 'data:text/html,x';
    const messages = validateVirtualExperienceForPublish(config).map(issue => issue.message);
    expect(messages).toContain('The dataset link must be a web address (https://...).');
    expect(messages.some(message => message.includes('solution link must be a web address'))).toBe(true);

    config.dataset.url = 'https://example.com/data.csv';
    config.modules[0].solutionVideo = 'https://youtu.be/abc';
    expect(validateVirtualExperienceForPublish(config)).toEqual([]);
  });
});
