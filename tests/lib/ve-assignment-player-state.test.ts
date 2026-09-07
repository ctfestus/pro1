import { describe, expect, it } from 'vitest';
import { shouldShowGroupReadyScreen } from '@/lib/ve-assignment-player-state';

describe('group member pre-submission state', () => {
  it('shows the ready screen when preparation first reaches 100 percent', () => {
    expect(shouldShowGroupReadyScreen({
      graded: false,
      canSubmit: false,
      overallPct: 100,
      reviewBeforeSubmit: false,
    })).toBe(true);
  });

  it('returns to editable missions when review is requested', () => {
    expect(shouldShowGroupReadyScreen({
      graded: false,
      canSubmit: false,
      overallPct: 100,
      reviewBeforeSubmit: true,
    })).toBe(false);
  });
});
