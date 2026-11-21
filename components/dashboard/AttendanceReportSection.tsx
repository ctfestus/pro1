'use client';

// The admin Live sessions page: who joined each live class, and who missed it.

import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, Download, MinusCircle, Send, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { isScheduledSessionDate } from '@/lib/event-sessions';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { Card, Empty, Pill, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';

const sessionLabel = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function computeExpectedSessionDates(event: any): string[] {
  if (!event?.event_date) return [];
  const todayStr = new Date().toISOString().slice(0, 10);
  if (event.recurrence === 'once' || !event.recurrence) {
    return event.event_date <= todayStr ? [event.event_date] : [];
  }
  if (event.recurrence === 'weekly') {
    const endStr = event.recurrence_end_date && event.recurrence_end_date < todayStr
      ? event.recurrence_end_date : todayStr;
    const start  = new Date(event.event_date + 'T12:00:00');
    const end    = new Date(endStr + 'T12:00:00');
    const targetDays: number[] =
      Array.isArray(event.recurrence_days) && event.recurrence_days.length > 0
        ? event.recurrence_days
        : [start.getUTCDay()]; // fall back to the weekday of event_date
    const dateSet = new Set<string>();
    for (const targetDay of targetDays) {
      const cur = new Date(start);
      const diff = ((targetDay - cur.getUTCDay()) + 7) % 7;
      cur.setUTCDate(cur.getUTCDate() + diff);
      while (cur <= end) {
        dateSet.add(cur.toISOString().slice(0, 10));
        cur.setUTCDate(cur.getUTCDate() + 7);
      }
    }
    return [...dateSet].sort();
  }
  if (event.recurrence === 'daily') {
    const endStr = event.recurrence_end_date && event.recurrence_end_date < todayStr
      ? event.recurrence_end_date : todayStr;
    const cur = new Date(event.event_date + 'T12:00:00');
    const end = new Date(endStr + 'T12:00:00');
    const dates: string[] = [];
    while (cur <= end) {
      dates.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return dates;
  }
  return [];
}

export function AttendanceReportSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEventId, setSelectedEventId] = useState('');
  const [registrations, setRegistrations] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'summary' | 'matrix'>('summary');
  const [nudging, setNudging] = useState(false);
  const [nudgeMsg, setNudgeMsg] = useState('');
  const [nudgeDate, setNudgeDate] = useState('');           // which session's absences to act on
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // students to nudge
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState<'all' | 'attended' | 'missed'>('all');

  useEffect(() => {
    (async () => {
      setEventsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('events')
        .select('id, title, recurrence, event_date, recurrence_end_date, recurrence_days, cohort_ids')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setEvents(data ?? []);
      setEventsLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedEventId) return;
    (async () => {
      setLoading(true);
      const [{ data: regData }, { data: attData }] = await Promise.all([
        supabase
          .from('event_registrations')
          .select('student_id, student:students(full_name, email, role, cohort_id)')
          .eq('event_id', selectedEventId),
        supabase
          .from('live_attendance')
          .select('student_id, session_date, joined_at')
          .eq('event_id', selectedEventId)
          .order('session_date', { ascending: true }),
      ]);
      setRegistrations(regData ?? []);
      setAttendance(attData ?? []);
      setLoading(false);
    })();
  }, [selectedEventId]);

  const selectedEvent   = events.find((e: any) => e.id === selectedEventId) ?? null;
  const expectedDates   = computeExpectedSessionDates(selectedEvent);
  // Drop off-schedule rows: a stray click on a non-session day must not invent
  // a session or mark anyone absent for a date the meeting never ran.
  const validAttendance = attendance.filter((a: any) => isScheduledSessionDate(selectedEvent, a.session_date as string));
  const attendanceDates = [...new Set(validAttendance.map((a: any) => a.session_date as string))];
  const sessionDates    = [...new Set([...expectedDates, ...attendanceDates])].sort();
  const totalSessions   = sessionDates.length;

  const attendanceMap = new Map<string, Set<string>>();
  const lastJoinedMap = new Map<string, string>();
  for (const a of validAttendance) {
    if (!attendanceMap.has(a.student_id)) attendanceMap.set(a.student_id, new Set());
    attendanceMap.get(a.student_id)!.add(a.session_date);
    const prev = lastJoinedMap.get(a.student_id);
    if (!prev || a.joined_at > prev) lastJoinedMap.set(a.student_id, a.joined_at);
  }

  // event_registrations rows are written once, when the event is assigned to a cohort, and are
  // never removed, so the raw list still names students who have since moved to another cohort or
  // onto a subscription. Narrow the roster to current members: without this they showed up here and
  // were counted absent for every session. live_attendance is left exactly as recorded, so a
  // session someone attended before moving still counts as a session that ran.
  // The server also requires the cohort to be a bootcamp intake (lib/cohort-roster); that is left
  // out here because an instructor can only read cohorts they created, and events are only ever
  // assigned bootcamp cohorts.
  const eventCohortIds: string[] = Array.isArray(selectedEvent?.cohort_ids) ? selectedEvent.cohort_ids : [];
  const STAFF_ROLES = ['admin', 'instructor', 'staff'];
  const currentRegistrations = eventCohortIds.length
    ? registrations.filter((r: any) => {
        if (STAFF_ROLES.includes(r.student?.role ?? '')) return true;
        const cohortId = r.student?.cohort_id ?? null;
        return !!cohortId && eventCohortIds.includes(cohortId);
      })
    : registrations;

  const studentRows = currentRegistrations.map((r: any) => {
    const attended = attendanceMap.get(r.student_id) ?? new Set<string>();
    const count = attended.size;
    return { id: r.student_id, name: r.student?.full_name ?? 'Unknown', email: r.student?.email ?? '', attended, count, lastJoined: lastJoinedMap.get(r.student_id) ?? null };
  }).sort((a, b) => b.count - a.count);

  const handleExport = () => {
    const ev = events.find(e => e.id === selectedEventId);
    const headers = ['Name', 'Email', 'Sessions Attended', 'Total Sessions', 'Last Joined', ...sessionDates];
    const rows = studentRows.map(r => [
      r.name, r.email, r.count, totalSessions,
      r.lastJoined ? new Date(r.lastJoined).toLocaleDateString() : 'Never',
      ...sessionDates.map(d => r.attended.has(d) ? 'Yes' : 'No'),
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `attendance-${(ev?.title || 'event').replace(/[^a-z0-9]/gi, '_').toLowerCase()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const lastSession  = sessionDates[sessionDates.length - 1] ?? null;
  // The session whose absences we are acting on: the chosen date, else the latest.
  const activeDate   = (nudgeDate && sessionDates.includes(nudgeDate)) ? nudgeDate : lastSession;
  const absentRows   = activeDate ? studentRows.filter(r => !r.attended.has(activeDate)) : [];
  const absentIds    = new Set(absentRows.map(r => r.id));

  // Default the selection to every absentee for the active session; the
  // instructor can then deselect anyone who was excused.
  useEffect(() => {
    setSelectedIds(new Set(absentRows.map(r => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDate, attendance, registrations]);

  const toggleStudent = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allAbsentSelected = absentRows.length > 0 && absentRows.every(r => selectedIds.has(r.id));
  const toggleAllAbsent = () =>
    setSelectedIds(allAbsentSelected ? new Set() : new Set(absentRows.map(r => r.id)));

  const handleNudge = async () => {
    const ids = Array.from(selectedIds).filter(id => absentIds.has(id));
    if (!selectedEventId || ids.length === 0) return;
    if (!window.confirm(`Send a missed-session reminder to ${ids.length} student${ids.length !== 1 ? 's' : ''}?`)) return;
    setNudging(true);
    setNudgeMsg('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res  = await fetch('/api/events/nudge-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ eventId: selectedEventId, sessionDate: activeDate, studentIds: ids }),
      });
      const json = await res.json();
      setNudgeMsg(json.error ? `Error: ${json.error}` : `Sent to ${json.sent} student${json.sent !== 1 ? 's' : ''}`);
    } catch {
      setNudgeMsg('Failed to send');
    } finally {
      setNudging(false);
      setTimeout(() => setNudgeMsg(''), 5000);
    }
  };

  const term = search.trim().toLowerCase();
  const visibleRows = studentRows.filter(r =>
    (!term || `${r.name} ${r.email}`.toLowerCase().includes(term))
    && (shown === 'all' || (shown === 'missed') === absentIds.has(r.id)));
  const attendedCount = activeDate ? studentRows.length - absentRows.length : 0;
  const dash = (n: number) => loading ? '--' : n;
  const chip = (on: boolean) => on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` };
  const th = 'text-left px-4 py-3 text-xs font-semibold whitespace-nowrap';

  return (
    <div className="space-y-5 pb-12">
      <PageHeader C={C} title="Live sessions" sub="Who joined each live class, and who missed it."
        actions={selectedEventId && !loading && <>
          {studentRows.length > 0 && (
            <button type="button" onClick={handleExport} className={btnClass} style={btnStyle('sec', C)}>
              <Download className="w-4 h-4" /> Export CSV
            </button>
          )}
          {absentRows.length > 0 && (
            <button type="button" onClick={handleNudge} disabled={nudging || selectedIds.size === 0} className={btnClass} style={btnStyle('sec', C)}>
              <Send className="w-4 h-4" /> {nudging ? 'Sending...' : `Nudge absent learners (${selectedIds.size})`}
            </button>
          )}
        </>} />

      {nudgeMsg && (
        <div role={nudgeMsg.startsWith('Error') || nudgeMsg === 'Failed to send' ? 'alert' : 'status'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={nudgeMsg.startsWith('Error') || nudgeMsg === 'Failed to send'
            ? { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }
            : { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` }}>
          {nudgeMsg.startsWith('Error') || nudgeMsg === 'Failed to send' ? <XCircle className="w-4 h-4 flex-shrink-0" /> : <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
          {nudgeMsg}
        </div>
      )}

      {eventsLoading ? (
        <div className="h-10 w-full sm:w-72 rounded-xl animate-pulse" style={{ background: C.card }} />
      ) : events.length === 0 ? (
        <Card C={C}><Empty C={C} title="No live sessions yet" sub="Live sessions you create show here with their attendance." /></Card>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <MenuSelect fixed searchable label="Live session" placeholder="Choose a live session" value={selectedEventId} onChange={setSelectedEventId} C={C}
            options={events.map(e => ({ value: e.id as string, label: `${e.title}${e.recurrence && e.recurrence !== 'once' ? ' (recurring)' : ''}` }))} />
          {selectedEventId && sessionDates.length > 1 && (
            <MenuSelect fixed label="Session to check absences against" value={activeDate ?? ''} onChange={setNudgeDate} C={C}
              options={sessionDates.map(d => ({ value: d, label: sessionLabel(d) }))} />
          )}
        </div>
      )}

      {!eventsLoading && events.length > 0 && !selectedEventId && (
        <Card C={C}><Empty C={C} title="Choose a live session to view attendance" /></Card>
      )}

      {selectedEventId && (
        <>
          <Kpis C={C} items={[
            { label: 'Registered', n: dash(studentRows.length), sub: `${plural(totalSessions, 'session')} recorded`, color: C.text },
            { label: 'Attended', n: dash(attendedCount), sub: activeDate ? `${studentRows.length ? Math.round((attendedCount / studentRows.length) * 100) : 0}% on ${sessionLabel(activeDate)}` : 'No sessions yet', color: attendedCount ? P.good : C.text },
            { label: 'Missed', n: dash(absentRows.length), sub: 'Registered, did not join', color: absentRows.length ? P.bad : C.text },
            { label: 'Joins', n: dash(attendance.length), sub: 'Including rejoins', color: C.text },
          ]} />

          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search learner" C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by attendance">
              {([['all', 'All'], ['attended', 'Attended'], ['missed', 'Missed']] as const).map(([id, label]) => (
                <button key={id} type="button" aria-pressed={shown === id} onClick={() => setShown(id)} className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(shown === id)}>{label}</button>
              ))}
            </div>
            <div role="tablist" aria-label="Attendance view" className="inline-flex gap-1 p-1 rounded-[14px] ml-auto" style={{ background: C.card }}>
              {([['summary', 'Summary'], ['matrix', 'Every session']] as const).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={viewMode === id} onClick={() => setViewMode(id)}
                  className="h-8 px-3 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
                  style={viewMode === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>{label}</button>
              ))}
            </div>
          </div>

          <Card C={C} className="overflow-hidden">
            {loading ? (
              <div className="p-5 space-y-3">
                {[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: C.skeleton }} />)}
              </div>
            ) : studentRows.length === 0 ? (
              <Empty C={C} title="No registered students for this event yet." />
            ) : visibleRows.length === 0 ? (
              <Empty C={C} title="No learners match these filters." />
            ) : viewMode === 'summary' ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr>
                      <th className="pl-4 pr-1 py-3 w-10">
                        <button type="button" role="checkbox" aria-checked={allAbsentSelected} aria-label="Select all absent" disabled={absentRows.length === 0} onClick={toggleAllAbsent} className="grid place-items-center disabled:opacity-40">
                          <Tick on={allAbsentSelected} C={C} />
                        </button>
                      </th>
                      <th className={th} style={{ color: C.faint }}>Learner</th>
                      <th className={th} style={{ color: C.faint }}>Attendance</th>
                      <th className={th} style={{ color: C.faint }}>Sessions attended</th>
                      <th className={th} style={{ color: C.faint }}>Last joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(r => {
                      const isAbsent = absentIds.has(r.id);
                      return (
                        <tr key={r.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                          <td className="pl-4 pr-1 py-3">
                            {isAbsent && (
                              <button type="button" role="checkbox" aria-checked={selectedIds.has(r.id)} aria-label={`Nudge ${r.name}`} onClick={() => toggleStudent(r.id)} className="grid place-items-center">
                                <Tick on={selectedIds.has(r.id)} C={C} />
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <p className="font-semibold" style={{ color: C.text }}>{r.name}</p>
                            <p className="text-xs" style={{ color: C.muted }}>{r.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            {!activeDate ? <span className="text-xs" style={{ color: C.muted }}>--</span>
                              : isAbsent ? <Pill tone="bad" C={C}>Missed</Pill>
                              : <Pill tone="good" dot C={C}>Attended</Pill>}
                          </td>
                          <td className="px-4 py-3 tabular-nums" style={{ color: C.text }}>{r.count} of {totalSessions}</td>
                          <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: C.muted }}>
                            {r.lastJoined ? new Date(r.lastJoined).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Never joined'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="text-xs" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
                  <thead>
                    <tr>
                      <th className={`${th} sticky left-0`} style={{ color: C.faint, minWidth: 180, background: C.card }}>Learner</th>
                      {sessionDates.map(d => (
                        <th key={d} className="px-3 py-3 font-semibold text-center whitespace-nowrap" style={{ color: C.faint, minWidth: 72 }}>
                          {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </th>
                      ))}
                      <th className="px-4 py-3 font-semibold text-center" style={{ color: C.faint }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map(r => (
                      <tr key={r.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                        <td className="px-4 py-3 sticky left-0" style={{ background: C.card }}>
                          <p className="font-semibold text-sm" style={{ color: C.text }}>{r.name}</p>
                          <p style={{ color: C.muted }}>{r.email}</p>
                        </td>
                        {sessionDates.map(d => (
                          <td key={d} className="px-3 py-3 text-center">
                            {r.attended.has(d)
                              ? <CheckCircle2 className="w-4 h-4 mx-auto" aria-label="Attended" style={{ color: P.good }} />
                              : <MinusCircle className="w-4 h-4 mx-auto" aria-label="Missed" style={{ color: C.faint, opacity: 0.5 }} />}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center font-semibold text-sm tabular-nums" style={{ color: C.text }}>
                          {r.count}/{totalSessions}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
