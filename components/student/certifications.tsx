'use client';

// Student-facing certifications listing. Shows the published certifications assigned to the
// student's cohort, with their attempt status (Start / Continue / Review). Taking one opens the
// full-screen CertificationTaker at /{slug}.

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, DARK_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { CertificationType } from '@/lib/course-schema';
import { EmptyState, HoverPreviewCard } from '@/components/student/shared';
import { CertificationQuestionView, CertificationResultSummary } from '@/components/CertificationTaker';
import { ShieldCheck, Clock, CheckCircle, Award, Briefcase, Code2, ArrowUpRight, BookOpenCheck, BadgeCheck, Share2, FileCheck2, X, ChevronLeft, ChevronRight, BookOpen, ArrowRight } from 'lucide-react';

const softSurface = (C: typeof LIGHT_C, shadow = '0 12px 36px rgba(15,23,42,0.08)') => ({
  background: C.card,
  border: 'none',
  boxShadow: C.page === DARK_C.page ? 'none' : shadow,
});

function CredentialSeal({ cert, C, size = 132 }: { cert: any; C: typeof LIGHT_C; size?: number }) {
  return (
    <div className="relative grid shrink-0 place-items-center rounded-full" style={{ width: size, height: size, border: C.page === DARK_C.page ? 'none' : `1px solid ${C.inputBorder}`, background: C.card, boxShadow: C.cardShadow }}>
      <div className="absolute inset-[9%] rounded-full" style={{ border: `2px dotted ${C.green}66` }} />
      <div className="absolute inset-[17%] rounded-full" style={{ border: `1.5px solid ${C.green}` }} />
      {cert?.badge_image_url
        ? <img src={resolveCoverUrl(cert.badge_image_url)} alt="" className="relative z-10 h-[62%] w-[62%] object-contain" onError={e => (e.currentTarget.style.display = 'none')} />
        : <div className="relative z-10 grid h-[48%] w-[48%] place-items-center rounded-full" style={{ background: `${C.green}14`, color: C.green }}><ShieldCheck className="h-[56%] w-[56%]" /></div>}
      <span className="absolute bottom-[13%] z-20 rounded-full px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[0.14em]" style={{ background: C.green, color: '#fff' }}>Certified</span>
    </div>
  );
}

const examPreviewTheme = (C: typeof LIGHT_C) => C.page === DARK_C.page
  ? { bg: '#17181E', card: '#1E1F26', cardHover: '#23242c', border: 'rgba(255,255,255,0.10)', text: '#f0f0f0', muted: '#8a8a93', track: 'rgba(255,255,255,0.08)' }
  : { bg: '#ffffff', card: '#ffffff', cardHover: '#f8fafc', border: 'rgba(15,23,42,0.09)', text: '#111827', muted: '#667085', track: '#e9eef5' };

function QuestionTypesPreview({ C }: { C: typeof LIGHT_C }) {
  const previewTheme = examPreviewTheme(C);
  const sample = { id: 'preview-mc', type: 'multiple_choice', question: 'Which approach best validates a model before deployment?', options: ['Test against representative data', 'Use only training accuracy', 'Skip edge-case testing'], correctAnswer: 'Test against representative data' };
  const [answer, setAnswer] = useState('');
  return (
    <div className="mx-auto max-w-2xl overflow-hidden rounded-2xl" style={{ background: previewTheme.bg, border: 'none', boxShadow: C.page === DARK_C.page ? 'none' : '0 14px 40px rgba(15,23,42,0.10)' }}>
      <div className="grid grid-cols-[28px_minmax(0,1fr)_64px] items-center gap-3 px-4 py-3 sm:grid-cols-[32px_minmax(0,1fr)_72px]" style={{ background: previewTheme.bg }}>
        <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: previewTheme.track, color: previewTheme.muted }} aria-hidden="true"><X className="h-3.5 w-3.5" /></span>
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold" style={{ color: previewTheme.muted }}><span>Question 2 of 10</span><span>20%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: previewTheme.track }}><div className="h-full w-[20%] rounded-full" style={{ background: C.green }} /></div>
        </div>
        <span className="flex items-center justify-end gap-1 text-[10px] font-bold tabular-nums" style={{ color: previewTheme.muted }}><Clock className="h-3.5 w-3.5" />04:18</span>
      </div>
      <div className="mx-auto max-w-xl p-4 sm:p-5"><CertificationQuestionView q={sample} qType="multiple_choice" value={answer} onChange={setAnswer} t={previewTheme} accentColor={C.green} sharedPlayground={{}} /></div>
    </div>
  );
}

function ResultPreview({ C }: { C: typeof LIGHT_C }) {
  const previewTheme = examPreviewTheme(C);
  if (C.card) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl p-4 text-center sm:p-5" style={{ background: previewTheme.bg, border: 'none', color: previewTheme.text, boxShadow: C.page === DARK_C.page ? 'none' : '0 14px 40px rgba(15,23,42,0.10)' }}>
        <CertificationResultSummary compact result={{ score: 86, passed: true, correctQuestions: 17, totalQuestions: 20, skills: [{ id: 'analysis', name: 'Analysis', correct: 11, total: 12, pct: 92 }, { id: 'application', name: 'Application', correct: 5, total: 6, pct: 83 }, { id: 'judgement', name: 'Judgement', correct: 1, total: 2, pct: 50 }] }} passmark={70} theme={previewTheme} accentColor={C.green} />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border" style={{ background: C.page, borderColor: C.inputBorder, boxShadow: C.cardShadow }}>
      <div className="flex items-center justify-between border-b px-3 py-2" style={{ borderColor: C.inputBorder, background: C.card }}>
        <span className="flex gap-1.5" aria-hidden="true"><span className="h-2 w-2 rounded-full bg-rose-400"/><span className="h-2 w-2 rounded-full bg-amber-400"/><span className="h-2 w-2 rounded-full bg-emerald-400"/></span>
        <span className="text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: C.faint }}>Results</span><BadgeCheck className="h-3.5 w-3.5" style={{ color: C.green }} />
      </div>
      <div className="grid grid-cols-[88px_1fr] gap-3 p-3.5">
        <div className="grid aspect-square place-items-center rounded-full" style={{ background: `conic-gradient(${C.green} 0 86%, ${C.pill} 86% 100%)` }}>
          <div className="grid h-[72%] w-[72%] place-items-center rounded-full text-center" style={{ background: C.page }}><span><strong className="block text-lg leading-none" style={{ color: C.text }}>86%</strong><small className="text-[7px] font-bold uppercase" style={{ color: C.green }}>Passed</small></span></div>
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold" style={{ color: C.text }}>Certification passed</p>
          <p className="mt-0.5 text-[8px]" style={{ color: C.muted }}>Your strongest skill areas</p>
          <div className="mt-2 space-y-2">
            {[['Analysis', 92], ['Application', 81], ['Judgement', 76]].map(([label, score]) => <div key={String(label)}><div className="mb-0.5 flex justify-between text-[7px]" style={{ color: C.muted }}><span>{label}</span><span>{score}%</span></div><div className="h-1 rounded-full" style={{ background: C.pill }}><div className="h-full rounded-full" style={{ width: `${score}%`, background: C.green }} /></div></div>)}
          </div>
        </div>
      </div>
      <div className="mx-3.5 mb-3.5 flex items-center justify-between rounded-lg px-2.5 py-2 text-[8px] font-bold" style={{ background: `${C.green}10`, color: C.green }}><span>Credential unlocked</span><span>View certificate →</span></div>
    </div>
  );
}

function LearningPathPreview({ paths, C }: { paths: any[]; C: typeof LIGHT_C }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (direction: number) => scrollRef.current?.scrollBy({ left: direction * 380, behavior: 'smooth' });
  const [hover, setHover] = useState<{ path: any; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (path: any, element: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const rect = element.getBoundingClientRect();
    const width = 320;
    const height = 420;
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.top - 20, window.innerHeight - height - 12));
    setHover({ path, left, top, originX: Math.max(0, Math.min(rect.left + rect.width / 2 - left, width)), originY: Math.max(0, Math.min(rect.top + rect.height / 2 - top, height)) });
  };
  useEffect(() => () => cancelClose(), []);
  const isDark = C.page === DARK_C.page;
  return (
    <>
    <section className="relative overflow-hidden rounded-2xl p-5 sm:p-6" style={{ ...softSurface(C, '0 14px 40px rgba(15,23,42,0.10)'), background: isDark ? '#23242c' : C.card }} aria-label="Published learning paths">
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h4 className="text-xl font-bold leading-tight sm:text-2xl" style={{ color: C.text }}>Learning Paths</h4>
            <p className="mt-1.5 max-w-xl text-xs leading-relaxed sm:text-sm" style={{ color: C.muted }}>Launch your career in tech with curated courses, virtual experiences and guided projects.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => scrollByCards(-1)} aria-label="Scroll learning paths left" className="grid h-9 w-9 place-items-center rounded-full border transition-all hover:scale-105 active:scale-95" style={{ borderColor: C.cardBorder, color: C.muted, background: C.card }}><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => scrollByCards(1)} aria-label="Scroll learning paths right" className="grid h-9 w-9 place-items-center rounded-full border transition-all hover:scale-105 active:scale-95" style={{ borderColor: C.cardBorder, color: C.muted, background: C.card }}><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
        <div ref={scrollRef} className="flex snap-x flex-nowrap gap-4 overflow-x-auto pb-2 pt-5" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitMaskImage: 'linear-gradient(90deg, #000 94%, transparent)', maskImage: 'linear-gradient(90deg, #000 94%, transparent)' }}>
          {paths.map((path) => (
            <div key={path.id} className="group w-[220px] shrink-0 snap-start sm:w-[260px]" onMouseEnter={(event) => openHover(path, event.currentTarget)} onMouseLeave={scheduleClose}>
              <div className="relative aspect-video w-full overflow-hidden rounded-xl transition-shadow duration-300 group-hover:shadow-[0_14px_30px_-12px_rgba(2,32,71,0.65)]" style={{ background: path.imageUrl ? '#0b0b0d' : 'transparent' }}>
                {path.imageUrl
                  ? <img src={path.imageUrl} alt={path.title} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
                  : <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-amber-400 to-orange-500 transition-transform duration-500 group-hover:scale-[1.07]"><BookOpen className="h-8 w-8 text-white/70" /></div>}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/45 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="pointer-events-none absolute bottom-2 right-2 grid h-8 w-8 translate-y-1.5 place-items-center rounded-full bg-white text-slate-900 opacity-0 shadow-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"><ArrowRight className="h-4 w-4" /></div>
              </div>
              <p className="mt-2.5 line-clamp-2 text-[15px] font-bold leading-snug" style={{ color: C.text }}>{path.title}</p>
              {path.description && <p className="mt-1 line-clamp-1 text-[11px]" style={{ color: C.muted }}>{path.description}</p>}
            </div>
          ))}
          {!paths.length && (
            <div className="flex min-h-36 w-full items-center justify-center rounded-xl px-5 text-center text-sm" style={{ background: C.page, color: C.muted }}>Published learning paths will appear here.</div>
          )}
        </div>
      </div>
    </section>
    {typeof document !== 'undefined' && hover && createPortal(
      <HoverPreviewCard left={hover.left} top={hover.top} originX={hover.originX} originY={hover.originY} onEnter={cancelClose} onLeave={scheduleClose}>
        <div className="overflow-hidden rounded-2xl" style={{ background: C.card, boxShadow: isDark ? '0 18px 55px rgba(0,0,0,0.38)' : '0 16px 44px rgba(15,23,42,0.14)' }}>
          <div className="p-4 pb-0">
            <span className="mb-2 inline-block rounded-md bg-[#FF9933] px-2 py-0.5 text-[10px] font-bold text-white">Learning Path</span>
            <h5 className="line-clamp-2 text-lg font-bold leading-snug" style={{ color: C.text }}>{hover.path.title}</h5>
            {hover.path.description && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed" style={{ color: C.muted }}>{hover.path.description}</p>}
          </div>
          <div className="p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.faint }}>{hover.path.pathCourses.length} item{hover.path.pathCourses.length === 1 ? '' : 's'} in this path</p>
            <div className="flex flex-wrap gap-2.5">
              {hover.path.pathCourses.slice(0, 4).map((item: any) => (
                <div key={`${item.type}-${item.id}`} className="w-[110px] shrink-0">
                  <div className="mb-1.5 flex aspect-video items-center justify-center overflow-hidden rounded-lg" style={{ background: isDark ? C.pill : '#F0F6FF' }}>
                    {item.imageUrl ? <img src={item.imageUrl} alt={item.title} loading="lazy" className="h-full w-full object-cover" /> : <BookOpen className="h-5 w-5 text-[#9CA3AF]" />}
                  </div>
                  <p className="line-clamp-2 text-[11px] font-medium leading-snug" style={{ color: C.text }}>{item.title}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </HoverPreviewCard>,
      document.body,
    )}
    </>
  );
}

export function CertificationsSection({ userId, userEmail, C }: { userId: string; userEmail?: string; C: typeof LIGHT_C }) {
  const [items, setItems] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<Record<string, { passed: boolean; inProgress: boolean; score: number }>>({});
  // The certification the student is currently "enrolled" in: one they have attempted but not passed
  // (in progress OR a prior failed attempt). Only one exists at a time (enforced server-side). Every
  // OTHER exam is locked to a Switch until they pass this one or switch away -- matching the server.
  const [enrolledId, setEnrolledId] = useState<string | null>(null);
  const [publicPaths, setPublicPaths] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Certifications metadata comes from the service-role API (students cannot read the base table,
      // which holds answer keys). Attempts are RLS-scoped to the student, so read those directly.
      const { data: { session } } = await supabase.auth.getSession();
      const [listRes, { data: atts }, { data: publishedPaths }] = await Promise.all([
        fetch('/api/certification-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ action: 'list' }),
        }).then(r => r.ok ? r.json() : { certifications: [] }).catch(() => ({ certifications: [] })),
        supabase.from('certification_attempts').select('certification_id, passed, completed_at, score').eq('student_id', userId),
        supabase.from('published_learning_paths').select('id,title,description,cover_image').limit(8),
      ]);
      const certs = listRes.certifications ?? [];
      const byId: Record<string, { passed: boolean; inProgress: boolean; score: number }> = {};
      let active: string | null = null;
      for (const a of (atts ?? [])) {
        const cur = byId[a.certification_id] ?? { passed: false, inProgress: false, score: 0 };
        if (a.passed) { cur.passed = true; cur.score = Math.max(cur.score, a.score ?? 0); }
        if (!a.completed_at) { cur.inProgress = true; active = a.certification_id; }
        byId[a.certification_id] = cur;
      }
      // Enrollment = any attempted-but-unpassed cert (in progress OR failed). Prefer the in-progress one.
      const enrolled = active ?? (Object.entries(byId).find(([, st]) => !st.passed)?.[0] ?? null);
      setAttempts(byId);
      setEnrolledId(enrolled);
      setItems(certs ?? []);
      const publishedPathIds = (publishedPaths ?? []).map((path: any) => path.id);
      const { data: publishedPathItems } = publishedPathIds.length
        ? await supabase.from('published_path_items').select('path_id,id,title,cover_image,slug,type,position').in('path_id', publishedPathIds).order('position')
        : { data: [] as any[] };
      const pathItemsById: Record<string, any[]> = {};
      for (const item of (publishedPathItems ?? [])) {
        if (!pathItemsById[item.path_id]) pathItemsById[item.path_id] = [];
        pathItemsById[item.path_id].push({ ...item, imageUrl: resolveCoverUrl(item.cover_image) });
      }
      setPublicPaths((publishedPaths ?? []).map((path: any) => ({
        ...path,
        imageUrl: resolveCoverUrl(path.cover_image),
        pathCourses: pathItemsById[path.id] ?? [],
      })));
      setLoading(false);
    })();
  }, [userId]);

  if (loading) return (
    <div className="space-y-10">
      <div className="rounded-[28px] p-7 sm:p-12" style={{ background: C.card }}>
        <div className="h-4 w-52 rounded animate-pulse" style={{ background: C.skeleton }} />
        <div className="mt-5 h-12 w-[560px] max-w-full rounded-xl animate-pulse" style={{ background: C.skeleton }} />
        <div className="mt-4 h-5 w-[620px] max-w-full rounded animate-pulse" style={{ background: C.skeleton }} />
      </div>
      <div className="flex gap-4 overflow-hidden">
        {[...Array(3)].map((_, i) => <div key={i} className="h-[390px] min-w-[300px] flex-1 rounded-2xl animate-pulse" style={{ background: C.card }} />)}
      </div>
    </div>
  );
  if (!items.length) return <EmptyState icon={ShieldCheck} title="No certifications yet" body="Published certifications available to you will appear here." />;

  // One certification card. Extracted so both type groups render identical cards.
  const renderCard = (cert: any, i: number) => {
    const st = attempts[cert.id];
    const label = st?.passed ? 'View result' : st?.inProgress ? 'Continue' : 'Start exam';
    // Locked to a Switch while the student is enrolled in a DIFFERENT exam (in progress or failed),
    // mirroring the server's one-at-a-time rule so a quit/fail cannot silently unlock the others.
    const lockedByOther = !!enrolledId && enrolledId !== cert.id && !st?.passed;
    return (
      <motion.div key={cert.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
        whileHover={{ y: -5 }} className="group relative flex min-h-[410px] w-[86vw] max-w-[360px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border p-5 sm:w-[340px]" style={softSurface(C, '0 7px 24px rgba(15,23,42,0.075), 0 2px 8px rgba(15,23,42,0.035)')}>
        <div className="flex items-center justify-between gap-3">
          <span className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}>{st?.passed ? 'Credential earned' : st?.inProgress ? 'In progress' : 'Details'}</span>
          <a href={`/${cert.slug || cert.id}`} aria-label={`Open ${cert.title}`} className="grid h-9 w-9 place-items-center rounded-full transition-transform group-hover:rotate-6" style={{ background: C.pill, color: C.text }}><ArrowUpRight className="h-4 w-4" /></a>
        </div>
        <div className="flex flex-1 items-center justify-center py-7">
          <CredentialSeal cert={cert} C={C} size={154} />
        </div>
        {st?.passed && (
          <span className="absolute left-1/2 top-[205px] -translate-x-1/2 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1" style={{ background: `${C.green}16`, color: C.green }}>
            <CheckCircle className="w-3 h-3" /> Passed
          </span>
        )}
        <div className="flex flex-col">
          <div className="min-w-0">
            <h3 className="text-lg font-bold leading-tight line-clamp-2" style={{ color: C.text }}>{cert.title}</h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs mt-2" style={{ color: C.faint }}>
              <span>Pass {cert.passmark ?? 70}%</span>
              <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{cert.time_limit ? `${cert.time_limit}m` : 'Untimed'}</span>
            </div>
          </div>
          {cert.description && <p className="text-sm mt-3 mb-5 line-clamp-2 leading-relaxed" style={{ color: C.muted }}>{cert.description}</p>}
        {lockedByOther ? (
          // Another exam is in progress. Keep this actionable: opening it lets the student switch
          // (the taker asks to confirm, discarding the other) instead of a dead-end message.
          <div className="mt-auto">
            <a href={`/${cert.slug || cert.id}`}
              className="inline-flex w-full items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: C.pill, color: C.text }}>
              Switch to this exam
            </a>
            <p className="text-[11px] text-center mt-1.5" style={{ color: C.faint }}>You have another exam in progress.</p>
          </div>
        ) : (
          <a href={`/${cert.slug || cert.id}`}
            className="mt-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: st?.passed ? C.pill : C.cta, color: st?.passed ? C.muted : C.ctaText }}>
            {st?.passed && <Award className="w-4 h-4" />} {label}
          </a>
        )}
        </div>
      </motion.div>
    );
  };

  // Grouped by type. Anything without a type (legacy rows) falls under Technology.
  const GROUPS: { type: CertificationType; label: string; Icon: typeof Briefcase }[] = [
    { type: 'career', label: 'Career Certifications', Icon: Briefcase },
    { type: 'technology', label: 'Technology Certifications', Icon: Code2 },
  ];
  const featured = items.find(c => attempts[c.id]?.passed) ?? items.find(c => attempts[c.id]?.inProgress) ?? items[0];
  const featuredStatus = attempts[featured.id];
  const passedCount = Object.values(attempts).filter(a => a.passed).length;

  return (
    <div className="space-y-14 sm:space-y-20 pb-10">
      <section className="relative overflow-hidden rounded-[28px] px-6 py-10 sm:px-10 sm:py-14 lg:px-14" style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}>
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full blur-3xl" style={{ background: `${C.green}12` }} />
        <div className="relative grid items-center gap-10 lg:grid-cols-[1.15fr_0.85fr]">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.15em]" style={{ color: C.green }}>
              <motion.span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: C.green, boxShadow: `0 0 0 5px ${C.green}14` }} animate={{ scale: [0.82, 1.12, 0.82], opacity: [0.65, 1, 0.65] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />
              <span>Professional credentials</span>
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-semibold leading-[1.12] tracking-[-0.022em] sm:text-4xl lg:text-5xl" style={{ color: C.text }}>Certifications that prove what you can do</h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed sm:text-lg" style={{ color: C.muted }}>Validate practical skills, earn a trusted credential, and make your expertise easier to recognize and share.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#certification-catalog" className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-bold" style={{ background: C.text, color: C.page }}>Explore certifications <ArrowUpRight className="h-4 w-4" /></a>
              <a href="#how-certification-works" className="inline-flex items-center rounded-full px-5 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.text }}>How it works</a>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold" style={{ color: C.muted }}>
              <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-4 w-4" style={{ color: C.green }} /> Practical assessments</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-4 w-4" style={{ color: C.green }} /> Shareable credentials</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle className="h-4 w-4" style={{ color: C.green }} /> Verifiable results</span>
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ delay: 0.08 }} className="mx-auto w-full max-w-[430px] rounded-[26px] p-4 sm:p-5" style={softSurface(C, '0 14px 42px rgba(15,23,42,0.10)')}>
            <div className="rounded-[20px] p-5 sm:p-7" style={{ background: C.card }}>
              <div className="flex items-start justify-between gap-3">
                <div><p className="text-[10px] font-extrabold uppercase tracking-[0.16em]" style={{ color: C.green }}>Credential preview</p><p className="mt-1 text-xs" style={{ color: C.muted }}>{featuredStatus?.passed ? 'Credential earned' : 'Your next milestone'}</p></div>
                <BadgeCheck className="h-5 w-5" style={{ color: C.green }} />
              </div>
              <div className="flex justify-center py-5"><CredentialSeal cert={featured} C={C} size={132} /></div>
              <h2 className="text-center text-lg font-bold" style={{ color: C.text }}>{featured.title}</h2>
              <p className="mt-2 text-center text-xs leading-relaxed" style={{ color: C.muted }}>{featuredStatus?.passed ? `Completed with a best score of ${featuredStatus.score}%` : 'Complete the assessment to unlock your certificate and badge.'}</p>
              <div className="mt-5 flex items-center justify-between border-t pt-4 text-xs" style={{ borderColor: C.inputBorder, color: C.muted }}><span>{featured.time_limit ? `${featured.time_limit} min` : 'Untimed'}</span><span>{featured.passmark ?? 70}% pass mark</span></div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="certification-catalog" className="scroll-mt-24 space-y-12">
      {GROUPS.map(g => {
        const groupItems = items.filter(c => (c.cert_type === 'career' ? 'career' : 'technology') === g.type);
        if (!groupItems.length) return null;
        return (
          <section key={g.type}>
            <div className="mb-6 flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]" style={{ color: C.green }}><g.Icon className="h-4 w-4" /> {g.type === 'career' ? 'Build your career' : 'Deepen your expertise'}</div>
                <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl" style={{ color: C.text }}>{g.label}</h2>
                <p className="mt-1 max-w-2xl text-sm" style={{ color: C.muted }}>{g.type === 'career' ? 'Role-focused credentials that demonstrate your ability to perform in real professional contexts.' : 'Focused credentials that validate practical knowledge across tools, technologies, and specialist skills.'}</p>
              </div>
              <span className="text-xs font-semibold" style={{ color: C.faint }}>{groupItems.length} available</span>
            </div>
            <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 py-4 [scroll-padding-inline:1rem] [scrollbar-width:thin]">
              {groupItems.map((cert, i) => renderCard(cert, i))}
            </div>
          </section>
        );
      })}
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { Icon: FileCheck2, title: 'Official certificate', body: 'A clear record of the certification you earned and the standard you met.' },
          { Icon: BadgeCheck, title: 'Professional badge', body: 'A compact credential you can display as evidence of your achievement.' },
          { Icon: Share2, title: 'Easy to share', body: 'Showcase your result and make your verified expertise easier to discover.' },
        ].map(({ Icon, title, body }) => (
          <div key={title} className="rounded-2xl p-6" style={softSurface(C)}>
            <div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${C.green}12`, color: C.green }}><Icon className="h-5 w-5" /></div>
            <h3 className="mt-5 text-base font-bold" style={{ color: C.text }}>{title}</h3>
            <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>{body}</p>
          </div>
        ))}
      </section>

      <section id="how-certification-works" className="scroll-mt-24 rounded-[28px] p-6 sm:p-10 lg:p-12" style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}>
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.15em]" style={{ color: C.green }}>Your certification journey</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl" style={{ color: C.text }}>From preparation to credential in three steps</h2>
          <p className="mt-3 text-sm leading-relaxed sm:text-base" style={{ color: C.muted }}>Build confidence, demonstrate your skills, and unlock a credential you can carry forward.</p>
        </div>
        <div className="mt-9 space-y-5">
          {[
            { Icon: BookOpenCheck, title: 'Prepare with confidence', body: 'Use the study resources, courses, learning paths, and practice questions provided for your certification.' },
            { Icon: FileCheck2, title: 'Pass the assessment', body: 'Complete the practical exam and meet the required pass mark within the available attempts.' },
            { Icon: Award, title: 'Receive your credential', body: 'Unlock your result, certificate, and badge, ready to view and share.' },
          ].map(({ Icon, title, body }, index) => (
            <div key={title} className="relative grid gap-6 rounded-2xl p-5 lg:grid-cols-[0.32fr_0.68fr] lg:p-7" style={softSurface(C, '0 10px 30px rgba(15,23,42,0.07)')}>
              <div>
                <div className="flex items-center justify-between"><div className="grid h-11 w-11 place-items-center rounded-xl" style={{ background: `${C.green}13`, color: C.green }}><Icon className="h-5 w-5" /></div><span className="text-3xl font-extrabold" style={{ color: `${C.green}28` }}>0{index + 1}</span></div>
                <h3 className="mt-5 text-base font-bold" style={{ color: C.text }}>{title}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>{body}</p>
              </div>
              <div className="min-w-0">
                {index === 0 && <LearningPathPreview paths={publicPaths} C={C} />}
                {index === 1 && <QuestionTypesPreview C={C} />}
                {index === 2 && <ResultPreview C={C} />}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t pt-6" style={{ borderColor: C.inputBorder }}>
          <p className="text-sm font-semibold" style={{ color: C.text }}>{passedCount > 0 ? `You have earned ${passedCount} credential${passedCount === 1 ? '' : 's'}.` : 'Your first credential starts with one certification.'}</p>
          <a href="#certification-catalog" className="inline-flex items-center gap-2 text-sm font-bold" style={{ color: C.green }}>Choose a certification <ArrowUpRight className="h-4 w-4" /></a>
        </div>
      </section>
    </div>
  );
}
