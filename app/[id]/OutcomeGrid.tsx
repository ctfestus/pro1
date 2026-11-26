'use client';

// "What you'll learn" on a course or virtual experience page: each outcome in a tinted tile with
// its icon, the same look as the Icon grid lesson block. An author can choose an outcome's icon in
// the editor; any other is picked from the outcome's words (lib/lesson-icons outcomeIcon).

import { LessonIcon } from '@/components/lesson/LessonIcon';
import { outcomeIcon } from '@/lib/lesson-icons';

export function OutcomeGrid({ outcomes, icons, accent, card, body }: {
  outcomes: string[];
  /** Icons the author chose, keyed by outcome text; the rest are picked from their words. */
  icons?: Record<string, string>;
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
            <LessonIcon name={outcomeIcon(outcome, icons)} size={22} />
          </span>
          <span style={{ fontSize: 14, color: body, lineHeight: 1.5 }}>{outcome}</span>
        </div>
      ))}
    </div>
  );
}
