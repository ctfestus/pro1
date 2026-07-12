'use client';

// Community + Announcements (Tech Blog) sections, extracted verbatim from
// app/student/page.tsx. CommunitySection and AnnouncementsSection are exported;
// AnnThumbnail / AnnouncementCard / AnnouncementModal are file-internal.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { renderAnnouncementContent } from '@/lib/sanitize';
import { LIGHT_C, useC } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import { getStudentMode } from '@/lib/student-mode-client';
import {
  Users, Megaphone, X, ExternalLink, ChevronRight, ChevronLeft, Play, ThumbsUp, Bookmark,
} from 'lucide-react';

// --- Community section ---
export function CommunitySection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [communities, setCommunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: student } = await supabase.from('students').select('cohort_id').eq('id', userId).single();
      if (!student?.cohort_id) { setLoading(false); return; }
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

  if (loading) return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[0,1,2,3].map(i => (
        <div key={i} className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
          <Sk h={140} r={0}/><div className="p-4 space-y-2"><Sk h={15} w="70%"/><Sk h={11} w="50%"/></div>
        </div>
      ))}
    </div>
  );

  if (!communities.length) return (
    <EmptyState icon={Users} title="No communities yet" body="Communities are being set up. Check back soon to connect with fellow students."/>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {communities.map((com, i) => (
        <motion.div key={com.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
          className="rounded-2xl overflow-hidden group"
          style={{ background: C.card }}>
          <div className="relative h-36 overflow-hidden" style={{ background: C.thumbBg }}>
            {com.cover_image
              ? <img src={com.cover_image} alt={com.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
              : <div className="w-full h-full flex items-center justify-center"><Users className="w-10 h-10 opacity-25" style={{ color: C.green }}/></div>}
          </div>
          <div className="p-4">
            <h3 className="text-sm font-semibold leading-snug mb-1 truncate" style={{ color: C.text }}>{com.name}</h3>
            {com.description && <p className="text-xs line-clamp-2 mb-3" style={{ color: C.muted }}>{com.description.replace(/<[^>]*>/g, ' ').trim()}</p>}
            {com.whatsapp_link ? (
              <a href={com.whatsapp_link} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl no-underline hover:opacity-80 transition-opacity"
                style={{ background: '#dcfce7', color: '#16a34a' }}>
                <ExternalLink className="w-3.5 h-3.5"/> Join WhatsApp
              </a>
            ) : (
              <span className="text-xs font-medium" style={{ color: C.faint }}>Community</span>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  );
}

// --- Announcements section (tech-blog style) ---

function AnnThumbnail({ ann, isVideo }: { ann: any; isVideo: boolean }) {
  const C = useC();
  const embedId = ann.youtube_url?.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  const src = ann.cover_image || (embedId ? `https://img.youtube.com/vi/${embedId}/hqdefault.jpg` : null);
  const initLetter = (ann.title?.[0] ?? 'A').toUpperCase();

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {src ? (
        <>
          <img src={src} alt={ann.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}/>
          {(embedId || isVideo) && (
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Play style={{ width: 13, height: 13, color: '#111', marginLeft: 2 }}/>
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.lime, fontSize: 32, fontWeight: 800, color: C.green, opacity: 0.6 }}>
          {initLetter}
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({ ann, C, react, onToggleReaction, onClick }: {
  ann: any; C: typeof LIGHT_C;
  react: { liked: boolean; bookmarked: boolean; likeCount: number; bookmarkCount: number };
  onToggleReaction: (type: 'like' | 'bookmark') => void;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const authorName = ann.author?.full_name || 'Admin';
  const authorInitials = authorName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const hasVideo = !!ann.youtube_url;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex-shrink-0 snap-start cursor-pointer flex flex-col"
      style={{ width: 300, padding: 8, borderRadius: 14, boxSizing: 'border-box', background: hovered ? C.pill : 'transparent', transition: 'background 0.2s' }}>
      {/* Thumbnail */}
      <div className="relative rounded-xl overflow-hidden w-full" style={{ aspectRatio: '16 / 9', background: C.lime }}>
        <AnnThumbnail ann={ann} isVideo={hasVideo}/>
        {ann.is_pinned && (
          <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(0,0,0,0.65)', color: 'white' }}>Pinned</span>
        )}
      </div>
      {/* Meta row -- YouTube style: avatar + title/author/date */}
      <div className="mt-3 flex gap-3 min-w-0">
        <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-xs font-bold"
          style={{ background: C.green, color: '#fff' }}>
          {ann.author?.avatar_url
            ? <img src={ann.author.avatar_url} alt={authorName} className="w-full h-full object-cover"/>
            : authorInitials}
        </div>
        <div className="flex-1 min-w-0">
          <h3 style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: C.text }}>{ann.title}</h3>
          <div className="flex items-center gap-2 text-[13px] mt-1" style={{ color: C.faint }}>
            <span>{authorName}</span>
            {react.likeCount > 0 && (
              <>
                <span>&middot;</span>
                <span>{react.likeCount} {react.likeCount === 1 ? 'like' : 'likes'}</span>
              </>
            )}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onToggleReaction('bookmark'); }}
          aria-label={react.bookmarked ? 'Saved' : 'Save'}
          className="flex-shrink-0 self-start transition-opacity hover:opacity-70"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: react.bookmarked ? C.green : C.faint, padding: 2 }}>
          <Bookmark className="w-4 h-4" style={{ fill: react.bookmarked ? C.green : 'none' }}/>
        </button>
      </div>
    </div>
  );
}

function AnnouncementModal({ ann, C, react, onToggleReaction, onClose, otherItems, onSelect }: {
  ann: any; C: typeof LIGHT_C;
  react: { liked: boolean; bookmarked: boolean; likeCount: number; bookmarkCount: number };
  onToggleReaction: (type: 'like' | 'bookmark') => void;
  onClose: () => void;
  otherItems: any[];
  onSelect: (a: any) => void;
}) {
  const pub = new Date(ann.published_at);
  const dateStr = pub.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const authorName = ann.author?.full_name || 'Admin';
  const authorInitials = authorName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const embedId = ann.youtube_url?.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <motion.div
      ref={backdropRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={e => { if (e.target === backdropRef.current) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 24 }}
        className="w-full rounded-2xl overflow-hidden relative"
        style={{ maxWidth: 640, background: C.card, boxShadow: '0 32px 80px rgba(0,0,0,0.35)', margin: 'auto' }}>

        {/* Close */}
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center hover:opacity-70 transition-opacity"
          style={{ background: 'rgba(0,0,0,0.5)', border: 'none', cursor: 'pointer', color: 'white' }}>
          <X className="w-4 h-4"/>
        </button>

        {/* Header: pinned + title + author */}
        <div className="p-5 md:p-6 pb-4">
          {ann.is_pinned && (
            <span className="inline-block text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full mb-3"
              style={{ background: `${C.green}18`, color: C.green }}>Pinned</span>
          )}
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, lineHeight: 1.25, letterSpacing: '-0.02em', color: C.text, marginBottom: '0.8rem' }}>
            {ann.title}
          </h1>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center overflow-hidden text-sm font-bold"
              style={{ background: C.green, color: '#fff' }}>
              {ann.author?.avatar_url
                ? <img src={ann.author.avatar_url} alt={authorName} className="w-full h-full object-cover"/>
                : authorInitials}
            </div>
            <div>
              <p className="text-base font-semibold" style={{ color: C.text }}>{authorName}</p>
              <p className="text-sm" style={{ color: C.faint }}>{dateStr}</p>
            </div>
          </div>
        </div>

        {/* Cover image -- full width, edge to edge */}
        {ann.cover_image && (
          <img src={ann.cover_image} alt={ann.title}
            style={{ width: '100%', display: 'block', aspectRatio: '16/9', maxHeight: 260, objectFit: 'cover' }}
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}/>
        )}

        {/* Body */}
        <div className="p-5 md:p-6">
          {embedId && (
            <div className="mb-5" style={{ borderRadius: 12, overflow: 'hidden', position: 'relative', paddingBottom: '56.25%', height: 0 }}>
              <iframe
                src={`https://www.youtube.com/embed/${embedId}`}
                title={ann.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none' }}
              />
            </div>
          )}
          {ann.content && (
            <div className="rich-content compact" style={{ color: C.text, fontSize: 15.5 }}
              dangerouslySetInnerHTML={{ __html: renderAnnouncementContent(ann.content) }}
            />
          )}
          <div className="flex items-center gap-3 mt-6 pt-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            <button
              onClick={() => onToggleReaction('like')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: react.liked ? '#2563eb18' : C.pill, border: 'none', cursor: 'pointer', color: react.liked ? '#2563eb' : C.muted }}>
              <ThumbsUp className="w-4 h-4" style={{ fill: react.liked ? '#2563eb' : 'none' }}/>
              {react.liked ? 'Liked' : 'Like'}
              {react.likeCount > 0 && <span className="text-xs opacity-60 ml-0.5">{react.likeCount}</span>}
            </button>
            <button
              onClick={() => onToggleReaction('bookmark')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
              style={{ background: react.bookmarked ? `${C.green}18` : C.pill, border: 'none', cursor: 'pointer', color: react.bookmarked ? C.green : C.muted }}>
              <Bookmark className="w-4 h-4" style={{ fill: react.bookmarked ? C.green : 'none' }}/>
              {react.bookmarked ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>

        {/* More posts */}
        {otherItems.length > 0 && (
          <div className="px-5 md:px-6 pb-6" style={{ borderTop: `1px solid ${C.divider}` }}>
            <p className="text-xs font-bold uppercase tracking-wide mt-5 mb-3" style={{ color: C.faint }}>More Posts</p>
            <div className="space-y-3">
              {otherItems.slice(0, 3).map(item => {
                const embedId = item.youtube_url?.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/)?.[1];
                const thumbSrc = item.cover_image || (embedId ? `https://img.youtube.com/vi/${embedId}/hqdefault.jpg` : null);
                const initLetter = (item.title?.[0] ?? 'A').toUpperCase();
                const itemDate = new Date(item.published_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                return (
                  <button key={item.id} onClick={() => onSelect(item)}
                    className="w-full text-left flex items-center gap-3 transition-opacity hover:opacity-70"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {/* Thumbnail */}
                    <div style={{ width: 80, height: 56, flexShrink: 0, borderRadius: 8, overflow: 'hidden', background: C.lime, position: 'relative' }}>
                      {thumbSrc
                        ? <img src={thumbSrc} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 800, color: C.green, opacity: 0.5 }}>{initLetter}</div>
                      }
                      {embedId && (
                        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Play style={{ width: 9, height: 9, color: '#111', marginLeft: 1 }}/>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Text */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-snug mb-0.5"
                        style={{ color: C.text, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.title}
                      </p>
                      <p className="text-xs" style={{ color: C.faint }}>{itemDate}</p>
                    </div>
                  </button>
                );
              })}
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
  const [reactState, setReactState] = useState<Record<string, { liked: boolean; bookmarked: boolean; likeCount: number; bookmarkCount: number }>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [acting, setActing]   = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const effectiveUserId = userIdProp ?? user.id;
      setUserId(effectiveUserId);

      const { data: student } = await supabase.from('students').select('cohort_id').eq('id', effectiveUserId).single();
      if (!student?.cohort_id) { setLoading(false); return; }

      const { data: anns } = await supabase
        .from('announcements')
        .select('id, title, subtitle, content, cover_image, youtube_url, is_pinned, published_at, author_id')
        .or(`cohort_ids.cs.{${student.cohort_id}},cohort_ids.eq.{}`)
        .lte('published_at', new Date().toISOString())
        .order('is_pinned', { ascending: false })
        .order('published_at', { ascending: false })
        .limit(50);

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
      const rs: Record<string, { liked: boolean; bookmarked: boolean; likeCount: number; bookmarkCount: number }> = {};
      for (const a of enriched) rs[a.id] = { liked: likes.has(a.id), bookmarked: bookmarks.has(a.id), likeCount: 0, bookmarkCount: 0 };
      setReactState(rs);
      setLoading(false);
    };
    load();
  }, [userIdProp]);

  async function toggleReaction(annId: string, type: 'like' | 'bookmark') {
    if (acting || !userId) return;
    if (getStudentMode()) return; // read-only: never react on a student's behalf in Student Mode
    setActing(true);
    const prev = reactState[annId] ?? { liked: false, bookmarked: false, likeCount: 0, bookmarkCount: 0 };
    const isOn = type === 'like' ? prev.liked : prev.bookmarked;
    setReactState(s => ({
      ...s,
      [annId]: {
        liked: type === 'like' ? !prev.liked : prev.liked,
        bookmarked: type === 'bookmark' ? !prev.bookmarked : prev.bookmarked,
        likeCount: type === 'like' ? prev.likeCount + (isOn ? -1 : 1) : prev.likeCount,
        bookmarkCount: type === 'bookmark' ? prev.bookmarkCount + (isOn ? -1 : 1) : prev.bookmarkCount,
      }
    }));
    try {
      if (isOn) {
        await supabase.from('announcement_reactions')
          .delete().eq('announcement_id', annId).eq('student_id', userId).eq('type', type);
      } else {
        await supabase.from('announcement_reactions')
          .insert({ announcement_id: annId, student_id: userId, type });
      }
    } catch {
      setReactState(s => ({ ...s, [annId]: prev }));
    } finally { setActing(false); }
  }

  if (loading) return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <Sk h={22} w="180px"/>
      <div className="flex gap-4 overflow-hidden mt-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="flex-shrink-0" style={{ width: 250 }}>
            <div className="w-full rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9', background: C.skeleton }}/>
            <div className="mt-2.5 space-y-2">
              <Sk h={11} w="30%"/>
              <Sk h={14} w="85%"/>
              <Sk h={11}/><Sk h={11} w="60%"/>
            </div>
          </div>
        ))}
      </div>
    </section>
  );

  if (!items.length) return (
    <EmptyState icon={Megaphone} title="No posts yet" body="Tech blog posts from instructors and admins will appear here."/>
  );

  return (
    <>
      <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
        {/* Header: title + nav arrows */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: C.text }}>Tech Blog</h3>
            <p className="text-sm mt-1" style={{ color: C.muted }}>The latest in tech, AI trends, data insights, and tips to level up your career.</p>
          </div>
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
        {/* Carousel */}
        <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {items.map(ann => (
            <AnnouncementCard
              key={ann.id}
              ann={ann}
              C={C}
              react={reactState[ann.id] ?? { liked: false, bookmarked: false, likeCount: 0, bookmarkCount: 0 }}
              onToggleReaction={type => toggleReaction(ann.id, type)}
              onClick={() => setSelected(ann)}
            />
          ))}
        </div>
      </section>
      <AnimatePresence>
        {selected && (
          <AnnouncementModal
            ann={selected}
            C={C}
            react={reactState[selected.id] ?? { liked: false, bookmarked: false, likeCount: 0, bookmarkCount: 0 }}
            onToggleReaction={type => toggleReaction(selected.id, type)}
            onClose={() => setSelected(null)}
            otherItems={items.filter(i => i.id !== selected.id)}
            onSelect={setSelected}
          />
        )}
      </AnimatePresence>
    </>
  );
}
