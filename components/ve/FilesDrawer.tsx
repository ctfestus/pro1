'use client';

import { useEffect } from 'react';
import { FileText, LinkSimple, X } from '@phosphor-icons/react';

export interface DrawerFile {
  key: string;
  name: string;
  /** Opens in a new tab. Absent when the file is produced on click (onOpen). */
  url?: string;
  onOpen?: () => void;
  /** Second line: which mission it belongs to, a description, a score. */
  detail?: string;
  isLink?: boolean;
}

const EXT_COLORS: Record<string, string> = {
  csv: '#15803D', xlsx: '#166534', xls: '#166534', pdf: '#B91C1C', doc: '#1D4ED8', docx: '#1D4ED8',
  ppt: '#C2410C', pptx: '#C2410C', png: '#7C3AED', jpg: '#7C3AED', jpeg: '#7C3AED', pbix: '#B45309', sql: '#0F766E', py: '#0F766E',
};

function FileRow({ file, isDark, text, faint }: { file: DrawerFile; isDark: boolean; text: string; faint: string }) {
  const ext = file.isLink ? '' : (file.name.split('.').pop() || '').toLowerCase().slice(0, 4);
  const color = EXT_COLORS[ext] || (isDark ? '#3f3f46' : '#64748b');
  const inner = (
    <>
      <span className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[9.5px] font-bold uppercase text-white"
        style={{ background: file.isLink ? (isDark ? '#3f3f46' : '#64748b') : color, fontFamily: 'var(--font-mono), monospace' }}>
        {file.isLink ? <LinkSimple weight="bold" className="w-4 h-4" /> : ext || <FileText weight="duotone" className="w-4 h-4" />}
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[13px] font-semibold truncate" style={{ color: text }}>{file.name}</span>
        {file.detail && <span className="block text-[11.5px] truncate" style={{ color: faint }}>{file.detail}</span>}
      </span>
    </>
  );
  const cls = 'w-full flex items-center gap-3 px-2.5 py-2 rounded-xl transition-colors';
  const style = { background: isDark ? 'rgba(255,255,255,0.04)' : '#F6F8FB' };
  if (file.url) return <a href={file.url} target="_blank" rel="noreferrer" className={cls} style={style}>{inner}</a>;
  return <button type="button" onClick={file.onOpen} className={cls} style={style}>{inner}</button>;
}

/**
 * Every file in the experience in one place: what has been shared with the learner so far, and
 * what they have sent. Reads what the experience and the learner's progress already hold.
 */
export function FilesDrawer({ open, onClose, shared, sent, isDark, text, muted }: {
  open: boolean;
  onClose: () => void;
  shared: DrawerFile[];
  sent: DrawerFile[];
  isDark: boolean;
  text: string;
  muted: string;
}) {
  const faint = isDark ? '#777' : '#8a929e';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className="fixed inset-0 z-[70] bg-black/40" onClick={onClose} />
      <aside role="dialog" aria-modal="true" aria-label="Files"
        className="fixed top-0 right-0 bottom-0 z-[71] w-full sm:w-[380px] flex flex-col"
        style={{ background: isDark ? '#1a1a1a' : '#ffffff', boxShadow: '-10px 0 30px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="text-[17px] font-semibold" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>Files</h2>
          <button onClick={onClose} aria-label="Close files" className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: muted }}>
            <X weight="bold" className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-24 sm:pb-6 flex flex-col gap-1.5">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] px-1 pt-1 pb-1" style={{ color: faint }}>Shared with you</p>
          {shared.length ? shared.map(f => <FileRow key={f.key} file={f} isDark={isDark} text={text} faint={faint} />)
            : <p className="text-[12.5px] px-1" style={{ color: faint }}>Nothing shared yet. Files arrive with your manager&apos;s messages.</p>}
          <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] px-1 pt-4 pb-1" style={{ color: faint }}>You sent</p>
          {sent.length ? sent.map(f => <FileRow key={f.key} file={f} isDark={isDark} text={text} faint={faint} />)
            : <p className="text-[12.5px] px-1" style={{ color: faint }}>Nothing sent yet. Your uploads and links show here.</p>}
        </div>
      </aside>
    </>
  );
}
