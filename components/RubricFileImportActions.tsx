'use client';

import { useRef } from 'react';
import { FileText, Loader2, Upload } from 'lucide-react';
import type { RubricImportKind } from '@/lib/rubric-criteria';

interface RubricFileImportActionsProps {
  busy: RubricImportKind | null;
  disabled?: boolean;
  background: string;
  color: string;
  border?: string;
  onSelect: (kind: RubricImportKind, file: File) => void | Promise<void>;
}

const REFERENCE_FILE_TYPES = '.xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.docx';

export function RubricFileImportActions({
  busy,
  disabled = false,
  background,
  color,
  border = 'none',
  onSelect,
}: RubricFileImportActionsProps) {
  const referenceRef = useRef<HTMLInputElement>(null);
  const rubricRef = useRef<HTMLInputElement>(null);
  const blocked = disabled || busy !== null;

  const choose = async (kind: RubricImportKind, file: File | undefined, input: HTMLInputElement) => {
    input.value = '';
    if (!file || blocked) return;
    await onSelect(kind, file);
  };

  const buttonStyle = {
    background,
    color,
    border,
    opacity: blocked ? 0.5 : 1,
    cursor: blocked ? 'not-allowed' : 'pointer',
  };

  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={referenceRef}
        type="file"
        accept={REFERENCE_FILE_TYPES}
        className="hidden"
        onChange={event => void choose('reference_solution', event.target.files?.[0], event.target)}
      />
      <input
        ref={rubricRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={event => void choose('rubric', event.target.files?.[0], event.target)}
      />
      <button
        type="button"
        disabled={blocked}
        onClick={() => referenceRef.current?.click()}
        className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity"
        style={buttonStyle}>
        {busy === 'reference_solution'
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Extracting...</>
          : <><Upload className="h-3 w-3" /> Upload reference solution</>}
      </button>
      <button
        type="button"
        disabled={blocked}
        onClick={() => rubricRef.current?.click()}
        className="flex min-h-10 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-opacity"
        style={buttonStyle}>
        {busy === 'rubric'
          ? <><Loader2 className="h-3 w-3 animate-spin" /> Importing...</>
          : <><FileText className="h-3 w-3" /> Import rubric (.md)</>}
      </button>
    </div>
  );
}

