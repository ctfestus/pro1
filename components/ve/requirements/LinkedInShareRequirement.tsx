'use client';

import { Check, CheckCircle, CircleNotch, Eye, LinkSimple, Warning } from '@phosphor-icons/react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { XpBadgeStack } from '@/components/XpBadge';
import { clampLinkedInSharePoints } from '@/lib/course-schema';
import { REQ_META, type RequirementProps } from './types';
import { TaskHeader, TaskButton, taskTheme, fieldStyle, TASK_FIELD, TASK_SHELL } from './TaskCard';

/** LinkedIn share: suggested post, link claim and the profile check. */
export function LinkedInShareRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, reviewMode, progress, shareDrafts,
    setShareDrafts, shareSaving, shareErrors, setShareErrors, shareCopied, setShareCopied,
    submitShareLink, needsProfile, profileDraft, setProfileDraft, profileSaving, profileError,
    setProfileError, saveProfileAndRetry,
  } = ctx;
  const done           = !!progress[req.id]?.completed;
  const t = taskTheme(isDark, accentColor);

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
      <TaskHeader t={t} icon={<LinkedInIcon className="w-3.5 h-3.5" />}
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
              style={{ color: t.accent }}>
              <Check weight="bold" className="w-4 h-4 flex-shrink-0" />
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
          <Eye weight="duotone" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: accentColor }} />
          <p className="text-[12px] leading-snug" style={{ color: isDark ? '#aaa' : '#555' }}>
            Real work, shared publicly. This is the part hiring managers actually see.
          </p>
        </div>
      )}

      {req.sharePrompt && (
        <div className="rounded-[10px] p-3.5" style={{ background: t.soft }}>
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: t.faint }}>Suggested post</p>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(req.sharePrompt || '').then(() => {
                  setShareCopied(req.id);
                  setTimeout(() => setShareCopied(null), 1800);
                }).catch(() => {});
              }}
              className="min-w-[64px] px-2.5 py-1.5 rounded-lg text-[12px] font-bold transition-opacity hover:opacity-80"
              style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff', color: t.text }}
            >
              {shareCopied === req.id ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap" style={{ color: t.text }}>{req.sharePrompt}</p>
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
          <div className={`${TASK_SHELL} flex flex-1 min-w-0 items-center gap-2 rounded-[10px] px-3`} style={fieldStyle(t, error ? 'bad' : claimed ? 'done' : 'normal')}>
            <LinkSimple weight="bold" className="w-3.5 h-3.5 flex-shrink-0" style={{ color: t.faint }} />
            <input
              type="url" inputMode="url" value={draft} readOnly={reviewMode}
              onChange={e => {
                setShareDrafts(prev => ({ ...prev, [req.id]: e.target.value }));
                if (shareErrors[req.id]) setShareErrors(prev => { const n = { ...prev }; delete n[req.id]; return n; });
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitShareLink(req.id); } }}
              placeholder="https://www.linkedin.com/posts/..." aria-label="Link to your post"
              className="flex-1 min-w-0 bg-transparent py-2.5 text-[13.5px] outline-none" style={{ color: t.text }}
            />
          </div>
          {!reviewMode && (
            <TaskButton t={t} onClick={() => submitShareLink(req.id)} disabled={saving || !draft.trim() || draft.trim() === claimed}>
              {saving ? <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" /> : claimed ? 'Update' : 'Submit'}
            </TaskButton>
          )}
        </div>
        {/* Asked for once, when there is no profile to check the post's author
            against. Saving it retries the claim straight away. */}
        {needsProfile === req.id && (
          <div className="rounded-[10px] p-3 space-y-2" style={{ background: t.soft }}>
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
                aria-label="Your LinkedIn profile"
                className={`${TASK_FIELD} flex-1 min-w-0 px-3 py-2.5 text-[13.5px]`}
                style={{ ...fieldStyle(t, profileError ? 'bad' : 'normal'), background: isDark ? 'rgba(255,255,255,0.08)' : '#ffffff' }}
              />
              <TaskButton t={t} onClick={() => saveProfileAndRetry(req.id)} disabled={profileSaving || !profileDraft.trim()}>
                {profileSaving ? <CircleNotch weight="bold" className="w-3.5 h-3.5 animate-spin" /> : 'Save and submit'}
              </TaskButton>
            </div>
            {profileError && (
              <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: t.bad }}>
                <Warning weight="duotone" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {profileError}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="text-[12px] font-medium flex items-start gap-1.5" style={{ color: t.bad }}>
            <Warning weight="duotone" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
          </p>
        )}
        {!error && claimed && (
          <a href={claimed} target="_blank" rel="noreferrer"
            className="text-[12px] font-semibold flex items-center gap-1.5 hover:underline" style={{ color: t.accent }}>
            <CheckCircle weight="fill" className="w-3.5 h-3.5 flex-shrink-0" /> Verified. View your post
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
