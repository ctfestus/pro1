import { describe, expect, it } from 'vitest';
import { convertLegacyEmailDeliverable, htmlToPlainText, plainTextToRichHtml } from '@/lib/ve-deliverable-content';

describe('deliverable content conversion', () => {
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
    });
  });
});
