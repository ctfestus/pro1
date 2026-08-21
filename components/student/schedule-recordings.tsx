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
  ArrowLeft, BookOpen, Calendar, ChevronRight, ExternalLink, FileText, Play, Video,
} from 'lucide-react';

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

export function RecordingsSection({ userId, C }: { userId: string; C: typeof LIGHT_C }) {
  const [recordings, setRecordings] = useState<any[]>([]);
  const [entries, setEntries]       = useState<Record<string, any[]>>({});
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<any | null>(null);
  const [activeWeek, setActiveWeek] = useState<number | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

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
    setSelected(rec);
    setActiveWeek(null);
    topRef.current?.closest('main')?.scrollTo({ top: 0, behavior: 'smooth' });
    if (!entries[rec.id]) {
      const { data } = await supabase.from('recording_entries')
        .select('id, week, topic, url, order_index')
        .eq('recording_id', rec.id).order('week').order('order_index');
      const rows = data ?? [];
      setEntries(prev => ({ ...prev, [rec.id]: rows }));
      const firstWeek = rows.length ? Math.min(...rows.map((r: any) => r.week)) : null;
      setActiveWeek(firstWeek);
    } else {
      const rows = entries[rec.id];
      const firstWeek = rows.length ? Math.min(...rows.map((r: any) => r.week)) : null;
      setActiveWeek(firstWeek);
    }
  }

  if (loading) return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {[0,1,2,3,4,5].map(i => (
        <div key={i} className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
          <Sk h={160} r={0}/><div className="p-3 space-y-2"><Sk h={13} w="70%"/><Sk h={10} w="45%"/></div>
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
      <motion.div ref={topRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {/* Back + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <button onClick={() => setSelected(null)}
            style={{ width: 34, height: 34, borderRadius: 10,
              background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', flexShrink: 0 }}>
            <ArrowLeft size={15} style={{ color: C.text }}/>
          </button>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 800, color: C.text, lineHeight: 1.2 }} className="truncate">{selected.title}</p>
            <p style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{totalEntries} recording{totalEntries !== 1 ? 's' : ''} · {weeks.length} week{weeks.length !== 1 ? 's' : ''}</p>
          </div>
        </div>

        {/* Cover banner */}
        {selected.cover_image && (
          <div style={{ borderRadius: 16, overflow: 'hidden', marginBottom: 16, height: 180,
            boxShadow: '0 4px 20px rgba(0,0,0,0.12)' }}>
            <img src={selected.cover_image} alt={selected.title} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}/>
          </div>
        )}

        {/* Description */}
        {selected.description && (
          <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 16 }}
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(selected.description) }}/>
        )}

        {/* Week tabs */}
        {weeks.length > 0 && (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4, marginBottom: 16 }}
            className="hide-scrollbar">
            {weeks.map(w => (
              <button key={w} onClick={() => setActiveWeek(w)}
                style={{
                  padding: '6px 14px', borderRadius: 999, fontSize: 13, fontWeight: 700,
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

        {/* Entries for selected week */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {weekEntries.length === 0
            ? <p style={{ fontSize: 13, color: C.faint, textAlign: 'center', padding: '24px 0' }}>No recordings for this week.</p>
            : weekEntries.map((entry: any, idx: number) => (
                <motion.a key={entry.id} href={entry.url} target="_blank" rel="noopener noreferrer"
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px',
                    borderRadius: 16, background: C.card,
                    textDecoration: 'none', transition: 'transform 0.15s, box-shadow 0.15s' }}
                  className="hover:scale-[1.01]">
                  {/* Play button */}
                  <div style={{ width: 40, height: 40, borderRadius: 12, background: C.green,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Play size={16} fill={C === DARK_C ? '#111' : '#fff'} style={{ color: C === DARK_C ? '#111' : '#fff', marginLeft: 2 }}/>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: C.text, lineHeight: 1.3 }} className="truncate">
                      {entry.topic}
                    </p>
                    <p style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>Week {entry.week} · Recording {idx + 1}</p>
                  </div>
                  <ExternalLink size={14} style={{ color: C.faint, flexShrink: 0 }}/>
                </motion.a>
              ))
          }
        </div>
      </motion.div>
    );
  }

  /* -- Grid view -- */
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {recordings.map((rec, i) => (
        <motion.button key={rec.id} onClick={() => openRecording(rec)}
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
          className="text-left w-full"
          style={{ background: C.card, borderRadius: 16,
            overflow: 'hidden', cursor: 'pointer' }}>
          {/* Cover */}
          <div style={{ height: 160, background: C.pill, position: 'relative', overflow: 'hidden' }}>
            {rec.cover_image
              ? <img src={rec.cover_image} alt={rec.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
              : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Video size={28} style={{ color: C.faint }}/>
                </div>
            }
            {/* Play overlay */}
            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.92)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 2px 10px rgba(0,0,0,0.22)' }}>
                <Play size={14} fill={C.green} style={{ color: C.green, marginLeft: 2 }}/>
              </div>
            </div>
          </div>
          {/* Info */}
          <div style={{ padding: '10px 12px 12px' }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.3 }}
              className="line-clamp-2">{rec.title}</p>
          </div>
        </motion.button>
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
