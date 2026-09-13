'use client';

// The paid-plan lock for the upload-based AI reviewers.
//
// The workspace stays on screen rather than being replaced, so a learner can see what the upgrade
// actually buys them instead of a bare wall. It is dimmed and made `inert`, which takes it out of
// both pointer and keyboard reach as well as the accessibility tree -- opacity alone would leave a
// dropzone that still answers a Tab key.

import type { ReactNode } from 'react';
import AiReviewUpgradePrompt from '@/components/AiReviewUpgradePrompt';

interface Props {
  locked: boolean;
  accentColor: string;
  isDark: boolean;
  planName?: string | null;
  message?: string;
  upgradeUrl?: string;
  children: ReactNode;
}

export default function AiReviewLockOverlay({
  locked, accentColor, isDark, planName, message, upgradeUrl, children,
}: Props) {
  if (!locked) return <>{children}</>;

  return (
    <div className="relative">
      {/* Dimmed, drained of colour, and softly blurred. Dimming alone left the workspace's own
          labels legible straight through the lock message -- "or click to browse" landing under
          the upgrade button read as broken layout rather than as something behind glass. The blur
          is light enough that the shape of the upload area still says "upload area". */}
      <div
        inert
        className="select-none"
        style={{ opacity: isDark ? 0.3 : 0.38, filter: 'grayscale(1) blur(2.5px)' }}
      >
        {children}
      </div>
      <div className="absolute inset-0 grid place-items-center p-3">
        <AiReviewUpgradePrompt
          accentColor={accentColor}
          isDark={isDark}
          planName={planName}
          message={message}
          upgradeUrl={upgradeUrl}
        />
      </div>
    </div>
  );
}
