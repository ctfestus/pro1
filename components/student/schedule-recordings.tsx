'use client';

// Data Playground, Recordings and Schedule sections, extracted verbatim from
// app/student/page.tsx. DataCenterSection, RecordingsSection and ScheduleSection are
// exported; getDataCenterAuthHeaders and ScheduleDetail are file-internal.

import { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import { LIGHT_C, DARK_C } from '@/lib/theme';
import { DataPlaygroundGrid } from '@/components/data-playground/lazy';
import { Sk, EmptyState } from '@/components/student/shared';
import { isIndividualCohort } from '@/lib/cohort-kind';
import {
  ArrowLeft, BookOpen, Calendar, ChevronLeft, ChevronRight, Download, ExternalLink, FileText,
  Mic, Paperclip, Play, PlayCircle, Video,
} from 'lucide-react';
import { safeEmbedUrl } from '@/lib/safe-embed-url';
import { formatAttachmentSize, safeAttachmentUrl } from '@/lib/lesson-attachment';
import { looksLikeHtml, toPlainText } from '@/lib/plain-text';
import {
  normalizeRecordingAttachments, recordingAttachmentBadge, recordingAttachmentHref,
  type RecordingAttachment,
} from '@/lib/recording-attachments';

// --- Data Center section ---
async function getDataCenterAuthHeaders(): Promise<HeadersInit | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;
}

export function DataCenterSection({ C }: { C: typeof LIGHT_C }) {
  const { theme } = useTheme();

  return (
    <DataPlaygroundGrid
      C={C}
      isDark={theme === 'dark'}
      fetchHeaders={getDataCenterAuthHeaders}
      intro="Explore real-world datasets and sharpen your skills in data analysis, visualization, and storytelling. Each dataset comes with business questions designed to challenge how you think with data."
      loadingCardCount={3}
      emptyNoDatasetsMessage="Datasets will appear here once published by instructors."
      emptyNoMatchMessage="No datasets match your search."
    />
  );
}

// --- Schedule section ---
function ScheduleDetail({ schedule, C, onBack }: { schedule: any; C: typeof LIGHT_C; onBack: () => void }) {
  const [topics, setTopics] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/schedule?id=${schedule.id}`, {
          headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
        });
        const d = await res.json();
        setTopics(d.topics ?? []);
        setResources(d.resources ?? []);
      } catch {
        setTopics([]);
        setResources([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [schedule.id]);

  const fmt = (d?: Date | null, opts?: Intl.DateTimeFormatOptions) =>
    d ? d.toLocaleDateString('en-US', opts ?? { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const startLabel = fmt(schedule.startDate);
  const endLabel   = fmt(schedule.endDate);
  const dateRange  = endLabel && endLabel !== startLabel ? `${startLabel} -> ${endLabel}` : startLabel ?? 'Date TBA';

  const getDomain = (url: string) => { try { return new URL(url).hostname.replace('www.', ''); } catch { return url; } };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
      {/* Back */}
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-medium rounded-xl px-3 py-1.5 transition-colors"
        style={{ color: C.muted, background: C.pill, border: 'none', cursor: 'pointer' }}>
        <ArrowLeft className="w-3.5 h-3.5"/> Back
      </button>

      {/* Hero */}
      <div className="rounded-3xl overflow-hidden" style={{ background: C.card }}>
        <div className="relative" style={{ height: schedule.coverImage ? 220 : 0 }}>
          {schedule.coverImage && (
            <img src={schedule.coverImage} alt={schedule.title} className="w-full h-full object-cover"/>
          )}
        </div>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="text-xl font-bold leading-tight" style={{ color: C.text }}>{schedule.title}</h2>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
              style={{ background: `${C.green}12`, color: C.green }}>Active</span>
          </div>
          <div className="flex items-center gap-1.5 mb-4">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
            <span className="text-sm" style={{ color: C.muted }}>{dateRange}</span>
          </div>
          {schedule.description && (
            <p className="text-sm leading-relaxed pb-5 mb-5" style={{ color: C.muted, borderBottom: `1px solid ${C.divider}` }}>
              {schedule.description}
            </p>
          )}

          {loading ? (
            <div className="space-y-3"><Sk h={14} w="30%"/><Sk h={56} r={16}/><Sk h={56} r={16}/><Sk h={14} w="25%"/><Sk h={48} r={14}/></div>
          ) : (
            <div className="space-y-8">
              {/* Topics -- vertical stepper */}
              {topics.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: C.faint }}>
                    Topics · {topics.length}
                  </p>
                  <div className="space-y-0">
                    {topics.map((topic, i) => (
                      <motion.div key={topic.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }} className="flex gap-4">
                        {/* Dot + connector column */}
                        <div className="flex flex-col items-center flex-shrink-0" style={{ width: 32 }}>
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: C.lime, color: '#0f2d0f', border: `2px solid ${C.green}` }}>
                            {i + 1}
                          </div>
                          {i < topics.length - 1 && (
                            <div className="flex-1 w-px mt-1"
                              style={{ background: `repeating-linear-gradient(to bottom, ${C.green}40 0px, ${C.green}40 5px, transparent 5px, transparent 10px)`, minHeight: 16 }}/>
                          )}
                        </div>
                        {/* Content */}
                        <div className="flex-1 rounded-2xl p-4 mb-3" style={{ background: C.page, border: `1px solid ${C.divider}` }}>
                          <p className="text-sm font-semibold leading-snug" style={{ color: C.text }}>{topic.name}</p>
                          {topic.description && (
                            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: C.muted }}>{topic.description}</p>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Resources */}
              {resources.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.faint }}>
                    Resources · {resources.length}
                  </p>
                  <div className="space-y-2">
                    {resources.map((r, i) => (
                      <motion.a key={r.id} href={r.url} target="_blank" rel="noreferrer"
                        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center gap-3 rounded-2xl p-3.5 group"
                        style={{ background: C.page, border: `1px solid ${C.divider}`, textDecoration: 'none' }}>
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: C.card }}>
                          <FileText className="w-4 h-4" style={{ color: C.green }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{r.name}</p>
                          <p className="text-xs truncate" style={{ color: C.faint }}>{getDomain(r.url)}</p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.green }}/>
                      </motion.a>
                    ))}
                  </div>
                </div>
              )}

              {!topics.length && !resources.length && (
                <p className="text-sm text-center py-4" style={{ color: C.faint }}>No content added yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// Descriptions written before the rich-text editor are plain text with real newlines, and
// handing those to dangerouslySetInnerHTML would collapse the author's spacing into one
// paragraph. Render markup as markup, plain text as text.
function AuthoredText({ value, style }: { value: string; style?: React.CSSProperties }) {
  if (!value?.trim()) return null;
  if (looksLikeHtml(value)) {
    return <div style={style} dangerouslySetInnerHTML={{ __html: sanitizeRichText(value) }}/>;
  }
  return <p className="whitespace-pre-line" style={style}>{value}</p>;
}

// The resources handed out with a session: uploads download under the name the
// instructor gave them, pasted links open where they live.
function SessionResources({ attachments, C }: { attachments: RecordingAttachment[]; C: typeof LIGHT_C }) {
  if (!attachments.length) return null;
  return (
    <div style={{ marginTop: 26 }}>
      <p style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
        color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        <Paperclip size={12}/> Resources
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {attachments.map(att => {
          const size = formatAttachmentSize(att.size);
          return (
            <a key={att.id} href={recordingAttachmentHref(att)} target="_blank" rel="noopener noreferrer"
              download={att.kind === 'file' ? att.name : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                borderRadius: 12, background: C.pill, textDecoration: 'none' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: C.muted,
                background: C.card, borderRadius: 6, padding: '3px 6px', flexShrink: 0,
                border: `1px solid ${C.divider}` }}>
                {recordingAttachmentBadge(att)}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: C.text }} className="truncate">{att.name}</span>
                {size && <span style={{ display: 'block', fontSize: 11, color: C.faint, marginTop: 1 }}>{size}</span>}
              </span>
              {att.kind === 'file'
                ? <Download size={14} style={{ color: C.faint, flexShrink: 0 }}/>
                : <ExternalLink size={14} style={{ color: C.faint, flexShrink: 0 }}/>}
            </a>
          );
        })}
      </div>
    </div>
  );
}

// Small count pill used by the programme header.
function chip(C: typeof LIGHT_C): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '4px 10px', borderRadius: 999, background: C.pill,
    color: C.muted, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap',
  };
}

// The dark ground a session's video sits on, and that the link band borrows so a
// recording hosted elsewhere still reads as the video rather than as a notice.
const SURFACE = 'linear-gradient(135deg, #0f1115 0%, #181d26 55%, #0d1014 100%)';

// The picture on a link banner: the three things a class recording is made of, floating
// as tiles the way an illustration would. Decorative, so it is hidden from readers and
// dropped entirely on a narrow screen where the banner needs its width for words.
function RecordingIcons({ C, dim = false }: { C: typeof LIGHT_C; dim?: boolean }) {
  const tile = (Icon: any, style: React.CSSProperties, size: number, glyph: number, tint?: string) => (
    <span aria-hidden style={{
      position: 'absolute', width: size, height: size, borderRadius: 18,
      background: tint ?? C.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 12px 26px rgba(0,0,0,0.10)', ...style,
    }}>
      <Icon size={glyph} style={{ color: tint ? (C === DARK_C ? '#111' : '#fff') : C.muted }}/>
    </span>
  );

  return (
    <div aria-hidden className="hidden sm:block"
      style={{ position: 'relative', width: 212, height: 124, flexShrink: 0, opacity: dim ? 0.45 : 1 }}>
      {tile(Video, { left: 0, top: 26, transform: 'rotate(-10deg)' }, 62, 25)}
      {tile(PlayCircle, { left: 72, top: 4, transform: 'rotate(5deg)' }, 76, 32, C.green)}
      {tile(Mic, { left: 158, top: 42, transform: 'rotate(-6deg)' }, 54, 22)}
    </div>
  );
}

// Where a recording actually lives, for the cases where it cannot play in the app.
// Naming it is the honest version of a play button that opens a new tab -- but a
// student reads "Microsoft OneDrive", not "festman-my.sharepoint.com", so the hosts
// that turn up in practice get their real names and anything else falls back to the
// bare domain.
const LINK_SOURCES: [RegExp, string][] = [
  [/(^|\.)sharepoint\.com$/, 'Microsoft OneDrive'],
  [/(^|\.)onedrive\.live\.com$/, 'Microsoft OneDrive'],
  [/(^|\.)stream\.microsoft\.com$/, 'Microsoft Stream'],
  [/(^|\.)teams\.microsoft\.com$/, 'Microsoft Teams'],
  [/(^|\.)drive\.google\.com$/, 'Google Drive'],
  [/(^|\.)docs\.google\.com$/, 'Google Docs'],
  [/(^|\.)zoom\.us$/, 'Zoom'],
  [/(^|\.)dropbox\.com$/, 'Dropbox'],
  [/(^|\.)loom\.com$/, 'Loom'],
];

function linkSource(url: string): string {
  let hostname: string;
  try { hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  return LINK_SOURCES.find(([pattern]) => pattern.test(hostname))?.[1] ?? hostname;
}

// The session the student is watching: the video itself, what the class covered, the
// files for it, and the way on to the next one. One session is always on stage -- the
// list beside it switches which, so nothing collapses underfoot while you are watching.
function SessionStage({ entry, C, onPrev, onNext, hasPrev, hasNext }: {
  entry: any;
  C: typeof LIGHT_C;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  const embed = safeEmbedUrl(entry.url);
  // Authored by hand, so the fallback link goes through the same protocol check every
  // other authored destination does rather than straight into an href.
  const openHref = safeAttachmentUrl(entry.url ?? '');
  const source = linkSource(entry.url ?? '');
  const accent = C === DARK_C ? '#111' : '#fff';
  const attachments: RecordingAttachment[] = entry.attachments ?? [];

  const navBtn = (enabled: boolean) => ({
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '9px 14px', borderRadius: 12, border: 'none',
    background: C.pill, color: enabled ? C.text : C.faint,
    fontSize: 13, fontWeight: 600, cursor: enabled ? 'pointer' : 'not-allowed',
    opacity: enabled ? 1 : 0.55,
  } as React.CSSProperties);

  return (
    <motion.div key={entry.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}
      style={{ background: C.card, borderRadius: 18, overflow: 'hidden' }}>
      {embed
        ? <div style={{ background: SURFACE, aspectRatio: '16 / 9', maxWidth: '100%' }}>
            <iframe src={embed} title={entry.topic} allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}/>
          </div>
        : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
            padding: '28px 30px', background: `linear-gradient(120deg, ${C.green}1a 0%, ${C.green}0d 60%, transparent 100%)` }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 12.5, color: C.muted, fontWeight: 600 }}>Class recording</p>
              <p style={{ fontSize: 19, fontWeight: 800, color: C.text, lineHeight: 1.3, marginTop: 4 }}>
                {openHref
                  ? (source ? `Watch on ${source}` : 'Watch this recording')
                  : 'Not added yet'}
              </p>
              {openHref
                ? <a href={openHref} target="_blank" rel="noopener noreferrer"
                    className="transition-opacity hover:opacity-90"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16,
                      padding: '11px 20px', borderRadius: 12, background: C.green, color: accent,
                      fontSize: 13.5, fontWeight: 800, textDecoration: 'none' }}>
                    Open recording <ExternalLink size={14}/>
                  </a>
                : <p style={{ fontSize: 12.5, color: C.faint, marginTop: 8 }}>
                    Your instructor has not added this recording yet.
                  </p>
              }
            </div>
            <RecordingIcons C={C} dim={!openHref}/>
          </div>
      }

      <div style={{ padding: '24px 26px 26px' }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: 'uppercase',
          letterSpacing: '0.08em' }}>
          Week {entry.week}
        </p>
        <h3 style={{ fontSize: 19, fontWeight: 800, color: C.text, lineHeight: 1.3, marginTop: 6 }}>
          {entry.topic}
        </h3>

        <AuthoredText value={entry.description ?? ''}
          style={{ fontSize: 13.5, color: C.muted, lineHeight: 1.75, marginTop: 14 }}/>

        <SessionResources attachments={attachments} C={C}/>

        {(hasPrev || hasNext) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 28 }}>
            <button onClick={onPrev} disabled={!hasPrev} style={navBtn(hasPrev)}>
              <ChevronLeft size={15}/> Previous
            </button>
            <button onClick={onNext} disabled={!hasNext} style={{ ...navBtn(hasNext), flex: 1 }}>
              Next recording <ChevronRight size={15}/>
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// One line in the week's playlist. Says enough to choose with: the topic, and whether
// the class came with notes or files.
function PlaylistRow({ entry, index, active, C, onSelect }: {
  entry: any;
  index: number;
  active: boolean;
  C: typeof LIGHT_C;
  onSelect: () => void;
}) {
  const count = (entry.attachments ?? []).length;
  const external = !safeEmbedUrl(entry.url ?? '');
  const meta = [
    external ? 'Opens in a new tab' : '',
    entry.description ? 'Notes' : '',
    count ? `${count} resource${count !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' - ');

  return (
    <button onClick={onSelect}
      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
        padding: '12px', borderRadius: 12, border: 'none', cursor: 'pointer',
        background: active ? C.pill : 'transparent' }}>
      <span style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? C.green : C.pill,
        color: active ? (C === DARK_C ? '#111' : '#fff') : C.muted,
        fontSize: 12, fontWeight: 700 }}>
        {active && !external
          ? <Play size={12} fill={C === DARK_C ? '#111' : '#fff'} style={{ marginLeft: 1 }}/>
          : active ? <ExternalLink size={12}/> : index}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13, fontWeight: active ? 700 : 600, color: C.text }} className="truncate">
          {entry.topic}
        </span>
        {meta && <span style={{ display: 'block', fontSize: 11, color: C.faint, marginTop: 1 }}>{meta}</span>}
      </span>
    </button>
  );
}

export function RecordingsSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [entries, setEntries]       = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<any | null>(null);
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  // The session on stage. A week always has one playing, so arriving at a recording or
  // switching week puts that week's first session up rather than an empty frame.
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: student } = await supabase.from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
      // A synthetic individual-enrollment cohort (migration 165) has no recordings.
      const cohortId = isIndividualCohort((student as any)?.cohort?.cohort_kind) ? null : student?.cohort_id;
      if (!cohortId) { setLoading(false); return; }
      const { data } = await supabase.from('recordings')
        .select('id, title, description')
        .contains('cohort_ids', [cohortId]).eq('status', 'published')
        .order('created_at', { ascending: false });
      const recs = data ?? [];
      setRecordings(recs);
      // The list card promises how much is inside, so the sessions come with it rather
      // than one fetch per card. It also means opening a recording needs no round trip.
      if (recs.length) {
        const { data: rows } = await supabase.from('recording_entries')
          .select('id, recording_id, week, topic, url, description, attachments, order_index')
          .in('recording_id', recs.map(r => r.id)).order('week').order('order_index');
        const grouped: Record<string, any[]> = {};
        (rows ?? []).forEach((row: any) => {
          (grouped[row.recording_id] ||= []).push({
            ...row, attachments: normalizeRecordingAttachments(row.attachments),
          });
        });
        setEntries(grouped);
      }
      setLoading(false);
    };
    load();
  }, [userId]);

  async function openRecording(rec: any) {
    setSelected(rec);
    setActiveWeek(null);
    topRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    if (!entries[rec.id]) {
      const { data } = await supabase.from('recording_entries')
        .select('id, week, topic, url, description, attachments, order_index')
        .eq('recording_id', rec.id).order('week').order('order_index');
      const rows = (data ?? []).map((row: any) => ({
        ...row, attachments: normalizeRecordingAttachments(row.attachments),
      }));
      setEntries(prev => ({ ...prev, [rec.id]: rows }));
      openFirstWeek(rows);
    } else {
      openFirstWeek(entries[rec.id]);
    }
  }

  function openFirstWeek(rows: any[]) {
    const firstWeek = rows.length ? Math.min(...rows.map((r: any) => r.week)) : null;
    setActiveWeek(firstWeek);
    setActiveEntryId(rows.find((r: any) => r.week === firstWeek)?.id ?? null);
  }

  if (loading) return (
    <div className="grid gap-3 sm:grid-cols-2">
      {[0,1,2,3].map(i => (
        <div key={i} className="rounded-2xl p-4 flex gap-3" style={{ background: C.card }}>
          <Sk w={46} h={46} r={14}/>
          <div className="flex-1 space-y-2 pt-1"><Sk h={13} w="65%"/><Sk h={10} w="40%"/></div>
        </div>
      ))}
    </div>
  );

  if (!recordings.length) return (
    <EmptyState icon={Video} title="No recordings yet" body="Recordings for your courses will appear here once published."/>
  );

  /* -- Detail view -- */
  if (selected) {
    const recEntries = entries[selected.id] ?? [];
    const weeks = [...new Set(recEntries.map((e: any) => e.week))].sort((a, b) => a - b);
    const currentWeek = activeWeek ?? weeks[0] ?? null;
    const weekEntries = recEntries.filter((e: any) => e.week === currentWeek);
    const totalEntries = recEntries.length;
    const activeEntry = recEntries.find((e: any) => e.id === activeEntryId) ?? weekEntries[0] ?? null;
    const position = activeEntry ? recEntries.indexOf(activeEntry) : -1;

    // Previous and next run the length of the programme rather than the week, so a
    // student can watch straight through; crossing a boundary carries the week along.
    const step = (delta: number) => {
      const target = recEntries[position + delta];
      if (!target) return;
      setActiveEntryId(target.id);
      setActiveWeek(target.week);
    };

    const selectWeek = (week: number) => {
      setActiveWeek(week);
      setActiveEntryId(recEntries.find((e: any) => e.week === week)?.id ?? null);
    };

    return (
      <motion.div ref={topRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {/* Programme header: what this is, how much of it there is, and the way back */}
        <div style={{ background: C.card, borderRadius: 18, padding: '20px 24px', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button onClick={() => setSelected(null)} aria-label="Back to recordings"
              style={{ width: 38, height: 38, borderRadius: 12, border: 'none',
                background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', flexShrink: 0 }}>
              <ArrowLeft size={16} style={{ color: C.text }}/>
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 20, fontWeight: 800, color: C.text, lineHeight: 1.2 }} className="truncate">
                {selected.title}
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                <span style={chip(C)}>
                  <Video size={12}/> {totalEntries} recording{totalEntries !== 1 ? 's' : ''}
                </span>
                <span style={chip(C)}>
                  <Calendar size={12}/> {weeks.length} week{weeks.length !== 1 ? 's' : ''}
                </span>
                {activeEntry && recEntries.length > 1 && (
                  <span style={chip(C)}>Watching {position + 1} of {recEntries.length}</span>
                )}
              </div>
            </div>
          </div>

          <AuthoredText value={selected.description ?? ''}
            style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginTop: 18,
              paddingTop: 18, borderTop: `1px solid ${C.divider}` }}/>
        </div>

        {recEntries.length === 0
          ? <EmptyState icon={Video} title="Nothing published yet"
              body="Recordings for this programme will appear here once your instructor publishes them."/>
          : (
            <div className="grid gap-5 items-start lg:gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
              {/* Stage: what is playing */}
              {activeEntry
                ? <SessionStage entry={activeEntry} C={C}
                    onPrev={() => step(-1)} onNext={() => step(1)}
                    hasPrev={position > 0} hasNext={position >= 0 && position < recEntries.length - 1}/>
                : <p style={{ fontSize: 13, color: C.faint, padding: '24px 0' }}>No recordings for this week.</p>
              }

              {/* Playlist: the week, and what is in it */}
              <div style={{ background: C.card, borderRadius: 18, padding: 14 }}>
                {weeks.length > 1 && (
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6 }} className="hide-scrollbar">
                    {weeks.map(w => (
                      <button key={w} onClick={() => selectWeek(w)}
                        style={{
                          padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                          whiteSpace: 'nowrap', cursor: 'pointer', flexShrink: 0, border: 'none',
                          background: currentWeek === w ? C.green : C.pill,
                          color: currentWeek === w ? (C === DARK_C ? '#111' : '#fff') : C.muted,
                          transition: 'all 0.15s',
                        }}>
                        Week {w}
                      </button>
                    ))}
                  </div>
                )}
                <p style={{ fontSize: 11, fontWeight: 700, color: C.faint, textTransform: 'uppercase',
                  letterSpacing: '0.08em', padding: '10px 12px 8px' }}>
                  Week {currentWeek} - {weekEntries.length} recording{weekEntries.length !== 1 ? 's' : ''}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 460, overflowY: 'auto' }}
                  className="hide-scrollbar">
                  {weekEntries.length === 0
                    ? <p style={{ fontSize: 12, color: C.faint, padding: '8px 12px' }}>No recordings for this week.</p>
                    : weekEntries.map((entry: any, idx: number) => (
                        <PlaylistRow key={entry.id} entry={entry} index={idx + 1} C={C}
                          active={activeEntry?.id === entry.id}
                          onSelect={() => setActiveEntryId(entry.id)}/>
                      ))
                  }
                </div>
              </div>
            </div>
          )}
      </motion.div>
    );
  }

  /* -- List view -- */
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {recordings.map((rec, i) => {
        const rows = entries[rec.id] ?? [];
        const weekCount = new Set(rows.map((r: any) => r.week)).size;
        const blurb = toPlainText(rec.description);
        return (
          <motion.button key={rec.id} onClick={() => openRecording(rec)}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className="text-left w-full"
            style={{ background: C.card, borderRadius: 18, padding: 20, cursor: 'pointer',
              display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: C.green,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Play size={18} fill={C === DARK_C ? '#111' : '#fff'} style={{ color: C === DARK_C ? '#111' : '#fff', marginLeft: 2 }}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1.3 }} className="line-clamp-2">
                {rec.title}
              </p>
              <p style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
                {rows.length
                  ? `${rows.length} recording${rows.length !== 1 ? 's' : ''} - ${weekCount} week${weekCount !== 1 ? 's' : ''}`
                  : 'No recordings yet'}
              </p>
              {blurb && (
                <p style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5, marginTop: 8 }} className="line-clamp-2">
                  {blurb}
                </p>
              )}
            </div>
            <ChevronRight size={16} style={{ color: C.faint, flexShrink: 0, marginTop: 2 }}/>
          </motion.button>
        );
      })}
    </div>
  );
}

export function ScheduleSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [events, setScheduleItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: student } = await supabase.from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
      // A synthetic individual-enrollment cohort (migration 165) has no schedule.
      const cohortId = isIndividualCohort((student as any)?.cohort?.cohort_kind) ? null : student?.cohort_id;
      const schedulesRes = cohortId
        ? await supabase.from('schedules').select('id, title, description, cover_image, start_date, end_date, status, created_at, course_id')
            .contains('cohort_ids', [cohortId]).eq('status', 'published')
        : { data: [] };
      const scheduleRows = schedulesRes.data ?? [];
      const scheduleCourseIds = [...new Set(scheduleRows.map((r: any) => r.course_id).filter(Boolean))];
      let scheduleCourseMap: Record<string, string> = {};
      if (scheduleCourseIds.length) {
        const { data: cForms } = await supabase.from('courses').select('id, title').in('id', scheduleCourseIds);
        (cForms ?? []).forEach((f: any) => { scheduleCourseMap[f.id] = f.title; });
      }
      const items: any[] = scheduleRows.map((r: any) => ({
        id: r.id, type: 'schedule',
        date: new Date(r.start_date || r.created_at),
        startDate: r.start_date ? new Date(r.start_date) : null,
        endDate:   r.end_date   ? new Date(r.end_date)   : null,
        title: r.title, description: r.description, coverImage: r.cover_image, status: r.status,
        _course_title: r.course_id ? (scheduleCourseMap[r.course_id] ?? null) : null,
      }));
      items.sort((a, b) => a.date.getTime() - b.date.getTime());
      setScheduleItems(items);
      setLoading(false);
    };
    load();
  }, [userId]);

  if (loading) return (
    <div className="space-y-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-2xl p-4 flex gap-3" style={{ background: C.card }}>
          <Sk w={72} h={72} r={16}/><div className="flex-1 space-y-2 pt-1"><Sk h={14} w="60%"/><Sk h={11} w="40%"/><Sk h={11} w="30%"/></div>
        </div>
      ))}
    </div>
  );

  if (selected) return <ScheduleDetail schedule={selected} C={C} onBack={() => setSelected(null)}/>;

  if (!events.length) return (
    <EmptyState icon={Calendar} title="Schedule is clear" body="No published schedules are available for your cohort yet."/>
  );

  const now = new Date();
  const upcoming = events.filter(e => !e.startDate || e.startDate >= now || (e.endDate && e.endDate >= now));
  const past     = events.filter(e => e.startDate && e.startDate < now && (!e.endDate || e.endDate < now));

  const ScheduleCard = ({ item, index }: { item: any; index: number }) => {
    const isPast     = item.endDate ? item.endDate < now : (item.startDate ? item.startDate < now : false);
    const isOngoing  = !isPast && item.startDate && item.startDate < now && item.endDate && item.endDate >= now;
    const isToday    = !isOngoing && item.startDate ? item.startDate.toDateString() === now.toDateString() : false;
    const isSoon     = item.startDate ? (!isPast && !isOngoing && item.startDate > now && item.startDate.getTime() - now.getTime() < 48 * 3600 * 1000) : false;
    const startFmt = item.startDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const endFmt   = item.endDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const dateRange = endFmt && endFmt !== startFmt ? `${startFmt} -> ${endFmt}` : startFmt ?? 'Date TBA';

    return (
      <motion.button onClick={() => setSelected(item)} className="w-full text-left"
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: isPast ? 0.6 : 1, y: 0 }}
        transition={{ delay: index * 0.06, duration: 0.35 }}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <div className="relative rounded-2xl p-4 flex gap-4 transition-shadow"
          style={{ background: C.card }}>

          {/* Cover thumbnail */}
          <div className="w-[72px] h-[72px] rounded-2xl overflow-hidden flex-shrink-0"
            style={{ background: C.thumbBg }}>
            {item.coverImage
              ? <img src={item.coverImage} alt={item.title} className="w-full h-full object-cover"/>
              : <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
                  {item.startDate
                    ? <>
                        <span className="text-xl font-black leading-none" style={{ color: C.green }}>
                          {item.startDate.getDate()}
                        </span>
                        <span className="text-[9px] font-bold tracking-widest uppercase" style={{ color: C.green }}>
                          {item.startDate.toLocaleDateString('en-US', { month: 'short' })}
                        </span>
                      </>
                    : <Calendar className="w-6 h-6" style={{ color: C.faint }}/>
                  }
                </div>
            }
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
            {/* Status badges */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {isOngoing && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${C.green}15`, color: C.green }}>In progress</span>
              )}
              {isToday && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${C.green}15`, color: C.green }}>Today</span>
              )}
              {isSoon && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#fff7ed', color: '#ea580c' }}>Starting soon</span>
              )}
              {isPast && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: C.pill, color: C.faint }}>Past</span>
              )}
            </div>
            <p className="text-sm font-bold leading-snug line-clamp-1" style={{ color: C.text }}>{item.title}</p>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3 flex-shrink-0" style={{ color: C.faint }}/>
              <span className="text-xs" style={{ color: C.muted }}>{dateRange}</span>
            </div>
            {item.description && (
              <p className="text-xs line-clamp-1 mt-0.5" style={{ color: C.faint }}>{item.description}</p>
            )}
          </div>

          <ChevronRight className="w-4 h-4 self-center flex-shrink-0" style={{ color: C.faint }}/>
        </div>
      </motion.button>
    );
  };

  // Group by course
  const grouped: Record<string, any[]> = {};
  for (const item of events) {
    const key = item._course_title ?? '__none__';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  const courseKeys = Object.keys(grouped).filter(k => k !== '__none__').sort();
  if (grouped['__none__']) courseKeys.push('__none__');

  return (
    <div className="space-y-8">
      {courseKeys.map(key => (
        <div key={key}>
          <div className="flex items-center gap-2 mb-4">
            {key !== '__none__'
              ? <><BookOpen className="w-3.5 h-3.5" style={{ color: C.green }}/><p className="text-xs font-bold uppercase tracking-widest" style={{ color: C.green }}>{key}</p></>
              : <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>General</p>
            }
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: C.pill, color: C.faint }}>{grouped[key].length}</span>
          </div>
          <div className="space-y-3">
            {grouped[key].map((item, i) => <ScheduleCard key={`${item.type}-${item.id}`} item={item} index={i}/>)}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Student Badges section ---
