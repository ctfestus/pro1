'use client';

import { useState, type ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { Avatar, Card, DISPLAY_FONT, Pill, btnStyle, dateLabel, learnerName } from '../subscriptions/ui';
import { amountText } from './shared';

const FILTERS = [
  { id: 'pending', label: 'Waiting for review' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'all', label: 'All' },
] as const;

/** Payment proofs learners send. Approving records the payment and updates their access. */
export function ProofsView({ C, confs, currencyFor, busy, onApprove, onReject }: {
  C: ThemeColors;
  confs: any[];
  /** The proof's currency, from the enrollment it belongs to. */
  currencyFor: (conf: any) => string | null;
  busy: boolean;
  onApprove: (conf: any) => Promise<boolean>;
  onReject: (conf: any, note: string) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('pending');
  const [open, setOpen] = useState<any>(null);
  // Set while the reason for a rejection is being written, inside the details pop-up.
  const [rejecting, setRejecting] = useState<any>(null);
  const [note, setNote] = useState('');
  const shown = confs.filter((c) => filter === 'all' || c.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter proofs">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className="h-8 px-3 rounded-full text-xs font-semibold"
              style={filter === id ? { background: C.cta, color: '#FFFFFF' } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: C.muted }}>Approving records the payment and updates the learner&apos;s access.</p>
      </div>

      <Card C={C} className="overflow-hidden">
        {shown.length === 0 && (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>
            {filter === 'pending' ? 'No payment proofs are waiting for review.' : filter === 'all' ? 'No payment proofs yet.' : `No ${filter} proofs.`}
          </p>
        )}
        {shown.map((c, index) => (
          <button
            key={c.id}
            type="button"
            onClick={() => { setRejecting(null); setOpen(c); }}
            className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:opacity-90"
            style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}
          >
            <Avatar name={learnerName(c.students)} color={C.text} background={C.pill} />
            <span className="min-w-0 flex-1 text-sm font-semibold truncate" style={{ color: C.text }}>{learnerName(c.students)}</span>
            {c.status === 'approved' && <Pill tone="good" dot C={C}>Approved</Pill>}
            {c.status === 'rejected' && <Pill tone="bad" dot C={C}>Rejected</Pill>}
            <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: C.faint }} />
          </button>
        ))}
      </Card>

      {open && (() => {
        const currency = currencyFor(open);
        const details: [string, ReactNode][] = [
          ['Cohort', open.cohorts?.name],
          ['Sent', open.created_at && dateLabel(open.created_at)],
          ['Paid on', open.paid_at && dateLabel(open.paid_at)],
          ['Method', open.method],
          ['Reference', open.reference],
          ['Learner note', open.notes],
          ['Note to learner', open.admin_notes],
          ['Receipt', open.receipt_url && <a href={open.receipt_url} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2" style={{ color: C.text }}>View receipt</a>],
        ];
        return (
          <Modal title="Payment proof" eyebrow={learnerName(open.students)} onClose={() => setOpen(null)} C={C}>
            <div className="grid gap-4">
              <div className="flex items-center justify-between gap-3 rounded-xl p-4" style={{ background: C.page }}>
                <span className="text-[28px] leading-9 font-semibold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
                  {open.amount != null ? amountText(currency, open.amount) : '--'}
                </span>
                {open.status === 'pending' ? <Pill tone="warn" dot C={C}>Waiting for review</Pill>
                  : open.status === 'approved' ? <Pill tone="good" dot C={C}>Approved</Pill> : <Pill tone="bad" dot C={C}>Rejected</Pill>}
              </div>
              <dl className="rounded-xl overflow-hidden" style={{ background: C.page }}>
                {details.filter(([, value]) => value).map(([name, value], i) => (
                  <div key={name} className="flex items-start justify-between gap-4 px-4 py-3 text-sm" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                    <dt style={{ color: C.muted }}>{name}</dt>
                    <dd className="text-right break-words min-w-0" style={{ color: C.text }}>{value}</dd>
                  </div>
                ))}
              </dl>
              {rejecting && (
                <label className="block text-xs font-semibold" style={{ color: C.muted }}>
                  Reason <span className="font-normal" style={{ color: C.faint }}>(optional, the learner sees it)</span>
                  <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to be corrected" className={`${FIELD} mt-2 min-h-24`} style={inputStyle(C)} />
                </label>
              )}
            </div>
            {open.status === 'pending' && (
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
                {rejecting ? (
                  <>
                    <button type="button" onClick={() => setRejecting(null)} className={BUTTON} style={{ background: C.pill, color: C.text }}>Back</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => { if (await onReject(open, note)) setOpen(null); }}
                      className={BUTTON}
                      style={{ background: C.deleteText, color: '#FFFFFF' }}
                    >
                      {busy ? 'Rejecting...' : 'Reject proof'}
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={busy} onClick={() => { setNote(''); setRejecting(open); }} className={BUTTON} style={btnStyle('danger', C)}>Reject</button>
                    <button type="button" disabled={busy} onClick={async () => { if (await onApprove(open)) setOpen(null); }} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
                      <Check className="w-4 h-4" />
                      {busy ? 'Approving...' : 'Approve and record'}
                    </button>
                  </>
                )}
              </div>
            )}
          </Modal>
        );
      })()}
    </div>
  );
}
