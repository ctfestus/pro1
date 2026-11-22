'use client';

// Progress pages: Badges, Leaderboard and Certificates. Each opens with stat cards where it
// helps, then its content in white cards (badges and certificates as grids, the ranking as one
// list). Icons are Phosphor, as the menu.

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { Sk, EmptyState } from '@/components/student/shared';
import { isIndividualCohort } from '@/lib/cohort-kind';
import { FRAMED_CARD } from '@/components/CardMeta';
import { DISPLAY_FONT, btnClass, btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { DepthBar, LearningCardsSkeleton } from '@/components/student/learning-card';
import {
  ArrowClockwise, BookOpen, Certificate, ChartBar, DownloadSimple, Fire, LinkedinLogo, LockSimple, Medal, Trophy, UsersThree,
} from '@phosphor-icons/react';
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';

const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)]';

/** A stat card: the figure, what it is, and one line under it. */
function Stat({ value, label, sub, C }: { value: React.ReactNode; label: string; sub?: string; C: typeof LIGHT_C }) {
  return (
    <div className={`min-w-0 rounded-2xl px-4 py-3.5 ${CARD_SHADOW}`} style={{ background: C.card }}>
      <div className="truncate text-[22px] font-semibold leading-8 sm:text-[26px]" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{value}</div>
      <p className="mt-1 text-[13px] font-semibold" style={{ color: C.text }}>{label}</p>
      {sub && <p className="mt-0.5 truncate text-xs" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

/** A stat card while loading: the same white card with placeholder lines. */
function StatSkeleton({ C }: { C: typeof LIGHT_C }) {
  return (
    <div className={`space-y-2 rounded-2xl px-4 py-3.5 ${CARD_SHADOW}`} style={{ background: C.card }}>
      <Sk w={80} h={26}/><Sk w={100} h={12}/><Sk w={130} h={10}/>
    </div>
  );
}

/** A white card with a heading row (title on the left, something on the right) over its content. */
function Panel({ title, aside, children, C }: { title: string; aside?: React.ReactNode; children: React.ReactNode; C: typeof LIGHT_C }) {
  return (
    <section className={`overflow-hidden rounded-2xl ${CARD_SHADOW}`} style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
        <h3 className="min-w-0 truncate text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Add to LinkedIn as a quiet button with the LinkedIn mark. */
function LinkedInButton({ href, C, small }: { href: string; C: typeof LIGHT_C; small?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={small ? btnSmClass : btnClass} style={btnStyle('sec', C)}>
      <LinkedinLogo size={small ? 14 : 16} weight="fill" style={{ color: '#0A66C2' }}/> Add to LinkedIn
    </a>
  );
}

const BADGE_TABS = [
  { id: 'achievement',        label: 'Achievements'        },
  { id: 'course',             label: 'Courses'             },
  { id: 'learning_path',      label: 'Learning paths'      },
  { id: 'virtual_experience', label: 'Virtual experiences' },
  { id: 'certification',      label: 'Certifications'      },
] as const;

/** One badge: its art (or a lock), name, how it is earned, and for earned ones LinkedIn and Download. */
function BadgeTile({ b, earned, linkedIn, onDownload, C }: {
  b: any; earned: boolean; linkedIn: string | null; onDownload: (b: any) => void; C: typeof LIGHT_C;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[14px] px-3 py-4 text-center" style={{ background: `color-mix(in srgb, ${C.pill} 55%, ${C.card})` }}>
      <div className="grid h-16 w-16 place-items-center">
        {earned && b.image_url
          ? <img src={b.image_url} alt="" loading="lazy" className="h-16 w-16 object-contain"/>
          : earned
            ? <span className="text-[40px] leading-none">{b.icon}</span>
            : <span className="grid h-16 w-16 place-items-center rounded-full" style={{ background: C.pill, color: C.faint }}><LockSimple size={24} weight="duotone"/></span>}
      </div>
      <p className="text-sm font-semibold leading-tight" style={{ color: earned ? C.text : C.muted }}>{b.name}</p>
      {b.description && <p className="text-xs" style={{ color: C.muted }}>{b.description}</p>}
      {earned && (linkedIn || b.image_url) && (
        <div className="mt-1.5 flex flex-wrap justify-center gap-1.5">
          {linkedIn && <LinkedInButton href={linkedIn} C={C} small/>}
          {b.image_url && (
            <button type="button" onClick={() => onDownload(b)} aria-label={`Download ${b.name} badge`} title="Download badge"
              className={`${btnSmClass} w-8 px-0`} style={btnStyle('sec', C)}>
              <DownloadSimple size={14} weight="bold"/>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function StudentBadgesSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const { appName, appUrl } = useTenant();
  const [allBadges, setAllBadges]   = useState<{ id: string; name: string; description: string; icon: string; color: string; image_url: string | null; category: string }[]>([]);
  const [earnedIds, setEarnedIds]   = useState<Set<string>>(new Set());
  const [streak, setStreak]         = useState<{ current_streak: number; longest_streak: number } | null>(null);
  const [certIdMap, setCertIdMap]     = useState<Record<string, string>>({});
  const [badgeUuidMap, setBadgeUuidMap] = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(true);

  useEffect(() => {
    (async () => {
      const [badgesRes, earnedRes, streakRes, certsRes] = await Promise.all([
        supabase.from('badges').select('id, name, description, icon, color, image_url, category').order('id'),
        supabase.from('student_badges').select('id, badge_id').eq('student_id', userId),
        supabase.from('student_streaks').select('current_streak, longest_streak').eq('student_id', userId).maybeSingle(),
        supabase.from('certificates').select('id, course_id, ve_id, learning_path_id, certification_id').eq('student_id', userId).eq('revoked', false),
      ]);
      setAllBadges(badgesRes.data ?? []);
      const earnedRows = earnedRes.data ?? [];
      setEarnedIds(new Set(earnedRows.map((b: any) => b.badge_id)));
      setBadgeUuidMap(Object.fromEntries(earnedRows.map((b: any) => [b.badge_id, b.id])));
      const s = streakRes.data;
      setStreak(s ? { current_streak: s.current_streak, longest_streak: s.longest_streak } : null);

      // Build badge_id -> cert_id map
      const map: Record<string, string> = {};
      for (const cert of (certsRes.data ?? [])) {
        if (cert.course_id)        map[`crs_${cert.course_id}`]                   = cert.id;
        if (cert.ve_id)            map[`ve_${cert.ve_id}`]                        = cert.id;
        if (cert.learning_path_id) map[`lp_${cert.learning_path_id}`]            = cert.id;
        if (cert.certification_id) map[`cert_${cert.certification_id}`]          = cert.id;
      }
      setCertIdMap(map);
      setLoading(false);
    })();
  }, [userId]);

  const handleDownload = async (b: typeof allBadges[0]) => {
    const safeName = `${(b.name ?? b.id).replace(/[^a-zA-Z0-9\s-]/g, '').trim().replace(/\s+/g, '-')}-badge`;
    const ext = b.image_url?.split('.').pop()?.split('?')[0] ?? 'png';
    const filename = `${safeName}.${ext}`;
    try {
      const res = await fetch(b.image_url!);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      const a = document.createElement('a');
      a.href = b.image_url!; a.download = filename;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }
  };

  // The LinkedIn link for an earned badge: its certificate page when it has one, else its badge page.
  const linkedInFor = (b: any) => {
    const certPageId = certIdMap[b.id];
    const badgeUuid  = badgeUuidMap[b.id];
    const shareUrl   = certPageId ? `${appUrl}/certificate/${certPageId}` : badgeUuid ? `${appUrl}/b/${badgeUuid}` : null;
    if (!shareUrl) return null;
    return linkedInAddCertUrl({ name: b.name, organizationName: appName ?? undefined, certId: certPageId ?? badgeUuid ?? b.id, certUrl: shareUrl })
      || `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`;
  };

  if (loading) return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:max-w-[66%]">{[0, 1].map(i => <StatSkeleton key={i} C={C}/>)}</div>
      {[0, 1].map(i => (
        <div key={i} className={`rounded-2xl ${CARD_SHADOW}`} style={{ background: C.card }}>
          <div className="px-5 py-4"><Sk w={140} h={16}/></div>
          <div className="grid grid-cols-2 gap-3 px-5 pb-5 lg:grid-cols-4">{[0, 1, 2, 3].map(j => <Sk key={j} h={150} r={14}/>)}</div>
        </div>
      ))}
    </div>
  );

  const earnedCount = allBadges.filter(b => earnedIds.has(b.id)).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:max-w-[66%]">
        <Stat C={C} label="Current streak" sub={streak ? `Best: ${streak.longest_streak} day${streak.longest_streak === 1 ? '' : 's'}` : 'Learn today to start one'}
          value={<span className="inline-flex items-center gap-2">{streak?.current_streak ?? 0} day{streak?.current_streak === 1 ? '' : 's'}<Fire size={24} weight="duotone" style={{ color: '#F59E0B' }}/></span>}/>
        <Stat C={C} label="Badges earned" value={`${earnedCount} of ${allBadges.length}`}
          sub={allBadges.length - earnedCount > 0 ? `${allBadges.length - earnedCount} still to earn` : allBadges.length ? 'All earned' : undefined}/>
      </div>

      {allBadges.length === 0 ? (
        <div className={`rounded-2xl ${CARD_SHADOW}`} style={{ background: C.card }}>
          <EmptyState icon={Medal} title="No badges yet" body="Check back when new badges are added."/>
        </div>
      ) : (
        BADGE_TABS.map(t => {
          const list = allBadges.filter(b => (b.category ?? 'achievement') === t.id);
          if (!list.length) return null;
          const got = list.filter(b => earnedIds.has(b.id)).length;
          return (
            <Panel key={t.id} title={t.label} C={C} aside={<span className="text-xs" style={{ color: C.muted }}>{got} of {list.length}</span>}>
              <div className="grid grid-cols-2 gap-3 px-5 pb-5 pt-4 lg:grid-cols-4">
                {list.map(b => (
                  <BadgeTile key={b.id} b={b} earned={earnedIds.has(b.id)} linkedIn={earnedIds.has(b.id) ? linkedInFor(b) : null} onDownload={handleDownload} C={C}/>
                ))}
              </div>
            </Panel>
          );
        })
      )}
    </div>
  );
}

// --- Leaderboard section ---
export function LeaderboardSection({ userId: userIdProp, userEmail, C }: { userId?: string; userEmail: string; C: typeof LIGHT_C }) {
  const [cohort, setCohort]     = useState<any>(null);
  const [rankings, setRankings] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setLoadFailed(false);
      try {
        // Get current student's cohort -- query by auth user ID (reliable; email can mismatch)
        const { data: { session } } = await supabase.auth.getSession();
        const userId = userIdProp ?? session?.user?.id;
        if (!userId) { setLoading(false); return; }

        const { data: me } = await supabase
          .from('students')
          .select('cohort_id')
          .eq('id', userId)
          .single();

        if (!me?.cohort_id) { setLoading(false); return; }

        // Fetch cohort name separately -- join can silently return null if RLS blocks it
        const { data: cohortData } = await supabase
          .from('cohorts')
          .select('id, name, cohort_kind')
          .eq('id', me.cohort_id)
          .single();
        // A synthetic individual-enrollment cohort (migration 165) has no real peer
        // group to rank against.
        if (isIndividualCohort(cohortData?.cohort_kind)) { setLoading(false); return; }
        setCohort(cohortData ?? { id: me.cohort_id, name: 'Your Cohort' });

        // Fetch leaderboard via server API (service role bypasses RLS for cross-student reads)
        const res = await fetch(`/api/leaderboard?cohort_id=${me.cohort_id}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        if (!res.ok) throw new Error('Failed to load leaderboard');
        const { rankings: ranked } = await res.json();
        setRankings(ranked ?? []);
      } catch (err) {
        console.error('[LeaderboardSection]', err);
        // Shown as an error with a retry, not as "No rankings yet".
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userIdProp, userEmail, refreshKey]);

  const myEntry = rankings.find(r => r.isMe);
  const myRank  = myEntry?.rank ?? null;
  const myXP    = myEntry?.xp ?? 0;
  const maxXP   = rankings[0]?.xp ?? 1;
  // How far to the place above, and to first: the one line under each stat.
  const above   = myRank && myRank > 1 ? rankings.find(r => r.rank === myRank - 1) : null;

  if (loading) return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1, 2].map(i => <StatSkeleton key={i} C={C}/>)}</div>
      <div className={`overflow-hidden rounded-2xl ${CARD_SHADOW}`} style={{ background: C.card }}>
        <div className="px-5 py-4"><Sk w={220} h={16}/></div>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center gap-3.5 px-5 py-3" style={{ borderTop: `1px solid ${C.divider}` }}>
            <Sk w={30} h={30} r={99}/>
            <div className="flex-1 space-y-2"><Sk h={13} w="35%"/><Sk h={8} r={99}/></div>
            <Sk w={56} h={14}/>
          </div>
        ))}
      </div>
    </div>
  );

  if (loadFailed) return (
    <EmptyState icon={ArrowClockwise} title="Could not load the leaderboard" body="Check your connection and try again."
      action={<button type="button" onClick={() => setRefreshKey(k => k + 1)} className={btnClass}
        style={{ background: DARK_C.cta, color: '#ffffff' }}>Try again</button>} />
  );

  if (!cohort) return (
    <EmptyState icon={UsersThree} title="No cohort assigned"
      body="You have not been assigned to a cohort yet. Contact your instructor."/>
  );

  if (!rankings.length) return (
    <EmptyState icon={Trophy} title="No rankings yet"
      body="Rankings will appear once students in your cohort start earning XP."/>
  );

  // Gold, silver and bronze for the top three; the titles they carry.
  const MEDAL: Record<number, { bg: string; ink: string; title: string }> = {
    1: { bg: '#F5D77A', ink: '#3d2e00', title: 'Trailblazer' },
    2: { bg: '#E3E6EB', ink: '#374151', title: 'Innovator' },
    3: { bg: '#EBC9A4', ink: '#5b3412', title: 'Pioneer' },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat C={C} label="Your XP" value={myXP.toLocaleString()}
          sub={myRank === 1 ? 'You are in first place' : myEntry ? `${(maxXP - myXP).toLocaleString()} XP behind first place` : undefined}/>
        <Stat C={C} label="Your rank" value={myRank ? `#${myRank}` : 'None yet'}
          sub={above ? `${(above.xp - myXP).toLocaleString()} XP to reach #${above.rank}` : undefined}/>
        <Stat C={C} label="In your cohort" value={rankings.length} sub={cohort.name}/>
      </div>

      <Panel title={cohort.name} C={C} aside={
        <button type="button" onClick={() => setRefreshKey(k => k + 1)} disabled={loading} className={btnSmClass} style={btnStyle('sec', C)}>
          <ArrowClockwise size={14} weight="bold" className={loading ? 'animate-spin' : ''}/> Refresh
        </button>
      }>
        {rankings.map((r, idx) => {
          const isMe = r.isMe === true;
          const pct = maxXP > 0 ? Math.max((r.xp / maxXP) * 100, r.xp > 0 ? 2 : 0) : 0;
          const medal = MEDAL[r.rank];
          return (
            // Your row: tinted blue with a blue edge, a solid blue rank and a dark You label.
            <div key={r.id ?? r.rank} className="flex items-center gap-3.5 px-5 py-3"
              style={{
                borderTop: idx ? `1px solid ${C.divider}` : 'none',
                background: isMe ? `color-mix(in srgb, ${DARK_C.cta} 9%, ${C.card})` : 'transparent',
                boxShadow: isMe ? `inset 4px 0 0 ${DARK_C.cta}` : 'none',
              }}>
              <span className="grid h-[30px] w-[30px] flex-shrink-0 place-items-center rounded-full text-[13px] font-bold tabular-nums"
                style={isMe ? { background: DARK_C.cta, color: '#ffffff' } : medal ? { background: medal.bg, color: medal.ink } : { color: C.muted }}>
                {r.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="truncate text-sm" style={{ color: C.text, fontWeight: isMe ? 700 : 500 }}>{r.name}</span>
                  {isMe && <span className="rounded-full px-2 text-xs font-bold leading-[22px]" style={{ background: C.text, color: C.card }}>You</span>}
                  {medal && <span className="text-xs" style={{ color: C.muted }}>{medal.title}</span>}
                </div>
                <DepthBar pct={pct} done={false} C={C} className="mt-1.5 h-2 w-full"/>
              </div>
              <span className="flex-shrink-0 text-sm font-bold tabular-nums" style={{ color: C.text }}>
                {r.xp.toLocaleString()}<span className="ml-0.5 text-[11px] font-semibold" style={{ color: C.muted }}>XP</span>
              </span>
            </div>
          );
        })}
      </Panel>
    </div>
  );
}

// --- Certificates section ---
// Group certificates by type, in a fixed order, skipping empty types
function groupCertsByType(certs: any[]): [string, any[]][] {
  const buckets: Record<string, any[]> = { Courses: [], 'Virtual experiences': [], 'Learning paths': [], Certifications: [] };
  for (const c of certs) {
    const key = c.ve_id ? 'Virtual experiences' : c.learning_path_id ? 'Learning paths' : c.certification_id ? 'Certifications' : 'Courses';
    buckets[key].push(c);
  }
  return (['Courses', 'Virtual experiences', 'Learning paths', 'Certifications'] as const)
    .filter(k => buckets[k].length).map(k => [k, buckets[k]] as [string, any[]]);
}

/** One certificate as the My learning card: cover, title, issue date, then View, LinkedIn and (certifications) the report. */
function CertCard({ cert, appUrl, appName, C }: { cert: any; appUrl: string; appName?: string | null; C: typeof LIGHT_C }) {
  const [broken, setBroken] = useState(false);
  const cover = cert.content?.cover_image && !broken ? resolveCoverUrl(cert.content.cover_image) : null;
  const title = cert.content?.title || 'Certificate';
  const pageUrl = `${appUrl}/certificate/${cert.id}`;
  const linkedIn = linkedInAddCertUrl({ name: title, organizationName: appName ?? undefined, certId: cert.id, certUrl: pageUrl })
    || `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(pageUrl)}`;
  return (
    <div className={FRAMED_CARD} style={{ background: C.card, cursor: 'default' }}>
      <a href={`/certificate/${cert.id}`} target="_blank" rel="noreferrer" className="relative block aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
        {cover
          ? <img src={cover} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
          : <span className="grid h-full w-full place-items-center" style={{ color: '#16a34a' }}><Certificate size={40} weight="duotone"/></span>}
        <span className="absolute left-0 top-3 px-3 py-1 text-[11px] font-bold" style={{ background: '#ffffff', color: '#16a34a' }}>Earned</span>
      </a>
      <div className="flex flex-1 flex-col gap-3.5 px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-[18px] sm:pt-3.5">
        <div>
          <p className="line-clamp-2 text-[15px] font-bold leading-5" style={{ color: C.text }}>{title}</p>
          <p className="mt-1 text-xs" style={{ color: C.muted }}>
            Issued {new Date(cert.issued_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <a href={`/certificate/${cert.id}`} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('sec', C)}>View certificate</a>
          <LinkedInButton href={linkedIn} C={C}/>
          {cert.certification_id && (
            <a href={`/cert-report/${cert.id}`} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('sec', C)}>
              <ChartBar size={16} weight="duotone"/> View report
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function CertificatesSection({ userId, userEmail, C }: { userId: string; userEmail: string; C: typeof LIGHT_C }) {
  const { appName, appUrl } = useTenant();
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: certsData } = await supabase
        .from('certificates')
        .select('id, course_id, ve_id, learning_path_id, certification_id, student_name, issued_at')
        .eq('student_id', userId)
        .eq('revoked', false)
        .order('issued_at', { ascending: false });

      if (!certsData?.length) { setLoading(false); return; }

      const courseIds  = [...new Set(certsData.map((c: any) => c.course_id).filter(Boolean))];
      const veIds      = [...new Set(certsData.map((c: any) => c.ve_id).filter(Boolean))];
      const pathIds    = [...new Set(certsData.map((c: any) => c.learning_path_id).filter(Boolean))];
      const certIds    = [...new Set(certsData.map((c: any) => c.certification_id).filter(Boolean))];

      // Certification metadata comes from the service-role API (the base table denies student reads).
      const { data: { session } } = await supabase.auth.getSession();
      const certMetaFetch = certIds.length
        ? fetch('/api/certification-attempt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
            body: JSON.stringify({ action: 'meta', ids: certIds }),
          }).then(r => r.ok ? r.json() : { certifications: [] }).then((j: any) => ({ data: j.certifications ?? [] })).catch(() => ({ data: [] }))
        : Promise.resolve({ data: [] });
      const [{ data: courseRows }, { data: veRows }, { data: pathRows }, { data: certRows }] = await Promise.all([
        courseIds.length ? supabase.from('courses').select('id, title, cover_image').in('id', courseIds) : Promise.resolve({ data: [] }),
        veIds.length     ? supabase.from('virtual_experiences').select('id, title, cover_image').in('id', veIds) : Promise.resolve({ data: [] }),
        pathIds.length   ? supabase.from('learning_paths').select('id, title').in('id', pathIds) : Promise.resolve({ data: [] }),
        certMetaFetch,
      ]);

      const courseMap = Object.fromEntries((courseRows ?? []).map((r: any) => [r.id, r]));
      const veMap     = Object.fromEntries((veRows     ?? []).map((r: any) => [r.id, r]));
      const pathMap   = Object.fromEntries((pathRows   ?? []).map((r: any) => [r.id, r]));
      const certMap   = Object.fromEntries((certRows   ?? []).map((r: any) => [r.id, r]));

      setCerts(certsData.map((cert: any) => {
        const content = cert.course_id ? courseMap[cert.course_id]
          : cert.ve_id ? veMap[cert.ve_id]
          : cert.learning_path_id ? pathMap[cert.learning_path_id]
          : cert.certification_id ? certMap[cert.certification_id]
          : null;
        return { ...cert, content };
      }));
      setLoading(false);
    };
    load();
  }, [userEmail, userId]);

  if (loading) return <LearningCardsSkeleton C={C} bar={false}/>;

  if (!certs.length) return (
    <EmptyState icon={Certificate} title="No certificates yet"
      body="Complete a course with a passing score to earn your certificate."
      action={<Link href="/" className={btnClass} style={{ background: DARK_C.cta, color: '#ffffff' }}><BookOpen size={16} weight="bold"/> Browse courses</Link>}/>
  );

  return (
    <div className="space-y-7">
      {groupCertsByType(certs).map(([title, list]) => (
        <section key={title}>
          <h3 className="mb-3 text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
          <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 sm:gap-6">
            {list.map(cert => <CertCard key={cert.id} cert={cert} appUrl={appUrl} appName={appName} C={C}/>)}
          </div>
        </section>
      ))}
    </div>
  );
}
