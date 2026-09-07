import { describe, expect, it } from 'vitest';
import { mergeImprovedVeModules } from '@/lib/ve-ai-improve';

const current = [{
  id: 'module-1',
  lessons: [{
    id: 'lesson-1',
    requirements: [{
      id: 'task-1',
      type: 'task',
      label: 'Build the report',
      description: '<p>Original</p>',
      attachments: [{ name: 'Template.xlsx', url: 'https://example.com/template.xlsx' }],
      futureField: 'preserve me',
    }],
  }],
}];

describe('mergeImprovedVeModules', () => {
  it('preserves optional requirement fields omitted by AI Improve', () => {
    const result = mergeImprovedVeModules(current, [{
      id: 'module-1',
      lessons: [{
        id: 'lesson-1',
        requirements: [{ id: 'task-1', type: 'task', label: 'Build the final report', description: '<p>Original</p>' }],
      }],
    }]);

    expect(result[0].lessons[0].requirements[0]).toMatchObject({
      label: 'Build the final report',
      attachments: [{ name: 'Template.xlsx', url: 'https://example.com/template.xlsx' }],
      futureField: 'preserve me',
    });
  });

  it('honors an explicit attachment removal', () => {
    const result = mergeImprovedVeModules(current, [{
      id: 'module-1',
      lessons: [{
        id: 'lesson-1',
        requirements: [{ id: 'task-1', type: 'task', label: 'Build the report', description: '<p>Original</p>', attachments: [] }],
      }],
    }]);

    expect(result[0].lessons[0].requirements[0].attachments).toEqual([]);
  });
});
