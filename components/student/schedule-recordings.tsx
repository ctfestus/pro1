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
import { FRAMED_CARD } from '@/components/CardMeta';
import { DISPLAY_FONT, btnClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { isIndividualCohort } from '@/lib/cohort-kind';
import {
  ArrowLeft, BookOpen, Calendar, ChevronDown, ChevronRight, Download, ExternalLink, FileText,
  Paperclip, Play, Video,
} from 'lucide-react';
import { formatAttachmentSize } from '@/lib/lesson-attachment';
import { hasRichContent, looksLikeHtml, toPlainText } from '@/lib/plain-text';
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
  const dateRange  = endLabel && endLabel !== startLabel ? `${startLabel} to ${endLabel}` : startLabel ?? 'Date TBA';
  const ended      = !!schedule.endDate && schedule.endDate < new Date();

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
              style={ended ? { background: C.pill, color: C.muted } : { background: `${C.green}12`, color: C.green }}>{ended ? 'Ended' : 'Active'}</span>
          </div>
          <div className="flex items-center gap-1.5 mb-4">
            <Calendar className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
            <span className="text-sm" style={{ color: C.muted }}>{dateRange}</span>
          </div>
          {/* Authored in the rich text editor: shown formatted (with its images), not as raw markup. */}
          {schedule.description && hasRichContent(schedule.description) && (
            <div className="pb-5 mb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <AuthoredText value={schedule.description} style={{ color: C.muted, fontSize: 14, lineHeight: 1.6 }} />
            </div>
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

// What a class came with: the instructor's notes for the session, and the files handed
// out with it. Folded away under the recording so the week still reads as a list.
function SessionExtras({ entry, C }: { entry: any; C: typeof LIGHT_C }) {
  const [open, setOpen] = useState(false);
  const attachments: RecordingAttachment[] = entry.attachments ?? [];
  // An untouched rich-text field still arrives as markup, so ask what it actually says.
  const notes = hasRichContent(entry.description) ? entry.description as string : '';
  if (!notes && !attachments.length) return null;

  const summary = [
    notes ? 'Session notes' : '',
    attachments.length ? `${attachments.length} file${attachments.length !== 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' - ');

  return (
    <div style={{ padding: '0 16px 12px' }}>
      <button onClick={() => setOpen(v => !v)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', border: 'none',
          background: 'transparent', cursor: 'pointer', color: C.muted, fontSize: 12, fontWeight: 600 }}>
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }}/>
        {summary}
      </button>

      {open && (<>
        <AuthoredText value={notes}
          style={{ fontSize: 13, color: C.muted, lineHeight: 1.7, marginTop: 6 }}/>

        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: notes ? 12 : 6 }}>
            {attachments.map(att => {
              const size = formatAttachmentSize(att.size);
              return (
                <a key={att.id} href={recordingAttachmentHref(att)} target="_blank" rel="noopener noreferrer"
                  download={att.kind === 'file' ? att.name : undefined}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 12, background: C.pill, textDecoration: 'none' }}>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: C.muted,
                    background: C.card, borderRadius: 6, padding: '3px 6px', flexShrink: 0 }}>
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
        )}
      </>)}
    </div>
  );
}

export function RecordingsSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [entries, setEntries]       = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<any | null>(null);
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const openingId = useRef<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: student } = await supabase.from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', userId).single();
      // A synthetic individual-enrollment cohort (migration 165) has no recordings.
      const cohortId = isIndividualCohort((student as any)?.cohort?.cohort_kind) ? null : student?.cohort_id;
      if (!cohortId) { setLoading(false); return; }
      const { data } = await supabase.from('recordings')
        .select('id, title, description, cover_image')
        .contains('cohort_ids', [cohortId]).eq('status', 'published')
        .order('created_at', { ascending: false });
      setRecordings(data ?? []);
      setLoading(false);
    };
    load();
  }, [userId]);

  async function openRecording(rec: any) {
    openingId.current = rec.id;
    setSelected(rec);
    setActiveWeek(null);
    // The detail view is not mounted yet when opening from the grid, so scroll the
    // page's own scroller, and the window where the page scrolls instead.
    const scroller = document.querySelector('main');
    scroller?.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (!entries[rec.id]) {
      const { data } = await supabase.from('recording_entries')
        .select('id, week, topic, url, description, attachments, order_index')
        .eq('recording_id', rec.id).order('week').order('order_index');
      const rows = (data ?? []).map((row: any) => ({
        ...row, attachments: normalizeRecordingAttachments(row.attachments),
      }));
      setEntries(prev => ({ ...prev, [rec.id]: rows }));
      // Another recording may have been opened while this one loaded.
      if (openingId.current !== rec.id) return;
      const firstWeek = rows.length ? Math.min(...rows.map((r: any) => r.week)) : null;
      setActiveWeek(firstWeek);
    } else {
      const rows = entries[rec.id];
      const firstWeek = rows.length ? Math.min(...rows.map((r: any) => r.week)) : null;
      setActiveWeek(firstWeek);
    }
  }

  const grid = 'grid grid-cols-1 gap-4 min-[520px]:grid-cols-2 lg:grid-cols-3 sm:gap-6';

  if (loading) return (
    <div className={grid} aria-busy="true">
      {[0, 1, 2].map(i => (
        <div key={i} className="overflow-hidden rounded-xl" style={{ background: C.card }}>
          <div className="aspect-video w-full animate-pulse" style={{ background: C.skeleton }}/>
          <div className="space-y-2 px-4 pb-[18px] pt-3.5"><Sk h={14} w="70%"/><Sk h={11} w="45%"/><div className="flex justify-end pt-1.5"><Sk w={72} h={36} r={12}/></div></div>
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

    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div className="mb-4 flex items-center gap-3">
          <button type="button" onClick={() => setSelected(null)} aria-label="Back to recordings"
            className="grid h-9 w-9 flex-shrink-0 place-items-center rounded-xl" style={{ background: C.card, color: C.text }}>
            <ArrowLeft className="h-4 w-4"/>
          </button>
          <div className="min-w-0">
            <h2 className="truncate text-xl font-semibold leading-7" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{selected.title}</h2>
            <p className="text-xs" style={{ color: C.muted }}>{totalEntries} recording{totalEntries !== 1 ? 's' : ''}, {weeks.length} week{weeks.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {selected.cover_image && (
          <div className="mb-4 h-[180px] overflow-hidden rounded-2xl">
            <img src={selected.cover_image} alt="" className="h-full w-full object-cover object-top"/>
          </div>
        )}

        <AuthoredText value={selected.description ?? ''} style={{ fontSize: 14, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}/>

        {weeks.length > 0 && (
          <div className="hide-scrollbar mb-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Week">
            {weeks.map(w => (
              <button key={w} type="button" onClick={() => setActiveWeek(w)} aria-pressed={currentWeek === w}
                className="h-8 flex-shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold"
                style={currentWeek === w ? { background: DARK_C.cta, color: '#ffffff' } : { background: C.card, color: C.text, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                Week {w}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {weekEntries.length === 0
            ? <p className="py-6 text-center text-[13px]" style={{ color: C.faint }}>No recordings for this week.</p>
            : weekEntries.map((entry: any, idx: number) => (
                <div key={entry.id} className="rounded-2xl" style={{ background: C.card }}>
                  <a href={entry.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 px-4 py-3">
                    <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl"
                      style={{ background: `color-mix(in srgb, ${DARK_C.cta} 14%, transparent)`, color: DARK_C.cta }}>
                      <Play className="ml-0.5 h-4 w-4" fill="currentColor"/>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold group-hover:underline" style={{ color: C.text }}>{entry.topic}</span>
                      <span className="mt-0.5 block text-xs" style={{ color: C.muted }}>Week {entry.week}, recording {idx + 1}</span>
                    </span>
                    <span className={btnClass} style={btnStyle('sec', C)}><ExternalLink className="h-3.5 w-3.5"/>Watch</span>
                  </a>
                  <SessionExtras entry={entry} C={C}/>
                </div>
              ))
          }
        </div>
      </motion.div>
    );
  }

  /* -- Grid view: each collection as the My learning card -- */
  return (
    <div className={grid}>
      {recordings.map(rec => (
        <button key={rec.id} type="button" onClick={() => openRecording(rec)} className={`${FRAMED_CARD} text-left`} style={{ background: C.card }}>
          <div className="relative aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
            {rec.cover_image && <img src={rec.cover_image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]"/>}
            <span className="absolute inset-0 grid place-items-center">
              <span className="grid h-11 w-11 place-items-center rounded-full shadow-md" style={{ background: DARK_C.cta, color: '#ffffff' }}>
                <Play className="ml-0.5 h-[18px] w-[18px]" fill="currentColor"/>
              </span>
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-3.5 px-3 pb-3.5 pt-2.5 sm:px-4 sm:pb-[18px] sm:pt-3.5">
            <div>
              <p className="line-clamp-2 text-[15px] font-bold leading-5" style={{ color: C.text }}>{rec.title}</p>
              {hasRichContent(rec.description) && <p className="mt-1 line-clamp-1 text-xs" style={{ color: C.muted }}>{toPlainText(rec.description)}</p>}
            </div>
            <span className={`${btnClass} mt-auto self-end`} style={btnStyle('sec', C)}>Open</span>
          </div>
        </button>
      ))}
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
        // start_date and end_date are plain dates: read them in the learner's own day (new Date
        // on 'YYYY-MM-DD' is UTC midnight), and a schedule runs to the end of its last day.
        date: r.start_date ? new Date(`${r.start_date}T00:00:00`) : new Date(r.created_at),
        startDate: r.start_date ? new Date(`${r.start_date}T00:00:00`) : null,
        endDate:   r.end_date   ? new Date(`${r.end_date}T23:59:59`) : null,
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
    const dateRange = endFmt && endFmt !== startFmt ? `${startFmt} to ${endFmt}` : startFmt ?? 'Date TBA';

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
              <p className="text-xs line-clamp-1 mt-0.5" style={{ color: C.faint }}>{toPlainText(item.description)}</p>
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
