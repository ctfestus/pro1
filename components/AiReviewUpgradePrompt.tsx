'use client';

import { ArrowUpRight, Clock, LockKeyhole } from 'lucide-react';
import { AI_REVIEW_UPGRADE_URL } from '@/lib/ai-review-upgrade';

interface Props {
  accentColor: string;
  isDark: boolean;
  /** The plan the tenant recommends. Null when nobody has marked one -- the button stays generic. */
  planName?: string | null;
  title?: string;
  message?: string;
  upgradeUrl?: string;
  /** The cheapest way onto the plan, already worded. Omitted entirely when unknown. */
  priceLabel?: string | null;
}

/** "about 7 hours" / "about 40 minutes" -- vague on purpose, since the exact second is noise. */
export function aiReviewResetWording(seconds: number | null): string {
  if (!seconds || seconds <= 0) return 'It resets within a day of your last review.';
  if (seconds < 3600) {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return `It resets in about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;
  }
  const hours = Math.max(1, Math.round(seconds / 3600));
  return `It resets in about ${hours} ${hours === 1 ? 'hour' : 'hours'}.`;
}

/**
 * Today's free review is already spent.
 *
 * Shown BEFORE a learner writes, and said by the platform rather than by a course character.
 * A manager in a virtual experience explaining someone's billing plan breaks the fiction and
 * reads as a bug, so this notice is deliberately plain and outside the mail thread.
 */
export function AiReviewDailyLimitNotice({
  accentColor,
  isDark,
  resetsInSeconds = null,
  upgradeUrl = AI_REVIEW_UPGRADE_URL,
  priceLabel = null,
}: {
  accentColor: string;
  isDark: boolean;
  resetsInSeconds?: number | null;
  upgradeUrl?: string;
  priceLabel?: string | null;
}) {
  const muted = isDark ? '#cbd5e1' : '#64748b';
  return (
    <div
      className="flex items-start gap-2 rounded-xl p-3"
      style={{ background: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)' }}
    >
      <Clock className="mt-0.5 h-4 w-4 flex-shrink-0" style={{ color: muted }} />
      <div className="min-w-0">
        <p className="text-[13px] font-bold" style={{ color: muted }}>Your AI review for today is used</p>
        <p className="mt-0.5 text-[13px] leading-relaxed" style={{ color: isDark ? '#ccc' : '#444' }}>
          Your free plan includes one AI review a day. {aiReviewResetWording(resetsInSeconds)}
        </p>
        <AiReviewUpgradeNote accentColor={accentColor} upgradeUrl={upgradeUrl} priceLabel={priceLabel} />
      </div>
    </div>
  );
}

/**
 * The daily-limit upsell, as one line rather than a card.
 *
 * Used where the learner still has access and has simply spent today's review: inside a lesson
 * knowledge check, or a step in a virtual experience. A full card there would drop a block into
 * the middle of something they are reading.
 *
 * It says "Upgrade", not "Upgrade for more AI reviews". A plan is mainly the courses, paths,
 * experiences and certifications it unlocks; the reviewers come with it. Naming reviews as the
 * reason to pay sells a subscription as an add-on and understates it.
 */
export function AiReviewUpgradeNote({
  accentColor,
  upgradeUrl = AI_REVIEW_UPGRADE_URL,
  priceLabel = null,
}: {
  accentColor: string;
  upgradeUrl?: string;
  priceLabel?: string | null;
}) {
  return (
    <a
      href={upgradeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
      style={{ color: accentColor }}
    >
      {priceLabel ? `Upgrade for ${priceLabel}` : 'Upgrade'} <ArrowUpRight className="h-3 w-3" />
    </a>
  );
}

export default function AiReviewUpgradePrompt({
  accentColor,
  isDark,
  planName,
  title = 'This AI reviewer is locked',
  message = 'Reviews of uploaded work are part of a paid plan. Upgrade to submit your file and get feedback.',
  upgradeUrl = AI_REVIEW_UPGRADE_URL,
  priceLabel = null,
}: Props) {
  const text = isDark ? '#f8fafc' : '#111827';
  const muted = isDark ? '#a1a1aa' : '#667085';
  // The price belongs on the button itself: a figure sitting under it reads as small print, and
  // a learner deciding whether to click should not have to look elsewhere for the cost. The plan
  // name gives way to the price when there is one -- the pricing page names the plan on arrival,
  // and a button carrying both is too long to survive a phone.
  const label = priceLabel
    ? `Upgrade for ${priceLabel}`
    : planName ? `Upgrade to ${planName}` : 'Upgrade';

  // No panel, no surface, no shadow. The lock sits directly on the dimmed workspace, so what is
  // being unlocked stays visible behind it rather than being covered by a card.
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 px-5 py-6 text-center">
      <LockKeyhole className="h-6 w-6" style={{ color: muted }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: text }}>{title}</p>
        <p className="mt-1.5 text-xs leading-relaxed" style={{ color: muted }}>{message}</p>
      </div>

      <a
        href={upgradeUrl}
        target="_blank"
        rel="noopener noreferrer"
        // A new tab so the course keeps their place, and whatever they have already typed or
        // selected in this activity survives the trip to the pricing page.
        className="mt-1 inline-flex min-h-11 max-w-full items-center justify-center gap-2 text-balance rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
        style={{ background: accentColor, color: '#ffffff' }}
      >
        {label} <ArrowUpRight className="h-4 w-4" />
      </a>
    </div>
  );
}
