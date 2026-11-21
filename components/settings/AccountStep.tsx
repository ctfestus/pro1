'use client';

// Account settings, Account step: email, change password and the danger zone.

import { useState } from 'react';
import { CheckCircle2, Loader2, Trash2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { FIELD, Label, Sect, inputStyle } from '@/components/create/EditorKit';
import { Card, btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

export function AccountStep({ C, email, accessToken }: { C: ThemeColors; email: string; accessToken: string | null }) {
  const P = palette(C);
  const [pwCurrent, setPwCurrent]   = useState('');
  const [pwNew, setPwNew]           = useState('');
  const [pwConfirm, setPwConfirm]   = useState('');
  const [pwLoading, setPwLoading]   = useState(false);
  const [pwMsg, setPwMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText]       = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMsg, setDeleteMsg]         = useState('');

  const handleChangePassword = async () => {
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: 'Passwords do not match.' }); return; }
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return; }
    setPwLoading(true); setPwMsg(null);
    const res = await fetch('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
    });
    const data = await res.json();
    setPwLoading(false);
    if (!res.ok) { setPwMsg({ ok: false, text: data.error ?? 'Failed to update password. Try again.' }); }
    else { setPwMsg({ ok: true, text: 'Password updated successfully.' }); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
  };

  const handleDeleteAccount = async () => {
    if (deleteText !== 'DELETE') return;
    setDeleteLoading(true); setDeleteMsg('');
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const data = await res.json();
      setDeleteMsg(data.error ?? 'Failed to delete account.');
      setDeleteLoading(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.href = '/auth';
  };

  return (
    <Card C={C}>
      <Sect title="Email address" first C={C}>
        <p className="text-sm font-semibold break-all" style={{ color: C.text }}>{email}</p>
      </Sect>

      <Sect title="Change password" C={C}>
        <div className="grid gap-4 max-w-md">
          <div>
            <Label C={C}>Current password</Label>
            <input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} className={FIELD} style={inputStyle(C)} />
          </div>
          <div>
            <Label C={C}>New password</Label>
            <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="At least 8 characters" className={FIELD} style={inputStyle(C)} />
          </div>
          <div>
            <Label C={C}>Confirm new password</Label>
            <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} className={FIELD} style={inputStyle(C)} />
          </div>
          {pwMsg && (
            <div role={pwMsg.ok ? 'status' : 'alert'} className="flex items-center gap-2 text-sm" style={{ color: pwMsg.ok ? P.good : P.bad }}>
              {pwMsg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
              {pwMsg.text}
            </div>
          )}
          <button type="button" onClick={handleChangePassword} disabled={pwLoading || !pwCurrent || !pwNew || !pwConfirm} className={`${btnClass} w-fit`} style={btnStyle('pri', C)}>
            {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {pwLoading ? 'Updating...' : 'Update password'}
          </button>
        </div>
      </Sect>

      <Sect title="Danger zone" C={C}>
        {!confirmDelete ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" style={{ color: C.muted }}>Permanently delete your account and everything in it.</p>
            <button type="button" onClick={() => setConfirmDelete(true)} className={btnClass} style={btnStyle('danger', C)}>
              <Trash2 className="w-4 h-4" /> Delete account
            </button>
          </div>
        ) : (
          <div className="rounded-xl p-4 grid gap-3" style={{ background: P.badSoft }}>
            <p className="text-sm font-semibold" style={{ color: P.bad }}>This permanently deletes your account, all forms, responses, and certificates. This cannot be undone.</p>
            <p className="text-xs" style={{ color: P.bad }}>Type <strong>DELETE</strong> to confirm.</p>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE" aria-label="Type DELETE to confirm" className={`${FIELD} max-w-md`} style={{ ...inputStyle(C), background: C.card }} />
            {deleteMsg && <p className="text-xs" style={{ color: P.bad }}>{deleteMsg}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleDeleteAccount} disabled={deleteLoading || deleteText !== 'DELETE'} className={btnClass} style={{ background: P.bad, color: '#FFFFFF' }}>
                {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleteLoading ? 'Deleting...' : 'Delete my account'}
              </button>
              <button type="button" onClick={() => { setConfirmDelete(false); setDeleteText(''); setDeleteMsg(''); }} className={btnClass} style={btnStyle('sec', C)}>Cancel</button>
            </div>
          </div>
        )}
      </Sect>
    </Card>
  );
}
