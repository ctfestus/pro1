'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import type { ThemeColors } from '@/lib/theme';
import { getPayments, postPayments } from '../subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';
import { FloatingMenu, menuPosition, type MenuPosition } from '../subscriptions/Menus';
import { Switch } from '../subscriptions/PlanForm';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle } from '../subscriptions/ui';

const TYPES = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'mobile_money', label: 'Mobile Money' },
  { value: 'online', label: 'Online payment' },
] as const;

const TYPE_FIELDS: Record<string, { key: string; label: string; placeholder: string }[]> = {
  bank_transfer: [
    { key: 'bank_name', label: 'Bank name', placeholder: 'For example, GCB Bank' },
    { key: 'account_name', label: 'Account name', placeholder: 'Full name on the account' },
    { key: 'account_number', label: 'Account number', placeholder: '' },
    { key: 'branch', label: 'Branch', placeholder: 'For example, Accra Main' },
    { key: 'country', label: 'Country', placeholder: 'For example, Ghana' },
  ],
  mobile_money: [
    { key: 'mobile_money_number', label: 'Number', placeholder: '024XXXXXXX' },
    { key: 'account_name', label: 'Account name', placeholder: 'Registered name' },
    { key: 'network', label: 'Network', placeholder: 'For example, MTN, Telecel, AirtelTigo' },
  ],
  online: [
    { key: 'payment_link', label: 'Payment link', placeholder: 'https://' },
    { key: 'platform', label: 'Platform', placeholder: 'For example, Paystack, Flutterwave, PayPal' },
  ],
};

const blank = () => ({
  id: '', label: '', type: 'bank_transfer', instructions: '',
  bank_name: '', account_name: '', account_number: '', branch: '', country: '',
  mobile_money_number: '', network: '', payment_link: '', platform: '',
  logo_url: '', is_active: true, sort_order: 0,
});

function savePayload(o: any) {
  const or = (v: any) => v || null;
  return {
    action: 'save-payment-option', id: o.id || undefined, label: o.label, type: o.type, instructions: or(o.instructions),
    bank_name: or(o.bank_name), account_name: or(o.account_name), account_number: or(o.account_number), branch: or(o.branch), country: or(o.country),
    mobile_money_number: or(o.mobile_money_number), network: or(o.network), payment_link: or(o.payment_link), platform: or(o.platform),
    logo_url: or(o.logo_url), is_active: o.is_active, sort_order: Number(o.sort_order) || 0,
  };
}

/** The ways to pay shown to learners on My Plan, in order. */
export function OptionsView({ C, onMessage }: { C: ThemeColors; onMessage: (ok: boolean, text: string) => void }) {
  const [options, setOptions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [menu, setMenu] = useState<{ option: any; position: MenuPosition } | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getPayments('action=payment-options', 'Failed to load payment options');
      setOptions(data.options ?? []);
    } catch (err: any) {
      onMessage(false, err.message);
    } finally {
      setLoading(false);
    }
  }, [onMessage]);
  useEffect(() => { load(); }, [load]);

  async function run(task: () => Promise<unknown>, done?: string) {
    setBusy(true);
    try {
      await task();
      await load();
      if (done) onMessage(true, done);
    } catch (err: any) {
      onMessage(false, err.message);
    } finally {
      setBusy(false);
    }
  }

  const setVisible = (o: any, is_active: boolean) =>
    run(() => postPayments(savePayload({ ...o, is_active }), 'Failed to update the payment option'));

  // Order is the stored sort number. Moving swaps it with the neighbour, numbering by position so
  // options that shared a number still end up in a definite order.
  const move = (index: number, step: -1 | 1) => run(async () => {
    const order = options.map((o, i) => ({ ...o, sort_order: i }));
    const other = index + step;
    [order[index].sort_order, order[other].sort_order] = [order[other].sort_order, order[index].sort_order];
    for (const o of [order[index], order[other]]) await postPayments(savePayload(o), 'Failed to reorder payment options');
  });

  const remove = (o: any) => {
    if (!confirm(`Delete "${o.label}"? Learners will no longer see it.`)) return;
    run(() => postPayments({ action: 'delete-payment-option', id: o.id }, 'Failed to delete the payment option'), `"${o.label}" deleted.`);
  };

  if (loading) return <Card C={C}><p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>Loading payment options...</p></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs" style={{ color: C.muted }}>Shown to learners on My Plan, in this order.</p>
        <button type="button" onClick={() => setEditing(blank())} className={btnClass} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          Add payment option
        </button>
      </div>
      {options.length === 0 && <Card C={C}><p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No payment options yet. Add one so learners know how to pay.</p></Card>}
      <div className="grid md:grid-cols-2 gap-3">
        {options.map((o) => {
          const details = (TYPE_FIELDS[o.type] ?? []).filter((f) => o[f.key]);
          return (
            <Card key={o.id} C={C} className="p-4 grid gap-3 content-start">
              <div className="flex items-start gap-3">
                <span className="w-11 h-11 rounded-xl grid place-items-center overflow-hidden flex-shrink-0 font-bold" style={{ background: C.pill, color: C.text, fontFamily: DISPLAY_FONT }}>
                  {o.logo_url ? <img src={o.logo_url} alt="" className="w-full h-full object-contain" /> : String(o.label || '?').charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold flex items-center gap-2 flex-wrap" style={{ color: C.text }}>
                    {o.label}
                    {!o.is_active && <Pill tone="mute" C={C}>Hidden</Pill>}
                  </p>
                  <p className="text-xs" style={{ color: C.muted }}>{TYPES.find((t) => t.value === o.type)?.label ?? o.type}</p>
                </div>
                <button
                  type="button"
                  aria-label={`More for ${o.label}`}
                  onClick={(e) => setMenu(menu?.option.id === o.id ? null : { option: o, position: menuPosition(e.currentTarget, 220) })}
                  className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0"
                  style={{ background: C.pill, color: C.muted }}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
              {details.length > 0 && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs rounded-xl p-3" style={{ background: C.page }}>
                  {details.map((f) => (
                    <div key={f.key} className="contents">
                      <dt style={{ color: C.muted }}>{f.label}</dt>
                      <dd className="font-medium tabular-nums break-all" style={{ color: C.text }}>{o[f.key]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-3 text-xs" style={{ color: C.muted }}>
                  <Switch on={o.is_active} onChange={(on) => setVisible(o, on)} label={`Show ${o.label} to learners`} C={C} />
                  {o.is_active ? 'Visible to learners' : 'Hidden from learners'}
                </span>
                <button type="button" disabled={busy} onClick={() => setEditing({ ...o })} className={btnSmClass} style={btnStyle('ghost', C)}>
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      {menu && (() => {
        const index = options.findIndex((o) => o.id === menu.option.id);
        return (
          <FloatingMenu
            position={menu.position}
            label="payment option actions"
            onClose={() => setMenu(null)}
            C={C}
            items={[
              { label: 'Move up', sub: 'Show it earlier on My Plan', icon: ArrowUp, onClick: () => { setMenu(null); move(index, -1); }, disabled: busy || index <= 0 },
              { label: 'Move down', sub: 'Show it later on My Plan', icon: ArrowDown, onClick: () => { setMenu(null); move(index, 1); }, disabled: busy || index >= options.length - 1 },
              null,
              { label: 'Delete', sub: 'Learners will no longer see it', icon: Trash2, onClick: () => { setMenu(null); remove(menu.option); }, danger: true },
            ]}
          />
        );
      })()}

      {editing && (
        <OptionModal
          option={editing}
          C={C}
          onClose={() => setEditing(null)}
          onSaved={async (label, isNew) => { setEditing(null); await load(); onMessage(true, isNew ? `"${label}" added.` : `"${label}" saved.`); }}
        />
      )}
    </div>
  );
}

function OptionModal({ option, onClose, onSaved, C }: { option: any; onClose: () => void; onSaved: (label: string, isNew: boolean) => void; C: ThemeColors }) {
  const [o, setO] = useState(option);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (change: any) => setO((v: any) => ({ ...v, ...change }));

  async function upload(file: File) {
    setUploading(true);
    try {
      set({ logo_url: await uploadToCloudinary(file, 'payment-options') });
    } catch (err: any) {
      setError(err.message ?? 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!o.label.trim()) { setError('Give the option a name.'); return; }
    setSaving(true);
    setError('');
    try {
      await postPayments(savePayload(o), 'Failed to save the payment option');
      onSaved(o.label, !o.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const label = 'block text-xs font-semibold';
  return (
    <Modal title={o.id ? 'Edit payment option' : 'New payment option'} eyebrow="Shown to learners on My Plan" onClose={onClose} C={C} error={error}>
      <div className="grid gap-4">
        <label className={label} style={{ color: C.muted }}>
          Name
          <input value={o.label} onChange={(e) => set({ label: e.target.value })} placeholder="For example, GCB Bank Transfer" className={`${FIELD} mt-2`} style={inputStyle(C)} />
        </label>
        <div>
          <span className={`${label} mb-2`} style={{ color: C.muted }}>Type</span>
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: C.pill }} role="radiogroup" aria-label="Payment type">
            {TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={o.type === t.value}
                onClick={() => set({ type: t.value })}
                className="flex-1 h-9 rounded-[10px] text-xs font-semibold"
                style={o.type === t.value ? { background: C.card, color: C.text, boxShadow: '0 1px 2px rgba(16,24,40,0.08)' } : { color: C.muted }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {(TYPE_FIELDS[o.type] ?? []).map((f) => (
            <label key={f.key} className={`${label} ${f.key === 'payment_link' ? 'sm:col-span-2' : ''}`} style={{ color: C.muted }}>
              {f.label}
              <input value={o[f.key] ?? ''} onChange={(e) => set({ [f.key]: e.target.value })} placeholder={f.placeholder} className={`${FIELD} mt-2`} style={inputStyle(C)} />
            </label>
          ))}
        </div>
        <div>
          <span className={`${label} mb-2`} style={{ color: C.muted }}>Logo</span>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          <div className="flex items-center gap-3">
            {o.logo_url && <span className="w-12 h-12 rounded-xl overflow-hidden flex-shrink-0" style={{ background: C.pill }}><img src={o.logo_url} alt="" className="w-full h-full object-contain" /></span>}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={BUTTON} style={{ background: C.pill, color: C.text }}>
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {uploading ? 'Uploading...' : o.logo_url ? 'Replace logo' : 'Upload logo'}
            </button>
            {o.logo_url && <button type="button" onClick={() => set({ logo_url: '' })} className="text-xs font-semibold" style={{ color: C.deleteText }}>Remove</button>}
          </div>
        </div>
        <label className={label} style={{ color: C.muted }}>
          Instructions <span className="font-normal" style={{ color: C.faint }}>(optional)</span>
          <textarea value={o.instructions ?? ''} onChange={(e) => set({ instructions: e.target.value })} placeholder="Steps learners follow to pay" className={`${FIELD} mt-2 min-h-20`} style={inputStyle(C)} />
        </label>
        <span className="flex items-center gap-3 text-sm" style={{ color: C.text }}>
          <Switch on={o.is_active} onChange={(is_active) => set({ is_active })} label="Visible to learners" C={C} />
          Visible to learners
        </span>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" onClick={save} disabled={saving || uploading} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{saving ? 'Saving...' : 'Save'}</button>
      </div>
    </Modal>
  );
}
