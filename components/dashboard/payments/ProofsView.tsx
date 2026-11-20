'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { Avatar, Card, DISPLAY_FONT, Pill, btnSmClass, btnStyle, learnerName, shortDate } from '../subscriptions/ui';
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
  onApprove: (conf: any) => void;
  onReject: (conf: any, note: string) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('pending');
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
        {shown.map((c, index) => {
          const currency = currencyFor(c);
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-4" style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}>
              <Avatar name={learnerName(c.students)} color={C.text} background={C.pill} />
              <div className="min-w-[220px] flex-1">
                <div className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: C.text }}>
                  {learnerName(c.students)}
                  {c.status === 'approved' && <Pill tone="good" dot C={C}>Approved</Pill>}
                  {c.status === 'rejected' && <Pill tone="bad" dot C={C}>Rejected</Pill>}
                </div>
                <p className="text-xs" style={{ color: C.muted }}>
                  {[c.cohorts?.name, c.created_at && `sent ${shortDate(c.created_at)}`].filter(Boolean).join(', ')}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {[c.method, c.reference, c.paid_at && `Paid ${shortDate(c.paid_at)}`, c.notes].filter(Boolean).map((t, i) => (
                    <span key={i} className="text-xs px-2 rounded-lg leading-5" style={{ background: C.pill, color: C.muted }}>{t}</span>
                  ))}
                  {c.receipt_url && (
                    <a href={c.receipt_url} target="_blank" rel="noreferrer" className="text-xs font-semibold underline underline-offset-2" style={{ color: C.text }}>View receipt</a>
                  )}
                </div>
                {c.admin_notes && <p className="text-xs mt-2" style={{ color: C.muted }}>Note to learner: {c.admin_notes}</p>}
              </div>
              {c.amount != null && <span className="text-base font-semibold tabular-nums whitespace-nowrap" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{amountText(currency, c.amount)}</span>}
              {c.status === 'pending' && (
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => { setNote(''); setRejecting(c); }} className={btnSmClass} style={btnStyle('danger', C)}>Reject</button>
                  <button type="button" disabled={busy} onClick={() => onApprove(c)} className={btnSmClass} style={btnStyle('pri', C)}>
                    <Check className="w-4 h-4" />
                    Approve
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </Card>

      {rejecting && (
        <Modal title="Reject payment proof" eyebrow={learnerName(rejecting.students)} onClose={() => setRejecting(null)} C={C}>
          <label className="block text-xs font-semibold" style={{ color: C.muted }}>
            Reason <span className="font-normal" style={{ color: C.faint }}>(optional, the learner sees it)</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What needs to be corrected" className={`${FIELD} mt-2 min-h-24`} style={inputStyle(C)} />
          </label>
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
            <button type="button" onClick={() => setRejecting(null)} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => { if (await onReject(rejecting, note)) setRejecting(null); }}
              className={BUTTON}
              style={{ background: C.deleteText, color: '#FFFFFF' }}
            >
              {busy ? 'Rejecting...' : 'Reject proof'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
