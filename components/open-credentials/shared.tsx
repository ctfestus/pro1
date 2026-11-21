'use client';

// Types, labels and small helpers shared by the Open credentials page and its pop-ups.

import type { ReactNode } from 'react';
import { AlertTriangle, Check } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { BUTTON } from '@/components/dashboard/subscriptions/Modal';

export type IssueMode = 'certificate_only' | 'badge_only' | 'both';
export type Program = {
  id: string; name: string; description: string | null;
  skills: string[]; badge_image_url: string | null;
  issue_mode: IssueMode; completion_text: string | null; created_at: string;
};
export type OpenCert = {
  id: string; program_id: string | null; program_name: string;
  recipient_name: string; recipient_email: string | null;
  issued_date: string; revoked: boolean; created_at: string;
};

export const ISSUE_MODES: { value: IssueMode; label: string; desc: string }[] = [
  { value: 'certificate_only', label: 'Certificate only',      desc: 'Recipients get a printable certificate' },
  { value: 'badge_only',       label: 'Badge only',            desc: 'Recipients get a digital badge' },
  { value: 'both',             label: 'Certificate and badge', desc: 'Recipients get both' },
];

export function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function Notice({ ok, children, C }: { ok?: boolean; children: ReactNode; C: ThemeColors }) {
  return (
    <div role={ok ? 'status' : 'alert'} className="rounded-xl px-4 py-3 text-sm flex items-center gap-2"
      style={ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      {ok ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

/** Cancel and the main action, at the foot of each pop-up. */
export function Footer({ onCancel, children, C }: { onCancel: () => void; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
      <button type="button" onClick={onCancel} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
      {children}
    </div>
  );
}
