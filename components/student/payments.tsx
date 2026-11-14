'use client';

// Payments section, extracted verbatim from app/student/page.tsx.
// PaymentsSection is exported; Detail is file-internal.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { LIGHT_C } from '@/lib/theme';
import { Sk, EmptyState } from '@/components/student/shared';
import {
  CreditCard, CheckCircle, AlertCircle, Check, Copy, Wallet, TrendingDown, Send, ExternalLink, CalendarCheck,
} from 'lucide-react';

function Detail({ label, value, C, copyable }: { label: string; value: string; C: typeof LIGHT_C; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm flex-shrink-0" style={{ color: C.faint }}>{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-sm font-semibold truncate" style={{ color: C.text }}>{value}</span>
        {copyable && (
          <button onClick={copy} className="flex-shrink-0 p-0.5 rounded transition-opacity hover:opacity-70"
            style={{ color: copied ? '#16a34a' : C.faint }}>
            {copied ? <Check className="w-3 h-3"/> : <Copy className="w-3 h-3"/>}
          </button>
        )}
      </div>
    </div>
  );
}

// --- Payments section ---
export function PaymentsSection({ userId, C, readOnly = false }: { userId: string; C: typeof LIGHT_C; readOnly?: boolean }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState('');
  const [enrollment, setEnrollment]     = useState<any>(null);
  const [installments, setInstallments] = useState<any[]>([]);
  const [payments, setPayments]         = useState<any[]>([]);
  const [confirmations, setConf]        = useState<any[]>([]);
  const [options, setOptions]           = useState<any[]>([]);

  // Submit form
  const [amount, setAmount]     = useState('');
  const [paidAt, setPaidAt]     = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod]     = useState('');
  const [reference, setRef]     = useState('');
  const [notes, setNotes]       = useState('');
  const [receiptUrl, setReceipt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [payTab, setPayTab]           = useState<'make' | 'submit' | 'history'>('make');
  const [selectedOptId, setSelectedOptId] = useState<string | null>(null);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = await getToken();
      const res = await fetch(`/api/student-payments?studentId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setEnrollment(res.enrollment ?? null);
      setInstallments(res.installments ?? []);
      setPayments(res.payments ?? []);
      setConf(res.confirmations ?? []);
      setOptions(res.paymentOptions ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load payment data');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    setSubmitError(''); setSubmitSuccess(false);
    if (!amount || Number(amount) <= 0) { setSubmitError('Enter a valid amount'); return; }
    if (!paidAt) { setSubmitError('Enter the date you paid'); return; }
    if (!enrollment?.id) { setSubmitError('No enrollment found'); return; }
    setSubmitting(true);
    try {
      const token = await getToken();
      const res = await fetch('/api/student-payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enrollmentId: enrollment.id,
          amount: Number(amount),
          paidAt,
          method: method || undefined,
          reference: reference || undefined,
          notes: notes || undefined,
          receiptUrl: receiptUrl || undefined,
        }),
      }).then(r => r.json());
      if (res.error) { setSubmitError(res.error); return; }
      setSubmitSuccess(true);
      setAmount(''); setMethod(''); setRef(''); setNotes(''); setReceipt('');
      await load();
    } catch (e: any) {
      // A TypeError from fetch means the connection dropped before a response came back
      // (the browser's "Failed to fetch"). The confirmation may still have been saved, so
      // reload the history and tell the student to check it before submitting again.
      if (e instanceof TypeError) {
        setSubmitError('We could not reach the server. Check your connection, then open Payment History to see if your confirmation was received before submitting again.');
        load().catch(() => {});
      } else {
        setSubmitError(e.message ?? 'Failed to submit');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const card = (bg: string, color: string) => ({
    background: isDark ? 'rgba(255,255,255,0.04)' : bg,
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)'}`,
    borderRadius: 14,
    padding: '16px 20px',
  });

  const statusColor = (s: string) => {
    if (s === 'approved')  return '#16a34a';
    if (s === 'rejected')  return '#dc2626';
    if (s === 'pending')   return '#d97706';
    if (s === 'active')    return '#16a34a';
    if (s === 'completed') return '#2563eb';
    if (s === 'overdue')   return '#dc2626';
    if (s === 'pending_deposit') return '#d97706';
    if (s === 'waived')    return '#7c3aed';
    return C.muted;
  };
  const statusLabel = (s: string) => {
    const map: Record<string, string> = {
      approved: 'Approved', rejected: 'Rejected', pending: 'Pending',
      active: 'Active', completed: 'Completed', overdue: 'Overdue',
      pending_deposit: 'Pending Deposit', waived: 'Waived', expired: 'Expired',
      paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid',
    };
    return map[s] ?? s;
  };

  const fmt = (n: number, currency = 'GHS') => `${currency} ${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  const inputStyle = {
    width: '100%', padding: '9px 12px', borderRadius: 10, fontSize: 13,
    background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text, outline: 'none',
  };

  if (loading) {
    return (
      <div className="space-y-4 mt-2">
        {[1,2,3].map(i => <Sk key={i} h={80}/>)}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <AlertCircle className="w-8 h-8 mb-3" style={{ color: '#dc2626' }}/>
        <p className="text-sm" style={{ color: C.muted }}>{error}</p>
        <button onClick={load} className="mt-4 px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Retry</button>
      </div>
    );
  }

  const currency = enrollment?.currency ?? 'GHS';
  const nextDue = installments.find((i: any) => i.status === 'unpaid' || i.status === 'partial');

  return (
    <div className="space-y-7 pb-10">

      {/* Summary cards -- enrollment required */}
      {enrollment && (() => {
        const neutralBg  = isDark ? 'rgba(255,255,255,0.05)' : '#ffffff';
        const neutralBorder = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
        const neutralIconBg = isDark ? 'rgba(255,255,255,0.1)' : '#f1f1f6';

        const summaryCards: {
          label: string; sub: string; value: string;
          Icon: React.ElementType; colored: boolean;
          grad?: string; accentColor?: string;
        }[] = [
          {
            label: 'Total Fee',
            sub: 'Program cost',
            value: fmt(enrollment.total_fee, currency),
            Icon: CreditCard,
            colored: false,
          },
          {
            label: 'Amount Paid',
            sub: 'Confirmed by admin',
            value: fmt(enrollment.paid_total, currency),
            Icon: CheckCircle,
            colored: false,
          },
          {
            label: 'Balance',
            sub: 'Remaining',
            value: fmt(enrollment.balance, currency),
            Icon: Wallet,
            colored: true,
            grad: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
          },
          {
            label: 'Next Due',
            sub: nextDue ? 'Upcoming installment' : 'All installments paid',
            value: nextDue ? fmtDate(nextDue.due_date) : 'None',
            Icon: CalendarCheck,
            colored: false,
          },
          {
            label: 'Status',
            sub: 'Access level',
            value: statusLabel(enrollment.access_status),
            Icon: TrendingDown,
            colored: true,
            grad: `linear-gradient(135deg, ${statusColor(enrollment.access_status)} 0%, ${statusColor(enrollment.access_status)}cc 100%)`,
          },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            {summaryCards.map(({ label, sub, value, Icon, colored, grad }) => {
              const txtPrimary   = colored ? 'rgba(255,255,255,0.92)' : C.text;
              const txtSecondary = colored ? 'rgba(255,255,255,0.68)' : C.muted;
              const iconBg       = colored ? 'rgba(255,255,255,0.2)' : neutralIconBg;
              const iconColor    = colored ? '#ffffff' : C.cta;
              return (
                <div key={label} className="relative overflow-hidden rounded-2xl p-4 flex flex-col justify-between min-h-[130px]"
                  style={{ background: colored ? grad : neutralBg }}>
                  {/* Top row: label + icon */}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-bold leading-tight" style={{ color: txtPrimary }}>{label}</p>
                      <p className="text-[13px] mt-0.5 leading-tight" style={{ color: txtSecondary }}>{sub}</p>
                    </div>
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: iconBg }}>
                      <Icon className="w-4 h-4" style={{ color: iconColor }}/>
                    </div>
                  </div>
                  {/* Value */}
                  <p className="text-xl font-extrabold leading-none mt-3 truncate" style={{ color: txtPrimary }}>{value}</p>
                  {/* Decorative circle (colored cards only) */}
                  {colored && (
                    <div className="absolute -bottom-5 -right-5 w-20 h-20 rounded-full"
                      style={{ background: 'rgba(255,255,255,0.08)' }}/>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Tabs: Make Payment / Submit Confirmation */}
      <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>

        {/* Tab bar */}
        <div className="flex" style={{ borderBottom: `1px solid ${C.divider}` }}>
          {(readOnly
            ? ([['make', 'Make Payment'], ['history', 'Payment History']] as const)
            : ([['make', 'Make Payment'], ['submit', 'Submit Confirmation'], ['history', 'Payment History']] as const)
          ).map(([id, label]) => (
            <button key={id} onClick={() => setPayTab(id)}
              className="flex-1 py-3.5 text-sm font-semibold transition-all"
              style={{
                color:        payTab === id ? C.cta : C.faint,
                borderBottom: payTab === id ? `2px solid ${C.cta}` : '2px solid transparent',
                background:   'transparent',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Make Payment tab */}
        {payTab === 'make' && (
          <div className="p-5">
            {options.length === 0 ? (
              <div className="py-10 text-center text-sm" style={{ color: C.faint }}>
                No payment options have been set up yet. Contact your instructor.
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-semibold" style={{ color: C.muted }}>Select preferred payment option</p>
                {/* Option selector chips */}
                <div className="flex flex-wrap gap-3">
                  {options.map((opt: any) => {
                    const selected = selectedOptId === opt.id;
                    return (
                      <button key={opt.id}
                        onClick={() => setSelectedOptId(selected ? null : opt.id)}
                        className="flex items-center justify-center p-3 rounded-2xl transition-all"
                        title={opt.label}
                        style={{
                          background: selected ? C.page : 'transparent',
                          boxShadow: selected || isDark ? 'none' : '0 1px 4px rgba(0,0,0,0.12)',
                          width: 64, height: 64,
                        }}>
                        {opt.logo_url
                          ? <img src={opt.logo_url} alt={opt.label} className="w-full h-full object-contain"/>
                          : <CreditCard className="w-6 h-6" style={{ color: C.faint }}/>}
                      </button>
                    );
                  })}
                </div>

                {/* Selected option detail panel */}
                {selectedOptId && (() => {
                  const opt = options.find((o: any) => o.id === selectedOptId);
                  if (!opt) return null;
                  return (
                    <div className="flex justify-start mt-2">
                      <div className="rounded-2xl p-5 space-y-4 w-full sm:w-auto sm:min-w-[260px]"
                        style={{ background: C.page, maxWidth: 380 }}>
                        {/* Header */}
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
                            {opt.logo_url
                              ? <img src={opt.logo_url} alt={opt.label} className="w-full h-full object-contain"/>
                              : <CreditCard className="w-6 h-6" style={{ color: C.faint }}/>}
                          </div>
                          <div>
                            <p className="text-base font-bold" style={{ color: C.text }}>{opt.label}</p>
                            <p className="text-xs font-semibold uppercase tracking-wide mt-0.5" style={{ color: C.faint }}>
                              {opt.type === 'bank_transfer' ? 'Bank Transfer'
                                : opt.type === 'mobile_money' ? 'Mobile Money'
                                : 'Online Payment'}
                            </p>
                          </div>
                        </div>

                        {/* Details */}
                        <div className="space-y-2.5">
                          {opt.type === 'bank_transfer' && (<>
                            {opt.bank_name      && <Detail label="Bank"           value={opt.bank_name}      C={C}/>}
                            {opt.account_name   && <Detail label="Account Name"   value={opt.account_name}   C={C}/>}
                            {opt.account_number && <Detail label="Account Number" value={opt.account_number} C={C} copyable/>}
                            {opt.branch         && <Detail label="Branch"         value={opt.branch}         C={C}/>}
                            {opt.country        && <Detail label="Country"        value={opt.country}        C={C}/>}
                          </>)}
                          {opt.type === 'mobile_money' && (<>
                            {opt.network             && <Detail label="Network"      value={opt.network}             C={C}/>}
                            {opt.mobile_money_number && <Detail label="Number"       value={opt.mobile_money_number} C={C} copyable/>}
                            {opt.account_name        && <Detail label="Account Name" value={opt.account_name}        C={C}/>}
                          </>)}
                          {opt.type === 'online' && (<>
                            {opt.platform && <Detail label="Platform" value={opt.platform} C={C}/>}
                            {opt.payment_link && (
                              <a href={opt.payment_link} target="_blank" rel="noreferrer"
                                className="mt-1 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-bold transition-opacity hover:opacity-80"
                                style={{ background: C.cta, color: C.ctaText }}>
                                <ExternalLink className="w-3.5 h-3.5"/> Pay Now
                              </a>
                            )}
                          </>)}
                          {opt.instructions && (
                            <p className="text-sm pt-1" style={{ color: C.muted }}>{opt.instructions}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {!selectedOptId && (
                  <p className="text-xs text-center pt-1" style={{ color: C.faint }}>
                    Select a payment method above to see the details.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Submit Confirmation tab */}
        {payTab === 'submit' && (
          <div className="p-5 space-y-5">

            {/* Submit form */}
            {enrollment ? (
              <div className="space-y-3">
                <p className="text-xs" style={{ color: C.muted }}>
                  Already made a payment? Fill in the details below. Your balance updates once an admin confirms it.
                </p>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Amount *</label>
                    <input type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
                      placeholder="0.00" style={inputStyle}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Date Paid *</label>
                    <input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} style={inputStyle}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Payment Method</label>
                    <input type="text" value={method} onChange={e => setMethod(e.target.value)}
                      placeholder="e.g. Mobile Money, Bank Transfer" style={inputStyle}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Reference / Transaction ID</label>
                    <input type="text" value={reference} onChange={e => setRef(e.target.value)}
                      placeholder="Transaction reference" style={inputStyle}/>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Notes</label>
                    <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                      placeholder="Any additional details" style={inputStyle}/>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Receipt URL</label>
                    <input type="url" value={receiptUrl} onChange={e => setReceipt(e.target.value)}
                      placeholder="Link to receipt image or document" style={inputStyle}/>
                  </div>
                </div>
                {submitError   && <p className="text-xs" style={{ color: '#dc2626' }}>{submitError}</p>}
                {submitSuccess && <p className="text-xs font-semibold" style={{ color: '#16a34a' }}>Submitted! Pending admin review.</p>}
                <button onClick={handleSubmit} disabled={submitting}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ background: C.cta, color: C.ctaText }}>
                  <Send className="w-3.5 h-3.5"/>
                  {submitting ? 'Submitting...' : 'Submit Confirmation'}
                </button>
              </div>
            ) : (
              <p className="text-sm text-center py-6" style={{ color: C.faint }}>
                Enrollment required to submit a payment confirmation.
              </p>
            )}
          </div>
        )}

        {/* Payment History tab - timeline */}
        {payTab === 'history' && (() => {
          // Merge confirmed payments + student confirmations, sort newest first
          const timelineItems: any[] = [
            ...payments.map((p: any) => ({
              _type: 'payment',
              id: p.id,
              amount: Number(p.amount),
              date: p.paid_at,
              method: p.method ?? null,
              reference: p.reference ?? null,
              notes: p.notes ?? null,
              status: 'confirmed',
            })),
            ...confirmations.filter((c: any) => c.status !== 'approved').map((c: any) => ({
              _type: 'confirmation',
              id: c.id,
              amount: Number(c.amount),
              date: c.paid_at,
              submittedAt: c.created_at,
              method: c.method ?? null,
              reference: c.reference ?? null,
              notes: c.notes ?? null,
              receipt_url: c.receipt_url ?? null,
              admin_notes: c.admin_notes ?? null,
              status: c.status,
            })),
          ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          if (timelineItems.length === 0) {
            return (
              <div className="p-8 text-center text-sm" style={{ color: C.faint }}>
                No payment history yet.
              </div>
            );
          }

          const dotColor = (status: string) =>
            status === 'confirmed' || status === 'approved' ? '#16a34a'
            : status === 'rejected' ? '#dc2626'
            : '#d97706';

          return (
            <div className="p-5">
              <div className="space-y-0" style={{ maxWidth: 520 }}>
                  {timelineItems.map((item, idx) => {
                    const color = dotColor(item.status);
                    const isLast = idx === timelineItems.length - 1;
                    return (
                    <div key={item.id} className={`flex gap-3 items-stretch${isLast ? '' : ' mb-4'}`}>
                      {/* Dot column */}
                      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: `${color}15`, border: `1.5px solid ${color}` }}>
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                            {item.status === 'rejected'
                              ? <><line x1="3" y1="3" x2="11" y2="11" stroke={color} strokeWidth="2" strokeLinecap="round"/><line x1="11" y1="3" x2="3" y2="11" stroke={color} strokeWidth="2" strokeLinecap="round"/></>
                              : item.status === 'pending'
                              ? <circle cx="7" cy="7" r="2.5" fill={color}/>
                              : <polyline points="2.5,7 5.5,10 11.5,4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                            }
                          </svg>
                        </div>
                        {!isLast && (
                          <div className="flex-1 mt-1" style={{ width: 0, borderLeft: `2px dashed ${C.cardBorder}` }}/>
                        )}
                      </div>

                      {/* Content card */}
                      <div className="flex-1 rounded-xl px-4 py-3 min-w-0 mb-0.5"
                        style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f8f9fb' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-bold" style={{ color: C.text }}>
                              {fmt(item.amount, currency)}
                            </p>
                            <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                              {fmtDate(item.date)}
                              {item.method ? ` - ${item.method}` : ''}
                            </p>
                            {item.reference && (
                              <p className="text-xs mt-0.5 font-medium" style={{ color: C.faint }}>
                                Ref: {item.reference}
                              </p>
                            )}
                            {item._type === 'confirmation' && item.submittedAt && (
                              <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                                Submitted {fmtDate(item.submittedAt)}
                              </p>
                            )}
                            {item.notes && (
                              <p className="text-xs mt-1 italic" style={{ color: C.muted }}>{item.notes}</p>
                            )}
                            {item.admin_notes && item.status === 'rejected' && (
                              <p className="text-xs mt-1 font-medium" style={{ color: '#dc2626' }}>
                                Admin: {item.admin_notes}
                              </p>
                            )}
                            {item.receipt_url && (
                              <a href={item.receipt_url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs mt-1.5 font-medium underline"
                                style={{ color: C.cta }}>
                                <ExternalLink className="w-3 h-3"/> View Receipt
                              </a>
                            )}
                          </div>
                          <span className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px] font-semibold"
                            style={{ background: `${color}15`, color }}>
                            {item.status === 'confirmed' ? 'Confirmed'
                              : item.status === 'approved' ? 'Approved'
                              : item.status === 'rejected' ? 'Rejected'
                              : 'Pending'}
                          </span>
                        </div>
                      </div>
                    </div>
                    );
                  })}
              </div>
            </div>
          );
        })()}

      </div>

      {/* No enrollment + no options: show placeholder */}
      {!enrollment && options.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title="No payment information yet"
          body="Payment details will appear here once your enrollment is confirmed by an admin."
        />
      )}

    </div>
  );
}

// --- Main dashboard ---
