'use client';

import { useState } from 'react';
import type { ThemeColors } from '@/lib/theme';
import { sendJson } from '../subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '../subscriptions/Modal';

/** A learner on their own, not in a bootcamp cohort. They get an email to set their password. */
export function AddStudentModal({ onClose, onCreated, C }: { onClose: () => void; onCreated: (message: string) => void; C: ThemeColors }) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = /^\S+@\S+\.\S+$/.test(email.trim());

  async function create() {
    setBusy(true);
    setError('');
    try {
      await sendJson('/api/admissions', 'POST', { action: 'create-individual-student', fullName, email }, 'Failed to create student');
      onCreated(`${fullName.trim() || email.trim()} was added. A setup email is on its way.`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add student" eyebrow="A learner on their own, not in a bootcamp cohort" onClose={onClose} C={C} error={error}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) create(); }}>
        <label className="block text-xs font-semibold" style={{ color: C.muted }}>
          Full name
          <input autoFocus value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Learner's full name" className={`${FIELD} mt-2`} style={inputStyle(C)} />
        </label>
        <label className="block text-xs font-semibold" style={{ color: C.muted }}>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="learner@example.com" className={`${FIELD} mt-2`} style={inputStyle(C)} />
        </label>
        <p className="text-xs" style={{ color: C.muted }}>They get an email with a link to set their password. Give them a plan from Subscriptions.</p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-2">
          <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
          <button type="submit" disabled={busy || !valid} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>{busy ? 'Creating...' : 'Create and send setup email'}</button>
        </div>
      </form>
    </Modal>
  );
}
