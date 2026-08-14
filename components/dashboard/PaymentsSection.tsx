'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, AlertTriangle, Check, CheckCircle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, CreditCard, Download, Edit2, ExternalLink, Loader2, MoreVertical, Plus, RefreshCw, Search, Send, Settings, Trash2, Upload, Users, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { reportExportCSV } from '@/lib/dashboard-export';
import { useTheme } from '@/components/ThemeProvider';
import { LIGHT_C, DARK_C, cardStyle, modalStyle } from '@/lib/theme';
import { isIndividualCohort } from '@/lib/cohort-kind';

type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'waived' | string;

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  unpaid:  { bg: 'rgba(239,68,68,0.10)',   text: '#dc2626', label: 'Unpaid'  },
  partial: { bg: 'rgba(245,158,11,0.10)',  text: '#d97706', label: 'Partial' },
  paid:    { bg: 'rgba(34,197,94,0.10)',   text: '#16a34a', label: 'Paid'    },
  waived:  { bg: 'rgba(148,163,184,0.15)', text: '#64748b', label: 'Waived'  },
};

// --- Payment Options management tab (admin) ---
const PAYMENT_TYPES = [
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money',  label: 'Mobile Money'  },
  { value: 'online',        label: 'Online Payment' },
] as const;

const TYPE_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  bank_transfer: [
    { key: 'bank_name',     label: 'Bank Name',      placeholder: 'e.g. GCB Bank' },
    { key: 'account_name',  label: 'Account Name',   placeholder: 'Full name on account' },
    { key: 'account_number',label: 'Account Number', placeholder: '' },
    { key: 'branch',        label: 'Branch',         placeholder: 'e.g. Accra Main' },
    { key: 'country',       label: 'Country',        placeholder: 'e.g. Ghana' },
  ],
  mobile_money: [
    { key: 'mobile_money_number', label: 'Mobile Number', placeholder: '024XXXXXXX' },
    { key: 'account_name',        label: 'Account Name',  placeholder: 'Registered name' },
    { key: 'network',             label: 'Network',       placeholder: 'e.g. MTN, Vodafone, AirtelTigo' },
  ],
  online: [
    { key: 'payment_link', label: 'Payment URL', placeholder: 'https://' },
    { key: 'platform',     label: 'Platform',    placeholder: 'e.g. Paystack, Flutterwave, PayPal' },
  ],
};

function PaymentOptionsTab({ C, getToken }: { C: typeof LIGHT_C; getToken: () => Promise<string> }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [options,       setOptions]       = useState<any[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [editing,       setEditing]       = useState<any | null>(null);
  const [saving,        setSaving]        = useState(false);
  const [saveErr,       setSaveErr]       = useState('');
  const [deleting,      setDeleting]      = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const blank = (): any => ({
    id: '', label: '', type: 'bank_transfer', instructions: '',
    bank_name: '', account_name: '', account_number: '', branch: '', country: '',
    mobile_money_number: '', network: '',
    payment_link: '', platform: '',
    logo_url: '', is_active: true, sort_order: 0,
  });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/payments?action=payment-options', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setOptions(res.options ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      const url = await uploadToCloudinary(file, 'payment-options');
      setEditing((p: any) => ({ ...p, logo_url: url }));
    } catch (e: any) {
      setSaveErr(e.message ?? 'Logo upload failed');
    } finally {
      setLogoUploading(false);
    }
  };

  const handleSave = async () => {
    if (!editing?.label) { setSaveErr('Label is required'); return; }
    setSaving(true); setSaveErr('');
    try {
      const token = await getToken();
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action:              'save-payment-option',
          id:                  editing.id || undefined,
          label:               editing.label,
          type:                editing.type,
          instructions:        editing.instructions || null,
          bank_name:           editing.bank_name || null,
          account_name:        editing.account_name || null,
          account_number:      editing.account_number || null,
          branch:              editing.branch || null,
          country:             editing.country || null,
          mobile_money_number: editing.mobile_money_number || null,
          network:             editing.network || null,
          payment_link:        editing.payment_link || null,
          platform:            editing.platform || null,
          logo_url:            editing.logo_url || null,
          is_active:           editing.is_active,
          sort_order:          Number(editing.sort_order) || 0,
        }),
      }).then(r => r.json());
      if (res.error) { setSaveErr(res.error); return; }
      setEditing(null);
      await load();
    } catch (e: any) {
      setSaveErr(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this payment option?')) return;
    setDeleting(id);
    try {
      const token = await getToken();
      await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete-payment-option', id }),
      });
      await load();
    } catch { /* ignore */ }
    setDeleting(null);
  };

  const inp = {
    width: '100%', padding: '8px 11px', borderRadius: 9, fontSize: 13,
    background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text, outline: 'none',
  };

  const typeLabel = (t: string) => PAYMENT_TYPES.find(p => p.value === t)?.label ?? t;

  if (loading) return <div className="py-12 text-center text-sm" style={{ color: C.faint }}>Loading...</div>;
  if (error)   return <div className="py-12 text-center text-sm" style={{ color: '#dc2626' }}>{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold" style={{ color: C.text }}>Payment Options</h3>
          <p className="text-xs mt-0.5" style={{ color: C.faint }}>Global options shown to all students on the Payments page.</p>
        </div>
        <button onClick={() => { setEditing(blank()); setSaveErr(''); }}
          className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-xl transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4"/> Add Option
        </button>
      </div>

      {options.length === 0 && (
        <div className="py-16 text-center text-sm" style={{ color: C.faint }}>No payment options yet. Add one above.</div>
      )}

      <div className="space-y-3">
        {options.map((opt: any) => (
          <div key={opt.id} className="p-4 rounded-xl flex items-center gap-4"
            style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f8f9fb', border: 'none' }}>
            {/* Logo */}
            <div className="w-12 h-12 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden"
              style={{ background: C.pill }}>
              {opt.logo_url
                ? <img src={opt.logo_url} alt="" className="w-full h-full object-contain"/>
                : <CreditCard className="w-5 h-5" style={{ color: C.faint }}/>}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm font-bold" style={{ color: C.text }}>{opt.label}</p>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{ background: C.lime, color: C.green }}>{typeLabel(opt.type)}</span>
                {!opt.is_active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: C.pill, color: C.faint }}>Hidden</span>
                )}
              </div>
              <p className="text-xs mt-0.5" style={{ color: C.muted }}>
                {opt.type === 'bank_transfer' && [opt.bank_name, opt.account_name, opt.account_number].filter(Boolean).join(' - ')}
                {opt.type === 'mobile_money'  && [opt.network, opt.mobile_money_number, opt.account_name].filter(Boolean).join(' - ')}
                {opt.type === 'online'        && [opt.platform, opt.payment_link].filter(Boolean).join(' - ')}
              </p>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => { setEditing({ ...opt }); setSaveErr(''); }}
                className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: C.muted }}>
                <Edit2 className="w-3.5 h-3.5"/>
              </button>
              <button onClick={() => handleDelete(opt.id)} disabled={deleting === opt.id}
                className="p-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40" style={{ color: '#dc2626' }}>
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create modal */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh]"
            style={{ ...modalStyle(C) }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-6 pb-4 flex-shrink-0">
              <h3 className="text-base font-bold" style={{ color: C.text }}>{editing.id ? 'Edit Option' : 'New Payment Option'}</h3>
              <button onClick={() => setEditing(null)}><X className="w-5 h-5" style={{ color: C.faint }}/></button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-4">
              {/* Label */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Label *</label>
                <input value={editing.label} onChange={e => setEditing((p: any) => ({ ...p, label: e.target.value }))}
                  placeholder="e.g. GCB Bank Transfer" style={inp}/>
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Payment Type *</label>
                <div className="flex gap-2">
                  {PAYMENT_TYPES.map(t => (
                    <button key={t.value} onClick={() => setEditing((p: any) => ({ ...p, type: t.value }))}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold border transition-all"
                      style={{
                        background: editing.type === t.value ? C.cta : C.pill,
                        color:      editing.type === t.value ? C.ctaText : C.muted,
                        border:     `1px solid ${editing.type === t.value ? C.cta : C.cardBorder}`,
                      }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Type-specific fields */}
              <div className="grid sm:grid-cols-2 gap-3">
                {(TYPE_FIELDS[editing.type] ?? []).map(({ key, label, placeholder }) => (
                  <div key={key} className={key === 'payment_link' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>{label}</label>
                    <input value={(editing as any)[key] ?? ''} onChange={e => setEditing((p: any) => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder} style={inp}/>
                  </div>
                ))}
              </div>

              {/* Logo upload */}
              <div>
                <label className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>Logo / Image</label>
                <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }}/>
                <div className="flex items-center gap-3">
                  {editing.logo_url && (
                    <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 border" style={{ borderColor: C.cardBorder }}>
                      <img src={editing.logo_url} alt="" className="w-full h-full object-contain"/>
                    </div>
                  )}
                  <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-opacity hover:opacity-80 disabled:opacity-50"
                    style={{ background: C.pill, color: C.text, border: `1px solid ${C.cardBorder}` }}>
                    {logoUploading
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin"/> Uploading...</>
                      : <><Upload className="w-3.5 h-3.5"/> {editing.logo_url ? 'Replace Logo' : 'Upload Logo'}</>}
                  </button>
                  {editing.logo_url && (
                    <button type="button" onClick={() => setEditing((p: any) => ({ ...p, logo_url: '' }))}
                      className="text-xs font-semibold transition-opacity hover:opacity-70" style={{ color: '#dc2626' }}>
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {/* Instructions */}
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Instructions (optional)</label>
                <textarea rows={3} value={editing.instructions ?? ''} onChange={e => setEditing((p: any) => ({ ...p, instructions: e.target.value }))}
                  placeholder="Step-by-step instructions shown to students..."
                  style={{ ...inp, resize: 'vertical' }}/>
              </div>

              {/* Sort order + visibility */}
              <div className="flex items-center gap-4">
                <div className="w-28">
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Sort Order</label>
                  <input type="number" value={editing.sort_order} onChange={e => setEditing((p: any) => ({ ...p, sort_order: e.target.value }))}
                    style={inp}/>
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <input type="checkbox" id="opt_is_active" checked={editing.is_active}
                    onChange={e => setEditing((p: any) => ({ ...p, is_active: e.target.checked }))}
                    className="w-4 h-4"/>
                  <label htmlFor="opt_is_active" className="text-sm" style={{ color: C.text }}>Visible to students</label>
                </div>
              </div>

              {saveErr && <p className="text-xs" style={{ color: '#dc2626' }}>{saveErr}</p>}
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 pb-6 flex-shrink-0">
              <button onClick={() => setEditing(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={handleSave} disabled={saving || logoUploading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: C.cta, color: C.ctaText }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Confirmations review tab (admin) ---
function ConfirmationsTab({ C, getToken }: { C: typeof LIGHT_C; getToken: () => Promise<string> }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [confs,    setConfs]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [filter,   setFilter]   = useState<'all'|'pending'|'approved'|'rejected'>('pending');
  const [acting,   setActing]   = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/payments?action=confirmations', {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());
      if (res.error) { setError(res.error); return; }
      setConfs(res.confirmations ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleApprove = async (id: string) => {
    if (!confirm('Approve this confirmation and record the payment?')) return;
    setActing(id);
    try {
      const token = await getToken();
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'approve-confirmation', confirmationId: id }),
      }).then(r => r.json());
      if (res.error) alert(res.error);
      else await load();
    } catch { alert('Failed to approve.'); }
    setActing(null);
  };

  const handleReject = async () => {
    if (!rejectId) return;
    setActing(rejectId);
    try {
      const token = await getToken();
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'reject-confirmation', confirmationId: rejectId, adminNotes: rejectNote }),
      }).then(r => r.json());
      if (res.error) alert(res.error);
      else { setRejectId(null); setRejectNote(''); await load(); }
    } catch { alert('Failed to reject.'); }
    setActing(null);
  };

  const statusColor = (s: string) =>
    s === 'approved' ? '#16a34a' : s === 'rejected' ? '#dc2626' : '#d97706';

  const fmtDate = (d: string) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  const filtered = confs.filter(c => filter === 'all' || c.status === filter);
  const pendingCount = confs.filter(c => c.status === 'pending').length;

  if (loading) return <div className="py-12 text-center text-sm" style={{ color: C.faint }}>Loading...</div>;
  if (error) return <div className="py-12 text-center text-sm" style={{ color: '#dc2626' }}>{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-base font-bold" style={{ color: C.text }}>Student Confirmations</h3>
          <p className="text-xs mt-0.5" style={{ color: C.faint }}>
            Review student-submitted payment proofs. Approval records the payment automatically.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg"
          style={{ background: C.pill, color: C.muted }}>
          <RefreshCw className="w-3.5 h-3.5"/> Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {([['all','All'], ['pending','Pending'], ['approved','Approved'], ['rejected','Rejected']] as const).map(([val, label]) => (
          <button key={val} onClick={() => setFilter(val)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: filter === val ? C.cta : C.pill,
              color: filter === val ? C.ctaText : C.muted,
            }}>
            {label}{val === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="py-16 text-center text-sm" style={{ color: C.faint }}>No {filter === 'all' ? '' : filter} confirmations.</div>
      )}

      <div className="space-y-3">
        {filtered.map((c: any) => {
          const student = c.students ?? {};
          const cohort  = c.cohorts ?? {};
          return (
            <div key={c.id} className="p-4 rounded-xl space-y-3"
              style={{ background: isDark ? 'rgba(255,255,255,0.03)' : '#f8f9fb', border: 'none' }}>
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-0.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: C.text }}>
                      {student.full_name || student.email || 'Unknown'}
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                      style={{ background: `${statusColor(c.status)}18`, color: statusColor(c.status) }}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: C.muted }}>
                    {student.email}{cohort.name ? ` - ${cohort.name}` : ''}
                  </p>
                  <p className="text-sm font-semibold mt-1" style={{ color: C.text }}>
                    {c.amount ? `GHS ${Number(c.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''} - {c.paid_at ? fmtDate(c.paid_at) : ''}
                  </p>
                  <p className="text-xs" style={{ color: C.muted }}>
                    {c.method ? `Method: ${c.method}` : ''}{c.reference ? ` - Ref: ${c.reference}` : ''}
                    {c.notes ? ` - ${c.notes}` : ''}
                  </p>
                  {c.receipt_url && (
                    <a href={c.receipt_url} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold mt-1"
                      style={{ color: C.cta }}>
                      <ExternalLink className="w-3 h-3"/> View Receipt
                    </a>
                  )}
                  {c.admin_notes && (
                    <p className="text-xs mt-1" style={{ color: '#dc2626' }}>Admin note: {c.admin_notes}</p>
                  )}
                  <p className="text-[11px] mt-1" style={{ color: C.faint }}>Submitted {fmtDate(c.created_at)}</p>
                </div>
                {c.status === 'pending' && (
                  <div className="flex gap-2 flex-shrink-0 self-start">
                    <button onClick={() => handleApprove(c.id)} disabled={acting === c.id}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 transition-opacity hover:opacity-80"
                      style={{ background: '#16a34a18', color: '#16a34a' }}>
                      <CheckCircle className="w-3.5 h-3.5"/>
                      {acting === c.id ? '...' : 'Approve'}
                    </button>
                    <button onClick={() => { setRejectId(c.id); setRejectNote(''); }}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
                      style={{ background: '#dc262618', color: '#dc2626' }}>
                      <XCircle className="w-3.5 h-3.5"/> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Reject confirmation modal */}
      {rejectId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4"
            style={{ ...modalStyle(C) }}>
            <h3 className="text-base font-bold" style={{ color: C.text }}>Reject Confirmation</h3>
            <p className="text-sm" style={{ color: C.muted }}>Optionally add a note explaining why this was rejected.</p>
            <textarea rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (optional)"
              className="w-full text-sm px-3 py-2 rounded-xl outline-none resize-none"
              style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
            <div className="flex gap-3">
              <button onClick={() => setRejectId(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={handleReject} disabled={acting === rejectId}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: '#dc2626', color: 'white' }}>
                {acting === rejectId ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status, C }: { status: PaymentStatus; C: typeof LIGHT_C }) {
  const s = STATUS_COLORS[status] ?? { bg: C.pill, text: C.faint, label: status };
  return (
    <span style={{ background: s.bg, color: s.text, borderRadius: 20, padding: '2px 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', display: 'inline-block', textTransform: 'capitalize' }}>
      {s.label}
    </span>
  );
}

export function PaymentsSection({ C }: { C: typeof LIGHT_C }) {
  const isDark = C === DARK_C;
  const [payTab, setPayTab] = useState<'enrollments' | 'confirmations' | 'options'>('enrollments');

  const [rows,       setRows]       = useState<any[]>([]);
  const [cohorts,    setCohorts]    = useState<any[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [search,     setSearch]     = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cohortFilter, setCohortFilter] = useState('all');

  const [outstandingCohortId, setOutstandingCohortId] = useState<string>('');

  // Grace period state
  const [gracePeriods,        setGracePeriods]        = useState<Record<string, number | null>>({});
  const [graceCohortId,       setGraceCohortId]       = useState<string>('');
  const [graceDaysInput,      setGraceDaysInput]      = useState<string>('');
  const [graceSaving,         setGraceSaving]         = useState(false);
  const [graceError,          setGraceError]          = useState('');

  // Move/restore action state
  const [movingId,   setMovingId]   = useState<string | null>(null);

  // Edit enrollment modal state
  const [editRow,         setEditRow]         = useState<any | null>(null);
  const [editFields,      setEditFields]      = useState<any>({});
  const [saving,          setSaving]          = useState(false);
  const [saveError,       setSaveError]       = useState('');
  const [installments,    setInstallments]    = useState<any[]>([]);
  const [instDates,       setInstDates]       = useState<Record<string, string>>({});
  const [instSaving,      setInstSaving]      = useState<Record<string, boolean>>({});
  const [instError,       setInstError]       = useState('');

  // Record payment modal
  const [payRow,       setPayRow]       = useState<any | null>(null);
  const [payAmount,    setPayAmount]    = useState('');
  const [payDate,      setPayDate]      = useState('');
  const [payMethod,    setPayMethod]    = useState('');
  const [payRef,       setPayRef]       = useState('');
  const [payNotes,     setPayNotes]     = useState('');
  const [paySaving,    setPaySaving]    = useState(false);
  const [payError,     setPayError]     = useState('');

  // Payment history modal
  const [histRow,      setHistRow]      = useState<any | null>(null);
  const [histPayments, setHistPayments] = useState<any[]>([]);
  const [histLoading,  setHistLoading]  = useState(false);
  const [histError,    setHistError]    = useState('');
  const [editingPayId, setEditingPayId] = useState<string | null>(null);
  const [editPayFields, setEditPayFields] = useState<any>({});
  const [editPaySaving, setEditPaySaving] = useState(false);
  const [editPayError,  setEditPayError]  = useState('');
  const [deletingPayId,   setDeletingPayId]   = useState<string | null>(null);
  const [menuRow,         setMenuRow]         = useState<any | null>(null);
  const [menuPos,         setMenuPos]         = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const [sendingReminder, setSendingReminder] = useState<string | null>(null);
  const [payToast,        setPayToast]        = useState<{ ok: boolean; text: string } | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  };

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const token = await getToken();
    try {
      const [res, cfgRes, gpRes] = await Promise.all([
        fetch('/api/payments?action=summary', {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch('/api/payments?action=payment-config', {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
        fetch('/api/payments?action=grace-periods', {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json()),
      ]);
      if (res.error) { setError(res.error); setLoading(false); return; }

      const fetchedRows: any[] = res.rows ?? [];
      const currentOutstandingId: string = cfgRes.config?.outstanding_cohort_id ?? '';

      setRows(fetchedRows);
      setCohorts(res.cohorts ?? []);
      setOutstandingCohortId(currentOutstandingId);

      const gpMap: Record<string, number | null> = {};
      for (const g of gpRes.gracePeriods ?? []) gpMap[g.cohort_id] = g.grace_period_days ?? null;
      setGracePeriods(gpMap);
    } catch { setError('Failed to load payment data.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggleExempt = async (r: any, exempt: boolean) => {
    setMovingId(r.student_id);
    const token = await getToken();
    await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'toggle-exempt', studentId: r.student_id, exempt }),
    });
    await load();
    setMovingId(null);
  };

  const handleMoveToOutstanding = async (r: any) => {
    if (!outstandingCohortId) { alert('Please select the outstanding cohort first.'); return; }
    setMovingId(r.student_id);
    const token = await getToken();
    await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'move-to-outstanding', studentId: r.student_id, outstandingCohortId }),
    });
    await load();
    setMovingId(null);
  };

  const handleRestoreCohort = async (r: any) => {
    setMovingId(r.student_id);
    const token = await getToken();
    const res = await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'restore-cohort', studentId: r.student_id }),
    }).then(r => r.json());
    if (res.error) alert(res.error);
    await load();
    setMovingId(null);
  };

  const handleMarkWaived = async (r: any) => {
    if (!confirm(`Mark ${r.email} as waived/sponsored? This grants full access.`)) return;
    setMovingId(r.student_id);
    const token = await getToken();
    await fetch('/api/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'mark-waived', enrollmentId: r.enrollment_id }),
    });
    await load();
    setMovingId(null);
  };

  // Open edit enrollment modal
  const openEdit = async (r: any) => {
    setEditRow(r);
    setEditFields({
      total_fee:        String(r.total_fee ?? ''),
      deposit_required: String(r.deposit_required ?? ''),
      payment_plan:     r.payment_plan ?? 'flexible',
    });
    setSaveError(''); setInstError('');
    setInstallments([]); setInstDates({}); setInstSaving({});
    if (!r.is_presignup && r.enrollment_id) {
      const token = await getToken();
      try {
        const res = await fetch(`/api/payments?action=installments&enrollmentId=${r.enrollment_id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).then(r => r.json());
        if (!res.error) {
          setInstallments(res.installments ?? []);
          const dates: Record<string, string> = {};
          for (const inst of res.installments ?? []) dates[inst.id] = inst.due_date ?? '';
          setInstDates(dates);
        }
      } catch { /* non-blocking */ }
    }
  };

  const handleSaveInstallmentDate = async (instId: string) => {
    const due_date = instDates[instId];
    if (!due_date) return;
    setInstSaving(prev => ({ ...prev, [instId]: true }));
    setInstError('');
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'edit-installment', installmentId: instId, due_date }),
      }).then(r => r.json());
      if (res.error) setInstError(res.error);
      else {
        setInstallments(prev => prev.map(i => i.id === instId ? { ...i, due_date } : i));
        await load();
      }
    } catch { setInstError('Failed to save due date.'); }
    setInstSaving(prev => ({ ...prev, [instId]: false }));
  };

  const handleSave = async () => {
    if (!editRow) return;
    setSaving(true); setSaveError('');
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action:           'edit-enrollment',
          enrollmentId:     editRow.enrollment_id,
          total_fee:        Number(editFields.total_fee),
          deposit_required: Number(editFields.deposit_required),
          payment_plan:     editFields.payment_plan,
        }),
      }).then(r => r.json());
      if (res.error) { setSaveError(res.error); } else { setEditRow(null); await load(); }
    } catch { setSaveError('Failed to save changes.'); }
    setSaving(false);
  };

  const showPayToast = (ok: boolean, text: string) => {
    setPayToast({ ok, text });
    setTimeout(() => setPayToast(null), 3500);
  };

  const handleSendReminder = async (r: any) => {
    setSendingReminder(r.enrollment_id);
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ action: 'send-payment-reminder', enrollmentId: r.enrollment_id }),
      }).then(x => x.json());
      if (res.ok) {
        showPayToast(true, `Payment reminder sent to ${r.student_name || r.email}`);
      } else {
        showPayToast(false, res.error || 'Failed to send reminder.');
      }
    } catch { showPayToast(false, 'Failed to send reminder.'); }
    setSendingReminder(null);
  };

  // Open record payment modal
  const openPay = (r: any) => {
    setPayRow(r);
    setPayAmount('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMethod(''); setPayRef(''); setPayNotes(''); setPayError('');
  };

  const handleRecordPayment = async () => {
    if (!payRow || !payAmount) { setPayError('Amount is required.'); return; }
    setPaySaving(true); setPayError('');
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action:       'record-payment',
          enrollmentId: payRow.enrollment_id,
          amount:       Number(payAmount),
          paidAt:       payDate || undefined,
          method:       payMethod || undefined,
          reference:    payRef || undefined,
          notes:        payNotes || undefined,
        }),
      }).then(r => r.json());
      if (res.error) { setPayError(res.error); }
      else { setPayRow(null); await load(); }
    } catch { setPayError('Failed to record payment.'); }
    setPaySaving(false);
  };

  const openHistory = async (r: any) => {
    setHistRow(r);
    setHistPayments([]);
    setHistError('');
    setEditingPayId(null);
    setHistLoading(true);
    const token = await getToken();
    try {
      const res = await fetch(`/api/payments?action=history&enrollmentId=${r.enrollment_id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then(r => r.json());
      if (res.error) setHistError(res.error);
      else setHistPayments(res.payments ?? []);
    } catch { setHistError('Failed to load payment history.'); }
    setHistLoading(false);
  };

  const startEditPayment = (p: any) => {
    setEditingPayId(p.id);
    setEditPayFields({ amount: String(p.amount), paid_at: p.paid_at ?? '', method: p.method ?? '', reference: p.reference ?? '', notes: p.notes ?? '' });
    setEditPayError('');
  };

  const handleEditPayment = async () => {
    if (!editingPayId || !editPayFields.amount) { setEditPayError('Amount is required.'); return; }
    setEditPaySaving(true); setEditPayError('');
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action:    'edit-payment',
          paymentId: editingPayId,
          amount:    Number(editPayFields.amount),
          paidAt:    editPayFields.paid_at || undefined,
          method:    editPayFields.method || null,
          reference: editPayFields.reference || null,
          notes:     editPayFields.notes || null,
        }),
      }).then(r => r.json());
      if (res.error) { setEditPayError(res.error); }
      else {
        setEditingPayId(null);
        await openHistory(histRow);
        await load();
      }
    } catch { setEditPayError('Failed to update payment.'); }
    setEditPaySaving(false);
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment record? This will recompute the student\'s balance and access status.')) return;
    setDeletingPayId(paymentId);
    const token = await getToken();
    try {
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'delete-payment', paymentId }),
      }).then(r => r.json());
      if (res.error) alert(res.error);
      else {
        await openHistory(histRow);
        await load();
      }
    } catch { alert('Failed to delete payment.'); }
    setDeletingPayId(null);
  };

  const ACCESS_COLORS: Record<string, string> = {
    active:          '#16a34a',
    completed:       '#2563eb',
    waived:          '#7c3aed',
    overdue:         '#dc2626',
    pending_deposit: '#d97706',
    expired:         '#6b7280',
  };

  const filtered = rows.filter(r => {
    const matchSearch = !search ||
      r.email?.toLowerCase().includes(search.toLowerCase()) ||
      r.student_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.cohort_name?.toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || r.access_status === statusFilter;
    const matchCohort = cohortFilter === 'all' || r.cohort_id === cohortFilter;
    return matchSearch && matchStatus && matchCohort;
  });

  const groupedRows: { cohort_id: string; cohort_name: string; rows: any[] }[] = (() => {
    const map: Record<string, { cohort_id: string; cohort_name: string; rows: any[] }> = {};
    for (const r of filtered) {
      const key = r.cohort_id ?? '__none__';
      if (!map[key]) map[key] = { cohort_id: key, cohort_name: r.cohort_name ?? '--', rows: [] };
      map[key].rows.push(r);
    }
    return Object.values(map);
  })();

  const withBalance      = rows.filter(r => r.access_status === 'overdue' || r.access_status === 'pending_deposit').length;
  const totalOutstanding = rows.reduce((s: number, r: any) => s + (r.balance ?? 0), 0);
  const fullyPaid        = rows.filter(r => r.access_status === 'completed' || r.access_status === 'waived').length;

  return (
    <>
    <div className="space-y-5">
      {/* White carousel -- section switcher in the header, content in the body */}
      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
        {(() => {
          const SECTIONS = [
            { id: 'enrollments',   label: 'Enrollments' },
            { id: 'confirmations', label: 'Confirmations' },
            { id: 'options',       label: 'Payment Options' },
          ] as const;
          const ci = SECTIONS.findIndex(s => s.id === payTab);
          return (
            <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex items-center gap-3 min-w-0">
                <h2 className="text-lg font-bold leading-none truncate" style={{ color: C.text }}>{SECTIONS[ci]?.label}</h2>
                <div className="flex items-center gap-1.5">
                  {SECTIONS.map((s, i) => (
                    <button key={s.id} onClick={() => setPayTab(s.id)} aria-label={s.label}
                      className="rounded-full transition-all" style={{ width: i === ci ? 18 : 7, height: 7, background: i === ci ? C.cta : C.cardBorder }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => setPayTab(SECTIONS[(ci - 1 + SECTIONS.length) % SECTIONS.length].id)} aria-label="Previous section"
                  className="w-8 h-8 rounded-full grid place-items-center transition-opacity hover:opacity-70" style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                  <ChevronLeft className="w-4 h-4"/>
                </button>
                <button onClick={() => setPayTab(SECTIONS[(ci + 1) % SECTIONS.length].id)} aria-label="Next section"
                  className="w-8 h-8 rounded-full grid place-items-center transition-opacity hover:opacity-70" style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                  <ChevronRight className="w-4 h-4"/>
                </button>
              </div>
            </div>
          );
        })()}
        <div className="p-5 sm:p-6 space-y-5">

      {payTab === 'confirmations' && <ConfirmationsTab C={C} getToken={getToken}/>}
      {payTab === 'options'       && <PaymentOptionsTab C={C} getToken={getToken}/>}

      {payTab === 'enrollments' && <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs" style={{ color: C.faint }}>Enrollment-based payment tracking. Access gates are applied automatically.</p>
        </div>
        <button onClick={() => reportExportCSV(
          ['Email', 'Student', 'Cohort', 'Total Fee', 'Paid', 'Balance', 'Plan', 'Access Status', 'Access Until', 'Next Due'],
          filtered.map(r => [r.email, r.student_name, r.cohort_name, r.total_fee, r.paid_total, r.balance, r.payment_plan, r.access_status, r.access_until ?? '', r.next_due_date ?? '']),
          'enrollments-export.csv'
        )} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-opacity hover:opacity-80"
          style={{ background: C.pill, color: C.text }}>
          <Download className="w-3.5 h-3.5"/> Export CSV
        </button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {([
          { icon: Users,         label: 'Enrollments',      value: rows.length,                       sub: 'total students',         color: C.text,    tint: C.pill },
          { icon: AlertTriangle, label: 'Overdue / Pending', value: withBalance,                      sub: 'need payment',           color: '#dc2626', tint: 'rgba(220,38,38,0.12)' },
          { icon: CreditCard,    label: 'Outstanding',      value: totalOutstanding.toLocaleString(), sub: 'across all enrollments', color: '#d97706', tint: 'rgba(217,119,6,0.12)' },
          { icon: CheckCircle2,  label: 'Paid / Waived',    value: fullyPaid,                         sub: 'fully settled',          color: '#16a34a', tint: 'rgba(22,163,74,0.12)' },
        ] as const).map(s => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="rounded-2xl p-4" style={{ background: C.pill, border: 'none' }}>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: s.tint }}>
                  <Icon className="w-4 h-4" style={{ color: s.color === C.text ? C.muted : s.color }} />
                </div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] leading-tight" style={{ color: C.faint }}>{s.label}</p>
              </div>
              <p className="text-2xl font-bold leading-none tabular-nums mt-3" style={{ color: s.color }}>{s.value}</p>
              <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>{s.sub}</p>
            </div>
          );
        })}
      </div>

      {/* Payment settings -- collapsible card consolidating outstanding cohort + grace period */}
      <div className="rounded-2xl overflow-hidden" style={{ background: C.pill, border: 'none' }}>
        <button onClick={() => setSettingsOpen(o => !o)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 transition-opacity hover:opacity-80">
          <span className="flex items-center gap-2">
            <Settings className="w-4 h-4" style={{ color: C.faint }} />
            <span className="text-sm font-bold" style={{ color: C.text }}>Payment Settings</span>
          </span>
          <ChevronDown className="w-4 h-4 transition-transform" style={{ color: C.faint, transform: settingsOpen ? 'rotate(180deg)' : 'none' }} />
        </button>
        {settingsOpen && (
          <div className="px-4 pb-4 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-5" style={{ borderTop: `1px solid ${C.divider}` }}>
            {/* Outstanding cohort */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Outstanding Cohort</label>
              <select value={outstandingCohortId}
                onChange={async e => {
                  const v = e.target.value;
                  setOutstandingCohortId(v);
                  const token = await getToken();
                  fetch('/api/payments', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ action: 'save-payment-config', outstandingCohortId: v || null }),
                  }).catch(() => {});
                }}
                className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }}>
                <option value="">Select the outstanding cohort</option>
                {cohorts.filter((c: any) => !isIndividualCohort(c.cohort_kind)).map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>Students moved here lose access to course resources.</p>
            </div>
            {/* Grace period */}
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Grace Period</label>
              <div className="flex gap-2">
                <select
                  value={graceCohortId}
                  onChange={e => {
                    const id = e.target.value;
                    setGraceCohortId(id);
                    setGraceDaysInput(id && gracePeriods[id] != null ? String(gracePeriods[id]) : '');
                    setGraceError('');
                  }}
                  className="flex-1 min-w-0 text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }}>
                  <option value="">Select cohort</option>
                  {cohorts.filter((c: any) => c.cohort_kind === 'bootcamp').map((c: any) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{gracePeriods[c.id] != null ? ` (${gracePeriods[c.id]}d)` : ''}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  placeholder="Days"
                  value={graceDaysInput}
                  onChange={e => { setGraceDaysInput(e.target.value); setGraceError(''); }}
                  className="w-20 text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: C.card, color: C.text, border: `1px solid ${C.cardBorder}` }}
                />
                <button
                  disabled={!graceCohortId || graceSaving}
                  onClick={async () => {
                    if (!graceCohortId) return;
                    setGraceSaving(true); setGraceError('');
                    const token = await getToken();
                    try {
                      const res = await fetch('/api/payments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ action: 'save-grace-period', cohortId: graceCohortId, gracePeriodDays: graceDaysInput }),
                      }).then(r => r.json());
                      if (res.error) { setGraceError(res.error); }
                      else {
                        const days = graceDaysInput !== '' ? Number(graceDaysInput) : null;
                        setGracePeriods(prev => ({ ...prev, [graceCohortId]: days }));
                      }
                    } catch { setGraceError('Failed to save.'); }
                    setGraceSaving(false);
                  }}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40 flex-shrink-0"
                  style={{ background: C.cta, color: C.ctaText }}>
                  {graceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                  Save
                </button>
              </div>
              {graceError && <span className="text-xs block mt-1.5" style={{ color: '#dc2626' }}>{graceError}</span>}
              <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>Days of access after a missed installment before moving to outstanding.</p>
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.faint }} />
          <input placeholder="Search by email, name, or cohort..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full text-sm pl-9 pr-3 py-2 rounded-lg outline-none"
            style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
        </div>
        <select value={cohortFilter} onChange={e => setCohortFilter(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg outline-none"
          style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}>
          <option value="all">All Cohorts</option>
          {cohorts.filter((c: any) => c.cohort_kind === 'bootcamp').map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg outline-none"
          style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}>
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="pending_deposit">Pending Deposit</option>
          <option value="overdue">Overdue</option>
          <option value="completed">Completed</option>
          <option value="waived">Waived</option>
          <option value="expired">Expired</option>
        </select>
      </div>

      {/* Menu overlay - closes any open kebab menu */}
      {menuRow && (
        <div className="fixed inset-0 z-40" onClick={() => { setMenuRow(null); setMenuPos(null); }}/>
      )}

      {/* Payment Details section header */}
      <div>
        <h3 className="text-base font-bold leading-none" style={{ color: C.text }}>Payment Details</h3>
        <div style={{ height: 1, background: C.divider, marginTop: 14 }} />
      </div>

      {/* Cohorts -- vertical, one clear section per cohort with spacing */}
      {loading ? (
        <div className="flex items-center gap-2 py-10 justify-center" style={{ color: C.faint }}>
          <Loader2 className="w-4 h-4 animate-spin"/> Loading enrollment data...
        </div>
      ) : error ? (
        <div className="py-10 text-center text-sm" style={{ color: '#dc2626' }}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: C.faint }}>
          {rows.length === 0 ? 'No signed-up students found. Students appear here after completing signup via their invitation link.' : 'No results match your filters.'}
        </div>
      ) : (
        <div className="space-y-9">
          {groupedRows.map(group => {
            const isOutstandingGroup = outstandingCohortId && group.cohort_id === outstandingCohortId;
            const groupBalance = group.rows.reduce((s: number, r: any) => s + (r.balance ?? 0), 0);
            const currency = group.rows[0]?.currency ?? '';
            return (
              <div key={group.cohort_id}>
                {/* Cohort section header */}
                <div className="flex items-center gap-2.5 flex-wrap pb-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
                  <h4 className="text-sm font-bold leading-none" style={{ color: isOutstandingGroup ? '#dc2626' : C.text }}>{group.cohort_name}</h4>
                  {groupBalance > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>
                      Outstanding {currency} {groupBalance.toLocaleString()}
                    </span>
                  )}
                  {isOutstandingGroup && (
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide" style={{ background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>Outstanding Cohort</span>
                  )}
                </div>

                {/* Cohort enrollments table */}
                <div className="overflow-x-auto">
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${C.divider}` }}>
                        {['Student', 'Total Fee', 'Paid', 'Balance', 'Access Status', 'Next Due', ''].map((h, i) => (
                          <th key={h} className={[1, 2, 5].includes(i) ? 'hidden sm:table-cell' : ''} style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 600, fontSize: 10, color: C.faint, textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {group.rows.map((r: any, i: number) => {
                        const accentColor = ACCESS_COLORS[r.access_status] ?? C.muted;
                        return (
                          <tr key={r.enrollment_id ?? i} style={{ borderTop: `1px solid ${C.divider}` }}>
                            <td style={{ padding: '14px 16px', maxWidth: 280 }}>
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate" style={{ color: C.text, fontWeight: 500 }} title={r.student_name}>{r.student_name || '--'}</p>
                                  {r.is_presignup && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>Pending Signup</span>
                                  )}
                                  {!r.is_presignup && r.payment_exempt && (
                                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: 'rgba(234,179,8,0.12)', color: '#a16207' }}>Exempt</span>
                                  )}
                                </div>
                                <p className="truncate" style={{ color: C.faint, fontSize: 10 }} title={r.email}>{r.email}</p>
                              </div>
                            </td>
                            <td className="hidden sm:table-cell" style={{ padding: '14px 16px', color: C.text, whiteSpace: 'nowrap' }}>{r.currency} {Number(r.total_fee).toLocaleString()}</td>
                            <td className="hidden sm:table-cell" style={{ padding: '14px 16px', color: C.text, whiteSpace: 'nowrap' }}>{Number(r.paid_total).toLocaleString()}</td>
                            <td style={{ padding: '14px 16px', fontWeight: 600, whiteSpace: 'nowrap', color: r.balance > 0 ? '#dc2626' : '#16a34a' }}>
                              {r.balance > 0 ? r.balance.toLocaleString() : '--'}
                            </td>
                            <td style={{ padding: '14px 16px', whiteSpace: 'nowrap' }}>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ background: `${accentColor}18`, color: accentColor }}>
                                {r.access_status?.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="hidden sm:table-cell" style={{ padding: '14px 16px', color: C.muted, whiteSpace: 'nowrap', fontSize: 11 }}>
                              {r.next_due_date ? new Date(r.next_due_date).toLocaleDateString() : '--'}
                            </td>
                            <td style={{ padding: '14px 16px' }}>
                              {r.enrollment_id && (
                                <div className="flex justify-end">
                                  <button
                                    onClick={e => {
                                      e.stopPropagation();
                                      if (menuRow?.enrollment_id === r.enrollment_id) {
                                        setMenuRow(null); setMenuPos(null);
                                      } else {
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        const right = Math.max(8, window.innerWidth - rect.right);
                                        if (window.innerHeight - rect.bottom >= 270) {
                                          setMenuPos({ top: rect.bottom + 4, right });
                                        } else {
                                          setMenuPos({ bottom: window.innerHeight - rect.top + 4, right });
                                        }
                                        setMenuRow(r);
                                      }
                                    }}
                                    className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
                                    style={{ color: C.muted, background: menuRow?.enrollment_id === r.enrollment_id ? C.pill : 'transparent' }}>
                                    <MoreVertical className="w-4 h-4"/>
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          <div className="text-xs pt-1" style={{ color: C.faint }}>
            {filtered.length} enrollment{filtered.length !== 1 ? 's' : ''} across {groupedRows.length} cohort{groupedRows.length !== 1 ? 's' : ''}{rows.length !== filtered.length ? ` (filtered from ${rows.length})` : ''}
          </div>
        </div>
      )}

      {/* Kebab dropdown - rendered outside table to escape overflow-x-auto clip */}
      {menuRow && menuPos && (
        <div className="fixed z-50 w-52 rounded-xl py-1.5"
          style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? '0 4px 16px rgba(0,0,0,0.35)' : '0 12px 32px rgba(0,0,0,0.16)' }}
          onClick={e => e.stopPropagation()}>
          <button onClick={() => { setMenuRow(null); setMenuPos(null); openPay(menuRow); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
            style={{ color: C.text }}>
            <CreditCard className="w-3.5 h-3.5 flex-shrink-0"/> Record Payment
          </button>
          <button onClick={() => { setMenuRow(null); setMenuPos(null); openHistory(menuRow); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
            style={{ color: C.text }}>
            <Clock className="w-3.5 h-3.5 flex-shrink-0"/> Payment History
          </button>
          {menuRow.balance > 0 && !menuRow.payment_exempt && menuRow.access_status !== 'waived' && (
            <button onClick={() => { const row = menuRow; setMenuRow(null); setMenuPos(null); handleSendReminder(row); }}
              disabled={sendingReminder === menuRow.enrollment_id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ color: '#d97706' }}>
              <Send className="w-3.5 h-3.5 flex-shrink-0"/>
              {sendingReminder === menuRow.enrollment_id ? 'Sending...' : 'Send Payment Reminder'}
            </button>
          )}
          <button onClick={() => { setMenuRow(null); setMenuPos(null); openEdit(menuRow); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
            style={{ color: C.text }}>
            <Edit2 className="w-3.5 h-3.5 flex-shrink-0"/> Edit Enrollment
          </button>
          <div className="my-1 mx-3" style={{ borderTop: `1px solid ${C.divider}` }}/>
          {menuRow.access_status !== 'waived' && (
            <button onClick={() => { setMenuRow(null); setMenuPos(null); handleMarkWaived(menuRow); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
              style={{ color: C.text }}>
              <Check className="w-3.5 h-3.5 flex-shrink-0"/> Mark as Waived
            </button>
          )}
          {!menuRow.is_presignup && menuRow.student_id && outstandingCohortId &&
            menuRow.cohort_id !== outstandingCohortId && !menuRow.payment_exempt &&
            (menuRow.access_status === 'overdue' || menuRow.access_status === 'pending_deposit') && (
            <button onClick={() => { setMenuRow(null); setMenuPos(null); handleMoveToOutstanding(menuRow); }} disabled={movingId === menuRow.student_id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ color: C.text }}>
              <ArrowRight className="w-3.5 h-3.5 flex-shrink-0"/> Move to Outstanding
            </button>
          )}
          {!menuRow.is_presignup && menuRow.student_id && menuRow.original_cohort_id && (
            <button onClick={() => { setMenuRow(null); setMenuPos(null); handleRestoreCohort(menuRow); }} disabled={movingId === menuRow.student_id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70 disabled:opacity-50"
              style={{ color: C.text }}>
              <ArrowLeft className="w-3.5 h-3.5 flex-shrink-0"/> Restore to Cohort
            </button>
          )}
          {!menuRow.is_presignup && menuRow.student_id && (
            menuRow.payment_exempt ? (
              <button onClick={() => { setMenuRow(null); setMenuPos(null); handleToggleExempt(menuRow, false); }} disabled={movingId === menuRow.student_id}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{ color: C.text }}>
                <XCircle className="w-3.5 h-3.5 flex-shrink-0"/> Revoke Exemption
              </button>
            ) : (
              <button onClick={() => { setMenuRow(null); setMenuPos(null); handleToggleExempt(menuRow, true); }} disabled={movingId === menuRow.student_id}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70 disabled:opacity-50"
                style={{ color: C.text }}>
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0"/> Grant Exemption
              </button>
            )
          )}
        </div>
      )}

      {/* Record Payment modal */}
      {payRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setPayRow(null)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ ...modalStyle(C) }} onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold" style={{ color: C.text }}>Record Payment</h3>
                  <p className="text-xs mt-1" style={{ color: C.faint }}>{payRow.student_name || payRow.email}</p>
                </div>
                <button onClick={() => setPayRow(null)} className="p-1 rounded-lg transition-opacity hover:opacity-70 flex-shrink-0 mt-0.5" style={{ color: C.faint }}><X className="w-4 h-4"/></button>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-4 min-w-0">
                {[
                  { label: 'Total Fee', value: `${payRow.currency} ${Number(payRow.total_fee).toLocaleString()}`, color: C.text },
                  { label: 'Paid', value: Number(payRow.paid_total).toLocaleString(), color: '#16a34a' },
                  { label: 'Balance', value: payRow.balance > 0 ? Number(payRow.balance).toLocaleString() : 'Settled', color: payRow.balance > 0 ? '#dc2626' : '#16a34a' },
                ].map(s => (
                  <div key={s.label} className="rounded-xl px-3 py-2.5" style={{ background: C.pill }}>
                    <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.faint }}>{s.label}</p>
                    <p className="text-sm font-bold mt-0.5" style={{ color: s.color }}>{s.value}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Amount ({payRow.currency}) *</label>
                  <input type="number" value={payAmount} placeholder="0" onChange={e => setPayAmount(e.target.value)}
                    className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Date Paid</label>
                  <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)}
                    className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Method</label>
                  <input type="text" value={payMethod} placeholder="Cash, Mobile Money..." onChange={e => setPayMethod(e.target.value)}
                    className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Reference</label>
                  <input type="text" value={payRef} placeholder="Receipt / transaction ref" onChange={e => setPayRef(e.target.value)}
                    className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Notes</label>
                <input type="text" value={payNotes} placeholder="Optional notes" onChange={e => setPayNotes(e.target.value)}
                  className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                  style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
              </div>
              {payError && <p className="text-xs" style={{ color: '#dc2626' }}>{payError}</p>}
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button onClick={() => setPayRow(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80" style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={handleRecordPayment} disabled={paySaving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-90" style={{ background: C.cta, color: C.ctaText }}>
                {paySaving ? 'Saving...' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment History modal */}
      {histRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setHistRow(null)}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden max-h-[90vh] flex flex-col" style={{ ...modalStyle(C) }} onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-5 flex-shrink-0" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-bold" style={{ color: C.text }}>Payment History</h3>
                  <p className="text-xs mt-1" style={{ color: C.faint }}>{histRow.student_name || histRow.email}</p>
                </div>
                <button onClick={() => setHistRow(null)} className="p-1 rounded-lg transition-opacity hover:opacity-70 flex-shrink-0 mt-0.5" style={{ color: C.faint }}><X className="w-4 h-4"/></button>
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4">
                <div className="rounded-xl px-3 py-2.5" style={{ background: C.pill }}>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.faint }}>Total Paid</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: '#16a34a' }}>{histRow.currency} {Number(histRow.paid_total).toLocaleString()}</p>
                </div>
                <div className="rounded-xl px-3 py-2.5" style={{ background: histRow.balance > 0 ? 'rgba(220,38,38,0.08)' : C.pill }}>
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: C.faint }}>Balance</p>
                  <p className="text-sm font-bold mt-0.5" style={{ color: histRow.balance > 0 ? '#dc2626' : '#16a34a' }}>
                    {histRow.balance > 0 ? `${histRow.currency} ${histRow.balance.toLocaleString()}` : 'Settled'}
                  </p>
                </div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {histError && <p className="text-xs mb-2" style={{ color: '#dc2626' }}>{histError}</p>}
              {histLoading ? (
                <div className="flex items-center justify-center gap-2 py-12" style={{ color: C.faint }}>
                  <Loader2 className="w-4 h-4 animate-spin"/> Loading transactions...
                </div>
              ) : histPayments.length === 0 ? (
                <div className="py-12 text-center">
                  <CreditCard className="w-8 h-8 mx-auto mb-3" style={{ color: C.faint }}/>
                  <p className="text-sm" style={{ color: C.faint }}>No payment records yet.</p>
                </div>
              ) : (
                histPayments.map((p: any) => (
                  <div key={p.id} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                    {editingPayId === p.id ? (
                      <div className="p-4 space-y-3" style={{ background: C.pill }}>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { label: 'Amount', key: 'amount', type: 'number' },
                            { label: 'Date Paid', key: 'paid_at', type: 'date' },
                            { label: 'Method', key: 'method', type: 'text' },
                            { label: 'Reference', key: 'reference', type: 'text' },
                          ].map(f => (
                            <div key={f.key}>
                              <label className="block text-[10px] font-semibold mb-1" style={{ color: C.muted }}>{f.label}</label>
                              <input type={f.type} value={editPayFields[f.key]}
                                onChange={e => setEditPayFields((prev: any) => ({ ...prev, [f.key]: e.target.value }))}
                                className="w-full text-xs px-2.5 py-2 rounded-lg outline-none"
                                style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                            </div>
                          ))}
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold mb-1" style={{ color: C.muted }}>Notes</label>
                          <input type="text" value={editPayFields.notes}
                            onChange={e => setEditPayFields((prev: any) => ({ ...prev, notes: e.target.value }))}
                            className="w-full text-xs px-2.5 py-2 rounded-lg outline-none"
                            style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                        </div>
                        {editPayError && <p className="text-[10px]" style={{ color: '#dc2626' }}>{editPayError}</p>}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => setEditingPayId(null)} className="flex-1 py-2 rounded-lg text-xs font-semibold" style={{ background: C.input, color: C.muted }}>Cancel</button>
                          <button onClick={handleEditPayment} disabled={editPaySaving} className="flex-1 py-2 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>
                            {editPaySaving ? 'Saving...' : 'Save Changes'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 px-4 py-3" style={{ background: C.card }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(37,99,235,0.1)' }}>
                          <CreditCard className="w-4 h-4" style={{ color: '#2563eb' }}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold" style={{ color: C.text }}>{histRow.currency} {Number(p.amount).toLocaleString()}</p>
                          <p className="text-[11px] mt-0.5" style={{ color: C.muted }}>
                            {p.paid_at ? new Date(p.paid_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '--'}
                            {p.method ? ` - ${p.method}` : ''}
                            {p.reference ? ` (${p.reference})` : ''}
                          </p>
                          {p.notes && <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{p.notes}</p>}
                        </div>
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => startEditPayment(p)}
                            className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
                            style={{ color: C.muted, background: C.pill }}>
                            <Edit2 className="w-3 h-3"/>
                          </button>
                          <button onClick={() => handleDeletePayment(p.id)} disabled={deletingPayId === p.id}
                            className="p-1.5 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-50"
                            style={{ color: '#dc2626', background: 'rgba(220,38,38,0.08)' }}>
                            {deletingPayId === p.id ? <Loader2 className="w-3 h-3 animate-spin"/> : <Trash2 className="w-3 h-3"/>}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button onClick={() => { setHistRow(null); openPay(histRow); }}
                className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-opacity hover:opacity-80"
                style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}>
                <CreditCard className="w-4 h-4"/> Record New Payment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Enrollment modal */}
      {editRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }} onClick={() => setEditRow(null)}>
          <div className="w-full max-w-md rounded-2xl flex flex-col" style={{ ...modalStyle(C), maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 flex-shrink-0" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div>
                <h3 className="text-base font-bold" style={{ color: C.text }}>Edit Enrollment</h3>
                <p className="text-xs mt-0.5" style={{ color: C.faint }}>{editRow.student_name || editRow.email}</p>
              </div>
              <button onClick={() => setEditRow(null)} className="p-1 rounded-lg transition-opacity hover:opacity-70 flex-shrink-0 mt-0.5" style={{ color: C.faint }}><X className="w-4 h-4"/></button>
            </div>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              <div className="space-y-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.faint }}>Payment Terms</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Total Fee (GHS)</label>
                    <input type="number" value={editFields.total_fee} placeholder="3000"
                      onChange={e => setEditFields((p: any) => ({ ...p, total_fee: e.target.value }))}
                      className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                      style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Deposit Required (GHS)</label>
                    <input type="number" value={editFields.deposit_required} placeholder="1500"
                      onChange={e => setEditFields((p: any) => ({ ...p, deposit_required: e.target.value }))}
                      className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                      style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1.5" style={{ color: C.muted }}>Payment Plan</label>
                  <select value={editFields.payment_plan} onChange={e => setEditFields((p: any) => ({ ...p, payment_plan: e.target.value }))}
                    className="w-full text-sm px-3 py-2.5 rounded-xl outline-none"
                    style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}>
                    <option value="flexible">Flexible</option>
                    <option value="full">Full</option>
                    <option value="sponsored">Sponsored</option>
                    <option value="waived">Waived</option>
                  </select>
                </div>
              </div>
              {installments.length > 0 && (
                <div className="space-y-3 pt-2" style={{ borderTop: `1px solid ${C.divider}` }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider pt-1" style={{ color: C.faint }}>Installment Schedule</p>
                  {instError && <p className="text-[11px]" style={{ color: '#dc2626' }}>{instError}</p>}
                  {installments.map((inst: any, i: number) => (
                    <div key={inst.id} className="rounded-xl px-3 py-3" style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold" style={{ color: C.muted }}>
                          {i === 0 ? 'Deposit' : `Installment ${i}`}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                          style={{
                            background: inst.status === 'paid' ? 'rgba(22,163,74,0.12)' : inst.status === 'partial' ? 'rgba(217,119,6,0.12)' : C.input,
                            color: inst.status === 'paid' ? '#16a34a' : inst.status === 'partial' ? '#d97706' : C.faint,
                          }}>
                          {inst.status}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input type="date" value={instDates[inst.id] ?? inst.due_date}
                          onChange={e => setInstDates(prev => ({ ...prev, [inst.id]: e.target.value }))}
                          disabled={inst.status === 'paid'}
                          className="flex-1 text-xs px-2.5 py-2 rounded-lg outline-none disabled:opacity-50"
                          style={{ background: C.input, color: C.text, border: `1px solid ${C.cardBorder}` }}/>
                        <button
                          onClick={() => handleSaveInstallmentDate(inst.id)}
                          disabled={inst.status === 'paid' || instSaving[inst.id] || instDates[inst.id] === inst.due_date}
                          className="text-xs font-semibold px-3 py-2 rounded-lg disabled:opacity-40 transition-opacity hover:opacity-80"
                          style={{ background: C.cta, color: C.ctaText }}>
                          {instSaving[inst.id] ? '...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {saveError && <p className="text-xs" style={{ color: '#dc2626' }}>{saveError}</p>}
            </div>
            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button onClick={() => setEditRow(null)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80" style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-90" style={{ background: C.cta, color: C.ctaText }}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      </>}
        </div>
      </div>
    </div>

    {/* Toast notification */}
    {payToast && createPortal(
      <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg"
        style={{ background: payToast.ok ? '#16a34a' : '#dc2626', color: '#fff', minWidth: 220, maxWidth: 360 }}>
        {payToast.ok ? <Check className="w-4 h-4 flex-shrink-0"/> : <X className="w-4 h-4 flex-shrink-0"/>}
        {payToast.text}
      </div>,
      document.body
    )}
    </>
  );
}
