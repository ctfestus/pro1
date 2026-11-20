'use client';

// One assignment's report: tiles, filters and the responses table (one row per learner, or per
// group for a group assignment). Grading opens from here.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Download, ExternalLink, Pencil } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { exportCSV, exportGroupCSV } from '@/lib/dashboard-export';
import type { ThemeColors } from '@/lib/theme';
import { Bar, Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette, plural, shortDate } from '@/components/dashboard/subscriptions/ui';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { RESPONSE_ORDER, RESPONSE_STATUS, responseLabel, typeLabel } from './shared';

export function AssignmentReport({ assignment, submissions, assignedStudents, loading, veProgressMap, cohorts, passMark, onBack, onGrade, C }: {
  assignment: any;
  submissions: any[];
  assignedStudents: any[];
  loading: boolean;
  veProgressMap: Record<string, { pct: number; completedAt: string | null }>;
  cohorts: { id: string; name: string }[];
  passMark: number;
  onBack: () => void;
  onGrade: (submission: any) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [statusFilter, setStatusFilter] = useState('all');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const isGroup = (assignment.group_ids?.length ?? 0) > 0;

  // A submission wins (graded, submitted, draft); otherwise the VE attempt, so in-progress work
  // is not reported as Not started.
  const subByStudent: Record<string, any> = Object.fromEntries(submissions.map((s) => [s.student_id, s]));
  const learnerRows = assignedStudents.map((st) => {
    const sub = subByStudent[st.id] ?? null;
    const ve = veProgressMap[st.id];
    const status = sub?.status ?? (ve ? (ve.completedAt ? 'done_unsubmitted' : 'in_progress') : 'not_started');
    return { ...st, sub, _status: status, _pct: ve?.pct };
  });
  const subByGroup = Object.fromEntries(submissions.filter((s) => s.group_id).map((s) => [s.group_id, s]));
  const groupMap = new Map<string, { id: string; name: string; members: any[] }>();
  if (isGroup) {
    for (const st of assignedStudents) {
      if (!st.group_id) continue;
      if (!groupMap.has(st.group_id)) groupMap.set(st.group_id, { id: st.group_id, name: st.group_name || 'Group', members: [] });
      groupMap.get(st.group_id)!.members.push(st);
    }
  }
  const groupRows = [...groupMap.values()].map((group) => {
    const sub = subByGroup[group.id] ?? null;
    const ids = new Set(Array.isArray(sub?.participants) ? sub.participants : []);
    const participants = sub ? group.members.filter((m) => ids.has(m.id)) : [];
    const leader = group.members.find((m) => m.is_leader) ?? group.members[0] ?? null;
    const memberVe = group.members.map((m) => veProgressMap[m.id]).filter(Boolean);
    const status = sub?.status ?? (memberVe.length ? (memberVe.some((v) => v.completedAt) ? 'done_unsubmitted' : 'in_progress') : 'not_started');
    const pct = memberVe.length ? Math.max(...memberVe.map((v) => v.pct)) : undefined;
    return { ...group, sub, participants, leader, _status: status, _pct: pct };
  });
  const rows: any[] = isGroup ? groupRows : learnerRows;

  const present = RESPONSE_ORDER.filter((s) => rows.some((r) => r._status === s));
  const showCohortFilter = !isGroup && cohorts.length > 1;
  const term = search.trim().toLowerCase();
  const visible = rows
    .filter((r) => {
      const searchable = isGroup
        ? [r.name, r.leader?.full_name, r.leader?.email, ...(r.members ?? []).flatMap((m: any) => [m.full_name, m.email])]
        : [r.full_name, r.email, r.group_name];
      return (statusFilter === 'all' || r._status === statusFilter)
        && (cohortFilter === 'all' || r.cohort_id === cohortFilter)
        && (!term || searchable.some((v) => String(v ?? '').toLowerCase().includes(term)));
    })
    // What needs grading first, then the rest in the same order as the chips.
    .sort((a, b) => RESPONSE_ORDER.indexOf(a._status) - RESPONSE_ORDER.indexOf(b._status));

  const responded = isGroup ? groupRows.filter((r) => r.sub).length : submissions.length;
  const gradedScores = (isGroup ? groupRows.map((r) => r.sub) : submissions)
    .filter((s) => s?.status === 'graded').map((s) => s.score).filter((v): v is number => typeof v === 'number');
  const graded = isGroup ? groupRows.filter((r) => r.sub?.status === 'graded').length : submissions.filter((s) => s.status === 'graded').length;
  const passed = gradedScores.filter((s) => s >= passMark).length;
  const assignedTotal = rows.length;
  const toGrade = rows.filter((r) => r._status === 'submitted').length;
  const average = gradedScores.length ? Math.round(gradedScores.reduce((x, y) => x + y, 0) / gradedScores.length) : null;
  const rate = assignedTotal ? Math.round((responded / assignedTotal) * 100) : 0;
  const passRate = graded ? Math.round((passed / graded) * 100) : 0;

  const tiles = [
    { label: isGroup ? 'Groups' : 'Assigned', n: String(assignedTotal), color: C.text },
    { label: 'Responded', n: `${rate}%`, color: C.text, bar: rate },
    { label: 'To grade', n: String(toGrade), color: toGrade ? P.warn : C.text },
    { label: 'Graded', n: String(graded), color: C.text },
    { label: 'Average score', n: average == null ? '--' : `${average}%`, color: C.text },
    { label: 'Pass rate', n: `${passRate}%`, color: C.text },
  ];

  const statusPill = (r: any) => <Pill tone={(RESPONSE_STATUS[r._status] ?? RESPONSE_STATUS.not_started).tone} dot={r._status === 'submitted' || r._status === 'graded'} C={C}>{responseLabel(r._status, r._pct)}</Pill>;
  const score = (sub: any) => sub?.score != null
    ? <span className="font-semibold tabular-nums" style={{ color: sub.score >= passMark ? P.good : P.bad }}>{sub.score}</span>
    : <span className="text-xs" style={{ color: C.muted }}>--</span>;
  const result = (sub: any) => sub?.score != null
    ? <Pill tone={sub.score >= passMark ? 'good' : 'bad'} C={C}>{sub.score >= passMark ? 'Passed' : 'Failed'}</Pill>
    : <span className="text-xs" style={{ color: C.muted }}>--</span>;
  // Grade is the main button only where a hand-in is waiting.
  const action = (sub: any) => !sub ? null : (
    <button type="button" onClick={(e) => { e.stopPropagation(); onGrade(sub); }} className={btnSmClass} style={btnStyle(sub.status === 'submitted' ? 'pri' : 'sec', C)}>
      {sub.status === 'graded' ? 'Regrade' : 'Grade'}
    </button>
  );
  const toggle = (id: string) => setExpanded((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const th = (labels: string[]) => <thead><tr>{labels.map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>;

  return (
    <div className="space-y-5 pb-12">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: C.muted }}>
        <ArrowLeft className="w-4 h-4" />
        All assignments
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{assignment.title}</h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: C.muted }}>
            {assignment.status === 'published' ? <Pill tone="good" dot C={C}>Published</Pill> : <Pill tone="warn" C={C}>Draft</Pill>}
            <span>{typeLabel(assignment)}</span>
            <span>{assignment.deadline_date ? `Due ${shortDate(String(assignment.deadline_date).slice(0, 10))}` : 'No due date'}</span>
            <span>Pass mark {passMark}%</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/create/assignment?edit=${assignment.id}&preview=1`} target="_blank" rel="noreferrer" className={`${btnClass} no-underline`} style={btnStyle('sec', C)}>
            <ExternalLink className="w-4 h-4" />
            Preview
          </Link>
          <Link href={`/create/assignment?edit=${assignment.id}`} className={`${btnClass} no-underline`} style={btnStyle('sec', C)}>
            <Pencil className="w-4 h-4" />
            Edit
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {tiles.map((t) => (
          <Card key={t.label} C={C} className="p-4 grid gap-2 content-start">
            <p className="text-2xl leading-8 tabular-nums" style={{ color: t.color, fontFamily: DISPLAY_FONT }}>{t.n}</p>
            <p className="text-sm font-semibold" style={{ color: C.text }}>{t.label}</p>
            {t.bar != null && <Bar parts={[{ pct: t.bar, color: P.good }]} C={C} />}
          </Card>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder={isGroup ? 'Search groups or members' : 'Search by name or email'} C={C} />
            {showCohortFilter && (
              <MenuSelect searchable fixed label="Filter by cohort" value={cohortFilter} onChange={setCohortFilter}
                options={[{ value: 'all', label: 'All cohorts' }, ...cohorts.map((c) => ({ value: c.id, label: c.name }))]} C={C} />
            )}
            <button type="button" onClick={() => (isGroup ? exportGroupCSV(visible, assignment.title, passMark) : exportCSV(visible, assignment.title, passMark))} className={btnClass} style={btnStyle('sec', C)}>
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter responses by status">
            {[['all', 'All'], ...present.map((s) => [s, RESPONSE_STATUS[s].label])].map(([id, label]) => (
              <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                style={statusFilter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <Card C={C} className="overflow-hidden">
        {loading ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>Loading responses...</p>
        ) : rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-semibold" style={{ color: C.text }}>{isGroup ? 'No groups assigned' : 'No learners assigned'}</p>
            <p className="text-xs mt-1" style={{ color: C.muted }}>{isGroup ? 'No group members found for this assignment.' : 'Give this assignment to a cohort first.'}</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: C.muted }}>No {isGroup ? 'groups' : 'learners'} match these filters.</p>
            <button type="button" onClick={() => { setStatusFilter('all'); setCohortFilter('all'); setSearch(''); }} className="mt-2 text-xs font-semibold underline underline-offset-2" style={{ color: C.text }}>Clear filters</button>
          </div>
        ) : isGroup ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm table-fixed">
              <colgroup><col style={{ width: '26%' }} /><col style={{ width: '20%' }} /><col style={{ width: '9%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: 110 }} /></colgroup>
              {th(['Group', 'Leader', 'Members', 'Took part', 'Status', 'Score', 'Result', ''])}
              <tbody>
                {visible.map((row) => {
                  const open = expanded.has(row.id);
                  return [
                    <tr key={row.id} onClick={() => toggle(row.id)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: C.muted, transform: open ? 'rotate(180deg)' : 'none' }} />
                          <div className="min-w-0">
                            <p className="font-semibold truncate" style={{ color: C.text }}>{row.name}</p>
                            <p className="text-xs truncate" style={{ color: C.muted }}>{row.sub ? `Handed in by ${row.sub.submitted_by_student?.full_name || row.sub.student?.full_name || 'the leader'}` : 'Waiting for a hand-in'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><p className="truncate" style={{ color: C.text }}>{row.leader?.full_name || row.leader?.email || 'No leader'}</p></td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: C.text }}>{row.members.length}</td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: row.sub ? C.text : C.muted }}>{row.sub ? `${row.participants.length} of ${row.members.length}` : '--'}</td>
                      <td className="px-4 py-3">{statusPill(row)}</td>
                      <td className="px-4 py-3">{score(row.sub)}</td>
                      <td className="px-4 py-3">{result(row.sub)}</td>
                      <td className="pl-2 pr-5 py-3 text-right">{action(row.sub)}</td>
                    </tr>,
                    open && (
                      <tr key={`${row.id}-members`}>
                        <td colSpan={8} className="px-5 pb-4">
                          <div className="grid md:grid-cols-2 gap-6 pl-6">
                            <div>
                              <p className="text-xs font-semibold mb-1" style={{ color: C.muted }}>Members</p>
                              {row.members.map((m: any, i: number) => {
                                const took = !!row.sub && row.participants.some((p: any) => p.id === m.id);
                                return (
                                  <div key={m.id} className="flex items-center gap-3 py-2" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{m.full_name || m.email}</p>
                                      <p className="text-xs truncate" style={{ color: C.muted }}>{m.email}</p>
                                    </div>
                                    {m.is_leader && <Pill tone="good" dot C={C}>Leader</Pill>}
                                    {row.sub && <Pill tone={took ? 'good' : 'mute'} C={C}>{took ? 'Took part' : 'Not marked'}</Pill>}
                                  </div>
                                );
                              })}
                            </div>
                            <div>
                              <p className="text-xs font-semibold mb-1" style={{ color: C.muted }}>Hand-in</p>
                              {row.sub ? (
                                <div className="grid gap-1 text-sm py-2" style={{ color: C.text }}>
                                  <p>Handed in by {row.sub.submitted_by_student?.full_name || row.sub.student?.full_name || 'the leader'}</p>
                                  <p style={{ color: C.muted }}>{row.sub.updated_at ? shortDate(row.sub.updated_at) : ''}</p>
                                  <p className="text-xs" style={{ color: C.muted }}>Only the members marked as taking part get this grade.</p>
                                </div>
                              ) : <p className="text-sm py-2" style={{ color: C.muted }}>Nothing handed in yet.</p>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm table-fixed">
                <colgroup><col style={{ width: '40%' }} /><col style={{ width: '20%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: 120 }} /></colgroup>
                {th(['Learner', 'Status', 'Score', 'Result', ''])}
                <tbody>
                  {visible.map((row) => (
                    <tr key={row.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold truncate" style={{ color: C.text }}>{row.full_name || row.email}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>{row.email}</p>
                      </td>
                      <td className="px-4 py-3">{statusPill(row)}</td>
                      <td className="px-4 py-3">{score(row.sub)}</td>
                      <td className="px-4 py-3">{result(row.sub)}</td>
                      <td className="pl-2 pr-5 py-3 text-right">{action(row.sub)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {visible.map((row, i) => (
                <div key={row.id} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{row.full_name || row.email}</p>
                      <p className="text-xs truncate" style={{ color: C.muted }}>{row.email}</p>
                    </div>
                    {action(row.sub)}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">{statusPill(row)}{row.sub?.score != null && <>{score(row.sub)}{result(row.sub)}</>}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>
      {visible.length > 0 && <p className="text-xs" style={{ color: C.muted }}>{plural(visible.length, isGroup ? 'group' : 'learner')}{isGroup ? '. Click a group to see its members.' : '.'}</p>}
    </div>
  );
}
