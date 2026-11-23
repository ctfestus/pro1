'use client';

// The student assignment page's details panel (status, deadline, pass mark, type and, for
// scenario assignments, counts and progress), its one-line form on phones, and the icon-tiled
// sections of the brief. Shared by AssignmentDetail and StandardAssignmentPlayer so every
// assignment type reads the same.

import type { ReactNode } from 'react';
import { CalendarDots, Medal } from '@phosphor-icons/react';
import type { LIGHT_C } from '@/lib/theme';

type Colors = typeof LIGHT_C;

/** "Mon, 30 Nov" for a plain YYYY-MM-DD date (or an ISO timestamp). */
export function formatDueShort(d: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00` : d);
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
  return `${weekday}, ${date.getDate()} ${date.toLocaleDateString('en-GB', { month: 'short' })}`;
}

export type AssignmentStatus = { label: string; good: boolean };

/** Where the student's work stands, for the status pill. Green on white once handed in. */
export function assignmentStatus(subStatus: string | undefined, score?: number | null): AssignmentStatus {
  if (subStatus === 'graded') return { label: score != null ? `Graded, ${score}%` : 'Graded', good: true };
  if (subStatus === 'submitted') return { label: 'Submitted', good: true };
  if (subStatus === 'draft') return { label: 'In progress', good: false };
  return { label: 'Not submitted', good: false };
}

export function StatusPill({ status, C }: { status: AssignmentStatus; C: Colors }) {
  return (
    <span className="inline-block text-[12px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap"
      style={status.good
        ? { background: C.card, color: '#16a34a', boxShadow: 'inset 0 0 0 1px rgba(22,163,74,0.28)' }
        : { background: C.pill, color: C.muted }}>
      {status.label}
    </span>
  );
}

export type DetailRow = { icon: ReactNode; label: string; value: ReactNode };

/** The left panel: a white sticky card with the status, then label and value rows. */
export function DetailsPanel({ status, rows, cover, C }: { status: AssignmentStatus; rows: DetailRow[]; cover?: ReactNode; C: Colors }) {
  return (
    <aside className="rounded-xl p-4 sticky top-3 self-start" style={{ background: C.card }}>
      {cover}
      <StatusPill status={status} C={C} />
      <div className="grid gap-3 mt-3.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex-shrink-0 text-[18px]" style={{ color: C.faint }}>{row.icon}</span>
            <div className="min-w-0">
              <p className="text-[12px]" style={{ color: C.faint }}>{row.label}</p>
              <div className="text-[14px] font-bold break-words" style={{ color: C.text }}>{row.value}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** Phones: the details as one short line above the brief. */
export function DetailsLine({ status, due, passMark, C }: { status: AssignmentStatus; due?: string | null; passMark?: number | null; C: Colors }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
      <StatusPill status={status} C={C} />
      {due && (
        <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: C.muted }}>
          <CalendarDots weight="duotone" className="w-4 h-4" style={{ color: C.faint }} /> Due {formatDueShort(due)}
        </span>
      )}
      {passMark != null && (
        <span className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: C.muted }}>
          <Medal weight="duotone" className="w-4 h-4" style={{ color: C.faint }} /> Pass {passMark}%
        </span>
      )}
    </div>
  );
}

/** A 36px tile with a dark icon on the brand tint. Colour is kept for meaning, not icons. */
export function IconTile({ icon, C }: { icon: ReactNode; C: Colors }) {
  return (
    <span className="grid place-items-center flex-shrink-0 rounded-lg text-[19px]" style={{ width: 36, height: 36, background: `${C.cta}17`, color: C.text }}>
      {icon}
    </span>
  );
}

/** One section of the brief: a tile, a bold label, then its content. Divided by a thin line. */
export function BriefSection({ icon, label, children, first, C }: { icon: ReactNode; label: string; children: ReactNode; first?: boolean; C: Colors }) {
  return (
    <div className="grid gap-3 py-3.5" style={{ gridTemplateColumns: '36px minmax(0,1fr)', borderTop: first ? undefined : `1px solid ${C.divider}`, paddingTop: first ? 4 : undefined }}>
      <IconTile icon={icon} C={C} />
      <div className="min-w-0">
        <p className="font-bold mb-0.5 text-[14px]" style={{ color: C.text }}>{label}</p>
        <div style={{ color: C.muted }}>{children}</div>
      </div>
    </div>
  );
}
