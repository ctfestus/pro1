'use client';

// The cohort Payments page: data, page actions and the section switch. The sections and pop-ups
// live in components/dashboard/payments/.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3, CreditCard, Download, Gift, Pencil, Send, Settings, ShieldCheck, ShieldOff, XCircle } from 'lucide-react';
import { reportExportCSV } from '@/lib/dashboard-export';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { getPayments, postPayments } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuItem, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { DISPLAY_FONT, btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { EditEnrollmentModal, PaymentHistoryModal, RecordPaymentModal } from '@/components/dashboard/payments/EnrollmentModals';
import { EnrollmentsView } from '@/components/dashboard/payments/EnrollmentsView';
import { OptionsView } from '@/components/dashboard/payments/OptionsView';
import { ProofsView } from '@/components/dashboard/payments/ProofsView';
import { SettingsModal } from '@/components/dashboard/payments/SettingsModal';
import { amountText, owed } from '@/components/dashboard/payments/shared';

type Section = 'enrollments' | 'proofs' | 'options';
const SECTIONS: [Section, string][] = [['enrollments', 'Enrollments'], ['proofs', 'Payment proofs'], ['options', 'Payment options']];

export function PaymentsSection({ C: theme }: { C: ThemeColors }) {
  // As on Subscriptions: the dark-mode blue for buttons and selection controls in both modes.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [section, setSection] = useState<Section>('enrollments');
  const [rows, setRows] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [confs, setConfs] = useState<any[]>([]);
  const [outstandingCohortId, setOutstandingCohortId] = useState('');
  const [gracePeriods, setGracePeriods] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [menu, setMenu] = useState<{ row: any; position: MenuPosition } | null>(null);
  const [payRow, setPayRow] = useState<any>(null);
  const [historyRow, setHistoryRow] = useState<any>(null);
  const [editRow, setEditRow] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [summary, config, grace, proofs] = await Promise.all([
        getPayments('action=summary', 'Failed to load payment data'),
        getPayments('action=payment-config', 'Failed to load payment settings'),
        getPayments('action=grace-periods', 'Failed to load grace periods'),
        getPayments('action=confirmations', 'Failed to load payment proofs'),
      ]);
      setRows(summary.rows ?? []);
      setCohorts(summary.cohorts ?? []);
      setOutstandingCohortId(config.config?.outstanding_cohort_id ?? '');
      setGracePeriods(Object.fromEntries((grace.gracePeriods ?? []).map((g: any) => [g.cohort_id, g.grace_period_days ?? null])));
      setConfs(proofs.confirmations ?? []);
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const notify = useCallback((ok: boolean, text: string) => setMessage({ ok, text }), []);

  /** A page action: one at a time, its result in the banner, then the numbers reloaded. */
  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      await load();
      setMessage({ ok: true, text: done });
      return true;
    } catch (err: any) {
      setMessage({ ok: false, text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const name = (r: any) => r.student_name || r.email;
  const finished = (text: string) => { setMessage({ ok: true, text }); load(); };

  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (!term || [r.email, r.student_name, r.cohort_name].some((v) => String(v ?? '').toLowerCase().includes(term)))
    && (statusFilter === 'all' || r.access_status === statusFilter)
    && (cohortFilter === 'all' || r.cohort_id === cohortFilter));
  const pendingProofs = confs.filter((c) => c.status === 'pending').length;
  const currencyByEnrollment = new Map(rows.map((r) => [r.enrollment_id, r.currency]));

  function rowMenu(r: any): (MenuItem | null)[] {
    const close = () => setMenu(null);
    const signedUp = !r.is_presignup && Boolean(r.student_id);
    const behind = r.access_status === 'overdue' || r.access_status === 'pending_deposit';
    const items: (MenuItem | null)[] = [
      { label: 'Record payment', sub: 'Cash, transfer or Mobile Money received', icon: CreditCard, onClick: () => { close(); setPayRow(r); } },
      { label: 'Payment history', sub: 'Every payment, with edit and delete', icon: Clock3, onClick: () => { close(); setHistoryRow(r); } },
    ];
    if (owed(r) > 0 && !r.payment_exempt) {
      items.push({ label: 'Send reminder', sub: 'Email the learner about the balance', icon: Send, onClick: () => { close(); run(() => postPayments({ action: 'send-payment-reminder', enrollmentId: r.enrollment_id }, 'Failed to send the reminder'), `Payment reminder sent to ${name(r)}.`); } });
    }
    items.push({ label: 'Edit enrollment', sub: 'Fee, deposit, plan and due dates', icon: Pencil, onClick: () => { close(); setEditRow(r); } });
    items.push(null);
    if (r.access_status !== 'waived') {
      items.push({ label: 'Mark as waived', sub: 'Sponsored, full access, nothing owed', icon: Gift, onClick: () => {
        close();
        if (!confirm(`Mark ${name(r)} as waived or sponsored? This grants full access.`)) return;
        run(() => postPayments({ action: 'mark-waived', enrollmentId: r.enrollment_id }, 'Failed to mark as waived'), `${name(r)} is now waived.`);
      } });
    }
    if (signedUp) {
      items.push(r.payment_exempt
        ? { label: 'Revoke exemption', sub: 'Missed payments count again', icon: ShieldOff, onClick: () => { close(); run(() => postPayments({ action: 'toggle-exempt', studentId: r.student_id, exempt: false }, 'Failed to revoke the exemption'), `${name(r)} is no longer exempt.`); } }
        : { label: 'Grant exemption', sub: 'Keeps access while the balance stays', icon: ShieldCheck, onClick: () => { close(); run(() => postPayments({ action: 'toggle-exempt', studentId: r.student_id, exempt: true }, 'Failed to grant the exemption'), `${name(r)} is now exempt.`); } });
    }
    if (signedUp && r.original_cohort_id) {
      items.push({ label: 'Restore to cohort', sub: 'Gives course access back', icon: ArrowLeft, onClick: () => { close(); run(() => postPayments({ action: 'restore-cohort', studentId: r.student_id }, 'Failed to restore the learner'), `${name(r)} is back in their cohort.`); } });
    }
    if (signedUp && outstandingCohortId && r.cohort_id !== outstandingCohortId && !r.payment_exempt && behind) {
      items.push({ label: 'Move to outstanding', sub: 'Removes course access until paid', icon: ArrowRight, danger: true, onClick: () => { close(); run(() => postPayments({ action: 'move-to-outstanding', studentId: r.student_id, outstandingCohortId }, 'Failed to move the learner'), `${name(r)} moved to the outstanding cohort.`); } });
    }
    if (items[items.length - 1] === null) items.pop();
    return items;
  }

  const exportCsv = () => reportExportCSV(
    ['Email', 'Student', 'Cohort', 'Total Fee', 'Paid', 'Balance', 'Plan', 'Access Status', 'Access Until', 'Next Due'],
    filtered.map((r) => [r.email, r.student_name, r.cohort_name, r.total_fee, r.paid_total, owed(r), r.payment_plan, r.access_status, r.access_until ?? '', r.next_due_date ?? '']),
    'enrollments-export.csv',
  );

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Payments</h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Cohort fees, balances and the proofs learners send.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setSettingsOpen(true)} className={btnClass} style={btnStyle('sec', C)}>
            <Settings className="w-4 h-4" />
            Payment settings
          </button>
          <button type="button" onClick={exportCsv} disabled={!filtered.length} className={btnClass} style={btnStyle('sec', C)}>
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Payments sections" className="inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-2xl" style={{ background: C.pill }}>
        {SECTIONS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={section === id}
            onClick={() => setSection(id)}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap"
            style={section === id ? { background: C.card, color: C.text, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } : { color: C.muted }}
          >
            {label}
            {id === 'proofs' && pendingProofs > 0 && <span className="w-2 h-2 rounded-full" style={{ background: P.bad }} aria-label={`${pendingProofs} waiting for review`} />}
          </button>
        ))}
      </div>

      {message && (
        <div
          role="status"
          className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={message.ok
            ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` }
            : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}
        >
          {message.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: C.card }} />)}
        </div>
      ) : section === 'enrollments' ? (
        <EnrollmentsView
          C={C}
          rows={rows}
          filtered={filtered}
          cohorts={cohorts}
          outstandingCohortId={outstandingCohortId}
          gracePeriods={gracePeriods}
          search={search}
          setSearch={setSearch}
          cohortFilter={cohortFilter}
          setCohortFilter={setCohortFilter}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          menuRowId={menu?.row.enrollment_id ?? null}
          onMenu={(event, row) => setMenu(menu?.row.enrollment_id === row.enrollment_id ? null : { row, position: menuPosition(event.currentTarget, 460) })}
        />
      ) : section === 'proofs' ? (
        <ProofsView
          C={C}
          confs={confs}
          currencyFor={(c) => currencyByEnrollment.get(c.enrollment_id) ?? null}
          busy={busy}
          onApprove={(c) => run(
            () => postPayments({ action: 'approve-confirmation', confirmationId: c.id }, 'Failed to approve the payment proof'),
            `${amountText(currencyByEnrollment.get(c.enrollment_id), c.amount)} from ${c.students?.full_name || c.students?.email || 'the learner'} approved and recorded.`,
          )}
          onReject={(c, note) => run(
            () => postPayments({ action: 'reject-confirmation', confirmationId: c.id, adminNotes: note }, 'Failed to reject the payment proof'),
            'Payment proof rejected. The learner can send another.',
          )}
        />
      ) : (
        <OptionsView C={C} onMessage={notify} />
      )}

      {menu && <FloatingMenu position={menu.position} label="enrollment actions" items={rowMenu(menu.row)} onClose={() => setMenu(null)} C={C} />}
      {payRow && <RecordPaymentModal row={payRow} C={C} onClose={() => setPayRow(null)} onDone={(text) => { setPayRow(null); finished(text); }} />}
      {historyRow && (
        <PaymentHistoryModal
          row={rows.find((r) => r.enrollment_id === historyRow.enrollment_id) ?? historyRow}
          C={C}
          onClose={() => setHistoryRow(null)}
          onChanged={load}
          onRecordNew={() => { setPayRow(historyRow); setHistoryRow(null); }}
        />
      )}
      {editRow && <EditEnrollmentModal row={editRow} C={C} onClose={() => setEditRow(null)} onChanged={load} onDone={(text) => { setEditRow(null); finished(text); }} />}
      {settingsOpen && (
        <SettingsModal
          cohorts={cohorts}
          outstandingCohortId={outstandingCohortId}
          gracePeriods={gracePeriods}
          C={C}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => { setSettingsOpen(false); finished('Payment settings saved.'); }}
        />
      )}
    </div>
  );
}
