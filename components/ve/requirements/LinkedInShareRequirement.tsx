'use client';

import { CheckCircle2, Loader2, AlertTriangle, Eye, Check, Link as LinkIcon } from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { XpBadgeStack } from '@/components/XpBadge';
import { clampLinkedInSharePoints } from '@/lib/course-schema';
import { REQ_META, type RequirementProps } from './types';
import { TaskHeader, taskTheme } from './TaskCard';

/** LinkedIn share: suggested post, link claim and the profile check. */
export function LinkedInShareRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, fieldBg, fieldBorder, fieldShadow, reviewMode, progress, shareDrafts,
    setShareDrafts, shareSaving, shareErrors, setShareErrors, shareCopied, setShareCopied,
    submitShareLink, needsProfile, profileDraft, setProfileDraft, profileSaving, profileError,
    setProfileError, saveProfileAndRetry,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  // Clamped with the server's own helper rather than rendered raw: an imported,
  // synced or hand-edited VE can carry any number, and advertising 999,999 XP for a
  // claim that will award 200 is a promise the server does not keep.
  const bonus   = clampLinkedInSharePoints(req.sharePoints);
  const claimed = progress[req.id]?.linkUrl || '';
  const draft   = shareDrafts[req.id] ?? claimed;
  const saving  = shareSaving === req.id;
  const error   = shareErrors[req.id];
  const meta    = REQ_META.linkedin_share;
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <TaskHeader t={taskTheme(isDark, accentColor)} icon={<LinkedInIcon className="w-3.5 h-3.5" />}
        label={req.shareRequired !== true ? 'LinkedIn - optional' : 'LinkedIn'} title={req.label}
        description={req.description} done={done ? 'Verified' : null} />

      {/* Three states, and the claimed one deliberately names NO amount.
          What a claim actually paid is the snapshot on linkedin_shares.points,
          frozen when it was made; `bonus` is the CURRENT offer. Once an
          instructor edits the bonus the two diverge, so rendering `bonus` here
          would tell a student who earned 50 that they earned 100 -- and, when
          the offer is set to 0, erase the banner of somebody who really did
          earn XP. The player has no access to the snapshot, so it states the
          fact it can stand behind and leaves the number to the XP total. */}
      {claimed ? (
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
          style={{ background: 'rgba(16,185,129,0.10)' }}>
          <XpBadgeStack size={60} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight flex items-center gap-1.5"
              style={{ color: '#10b981' }}>
              <Check className="w-4 h-4 flex-shrink-0" strokeWidth={3} />
              LinkedIn share verified
            </p>
            <p className="text-[12px] leading-snug mt-0.5" style={{ color: isDark ? '#aaa' : '#555' }}>
              Your work is out in front of your network. That is how opportunities find you.
            </p>
          </div>
        </div>
      ) : bonus > 0 ? (
        <div className="flex items-center gap-3 rounded-xl px-3.5 py-3"
          style={{ background: `${accentColor}12` }}>
          <XpBadgeStack size={60} className="flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight" style={{ color: accentColor }}>
              {`${bonus.toLocaleString()} XP up for grabs`}
            </p>
            <p className="text-[12px] leading-snug mt-0.5" style={{ color: isDark ? '#aaa' : '#555' }}>
              Post about what you built, then paste the link below to claim it.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5"
          style={{ background: `${accentColor}10` }}>
          <Eye className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
          <p className="text-[12px] leading-snug" style={{ color: isDark ? '#aaa' : '#555' }}>
            Real work, shared publicly. This is the part hiring managers actually see.
          </p>
        </div>
      )}

      {req.sharePrompt && (
        <div className="rounded-lg p-3.5" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F8F8F8', border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: isDark ? '#666' : '#aaa' }}>Suggested post</p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(req.sharePrompt || '').then(() => {
                  setShareCopied(req.id);
                  setTimeout(() => setShareCopied(null), 1800);
                }).catch(() => {});
              }}
              className="px-2.5 py-1.5 rounded-md text-[11.5px] font-semibold transition-all active:scale-[0.97]"
              style={{ background: isDark ? 'rgba(255,255,255,0.07)' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.09)'}`, color: isDark ? '#ddd' : '#333' }}
            >
              {shareCopied === req.id ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: isDark ? '#aaa' : '#555' }}>{req.sharePrompt}</p>
        </div>
      )}

      <a
        href="https://www.linkedin.com/feed/?shareActive=true"
        target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center justify-center gap-2.5 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] hover:opacity-90"
        style={{ background: '#0A66C2', color: '#fff' }}
      >
        <LinkedInIcon className="w-4 h-4" /> Write my post
      </a>

      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium" style={{ color: isDark ? '#888' : '#666' }}>Paste the link to your post</p>
        <div className="flex flex-col sm:flex-row gap-2">
          {/* The input carries the border and radius itself, rather than sitting bare
              inside a bordered wrapper: the global focus ring in globals.css is an
              outline on the INPUT, and an outline follows that element's own radius --
              so a bare field would ring as a sharp rectangle inside the rounded box. */}
          <div className="flex-1 min-w-0 relative">
            <LinkIcon className="w-3 h-3 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: isDark ? '#8a8a8a' : '#64748b' }} />
            <input
              type="url" inputMode="url" value={draft} readOnly={reviewMode}
              onChange={e => {
                setShareDrafts(prev => ({ ...prev, [req.id]: e.target.value }));
                if (shareErrors[req.id]) setShareErrors(prev => { const n = { ...prev }; delete n[req.id]; return n; });
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitShareLink(req.id); } }}
              placeholder="https://www.linkedin.com/posts/..."
              className="w-full min-w-0 pl-8 pr-3 py-2.5 rounded-lg text-[12.5px] outline-none"
              style={{
                background: isDark ? 'rgba(255,255,255,0.055)' : '#ffffff',
                border: `1.5px solid ${error ? '#f43f5e' : claimed ? `${accentColor}80` : isDark ? 'rgba(255,255,255,0.16)' : '#cbd5e1'}`,
                boxShadow: isDark ? 'none' : '0 1px 2px rgba(15,23,42,0.04)',
                color: isDark ? '#f0f0f0' : '#111',
              }}
            />
          </div>
          {!reviewMode && (
            <button
              type="button"
              onClick={() => submitShareLink(req.id)}
              disabled={saving || !draft.trim() || draft.trim() === claimed}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
              style={{ background: accentColor, color: '#fff' }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : claimed ? 'Update' : 'Submit'}
            </button>
          )}
        </div>
        {/* Asked for once, when there is no profile to check the post's author
            against. Saving it retries the claim straight away. */}
        {needsProfile === req.id && (
          <div className="rounded-lg p-3 space-y-2" style={{ background: isDark ? 'rgba(255,255,255,0.04)' : '#F8F8F8' }}>
            <p className="text-[12.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>
              First, add your LinkedIn profile
            </p>
            <p className="text-[11.5px] leading-relaxed" style={{ color: isDark ? '#888' : '#666' }}>
              We check that the post you paste was written by you, so we need to know which profile is yours. This is saved to your profile once.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url" inputMode="url" value={profileDraft}
                onChange={e => { setProfileDraft(e.target.value); if (profileError) setProfileError(''); }}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); saveProfileAndRetry(req.id); } }}
                placeholder="linkedin.com/in/your-name"
                className="flex-1 min-w-0 px-3 py-2.5 rounded-lg text-[12.5px] outline-none"
                style={{
                  background: fieldBg,
                  border: `1.5px solid ${profileError ? '#f43f5e' : fieldBorder}`,
                  boxShadow: fieldShadow,
                  color: isDark ? '#f0f0f0' : '#111',
                }}
              />
              <button
                type="button"
                onClick={() => saveProfileAndRetry(req.id)}
                disabled={profileSaving || !profileDraft.trim()}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-[12.5px] font-semibold transition-all active:scale-[0.98] disabled:opacity-45"
                style={{ background: accentColor, color: '#fff' }}
              >
                {profileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save and submit'}
              </button>
            </div>
            {profileError && (
              <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {profileError}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: '#f43f5e' }}>
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
          </p>
        )}
        {!error && claimed && (
          <a href={claimed} target="_blank" rel="noreferrer"
            className="text-[12px] font-semibold flex items-center gap-1.5 hover:underline" style={{ color: '#10b981' }}>
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> Verified. View your post
          </a>
        )}
        {!error && !claimed && (
          <p className="text-[11.5px] leading-relaxed" style={{ color: isDark ? '#666' : '#999' }}>
            Open your post on LinkedIn, copy its full address, and paste it here. Shortened
            lnkd.in links cannot be checked.
          </p>
        )}
      </div>
    </div>
  );
}
