'use client';

// Certifications: where the student stands (earned, in progress, available), the catalog grouped
// by type as cards with one action each, how it works in three steps, and the learning paths to
// prepare with. Taking one opens the full-screen CertificationTaker at /{slug}. Icons are Phosphor.

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import type { CertificationType } from '@/lib/course-schema';
import { EmptyState, Sk } from '@/components/student/shared';
import { FRAMED_CARD } from '@/components/CardMeta';
import { DISPLAY_FONT, Pill, btnClass, btnStyle, type Tone } from '@/components/dashboard/subscriptions/ui';
import { LearningCardsSkeleton } from '@/components/student/learning-card';
import { ArrowClockwise, BookOpen, Certificate, Clock, Exam, SealCheck, Target } from '@phosphor-icons/react';
import { toPlainText } from '@/lib/plain-text';

const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)]';
const GRID = 'grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 sm:gap-6';

/** The certification's badge, or a seal, in a ringed circle: each card's picture. */
function CredentialSeal({ cert, C }: { cert: any; C: typeof LIGHT_C }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="grid h-24 w-24 place-items-center rounded-full"
      style={{ background: C.card, boxShadow: '0 0 0 8px color-mix(in srgb, #16a34a 10%, transparent)', color: '#16a34a' }}>
      {cert?.badge_image_url && !broken
        ? <img src={resolveCoverUrl(cert.badge_image_url)} alt="" onError={() => setBroken(true)} className="h-16 w-16 object-contain"/>
        : <SealCheck size={44} weight="duotone"/>}
    </span>
  );
}

function Stat({ value, label, sub, C }: { value: React.ReactNode; label: string; sub?: string; C: typeof LIGHT_C }) {
  return (
    <div className={`min-w-0 rounded-2xl px-4 py-3.5 ${CARD_SHADOW}`} style={{ background: C.card }}>
      <div className="truncate text-[22px] font-semibold leading-8 sm:text-[26px]" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{value}</div>
      <p className="mt-1 text-[13px] font-semibold" style={{ color: C.text }}>{label}</p>
      {sub && <p className="mt-0.5 truncate text-xs" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

const STEPS = [
  { Icon: BookOpen, title: 'Prepare', body: 'Study with your courses and the learning paths below.' },
  { Icon: Exam, title: 'Pass the exam', body: 'Reach the pass mark within the time and attempts shown. One exam at a time.' },
  { Icon: Certificate, title: 'Get your credential', body: 'A certificate and badge you can download and add to LinkedIn.' },
];

export function CertificationsSection({ userId, C }: { userId: string; userEmail?: string; C: typeof LIGHT_C }) {
  const [items, setItems] = useState<any[]>([]);
  const [attempts, setAttempts] = useState<Record<string, { passed: boolean; inProgress: boolean; score: number }>>({});
  // The certification the student is currently "enrolled" in: one they have attempted but not passed
  // (in progress OR a prior failed attempt). Only one exists at a time (enforced server-side). Every
  // OTHER exam is locked to a Switch until they pass this one or switch away -- matching the server.
  const [enrolledId, setEnrolledId] = useState<string | null>(null);
  const [publicPaths, setPublicPaths] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
      // Certifications metadata comes from the service-role API (students cannot read the base table,
      // which holds answer keys). Attempts are RLS-scoped to the student, so read those directly.
      const { data: { session } } = await supabase.auth.getSession();
      const [listRes, { data: atts }, { data: publishedPaths }] = await Promise.all([
        fetch('/api/certification-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ action: 'list' }),
        // A failed list is an error with a retry, not "No certifications yet".
        }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
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
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [userId, reloadKey]);

  if (loading) return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className={`space-y-2 rounded-2xl px-4 py-3.5 ${CARD_SHADOW}`} style={{ background: C.card }}><Sk w={60} h={26}/><Sk w={100} h={12}/><Sk w={130} h={10}/></div>
        ))}
      </div>
      <Sk w={200} h={16}/>
      <LearningCardsSkeleton C={C} bar={false}/>
    </div>
  );
  if (loadError) return (
    <EmptyState icon={ArrowClockwise} title="Could not load certifications" body="Check your connection and try again."
      action={<button type="button" onClick={() => setReloadKey(k => k + 1)} className={btnClass}
        style={{ background: DARK_C.cta, color: '#ffffff' }}>Try again</button>} />
  );

  if (!items.length) return <EmptyState icon={SealCheck} title="No certifications yet" body="Published certifications available to you will appear here." />;

  // One certification card: its seal, rules, a status and one action.
  const renderCard = (cert: any) => {
    const st = attempts[cert.id];
    const href = `/${cert.slug || cert.id}`;
    // Locked to a Switch while the student is enrolled in a DIFFERENT exam (in progress or failed),
    // mirroring the server's one-at-a-time rule so a quit/fail cannot silently unlock the others.
    const lockedByOther = !!enrolledId && enrolledId !== cert.id && !st?.passed;
    const status: { label: string; tone: Tone } = st?.passed ? { label: `Earned, ${st.score}%`, tone: 'good' }
      : st?.inProgress ? { label: 'In progress', tone: 'warn' }
      : enrolledId === cert.id ? { label: 'Not passed yet', tone: 'bad' }
      : { label: 'Not started', tone: 'mute' };
    const action = lockedByOther ? { label: 'Switch to this exam', primary: false }
      : st?.passed ? { label: 'View result', primary: false }
      : st?.inProgress ? { label: 'Continue', primary: true }
      : enrolledId === cert.id ? { label: 'Retake', primary: true }
      : { label: 'Start exam', primary: true };
    return (
      <div key={cert.id} className={FRAMED_CARD} style={{ background: C.card, cursor: 'default' }}>
        <a href={href} aria-label={`Open ${cert.title}`} className="grid aspect-video w-full place-items-center" style={{ background: C.pill }}>
          <CredentialSeal cert={cert} C={C}/>
        </a>
        <div className="flex flex-1 flex-col gap-3.5 px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-[18px] sm:pt-3.5">
          <div>
            <a href={href} className="line-clamp-2 text-[15px] font-bold leading-5 hover:underline" style={{ color: C.text }}>{cert.title}</a>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: C.muted }}>
              <span className="inline-flex items-center gap-1"><Target size={13} weight="bold"/>Pass {cert.passmark ?? 70}%</span>
              <span className="inline-flex items-center gap-1"><Clock size={13} weight="bold"/>{cert.time_limit ? `${cert.time_limit} min` : 'Untimed'}</span>
              {cert.max_attempts ? <span>{cert.max_attempts} attempt{cert.max_attempts === 1 ? '' : 's'}</span> : null}
            </p>
            {cert.description && <p className="mt-2 line-clamp-2 text-[13px]" style={{ color: C.muted }}>{toPlainText(cert.description)}</p>}
          </div>
          <div className="mt-auto">
            <div className="flex items-center justify-between gap-3">
              <Pill tone={status.tone} dot={status.tone === 'good'} C={C}>{status.label}</Pill>
              <a href={href} className={btnClass} style={action.primary ? { background: DARK_C.cta, color: '#ffffff' } : btnStyle('sec', C)}>{action.label}</a>
            </div>
            {lockedByOther && <p className="mt-1.5 text-[11px]" style={{ color: C.muted }}>You have another exam in progress.</p>}
          </div>
        </div>
      </div>
    );
  };

  // Grouped by type. Anything without a type (legacy rows) falls under Technology.
  const GROUPS: { type: CertificationType; label: string }[] = [
    { type: 'career', label: 'Career certifications' },
    { type: 'technology', label: 'Technology certifications' },
  ];
  const passed = items.filter(c => attempts[c.id]?.passed);
  const best = passed.sort((a, b) => (attempts[b.id]?.score ?? 0) - (attempts[a.id]?.score ?? 0))[0];
  const current = items.find(c => attempts[c.id]?.inProgress);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat C={C} label="Earned" value={passed.length} sub={best ? `${best.title}, ${attempts[best.id].score}%` : 'None yet'}/>
        <Stat C={C} label="In progress" value={current ? 1 : 0} sub={current ? current.title : 'One exam at a time'}/>
        <Stat C={C} label="Available to you" value={items.length} sub="Open to your cohort"/>
      </div>

      {GROUPS.map(g => {
        const groupItems = items.filter(c => (c.cert_type === 'career' ? 'career' : 'technology') === g.type);
        if (!groupItems.length) return null;
        return (
          <section key={g.type} className="mt-7">
            <h3 className="mb-3 text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{g.label}</h3>
            <div className={GRID}>{groupItems.map(renderCard)}</div>
          </section>
        );
      })}

      <section className={`mt-7 rounded-2xl px-5 py-[18px] ${CARD_SHADOW}`} style={{ background: C.card }}>
        <h3 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>How it works</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {STEPS.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-3">
              <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.text }}><Icon size={20} weight="duotone"/></span>
              <div>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>
                <p className="text-[13px]" style={{ color: C.muted }}>{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {publicPaths.length > 0 && (
        <section className="mt-7">
          <h3 className="mb-3 text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Prepare with a learning path</h3>
          <div className={GRID}>
            {publicPaths.map(path => {
              const href = `/${encodeURIComponent(path.id)}?catalogueType=learning_path`;
              const blurb = toPlainText(path.description);
              const count = path.pathCourses.length;
              return (
                <a key={path.id} href={href} className={FRAMED_CARD} style={{ background: C.card }}>
                  <div className="relative grid aspect-video w-full place-items-center overflow-hidden" style={{ background: C.pill, color: C.faint }}>
                    {path.imageUrl
                      ? <img src={path.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
                      : <BookOpen size={32} weight="duotone"/>}
                  </div>
                  <div className="flex flex-1 flex-col gap-3.5 px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-[18px] sm:pt-3.5">
                    <div>
                      <p className="line-clamp-2 text-[15px] font-bold leading-5" style={{ color: C.text }}>{path.title}</p>
                      <p className="mt-1 line-clamp-1 text-xs" style={{ color: C.muted }}>
                        {[blurb, count ? `${count} item${count === 1 ? '' : 's'}` : ''].filter(Boolean).join('. ')}
                      </p>
                    </div>
                    <span className={`${btnClass} mt-auto self-end`} style={btnStyle('sec', C)}>Open path</span>
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
