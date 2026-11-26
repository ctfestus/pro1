'use client';

// The icon beside a "What you'll learn" outcome in the course and experience editors. It shows the
// icon the content page will use: the author's choice, or until then one picked from the
// outcome's words. "Automatic" in the picker goes back to the picked one.

import { LessonIconButton } from '@/components/lesson/LessonIconPicker';
import { suggestLessonIcon } from '@/lib/lesson-icons';

export function OutcomeIconButton({ outcome, index, icons, onChange }: {
  outcome: string;
  index: number;
  icons: Record<string, string> | undefined;
  onChange: (icons: Record<string, string>) => void;
}) {
  return (
    <LessonIconButton
      className="outcome-icon-btn"
      title={`Outcome ${index + 1} icon`}
      value={icons?.[outcome]}
      fallback={outcome.trim() ? suggestLessonIcon(outcome) : undefined}
      noneLabel="Automatic"
      size={18}
      onChange={(key) => {
        const next = { ...(icons || {}) };
        if (key) next[outcome] = key; else delete next[outcome];
        onChange(next);
      }}
    />
  );
}
