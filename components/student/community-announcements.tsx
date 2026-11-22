'use client';

// Community and Tech Blog. Community: the cohort's groups as cards with a WhatsApp Join.
// Tech Blog: the first pinned post as a wide feature card, the rest as cards; a post opens in a
// dialog with Like, Save and More posts. Icons are Phosphor, as the menu.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { renderAnnouncementContent, sanitizeAnnouncementContent } from '@/lib/sanitize';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import { announcementCohortFilter, isIndividualCohort } from '@/lib/cohort-kind';
import { getStudentMode } from '@/lib/student-mode-client';
import { toPlainText } from '@/lib/plain-text';
import { FRAMED_CARD } from '@/components/CardMeta';
import { DISPLAY_FONT, btnClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { LearningCardsSkeleton } from '@/components/student/learning-card';
import { ArrowSquareOut, Article, BookmarkSimple, Megaphone, Play, PushPin, ThumbsUp, UsersThree, WhatsappLogo, X } from '@phosphor-icons/react';

const GRID = 'grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 sm:gap-6';
const CARD_BODY = 'flex flex-1 flex-col gap-3.5 px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-[18px] sm:pt-3.5';

// --- Community section ---
export function CommunitySection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [communities, setCommunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: student } = await supabase.from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
      // A synthetic individual-enrollment cohort (migration 165) has no community --
      // treat it the same as no cohort at all.
      if (!student?.cohort_id || isIndividualCohort((student as any).cohort?.cohort_kind)) { setLoading(false); return; }
      const { data } = await supabase
        .from('communities')
        .select('id, name, description, whatsapp_link, cover_image, status, created_at')
        .contains('cohort_ids', [student.cohort_id])
        .eq('status', 'active')
        .order('created_at', { ascending: false });
      setCommunities(data ?? []);
      setLoading(false);
    };
    load();
  }, [userId]);

  if (loading) return <LearningCardsSkeleton C={C} bar={false}/>;

  if (!communities.length) return (
    <EmptyState icon={UsersThree} title="No communities yet" body="Communities are being set up. Check back soon to connect with fellow students."/>
  );

  return (
    <div className={GRID}>
      {communities.map(com => (
        <div key={com.id} className={FRAMED_CARD} style={{ background: C.card, cursor: 'default' }}>
          <div className="grid aspect-video w-full place-items-center overflow-hidden" style={{ background: C.pill, color: C.faint }}>
            {com.cover_image
              ? <img src={com.cover_image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
              : <UsersThree size={34} weight="duotone"/>}
          </div>
          <div className={CARD_BODY}>
            <div>
              <h3 className="line-clamp-2 text-[15px] font-bold leading-5" style={{ color: C.text }}>{com.name}</h3>
              {com.description && <p className="mt-1 line-clamp-2 text-[13px]" style={{ color: C.muted }}>{toPlainText(com.description)}</p>}
            </div>
            <div className="mt-auto flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                {com.whatsapp_link ? <><WhatsappLogo size={16} weight="fill" style={{ color: '#25D366' }}/>WhatsApp group</> : 'Community'}
              </span>
              {com.whatsapp_link && (
                <a href={com.whatsapp_link} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('sec', C)}>
                  <ArrowSquareOut size={14} weight="bold"/> Join
                </a>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Tech Blog (announcements) ---

type Reactions = { liked: boolean; bookmarked: boolean };
const NO_REACTIONS: Reactions = { liked: false, bookmarked: false };

const youtubeId = (url?: string | null) => url?.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
const postDate = (iso: string, long = false) =>
  new Date(iso).toLocaleDateString('en-US', long ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
const authorOf = (ann: any) => {
  const name: string = ann.author?.full_name || 'Admin';
  return { name, initials: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), avatar: ann.author?.avatar_url as string | undefined };
};

/** The post's cover, else its YouTube thumbnail, else an article icon; a play mark on videos. */
function PostCover({ ann, C, iconSize = 30 }: { ann: any; C: typeof LIGHT_C; iconSize?: number }) {
  const [broken, setBroken] = useState(false);
  const embedId = youtubeId(ann.youtube_url);
  const src = ann.cover_image || (embedId ? `https://img.youtube.com/vi/${embedId}/hqdefault.jpg` : null);
  return (
    <>
      {src && !broken
        ? <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>
        : <span className="grid h-full w-full place-items-center" style={{ color: C.faint }}><Article size={iconSize} weight="duotone"/></span>}
      {embedId && (
        <span className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="grid h-11 w-11 place-items-center rounded-full" style={{ background: 'rgba(0,0,0,0.6)', color: '#ffffff' }}><Play size={18} weight="fill"/></span>
        </span>
      )}
    </>
  );
}

function Byline({ ann, C, long }: { ann: any; C: typeof LIGHT_C; long?: boolean }) {
  const a = authorOf(ann);
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs" style={{ color: C.muted }}>
      <span className="grid h-6 w-6 flex-shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold" style={{ background: C.pill, color: C.text }}>
        {a.avatar ? <img src={a.avatar} alt="" className="h-full w-full object-cover"/> : a.initials}
      </span>
      <span className="truncate">{a.name}, {postDate(ann.published_at, long)}</span>
    </span>
  );
}

/** Save as a square icon button, blue while saved. */
function SaveButton({ on, onToggle, C }: { on: boolean; onToggle: () => void; C: typeof LIGHT_C }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onToggle(); }} aria-label={on ? 'Saved' : 'Save'} aria-pressed={on} title={on ? 'Saved' : 'Save'}
      className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl transition-opacity hover:opacity-80"
      style={on ? selectedStyle : btnStyle('sec', C)}>
      <BookmarkSimple size={15} weight={on ? 'fill' : 'bold'}/>
    </button>
  );
}
const selectedStyle = { background: `color-mix(in srgb, ${DARK_C.cta} 12%, transparent)`, color: DARK_C.cta, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${DARK_C.cta} 30%, transparent)` };

function PostCard({ ann, C, react, onSave, onOpen }: { ann: any; C: typeof LIGHT_C; react: Reactions; onSave: () => void; onOpen: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e => { if (e.key === 'Enter') onOpen(); }} className={FRAMED_CARD} style={{ background: C.card }}>
      <div className="relative aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
        <PostCover ann={ann} C={C}/>
        {ann.is_pinned && <PinnedRibbon/>}
      </div>
      <div className={CARD_BODY}>
        <div>
          <h3 className="line-clamp-2 min-h-[40px] text-[15px] font-bold leading-5" style={{ color: C.text }}>{ann.title}</h3>
          {ann.subtitle && <p className="mt-1 line-clamp-1 text-xs" style={{ color: C.muted }}>{ann.subtitle}</p>}
        </div>
        <div className="mt-auto flex items-center justify-between gap-3">
          <Byline ann={ann} C={C}/>
          <SaveButton on={react.bookmarked} onToggle={onSave} C={C}/>
        </div>
      </div>
    </div>
  );
}

function PinnedRibbon() {
  return (
    <span className="absolute left-0 top-3 inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
      <PushPin size={12} weight="fill"/> Pinned
    </span>
  );
}

function AnnouncementModal({ ann, C, react, onToggleReaction, onClose, otherItems, onSelect }: {
  ann: any; C: typeof LIGHT_C; react: Reactions;
  onToggleReaction: (type: 'like' | 'bookmark') => void;
  onClose: () => void;
  otherItems: any[];
  onSelect: (a: any) => void;
}) {
  const embedId = youtubeId(ann.youtube_url);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <motion.div ref={backdropRef} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto px-4 py-8"
      style={{ background: 'rgba(10,12,18,0.55)', backdropFilter: 'blur(6px)' }}>
      <motion.div role="dialog" aria-modal="true" aria-labelledby="post-title"
        initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
        className="relative m-auto w-full max-w-[640px] overflow-hidden rounded-[20px] shadow-2xl" style={{ background: C.card }}>
        <div className="p-5 pb-4 md:p-6 md:pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {ann.is_pinned && (
                <span className="mb-2 inline-flex items-center gap-1 rounded-full px-2 text-xs font-semibold leading-[22px]" style={{ background: C.pill, color: C.text }}>
                  <PushPin size={12} weight="fill"/> Pinned
                </span>
              )}
              <h1 id="post-title" className="text-2xl font-semibold leading-[30px]" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{ann.title}</h1>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={btnStyle('sec', C)}>
              <X size={14} weight="bold"/>
            </button>
          </div>
          <div className="mt-3"><Byline ann={ann} C={C} long/></div>
        </div>

        {ann.cover_image && (
          <img src={ann.cover_image} alt="" className="block aspect-video max-h-[260px] w-full object-cover"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}/>
        )}

        <div className="p-5 md:p-6">
          {embedId && (
            <div className="relative mb-5 h-0 overflow-hidden rounded-xl pb-[56.25%]">
              <iframe src={`https://www.youtube.com/embed/${embedId}`} title={ann.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                className="absolute inset-0 h-full w-full border-0"/>
            </div>
          )}
          {ann.content && (
            <div className="rich-content compact" style={{ color: C.text, fontSize: 15.5 }}
              dangerouslySetInnerHTML={{ __html: renderAnnouncementContent(sanitizeAnnouncementContent(ann.content ?? '')) }}/>
          )}
          <div className="mt-6 flex items-center gap-2 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            <button type="button" onClick={() => onToggleReaction('like')} aria-pressed={react.liked} className={btnClass} style={react.liked ? selectedStyle : btnStyle('sec', C)}>
              <ThumbsUp size={16} weight={react.liked ? 'fill' : 'bold'}/> {react.liked ? 'Liked' : 'Like'}
            </button>
            <button type="button" onClick={() => onToggleReaction('bookmark')} aria-pressed={react.bookmarked} className={btnClass} style={react.bookmarked ? selectedStyle : btnStyle('sec', C)}>
              <BookmarkSimple size={16} weight={react.bookmarked ? 'fill' : 'bold'}/> {react.bookmarked ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {otherItems.length > 0 && (
          <div className="px-5 pb-6 md:px-6" style={{ borderTop: `1px solid ${C.divider}` }}>
            <p className="mb-2 mt-5 text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>More posts</p>
            <div className="space-y-1">
              {otherItems.slice(0, 3).map(item => (
                <button key={item.id} type="button" onClick={() => onSelect(item)} className="group flex w-full items-center gap-3 rounded-xl py-2 text-left">
                  <span className="relative h-11 w-[72px] flex-shrink-0 overflow-hidden rounded-lg" style={{ background: C.pill }}>
                    <PostCover ann={item} C={C} iconSize={18}/>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm font-semibold leading-snug group-hover:underline" style={{ color: C.text }}>{item.title}</span>
                    <span className="mt-0.5 block text-xs" style={{ color: C.muted }}>{postDate(item.published_at, true)}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

export function AnnouncementsSection({ userId: userIdProp, C }: { userId?: string; C: typeof LIGHT_C }) {
  const [items, setItems]     = useState<any[]>([]);
  const [userId, setUserId]   = useState('');
  const [reactState, setReactState] = useState<Record<string, Reactions>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [acting, setActing]   = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const effectiveUserId = userIdProp ?? user.id;
      setUserId(effectiveUserId);

      const { data: student } = await supabase.from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', effectiveUserId).single();
      // Both individual cohort kinds receive platform-wide announcements, but not
      // bootcamp-cohort announcements. Empty cohort_ids is the existing global marker.
      const audienceFilter = announcementCohortFilter(student?.cohort_id, (student as any)?.cohort?.cohort_kind);
      let announcementQuery = supabase
        .from('announcements')
        .select('id, title, subtitle, content, cover_image, youtube_url, is_pinned, published_at, author_id')
        .lte('published_at', new Date().toISOString())
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(50);
      announcementQuery = audienceFilter === null
        ? announcementQuery.eq('cohort_ids', '{}')
        : announcementQuery.or(audienceFilter);
      const { data: anns } = await announcementQuery;

      const authorIds = [...new Set((anns ?? []).map((a: any) => a.author_id).filter(Boolean))];
      const { data: authors } = authorIds.length
        ? await supabase.rpc('get_staff_profiles', { p_ids: authorIds })
        : { data: [] };
      const authorMap: Record<string, any> = {};
      for (const a of authors ?? []) authorMap[a.id] = a;

      const { data: reactions } = await supabase
        .from('announcement_reactions')
        .select('announcement_id, type')
        .eq('student_id', effectiveUserId);

      const likes = new Set<string>();
      const bookmarks = new Set<string>();
      for (const r of reactions ?? []) {
        if (r.type === 'like') likes.add(r.announcement_id);
        if (r.type === 'bookmark') bookmarks.add(r.announcement_id);
      }

      const enriched = (anns ?? []).map((a: any) => ({ ...a, author: authorMap[a.author_id] ?? null }));
      setItems(enriched);
      const rs: Record<string, Reactions> = {};
      for (const a of enriched) rs[a.id] = { liked: likes.has(a.id), bookmarked: bookmarks.has(a.id) };
      setReactState(rs);
      setLoading(false);
    };
    load();
  }, [userIdProp]);

  async function toggleReaction(annId: string, type: 'like' | 'bookmark') {
    if (acting || !userId) return;
    if (getStudentMode()) return; // read-only: never react on a student's behalf in Student Mode
    setActing(true);
    const prev = reactState[annId] ?? NO_REACTIONS;
    const isOn = type === 'like' ? prev.liked : prev.bookmarked;
    setReactState(s => ({
      ...s,
      [annId]: type === 'like' ? { ...prev, liked: !prev.liked } : { ...prev, bookmarked: !prev.bookmarked },
    }));
    try {
      // supabase-js reports a refused write as { error }, not by throwing; undo it either way.
      const { error } = isOn
        ? await supabase.from('announcement_reactions')
          .delete().eq('announcement_id', annId).eq('student_id', userId).eq('type', type)
        : await supabase.from('announcement_reactions')
          .insert({ announcement_id: annId, student_id: userId, type });
      if (error) throw error;
    } catch {
      setReactState(s => ({ ...s, [annId]: prev }));
    } finally { setActing(false); }
  }

  if (loading) return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid overflow-hidden rounded-2xl md:grid-cols-[1.1fr_1fr]" style={{ background: C.card }}>
        <div className="aspect-video w-full animate-pulse md:aspect-auto md:min-h-[220px]" style={{ background: C.skeleton }}/>
        <div className="space-y-3 p-5"><Sk h={22} w="80%"/><Sk h={13} w="60%"/><Sk h={11} w="40%"/><div className="pt-6"><Sk w={110} h={40} r={12}/></div></div>
      </div>
      <LearningCardsSkeleton C={C} bar={false}/>
    </div>
  );

  if (!items.length) return (
    <EmptyState icon={Megaphone} title="No posts yet" body="Tech blog posts from instructors and admins will appear here."/>
  );

  // The first pinned post leads; everything else (other pinned posts first, as the query orders) follows.
  const featured = items[0]?.is_pinned ? items[0] : null;
  const rest = featured ? items.slice(1) : items;
  const reactOf = (id: string) => reactState[id] ?? NO_REACTIONS;

  return (
    <>
      {featured && (
        <div role="button" tabIndex={0} onClick={() => setSelected(featured)} onKeyDown={e => { if (e.key === 'Enter') setSelected(featured); }}
          className="group grid cursor-pointer overflow-hidden rounded-2xl shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)] md:grid-cols-[1.1fr_1fr]"
          style={{ background: C.card }}>
          <div className="relative aspect-video w-full overflow-hidden md:aspect-auto md:min-h-[220px]" style={{ background: C.pill }}>
            <PostCover ann={featured} C={C} iconSize={40}/>
            <PinnedRibbon/>
          </div>
          <div className="flex flex-col gap-2.5 p-5 md:p-6">
            <h3 className="text-[22px] font-semibold leading-7" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{featured.title}</h3>
            {featured.subtitle && <p className="text-sm" style={{ color: C.muted }}>{featured.subtitle}</p>}
            <Byline ann={featured} C={C} long/>
            <div className="mt-auto flex items-center gap-2 pt-3">
              <span className={btnClass} style={{ background: DARK_C.cta, color: '#ffffff' }}>Read post</span>
              <SaveButton on={reactOf(featured.id).bookmarked} onToggle={() => toggleReaction(featured.id, 'bookmark')} C={C}/>
            </div>
          </div>
        </div>
      )}

      {rest.length > 0 && (
        <section className={featured ? 'mt-7' : ''}>
          {featured && <h3 className="mb-3 text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Latest posts</h3>}
          <div className={GRID}>
            {rest.map(ann => (
              <PostCard key={ann.id} ann={ann} C={C} react={reactOf(ann.id)}
                onSave={() => toggleReaction(ann.id, 'bookmark')} onOpen={() => setSelected(ann)}/>
            ))}
          </div>
        </section>
      )}

      <AnimatePresence>
        {selected && (
          <AnnouncementModal ann={selected} C={C} react={reactOf(selected.id)}
            onToggleReaction={type => toggleReaction(selected.id, type)}
            onClose={() => setSelected(null)}
            otherItems={items.filter(i => i.id !== selected.id)}
            onSelect={setSelected}/>
        )}
      </AnimatePresence>
    </>
  );
}
