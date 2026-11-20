'use client';

import { useEffect, useState } from 'react';
import { durationLabel } from '@/lib/pricing-offer';
import type { ThemeColors } from '@/lib/theme';
import { getPayments } from './api';
import { Modal } from './Modal';
import { DISPLAY_FONT, dateLabel, money } from './ui';

/** A learner's subscription payments, loaded when the pop-up opens. */
export function HistoryModal({ sub, onClose, C }: { sub: any; onClose: () => void; C: ThemeColors }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getPayments(`action=subscription-history&studentId=${sub.student_id}`, 'Failed to load history')
      .then((data) => setRows(data.payments ?? []))
      .catch((err) => setError(err.message || 'Could not load the payment history. Check your connection and try again.'));
  }, [sub.student_id]);

  return (
    <Modal title="Subscription payment history" eyebrow="Every payment and request, kept as recorded" onClose={onClose} C={C} error={error}>
      {rows === null ? (
        !error && <p className="text-sm text-center py-8" style={{ color: C.muted }}>Loading payments</p>
      ) : rows.length ? (
        <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
          {rows.map((row, index) => (
            <div key={row.id} className="flex items-start justify-between gap-3 px-4 py-3" style={index ? { borderTop: `1px solid ${C.divider}` } : undefined}>
              <div className="min-w-0">
                <p className="text-base font-semibold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{money(row.currency, row.amount)}</p>
                <p className="text-xs mt-1" style={{ color: C.muted }}>
                  {[row.plan_name, durationLabel(Number(row.duration_months)), row.kind && String(row.kind).replaceAll('_', ' ')].filter(Boolean).join(', ')}
                </p>
                {row.payment_reference && <p className="text-xs mt-1" style={{ color: C.faint }}>Reference {row.payment_reference}</p>}
              </div>
              <p className="text-xs whitespace-nowrap" style={{ color: C.muted }}>{dateLabel(row.paid_at)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-center py-8" style={{ color: C.muted }}>No payments recorded.</p>
      )}
    </Modal>
  );
}
