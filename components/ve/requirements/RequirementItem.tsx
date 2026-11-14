'use client';

import type React from 'react';
import type { Requirement, VeRequirementContext } from './types';
import { BriefingRequirement } from './BriefingRequirement';
import { DecisionRequirement } from './DecisionRequirement';
import { DebriefRequirement } from './DebriefRequirement';
import { EmailFramedRequirement } from './EmailFramedRequirement';
import { McqRequirement } from './McqRequirement';
import { LinkedInShareRequirement } from './LinkedInShareRequirement';
import { UploadRequirement } from './UploadRequirement';
import { AiReviewRequirement } from './AiReviewRequirement';
import { TextRequirement } from './TextRequirement';
import { TaskRequirement } from './TaskRequirement';

const AI_REVIEW_TYPES: Requirement['type'][] = ['dashboard_critique', 'code_review', 'excel_review', 'document_review'];

/**
 * The email-framed renderer covers these types. Any other type with emailFrame set (a LinkedIn
 * share, an mcq without options) falls through to its plain card, as it always has.
 */
function emailFrameHandles(req: Requirement, isMcq: boolean): boolean {
  return isMcq || ['text', 'reflection', 'upload', 'task', 'deliverable', ...AI_REVIEW_TYPES].includes(req.type);
}

/** One requirement of the current mission, rendered on the surface its type uses. */
export function RequirementItem({ req, qi, ctx }: { req: Requirement; qi: number; ctx: VeRequirementContext }) {
  const { isDark, accentColor, progress } = ctx;
  const done  = !!progress[req.id]?.completed;
  const isMcq = !!(req.type === 'mcq' && req.options?.length);

  const workplaceSurface = req.emailFrame || ['briefing', 'scenario_update', 'decision', 'debrief'].includes(req.type);
  const classicActionSurface = ['task', 'deliverable', 'linkedin_share'].includes(req.type);
  const rowStyle: React.CSSProperties = workplaceSurface ? {
    background: 'transparent',
  } : classicActionSurface ? {
    borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`,
    borderLeft: done ? `3px solid ${accentColor}` : `3px solid ${accentColor}30`,
    background: done ? (isDark ? `${accentColor}08` : `${accentColor}05`) : 'transparent',
    transition: 'background 0.2s, border-left-color 0.2s',
  } : {
    margin: '10px clamp(12px, 3vw, 24px) 16px',
    borderRadius: 16,
    background: done
      ? (isDark ? `${accentColor}0d` : `${accentColor}08`)
      : (isDark ? 'rgba(255,255,255,0.035)' : '#f7f8f7'),
    boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.055)' : '0 0 0 1px rgba(15,23,42,0.055)',
    overflow: 'hidden',
    transition: 'background 0.2s, box-shadow 0.2s',
  };

  const props = { req, qi, rowStyle, ctx };
  if (req.type === 'briefing' || req.type === 'scenario_update') return <BriefingRequirement {...props} />;
  if (req.type === 'decision') return <DecisionRequirement {...props} />;
  if (req.type === 'debrief') return <DebriefRequirement {...props} />;
  if (req.emailFrame && emailFrameHandles(req, isMcq)) return <EmailFramedRequirement {...props} />;
  if (isMcq) return <McqRequirement {...props} />;
  if (req.type === 'linkedin_share') return <LinkedInShareRequirement {...props} />;
  if (req.type === 'upload') return <UploadRequirement {...props} />;
  if (AI_REVIEW_TYPES.includes(req.type)) return <AiReviewRequirement {...props} />;
  if (req.type === 'text') return <TextRequirement {...props} />;
  return <TaskRequirement {...props} />;
}
