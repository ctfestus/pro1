'use client';

// Public-facing "who designed this" identity for Virtual Experience discovery
// surfaces: the public content page, the student catalog card and the detail
// drawer. The in-experience colleague persona lives in components/ve/workplace.tsx;
// this file exists so a learner sees the real professional BEFORE they enrol.
//
// Callers pass their own palette because these render inside three different theme
// systems: the public page's local `gp` tokens, lib/theme's `C`, and the dark hero
// overlay. Presentational only -- no data loading.

import React from 'react';
import { LinkedInIcon } from '@/components/LinkedInIcon';

export interface GuideSnapshot {
  fullName: string;
  professionalTitle?: string;
  company?: string;
  profilePhotoUrl?: string;
  bio?: string;
  linkedinUrl?: string;
  expertise?: string[];
  sourceType?: 'external' | 'instructor';
  consentStatus?: 'pending' | 'confirmed' | 'not_required';
}

export interface GuideTheme {
  text: string;
  muted: string;
  faint: string;
  surface: string;
  border: string;
  accent: string;
}

/**
 * The guide to show on a public surface, or null.
 *
 * Public identity fails closed: external profiles require confirmed consent and linked
 * instructors require the explicit not_required status written by the server.
 */
export function publicGuide(config: any): GuideSnapshot | null {
  const guide = config?.guideSnapshot;
  if (!guide?.fullName) return null;
  if (guide.consentStatus !== 'confirmed' && guide.consentStatus !== 'not_required') return null;
  return guide as GuideSnapshot;
}

export function guideRole(guide: GuideSnapshot): string {
  return [guide.professionalTitle, guide.company].filter(Boolean).join(', ');
}

function initialsOf(name: string): string {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

export function GuideAvatar({ guide, size = 22, accent, ring }: {
  guide: GuideSnapshot;
  size?: number;
  accent: string;
  ring?: string;
}) {
  // Photos are absolute vendor URLs, so a dead link is a real possibility -- fall back
  // to initials rather than leaving a broken image on a marketing surface.
  const [imgFailed, setImgFailed] = React.useState(false);
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    ...(ring ? { border: `1px solid ${ring}` } : {}),
  };
  if (guide.profilePhotoUrl && !imgFailed) {
    return (
      <img src={guide.profilePhotoUrl} alt="" onError={() => setImgFailed(true)}
        style={{ ...base, objectFit: 'cover', display: 'block' }} />
    );
  }
  return (
    <span style={{
      ...base,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `${accent}1f`, color: accent,
      fontSize: Math.max(9, Math.round(size * 0.38)), fontWeight: 800, letterSpacing: '0.02em',
    }}>
      {initialsOf(guide.fullName)}
    </span>
  );
}

/**
 * One-line credit, for cards and hero rows where space is tight.
 *
 * The label says "manager" rather than anything about authorship: selecting a guide sets
 * them as the manager persona and nothing more, so crediting them with designing the
 * experience would be an overclaim on exactly the axis this block exists to build.
 */
export function GuideByline({ guide, theme, size = 22, label = 'Your manager:', withRole = false, ring }: {
  guide: GuideSnapshot;
  theme: GuideTheme;
  size?: number;
  label?: string;
  withRole?: boolean;
  ring?: string;
}) {
  const role = guideRole(guide);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0, maxWidth: '100%' }}>
      <GuideAvatar guide={guide} size={size} accent={theme.accent} ring={ring} />
      <span style={{ minWidth: 0, lineHeight: 1.3 }}>
        <span style={{ display: 'block', fontSize: 12, color: theme.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label} <strong style={{ color: theme.text, fontWeight: 700 }}>{guide.fullName}</strong>
        </span>
        {withRole && role && (
          <span style={{ display: 'block', fontSize: 11, color: theme.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {role}
          </span>
        )}
      </span>
    </span>
  );
}

/** Full profile block: photo, real title and employer, bio, expertise, LinkedIn. */
export function GuideCard({ guide, theme, heading = 'Your manager', radius = 14 }: {
  guide: GuideSnapshot;
  theme: GuideTheme;
  heading?: string;
  radius?: number;
}) {
  const role = guideRole(guide);
  // guide_snapshot is jsonb, so expertise is only a string[] by convention.
  const tags = (Array.isArray(guide.expertise) ? guide.expertise : []).filter(t => typeof t === 'string' && t.trim()).slice(0, 4);
  return (
    <div style={{ background: theme.surface, borderRadius: radius, padding: '16px 18px', border: `1px solid ${theme.border}` }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: theme.muted, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
        {heading}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <GuideAvatar guide={guide} size={44} accent={theme.accent} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: theme.text, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{guide.fullName}</span>
            {guide.linkedinUrl && (
              <a href={guide.linkedinUrl} target="_blank" rel="noopener noreferrer"
                aria-label={`Open the LinkedIn profile of ${guide.fullName}`} title="View LinkedIn profile"
                style={{ display: 'inline-flex', flexShrink: 0, color: '#0A66C2', textDecoration: 'none' }}>
                <LinkedInIcon style={{ width: 14, height: 14 }} />
              </a>
            )}
          </p>
          {role && <p style={{ margin: '2px 0 0', fontSize: 12, color: theme.muted, lineHeight: 1.35 }}>{role}</p>}
        </div>
      </div>
      {guide.bio && (
        <p style={{ margin: '12px 0 0', fontSize: 12.5, lineHeight: 1.55, color: theme.muted }}>{guide.bio}</p>
      )}
      {tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 12 }}>
          {tags.map(tag => (
            <span key={tag} style={{ padding: '4px 9px', borderRadius: 999, background: `${theme.accent}14`, color: theme.accent, fontSize: 10.5, fontWeight: 700 }}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
