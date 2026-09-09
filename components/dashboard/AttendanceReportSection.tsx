'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Mail, Download, CheckCircle2, MinusCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { isScheduledSessionDate } from '@/lib/event-sessions';
import { LIGHT_C, cardStyle } from '@/lib/theme';

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

export function AttendanceReportSection({ C }: { C: typeof LIGHT_C }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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

  const card = cardStyle(C) as React.CSSProperties;
  const thStyle = { color: C.faint } as React.CSSProperties;

  return (
    <div className="space-y-5 pb-10">
      <div className="rounded-2xl p-5" style={card}>
        <p className="text-sm font-semibold mb-3" style={{ color: C.text }}>Select Live Session</p>
        {eventsLoading ? (
          <div className="h-10 rounded-lg animate-pulse" style={{ background: C.skeleton }} />
        ) : (
          <select value={selectedEventId} onChange={e => setSelectedEventId(e.target.value)}
            className="w-full rounded-lg px-4 py-2.5 text-sm"
            style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text, outline: 'none' }}>
            <option value="">Choose a live session to view attendance</option>
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.title}{e.recurrence && e.recurrence !== 'once' ? ' (recurring)' : ''}</option>
            ))}
          </select>
        )}
      </div>

      {selectedEventId && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Registered', value: loading ? '--' : registrations.length },
              { label: 'Sessions', value: loading ? '--' : totalSessions },
              { label: 'Total Joins', value: loading ? '--' : attendance.length },
            ].map(s => (
              <div key={s.label} className="rounded-2xl p-4" style={card}>
                <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: C.faint }}>{s.label}</p>
                <p className="text-2xl font-bold" style={{ color: C.text }}>{s.value}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl overflow-hidden" style={card}>
            {/* Carousel switcher header */}
            <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex items-center gap-3 min-w-0">
                <h3 className="text-base font-bold leading-none capitalize" style={{ color: C.text }}>{viewMode}</h3>
                <div className="flex items-center gap-1.5">
                  {(['summary', 'matrix'] as const).map(m => (
                    <button key={m} onClick={() => setViewMode(m)} aria-label={m}
                      className="rounded-full transition-all"
                      style={{ width: viewMode === m ? 18 : 7, height: 7, background: viewMode === m ? C.cta : C.cardBorder }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setViewMode(viewMode === 'summary' ? 'matrix' : 'summary')} aria-label="Previous view"
                  className="w-8 h-8 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                  style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                  <ChevronLeft className="w-4 h-4"/>
                </button>
                <button onClick={() => setViewMode(viewMode === 'summary' ? 'matrix' : 'summary')} aria-label="Next view"
                  className="w-8 h-8 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                  style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                  <ChevronRight className="w-4 h-4"/>
                </button>
              </div>
            </div>
            {/* Controls row */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <p className="text-xs" style={{ color: C.faint }}>{registrations.length} registered &middot; {totalSessions} sessions recorded</p>
              <div className="flex flex-wrap items-center gap-2">
                {sessionDates.length > 1 && (
                  <select value={activeDate ?? ''} onChange={e => setNudgeDate(e.target.value)}
                    title="Session to check absences against"
                    className="rounded-lg px-2.5 py-1.5 text-xs font-medium"
                    style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text, outline: 'none' }}>
                    {sessionDates.map(d => (
                      <option key={d} value={d}>
                        {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </option>
                    ))}
                  </select>
                )}
                {absentRows.length > 0 && (
                  <button onClick={handleNudge} disabled={nudging || selectedIds.size === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: '#fee2e2', color: '#dc2626', opacity: (nudging || selectedIds.size === 0) ? 0.6 : 1 }}>
                    <Mail className="w-3.5 h-3.5" /> {nudging ? 'Sending...' : `Nudge absent (${selectedIds.size})`}
                  </button>
                )}
                {studentRows.length > 0 && (
                  <button onClick={handleExport}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                    style={{ background: C.pill, color: C.muted }}>
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                )}
                {nudgeMsg && (
                  <span className="text-xs font-medium" style={{ color: nudgeMsg.startsWith('Error') ? '#dc2626' : '#16a34a' }}>
                    {nudgeMsg}
                  </span>
                )}
              </div>
            </div>

            {loading ? (
              <div className="px-5 py-10 space-y-3">
                {[0,1,2,3].map(i => <div key={i} className="h-12 rounded-lg animate-pulse" style={{ background: C.skeleton }} />)}
              </div>
            ) : studentRows.length === 0 ? (
              <div className="px-5 py-16 text-center text-sm" style={{ color: C.faint }}>
                No registered students for this event yet.
              </div>
            ) : viewMode === 'summary' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ ...thStyle, borderBottom: `1px solid ${C.divider}` }}>
                      <th className="px-3 sm:px-4 py-3 text-center" style={{ width: 40 }}>
                        <input type="checkbox" aria-label="Select all absent"
                          checked={allAbsentSelected} disabled={absentRows.length === 0}
                          onChange={toggleAllAbsent} style={{ accentColor: C.cta, cursor: absentRows.length === 0 ? 'default' : 'pointer' }} />
                      </th>
                      <th className="text-left px-1 sm:px-2 py-3 text-xs font-semibold uppercase tracking-wide">Student</th>
                      <th className="text-center px-3 sm:px-4 py-3 text-xs font-semibold uppercase tracking-wide">Attended</th>
                      <th className="text-center px-3 sm:px-4 py-3 text-xs font-semibold uppercase tracking-wide">Missed</th>
                      <th className="hidden sm:table-cell text-right px-5 py-3 text-xs font-semibold uppercase tracking-wide">Last Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentRows.map(r => {
                      const missed = totalSessions - r.count;
                      const isAbsent = absentIds.has(r.id);
                      return (
                        <tr key={r.id}>
                          <td className="px-3 sm:px-4 py-3 text-center">
                            {isAbsent ? (
                              <input type="checkbox" aria-label={`Nudge ${r.name}`}
                                checked={selectedIds.has(r.id)} onChange={() => toggleStudent(r.id)}
                                style={{ accentColor: C.cta, cursor: 'pointer' }} />
                            ) : null}
                          </td>
                          <td className="px-1 sm:px-2 py-3">
                            <p className="font-semibold" style={{ color: C.text }}>{r.name}</p>
                            <p className="text-xs" style={{ color: C.faint }}>{r.email}</p>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-center">
                            <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
                              style={{ background: '#dcfce7', color: '#16a34a' }}>
                              <CheckCircle2 className="w-3 h-3" /> {r.count}
                            </span>
                          </td>
                          <td className="px-3 sm:px-4 py-3 text-center">
                            {missed > 0 ? (
                              <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full"
                                style={{ background: '#fee2e2', color: '#dc2626' }}>
                                <MinusCircle className="w-3 h-3" /> {missed}
                              </span>
                            ) : <span style={{ color: C.faint }}>--</span>}
                          </td>
                          <td className="hidden sm:table-cell px-5 py-3 text-right text-xs" style={{ color: C.faint }}>
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
                    <tr style={{ ...thStyle, borderBottom: `1px solid ${C.divider}` }}>
                      <th className="text-left px-5 py-3 font-semibold uppercase tracking-wide sticky left-0"
                        style={{ ...thStyle, minWidth: 180, background: C.card }}>Student</th>
                      {sessionDates.map(d => (
                        <th key={d} className="px-3 py-3 font-semibold uppercase tracking-wide text-center" style={{ minWidth: 72 }}>
                          {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </th>
                      ))}
                      <th className="px-4 py-3 font-semibold uppercase tracking-wide text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {studentRows.map(r => (
                      <tr key={r.id}>
                        <td className="px-5 py-3 sticky left-0" style={{ background: C.card }}>
                          <p className="font-semibold text-sm" style={{ color: C.text }}>{r.name}</p>
                          <p style={{ color: C.faint }}>{r.email}</p>
                        </td>
                        {sessionDates.map(d => (
                          <td key={d} className="px-3 py-3 text-center">
                            {r.attended.has(d)
                              ? <CheckCircle2 className="w-4 h-4 mx-auto" style={{ color: '#16a34a' }} />
                              : <MinusCircle className="w-4 h-4 mx-auto" style={{ color: isDark ? '#333' : '#e5e7eb' }} />}
                          </td>
                        ))}
                        <td className="px-4 py-3 text-center font-bold text-sm" style={{ color: C.text }}>
                          {r.count}/{totalSessions}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
