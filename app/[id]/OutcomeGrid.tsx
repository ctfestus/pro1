'use client';

// "What you'll learn" on a course or virtual experience page: each outcome in a tinted tile with
// an icon picked from its words (lib/lesson-icons suggestLessonIcon), the same look as the Icon
// grid lesson block. Nothing to set up: the outcomes are the ones typed in the editor.

import { LessonIcon } from '@/components/lesson/LessonIcon';
import { suggestLessonIcon } from '@/lib/lesson-icons';

export function OutcomeGrid({ outcomes, accent, card, body }: {
  outcomes: string[];
  /** The page's accent, as a hex colour. */
  accent: string;
  /** The card colour, for the icon tile. */
  card: string;
  /** The body text colour; the icon is mixed toward it so it stays readable on a light accent. */
  body: string;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 12 }}>
      {outcomes.map((outcome, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 12, background: `${accent}14` }}>
          <span style={{ display: 'grid', placeItems: 'center', width: 40, height: 40, borderRadius: 10, background: card, color: `color-mix(in oklab, ${accent} 80%, ${body})` }}>
            <LessonIcon name={suggestLessonIcon(outcome)} size={22} />
          </span>
          <span style={{ fontSize: 14, color: body, lineHeight: 1.5 }}>{outcome}</span>
        </div>
      ))}
    </div>
  );
}
