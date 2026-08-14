'use client';

import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import {
  X, ListChecks, PenLine, ArrowUpDown, Image as ImageIcon, Images,
  Code2, Bot, Table2, BarChart2, ScrollText, MessageSquareText,
  Database, Terminal, Download,
} from 'lucide-react';
import { LinkedInIcon } from '@/components/LinkedInIcon';
import { useTheme } from '@/components/ThemeProvider';
import type { QuestionType } from '@/lib/course-schema';

export type QuestionTypeOrDownloads = QuestionType | 'downloads' | 'linkedin_share';

export const TYPE_LABELS: Record<QuestionTypeOrDownloads, string> = {
  multiple_choice:    'Multiple Choice',
  fill_blank:         'Fill in the Blank',
  arrange:            'Arrange / Order',
  image:              'Image Options',
  image_choice:       'Image Question',
  code:               'Code Snippet',
  code_review:        'AI Code Review',
  excel_review:       'AI Excel Review',
  dashboard_critique: 'AI Dashboard Critique',
  document_review:    'AI Document Review',
  written_response:   'AI Written Response',
  sql_exercise:       'SQL Exercise',
  python_exercise:    'Python Exercise',
  downloads:          'Downloads',
  linkedin_share:     'LinkedIn Share',
};

type TypeEntry = { value: QuestionTypeOrDownloads; label: string; icon: React.ReactNode; wide?: boolean };

// Types only offered when a caller explicitly allows them (e.g. certifications), hidden by default.
const OPT_IN_TYPES = new Set<QuestionTypeOrDownloads>(['image_choice']);

// Standalone slide kinds rather than question types -- they carry no answer, so an existing question
// can never be "changed into" one. Gated together by the includeDownloads prop.
const SLIDE_ONLY_TYPES = new Set<QuestionTypeOrDownloads>(['downloads', 'linkedin_share']);

const CATEGORIES: Array<{ label: string; color: string; types: TypeEntry[] }> = [
  {
    label: 'Quiz',
    color: '#3b82f6',
    types: [
      { value: 'multiple_choice', label: 'Multiple Choice',   icon: <ListChecks  className="w-[15px] h-[15px]" /> },
      { value: 'fill_blank',      label: 'Fill in the Blank', icon: <PenLine     className="w-[15px] h-[15px]" /> },
      { value: 'arrange',         label: 'Arrange / Order',   icon: <ArrowUpDown className="w-[15px] h-[15px]" /> },
      { value: 'image',           label: 'Image Options',     icon: <Images      className="w-[15px] h-[15px]" /> },
      { value: 'image_choice',    label: 'Image Question',    icon: <ImageIcon   className="w-[15px] h-[15px]" /> },
    ],
  },
  {
    label: 'Coding',
    color: '#10b981',
    types: [
      { value: 'sql_exercise',    label: 'SQL Exercise',    icon: <Database className="w-[15px] h-[15px]" /> },
      { value: 'python_exercise', label: 'Python Exercise', icon: <Terminal  className="w-[15px] h-[15px]" /> },
      { value: 'code',            label: 'Code Snippet',    icon: <Code2     className="w-[15px] h-[15px]" /> },
    ],
  },
  {
    label: 'AI Review',
    color: '#f59e0b',
    types: [
      { value: 'code_review',        label: 'AI Code Review',        icon: <Bot        className="w-[15px] h-[15px]" /> },
      { value: 'excel_review',       label: 'AI Excel Review',       icon: <Table2     className="w-[15px] h-[15px]" /> },
      { value: 'dashboard_critique', label: 'AI Dashboard Critique', icon: <BarChart2  className="w-[15px] h-[15px]" /> },
      { value: 'document_review',    label: 'AI Document Review',    icon: <ScrollText className="w-[15px] h-[15px]" /> },
      { value: 'written_response',   label: 'AI Written Response',   icon: <MessageSquareText className="w-[15px] h-[15px]" /> },
    ],
  },
  {
    label: 'Resources',
    color: '#6b7280',
    types: [
      { value: 'downloads',      label: 'Downloads',     icon: <Download className="w-[15px] h-[15px]" /> },
      { value: 'linkedin_share', label: 'LinkedIn Share', icon: <LinkedInIcon className="w-[15px] h-[15px]" /> },
    ],
  },
];

interface QuestionTypePickerProps {
  onSelect: (type: QuestionTypeOrDownloads) => void;
  onClose: () => void;
  includeDownloads?: boolean;
  allowedTypes?: QuestionTypeOrDownloads[];   // when set, only these types are offered
}

export function QuestionTypePicker({ onSelect, onClose, includeDownloads = true, allowedTypes }: QuestionTypePickerProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const T = dark
    ? { bg: '#0f0f11', border: 'rgba(255,255,255,0.07)', shadow: '0 28px 60px -8px rgba(0,0,0,0.75)', text: '#ebebeb', muted: '#5a5a5a', divider: 'rgba(255,255,255,0.055)', cardBg: 'rgba(255,255,255,0.04)' }
    : { bg: '#ffffff',  border: 'rgba(0,0,0,0.08)',        shadow: '0 28px 60px -8px rgba(0,0,0,0.13)', text: '#111',    muted: '#aaa',    divider: 'rgba(0,0,0,0.065)',        cardBg: 'rgba(0,0,0,0.025)' };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.28)', backdropFilter: 'blur(2px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }}
        className="w-full overflow-y-auto flex flex-col"
        style={{ maxWidth: 432, maxHeight: '86vh', background: T.bg, border: `1px solid ${T.border}`, borderRadius: 14, boxShadow: T.shadow }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sticky top-0 flex-shrink-0"
          style={{ background: T.bg, borderBottom: `1px solid ${T.divider}`, height: 44 }}
        >
          <span style={{ fontSize: 11.5, fontWeight: 500, color: T.muted, letterSpacing: '0.01em' }}>Add content</span>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-md transition-opacity hover:opacity-50"
            style={{ color: T.muted }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Categories */}
        <div className="px-3.5 pb-3.5">
          {CATEGORIES.map((cat, catIdx) => {
            let types = includeDownloads ? cat.types : cat.types.filter(t => !SLIDE_ONLY_TYPES.has(t.value));
            if (allowedTypes) types = types.filter(t => allowedTypes.includes(t.value));
            // image_choice is opt-in (certifications): hidden unless explicitly allowed.
            else types = types.filter(t => !OPT_IN_TYPES.has(t.value));
            if (!types.length) return null;
            return (
              <div key={cat.label} style={{ marginTop: catIdx === 0 ? 14 : 12 }}>
                {/* Section label + rule */}
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: cat.color, flexShrink: 0 }}>
                    {cat.label}
                  </span>
                  <div style={{ flex: 1, height: 1, background: cat.color + '28' }} />
                </div>

                {/* 2-column grid */}
                <div className="grid grid-cols-2 gap-2">
                  {types.map(t => (
                    <TypeCard
                      key={t.value}
                      entry={t}
                      color={cat.color}
                      textColor={T.text}
                      cardBg={T.cardBg}
                      onSelect={() => { onSelect(t.value); onClose(); }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}

function TypeCard({ entry, color, textColor, cardBg, onSelect }: {
  entry: TypeEntry;
  color: string;
  textColor: string;
  cardBg: string;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex items-center gap-2.5 text-left"
      style={{
        gridColumn: entry.wide ? 'span 2' : undefined,
        padding: '9px 11px',
        borderRadius: 9,
        background: hovered ? `${color}0d` : cardBg,
        border: `1px solid ${hovered ? color + '40' : 'transparent'}`,
        transition: 'background 120ms ease, border-color 120ms ease',
      }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{
          width: 30,
          height: 30,
          borderRadius: 8,
          background: hovered ? `${color}24` : `${color}16`,
          color,
          transition: 'background 120ms ease',
        }}
      >
        {entry.icon}
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: textColor, lineHeight: 1.2, letterSpacing: '-0.01em' }}>
        {entry.label}
      </span>
    </button>
  );
}
