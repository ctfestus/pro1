import { describe, expect, it } from 'vitest';
import {
  attachDeliverableDescriptionDoc,
  convertLegacyEmailDeliverable,
  htmlToPlainText,
  plainTextToRichHtml,
  reconcileImprovedDeliverableDescription,
} from '@/lib/ve-deliverable-content';
import type { LessonDoc } from '@/lib/lesson-doc';

describe('deliverable content conversion', () => {
  const promptDoc: LessonDoc = {
    type: 'doc',
    content: [{ type: 'promptBlock', attrs: { title: 'Analyse this', prompt: 'Review the dataset' } }],
  };

  it('escapes legacy tag-like plain text before rich editing', () => {
    expect(plainTextToRichHtml('Use the <b> column & check it.')).toBe(
      '<p>Use the &lt;b&gt; column &amp; check it.</p>',
    );
  });

  it('converts rich instructions to readable plain text when changing type', () => {
    expect(htmlToPlainText('<p>Prepare:</p><ol><li>Check revenue</li><li>Check costs</li></ol>')).toBe(
      'Prepare:\n\n- Check revenue\n- Check costs',
    );
  });

  it('preserves the learner-visible email body during legacy conversion', () => {
    expect(convertLegacyEmailDeliverable({
      description: 'Old fallback',
      emailBody: '<p>Detailed learner instructions</p>',
    })).toEqual({
      emailFrame: false,
      emailBody: undefined,
      description: '<p>Detailed learner instructions</p>',
      descriptionFormat: 'rich',
      descriptionDoc: undefined,
    });
  });

  it('drops stale interactive instructions when converting a legacy email deliverable', () => {
    expect(convertLegacyEmailDeliverable({
      description: '<p>Old instructions</p>',
      descriptionFormat: 'rich',
      descriptionDoc: { type: 'doc', content: [{ type: 'paragraph' }] },
      emailBody: '<p>Current email instructions</p>',
    }).descriptionDoc).toBeUndefined();
  });

  it('attaches a canonical document to generated deliverable instructions', () => {
    const requirement = { type: 'task', description: '<p>Run the prompt</p>', descriptionFormat: 'rich' as const };
    expect(attachDeliverableDescriptionDoc(requirement, () => promptDoc)).toEqual({
      ...requirement,
      descriptionDoc: promptDoc,
    });
  });

  it('preserves canonical interactive instructions when global AI Improve rewrites the fallback', () => {
    const prior = {
      type: 'task',
      description: '<blockquote><pre><code>Review the dataset</code></pre></blockquote>',
      descriptionFormat: 'rich' as const,
      descriptionDoc: promptDoc,
    };
    const improved = reconcileImprovedDeliverableDescription(
      { type: 'task', description: '<p>Shorter replacement</p>', descriptionFormat: 'rich' as const },
      prior,
      () => ({ type: 'doc', content: [] }),
    );
    expect(improved).toEqual(prior);
  });

  it('does not revive or clear canonical instructions through global AI Improve', () => {
    const prior = {
      type: 'deliverable',
      description: '<p>Use the interactive prompt</p>',
      descriptionFormat: 'rich' as const,
      descriptionDoc: promptDoc,
    };
    expect(reconcileImprovedDeliverableDescription(
      { type: 'deliverable', description: '', descriptionFormat: 'rich' as const },
      prior,
      () => ({ type: 'doc', content: [] }),
    )).toEqual(prior);
  });

  it('clears a non-canonical empty deliverable instead of inventing a document', () => {
    const incoming = { type: 'task', description: '', descriptionDoc: promptDoc };
    expect(attachDeliverableDescriptionDoc(incoming, () => promptDoc).descriptionDoc).toBeUndefined();
  });

  it('clears canonical fields when AI Improve changes a deliverable to another type', () => {
    const prior = {
      type: 'task',
      description: '<p>Use the prompt</p>',
      descriptionFormat: 'rich' as const,
      descriptionDoc: promptDoc,
    };
    const incoming = { ...prior, type: 'text', description: 'Explain your answer' };
    expect(reconcileImprovedDeliverableDescription(incoming, prior, () => promptDoc)).toEqual({
      ...incoming,
      descriptionFormat: undefined,
      descriptionDoc: undefined,
    });
  });

  it('does not revive a stale document when AI Improve changes a non-deliverable back to a task', () => {
    const stalePrior = {
      type: 'text',
      description: 'Explain your answer',
      descriptionFormat: 'rich' as const,
      descriptionDoc: promptDoc,
    };
    const replacementDoc: LessonDoc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New instructions' }] }],
    };
    const incoming = { type: 'task', description: '<p>New instructions</p>', descriptionFormat: 'rich' as const };
    expect(reconcileImprovedDeliverableDescription(incoming, stalePrior, () => replacementDoc)).toEqual({
      ...incoming,
      descriptionDoc: replacementDoc,
    });
  });

  it('does not revive a stale document when replacement document conversion fails', () => {
    const stalePrior = {
      type: 'text',
      description: 'Explain your answer',
      descriptionDoc: promptDoc,
    };
    const incoming = {
      type: 'task',
      description: '<invalid>',
      descriptionFormat: 'rich' as const,
      descriptionDoc: promptDoc,
    };
    const result = reconcileImprovedDeliverableDescription(incoming, stalePrior, () => {
      throw new Error('Cannot parse generated HTML');
    });
    expect(result).toEqual({ ...incoming, descriptionDoc: undefined });
  });
});
