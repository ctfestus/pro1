'use client';

// Types, lists and small pieces shared by the Account settings steps.

import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { palette } from '@/components/dashboard/subscriptions/ui';

export type EducationEntry = {
  id: string;
  school: string;
  degree: string;
  field: string;
  start_year: string;
  end_year: string;
  current: boolean;
};
export type WorkEntry = {
  id: string;
  company: string;
  title: string;
  start_year: string;
  end_year: string;
  current: boolean;
  description?: string;
};
export type PortfolioItem = {
  id: string;
  title: string;
  tools: string[];
  url: string;
  thumbnail_url: string;
  description: string;
};

/** Suggested skills and portfolio tools. */
export const TOOLS = [
  'Claude', 'Excel', 'SQL', 'Power BI', 'Python', 'Tableau',
  'Perplexity AI', 'Zapier', 'Databricks', 'AWS', 'Azure',
];

/** A field inside a grey entry panel takes the card colour. */
export const panelField = (C: ThemeColors) => ({ ...inputStyle(C), background: C.card });

/** One education, job or portfolio entry: a grey panel with a remove button. */
export function EntryCard({ children, onDelete, label, C }: { children: ReactNode; onDelete: () => void; label: string; C: ThemeColors }) {
  const P = palette(C);
  return (
    <div className="rounded-xl p-4 flex items-start gap-3" style={{ background: C.page }}>
      <div className="flex-1 min-w-0 grid gap-4">{children}</div>
      <button type="button" onClick={onDelete} aria-label={label} title={label}
        className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: P.badSoft, color: P.bad }}>
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
