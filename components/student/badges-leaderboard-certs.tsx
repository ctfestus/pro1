'use client';

// Badges, Leaderboard and Certificates sections, extracted verbatim from
// app/student/page.tsx. The three *Section components are exported; BADGE_TABS,
// BadgeRow, groupCertsByType and CertRow are file-internal.

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { Sk, CarouselSkeleton, EmptyState } from '@/components/student/shared';
import {
  Award, BarChart3, BookOpen, ChevronLeft, ChevronRight, Download, Lock, Medal, RefreshCw, Trophy, Users, Zap,
} from 'lucide-react';

const BADGE_TABS = [
  { id: 'achievement',       label: 'Achievements'       },
  { id: 'course',            label: 'Courses'            },
  { id: 'learning_path',     label: 'Learning Paths'     },
  { id: 'virtual_experience',label: 'Virtual Experiences'},
  { id: 'certification',     label: 'Certifications'     },
] as const;

// One badge category rendered as a titled, horizontally-scrolling carousel
function BadgeRow({ title, badges, earnedIds, certIdMap, badgeUuidMap, appUrl, appName, onDownload, C }: {
  title: string; badges: any[]; earnedIds: Set<string>; certIdMap: Record<string, string>; badgeUuidMap: Record<string, string>;
  appUrl: string; appName?: string | null; onDownload: (b: any) => void; C: typeof LIGHT_C;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>{title}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {badges.map((b: any) => {
          const earned = earnedIds.has(b.id);
          const now = new Date();
          const certPageId   = certIdMap[b.id];
          const certPageUrl  = certPageId  ? `${appUrl}/certificate/${certPageId}` : null;
          const badgeUuid    = badgeUuidMap[b.id];
          const badgePageUrl = badgeUuid   ? `${appUrl}/b/${badgeUuid}`             : null;
          const shareUrl     = certPageUrl ?? badgePageUrl ?? null;
          const liCertUrl    = shareUrl
            ? `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(b.name)}&organizationName=${encodeURIComponent(appName ?? '')}&issueYear=${now.getFullYear()}&issueMonth=${now.getMonth() + 1}&certUrl=${encodeURIComponent(shareUrl)}&certId=${encodeURIComponent(certPageId ?? badgeUuid ?? b.id)}`
            : null;
          const liPostUrl    = shareUrl ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}` : null;
          return (
            <div key={b.id} className="flex-shrink-0 w-[190px] snap-start flex flex-col items-center text-center gap-3 pt-2" style={{ opacity: earned ? 1 : 0.45 }}>
              <div className="w-24 h-24 flex items-center justify-center flex-shrink-0">
                {earned && b.image_url
                  ? <img src={b.image_url} alt={b.name} loading="lazy" className="w-24 h-24 object-contain drop-shadow-md"/>
                  : earned
                    ? <span className="text-5xl leading-none">{b.icon}</span>
                    : <div className="w-24 h-24 rounded-full flex items-center justify-center" style={{ background: C.pill }}><Lock className="w-8 h-8" style={{ color: C.faint }}/></div>}
              </div>
              <p className="text-[15px] font-bold leading-tight" style={{ color: C.text }}>{b.name}</p>
              <div className="flex items-center justify-center gap-2 mt-1">
                {earned && b.image_url && (
                  <button onClick={() => onDownload(b)} title="Download badge"
                    className="w-8 h-8 rounded-lg flex items-center justify-center transition-opacity hover:opacity-70"
                    style={{ background: C.pill, color: C.muted }}>
                    <Download className="w-3.5 h-3.5"/>
                  </button>
                )}
                {earned && (liCertUrl || liPostUrl) ? (
                  <a href={liCertUrl || liPostUrl || '#'} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-opacity hover:opacity-90"
                    style={{ background: '#0A66C2', color: '#fff' }}>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    Add to LinkedIn
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-not-allowed"
                    style={{ background: C.pill, color: C.faint }}>
                    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    Add to LinkedIn
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
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

  if (loading) return <CarouselSkeleton C={C}/>;

  return (
    <div className="space-y-6">
      {/* Streak */}
      {streak && streak.current_streak > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl w-fit"
          style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.18)' }}>
          <span className="text-xl leading-none">🔥</span>
          <div>
            <p className="text-sm font-bold leading-none" style={{ color: '#f97316' }}>{streak.current_streak}-day streak</p>
            <p className="text-[11px]" style={{ color: C.faint }}>Best: {streak.longest_streak} days</p>
          </div>
        </div>
      )}

      {/* Category carousels */}
      {allBadges.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl"
          style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
          <Medal className="w-10 h-10 mb-3" style={{ color: C.faint, opacity: 0.4 }}/>
          <p className="text-sm font-semibold" style={{ color: C.text }}>No badges yet</p>
          <p className="text-xs mt-1" style={{ color: C.faint }}>Check back when new badges are added.</p>
        </div>
      ) : (
        BADGE_TABS.map(t => {
          const list = allBadges.filter(b => (b.category ?? 'achievement') === t.id);
          if (!list.length) return null;
          return (
            <BadgeRow key={t.id} title={t.label} badges={list}
              earnedIds={earnedIds} certIdMap={certIdMap} badgeUuidMap={badgeUuidMap}
              appUrl={appUrl} appName={appName} onDownload={handleDownload} C={C} />
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
  const isDark = C.text === '#f0f0f0';
  const HERO_BG = 'linear-gradient(135deg, #1a1f8c 0%, #2d35c8 60%, #3b45d4 100%)';

  useEffect(() => {
    const load = async () => {
      setLoading(true);
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
          .select('id, name')
          .eq('id', me.cohort_id)
          .single();
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
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [userIdProp, userEmail, refreshKey]);

  // Avatar colour derived from name
  const myEntry = rankings.find(r => r.isMe);
  const myRank  = myEntry?.rank ?? null;
  const myXP    = myEntry?.xp ?? 0;
  const maxXP   = rankings[0]?.xp ?? 1;


  if (loading) return (
    <div className="space-y-4">
      <div className="rounded-2xl p-6 h-36" style={{ background: 'linear-gradient(135deg, #1a1f8c, #3b45d4)' }}>
        <Sk h={20} w="40%"/>
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
        {[...Array(6)].map((_, i) => (
          <div key={i} className="px-5 py-4" style={{ borderBottom: i < 5 ? `1px solid ${C.divider}` : 'none', opacity: 1 - i * 0.12 }}>
            <div className="flex items-center gap-4 mb-2.5">
              <Sk w={28} h={14} r={4}/>
              <Sk h={13} w="45%"/>
              <div className="ml-auto"><Sk w={60} h={13}/></div>
            </div>
            <div className="ml-10"><Sk h={6} w="100%" r={99}/></div>
          </div>
        ))}
      </div>
    </div>
  );

  if (!cohort) return (
    <EmptyState icon={Users} title="No cohort assigned"
      body="You have not been assigned to a cohort yet. Contact your instructor."/>
  );

  if (!rankings.length) return (
    <EmptyState icon={Trophy} title="No rankings yet"
      body="Rankings will appear once students in your cohort start earning XP."/>
  );

  return (
    <div className="space-y-4">

      {/* -- Hero header -- */}
      <div className="rounded-2xl px-5 py-4" style={{ background: HERO_BG }}>
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.12)' }}>
            <Trophy className="w-5 h-5" style={{ color: '#fbbf24' }}/>
          </div>

          {/* Title + subtitle */}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-black leading-tight" style={{ color: '#ffffff' }}>Leaderboard</h2>
            <p className="text-xs" style={{ color: 'rgba(197,210,255,0.8)' }}>
              Rankings by cohort &middot; total XP earned
            </p>
          </div>

          {/* Inline stats */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#fbbf24' }}>{myXP.toLocaleString()}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>Your XP</p>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.15)' }}/>
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#ffffff' }}>{myRank ? `#${myRank}` : '--'}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>Rank</p>
            </div>
            <div className="w-px h-8" style={{ background: 'rgba(255,255,255,0.15)' }}/>
            <div className="text-right">
              <p className="text-base font-black tabular-nums leading-tight" style={{ color: '#ffffff' }}>{rankings.length}</p>
              <p className="text-[10px]" style={{ color: 'rgba(197,210,255,0.7)' }}>In Cohort</p>
            </div>
          </div>
        </div>
      </div>

      {/* -- Refresh -- */}
      <div className="flex justify-end">
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all disabled:opacity-50"
          style={{ background: C.pill, color: C.muted }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}/>
          Refresh
        </button>
      </div>

      {/* -- Rankings table -- */}
      <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>

        {/* Cohort header */}
        <div className="flex items-center justify-between px-5 py-3.5"
          style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: isDark ? 'rgba(99,102,241,0.2)' : 'rgba(99,102,241,0.1)' }}>
              <Users className="w-3.5 h-3.5" style={{ color: '#6366f1' }}/>
            </div>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: C.text }}>
              {cohort.name}
            </span>
          </div>
          <span className="text-xs" style={{ color: C.faint }}>{rankings.length} students</span>
        </div>

        {/* Rows */}
        {rankings.map((r, idx) => {
          const isMe  = r.isMe === true;
          const pct   = maxXP > 0 ? Math.max((r.xp / maxXP) * 100, r.xp > 0 ? 2 : 0) : 0;
          const barColor = r.rank === 1 ? '#f59e0b' : r.rank === 2 ? '#9ca3af' : r.rank === 3 ? '#cd7c2f' : (isDark ? '#4f6ef7' : '#6366f1');
          const TOP_TITLES: Record<number, { emoji: string; title: string; color: string }> = {
            1: { emoji: '🔥', title: 'Trailblazer', color: '#f59e0b' },
            2: { emoji: '⚡', title: 'Innovator',   color: '#9ca3af' },
            3: { emoji: '🌍', title: 'Pioneer',     color: '#cd7c2f' },
          };
          const topTitle = TOP_TITLES[r.rank];
          return (
            <div key={r.id ?? r.rank}
              style={{
                borderBottom: idx < rankings.length - 1 ? `1px solid ${C.divider}` : 'none',
                background: isMe
                  ? (isDark ? 'rgba(245,158,11,0.07)' : 'rgba(245,158,11,0.05)')
                  : 'transparent',
                padding: '12px 20px',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!isMe) e.currentTarget.style.background = C.input; }}
              onMouseLeave={e => { if (!isMe) e.currentTarget.style.background = 'transparent'; }}>

              {/* Top row: rank | name | XP */}
              <div className="flex items-center gap-3">
                <div className="w-7 flex-shrink-0 flex items-center justify-center">
                  <span className="text-sm font-bold tabular-nums" style={{ color: C.faint }}>{r.rank}</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-sm truncate" style={{ color: C.text, fontWeight: isMe ? 700 : 500 }}>
                    {r.name}
                    {isMe && (
                      <span className="ml-2 text-[11px] font-bold" style={{ color: '#f59e0b' }}>· You</span>
                    )}
                  </span>
                  {topTitle && (
                    <span className="text-[11px] font-semibold" style={{ color: topTitle.color }}>
                      {topTitle.emoji} {topTitle.title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Zap className="w-3 h-3" style={{ color: '#f59e0b' }}/>
                  <span className="text-sm font-bold tabular-nums" style={{ color: r.rank === 1 ? '#f59e0b' : C.text }}>
                    {r.xp.toLocaleString()}
                  </span>
                  <span className="text-[11px] font-semibold ml-0.5" style={{ color: C.faint }}>XP</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mt-2 ml-10 rounded-full overflow-hidden" style={{ height: 5, background: C.divider }}>
                <div className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: barColor, transition: 'width 0.8s ease' }}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Certificates section ---
// Group certificates by type, in a fixed order, skipping empty types
function groupCertsByType(certs: any[]): [string, any[]][] {
  const buckets: Record<string, any[]> = { Courses: [], 'Virtual Experiences': [], 'Learning Paths': [], Certifications: [] };
  for (const c of certs) {
    const key = c.ve_id ? 'Virtual Experiences' : c.learning_path_id ? 'Learning Paths' : c.certification_id ? 'Certifications' : 'Courses';
    buckets[key].push(c);
  }
  return (['Courses', 'Virtual Experiences', 'Learning Paths'] as const)
    .filter(k => buckets[k].length).map(k => [k, buckets[k]] as [string, any[]]);
}

// One certificate type rendered as a titled, horizontally-scrolling carousel
function CertRow({ title, certs, C }: { title: string; certs: any[]; C: typeof LIGHT_C }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>{title}</h3>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {certs.map((cert: any) => {
          const cover = cert.content?.cover_image;
          return (
            <div key={cert.id} className="flex-shrink-0 w-[240px] snap-start">
              <a href={`/certificate/${cert.id}`} target="_blank" rel="noreferrer"
                className="block transition-transform hover:-translate-y-0.5">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video flex items-center justify-center"
                  style={{ background: `linear-gradient(135deg, ${C.green}18 0%, ${C.lime}30 100%)` }}>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
                    <Award className="w-9 h-9" style={{ color: C.green }}/>
                    <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.green }}>Certificate</span>
                  </div>
                  {cover && <img src={resolveCoverUrl(cover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                  <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: '#16a34a', color: '#ffffff' }}>Earned</span>
                </div>
                <p className="text-[15px] font-bold leading-snug mt-2 line-clamp-2" style={{ color: C.text }}>{cert.content?.title || 'Certificate'}</p>
                <p className="text-xs mt-1" style={{ color: C.faint }}>
                  Issued {new Date(cert.issued_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </p>
              </a>
              {cert.certification_id && (
                <a href={`/cert-report/${cert.id}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold mt-1.5 transition-opacity hover:opacity-80" style={{ color: C.cta }}>
                  <BarChart3 className="w-3.5 h-3.5" /> View report
                </a>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CertificatesSection({ userId, userEmail, C }: { userId: string; userEmail: string; C: typeof LIGHT_C }) {
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

  if (loading) return <CarouselSkeleton C={C}/>;

  if (!certs.length) return (
    <EmptyState icon={Award} title="No certificates yet"
      body="Complete a course with a passing score to earn your certificate."
      action={<Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-80 dashboard-cta"
        style={{ background: C.cta, color: C.ctaText }}><BookOpen className="w-4 h-4"/> Browse courses</Link>}/>
  );

  return (
    <div className="space-y-6">
      {groupCertsByType(certs).map(([title, list]) => (
        <CertRow key={title} title={title} certs={list} C={C} />
      ))}
    </div>
  );
}

// --- Continue Learning card (own component to avoid hooks-in-map violation) ---
