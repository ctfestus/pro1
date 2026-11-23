'use client';

import type { ReactNode } from 'react';

interface Props {
  icon: ReactNode;
  title: string;
  description: string;
  accentColor: string;
  isDark: boolean;
  reviewsUsed?: number;
  maxReviews?: number;
  analyzing?: boolean;
}

// One line on what the review does, the AI caveat, and how many reviews are left. The caveat
// lives here, so the players do not repeat the longer disclaimer above an empty answer box.
export default function AiReviewWorkspaceHeader({ icon, title, description, accentColor, isDark, reviewsUsed = 0, maxReviews, analyzing = false }: Props) {
  const text = isDark ? '#edf1f5' : '#111827';
  const muted = isDark ? '#8d99a6' : '#667085';
  const remaining = maxReviews === undefined ? null : Math.max(0, maxReviews - reviewsUsed);

  return (
    <div className="flex items-start gap-3">
      <span className={`mt-0.5 inline-flex flex-shrink-0 ${analyzing ? 'animate-pulse motion-reduce:animate-none' : ''}`} style={{ color: accentColor }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold leading-snug" style={{ color: text }}>{analyzing ? 'Reviewing your work' : title}</p>
        <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: muted }}>
          {description} AI feedback can be wrong, so check anything important.
        </p>
      </div>
      {remaining !== null && (
        <span className="flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums" style={{ color: accentColor, background: `${accentColor}18` }}>
          {remaining} review{remaining === 1 ? '' : 's'} left
        </span>
      )}
    </div>
  );
}
