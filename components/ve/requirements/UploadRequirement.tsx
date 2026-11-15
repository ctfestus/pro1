'use client';

import { useState } from 'react';
import { Loader2, AlertTriangle, Link as LinkIcon, Upload as UploadIcon, FileText } from 'lucide-react';
import { repairVeSubmissionUrl, VE_SUBMISSION_ACCEPT } from '@/lib/ve-upload';
import { firstNameOf } from '@/components/ve/workplace';
import type { RequirementProps } from './types';
import { TaskHeader, taskTheme, fieldStyle } from './TaskCard';

/** File upload or shared link. */
export function UploadRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, manager, progress, handleFileUpload, setUploadLink, uploadingReq, uploadErrors,
  } = ctx;
  const [dragging, setDragging] = useState(false);
  const done      = !!progress[req.id]?.completed;
  const fileUrl   = progress[req.id]?.fileUrl || '';
  const linkUrl   = progress[req.id]?.linkUrl || '';
  const uploading = uploadingReq === req.id;
  const t = taskTheme(isDark, accentColor);
  const fileName = (() => { try { return decodeURIComponent(fileUrl.split('/').pop()?.split('?')[0] || ''); } catch { return ''; } })() || 'Your file';
  const inputId = `ve-upload-${req.id}`;

  const fileInput = (
    <input id={inputId} type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden" disabled={uploading}
      onChange={async e => { const f = e.target.files?.[0]; if (f) await handleFileUpload(req.id, f); e.target.value = ''; }} />
  );

  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <TaskHeader t={t} icon={<UploadIcon className="w-3.5 h-3.5" />} label="Upload" title={req.label}
        description={req.description} done={done ? 'Sent' : null} />

      {fileUrl ? (
        // Sent: the file, who it went to, and a way to swap it.
        <div className="flex items-center gap-3 rounded-[10px] px-3 py-2.5" style={{ background: t.soft }}>
          <FileText className="w-4 h-4 flex-shrink-0" style={{ color: t.muted }} />
          <span className="min-w-0 flex-1">
            <a href={repairVeSubmissionUrl(fileUrl)} target="_blank" rel="noreferrer"
              className="block truncate text-[13.5px] font-semibold hover:underline" style={{ color: t.text }}>{fileName}</a>
            <span className="text-[12px]" style={{ color: t.muted }}>Sent to {firstNameOf(manager.name)}</span>
          </span>
          <label htmlFor={inputId} className="flex-shrink-0 cursor-pointer text-[12.5px] font-semibold underline underline-offset-2" style={{ color: t.muted }}>
            {uploading ? 'Uploading...' : 'Replace'}
          </label>
          {fileInput}
        </div>
      ) : (
        <label htmlFor={inputId}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={async e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f && !uploading) await handleFileUpload(req.id, f); }}
          className="flex cursor-pointer items-center justify-center gap-2.5 rounded-[10px] px-4 py-3.5 text-[13.5px] transition-colors"
          style={{ background: t.soft, border: `1.5px dashed ${dragging ? accentColor : isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.14)'}`, color: t.muted }}>
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: accentColor }} /> : <UploadIcon className="w-4 h-4" />}
          <span>{uploading ? 'Uploading...' : <><b style={{ color: t.text, fontWeight: 600 }}>Choose a file</b> or drop it here</>}</span>
          {fileInput}
        </label>
      )}
      {uploadErrors[req.id] && <p role="alert" className="text-[12.5px] flex items-center gap-1.5" style={{ color: t.bad }}><AlertTriangle className="w-3.5 h-3.5" />{uploadErrors[req.id]}</p>}

      <div className="flex items-center gap-2 rounded-[10px] px-3" style={fieldStyle(t, linkUrl ? 'done' : 'normal')}>
        <LinkIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: t.faint }} />
        <input type="url" value={linkUrl} onChange={e => setUploadLink(req.id, e.target.value)}
          placeholder={fileUrl ? 'Or share a link instead' : 'Or paste a link (Google Drive, GitHub...)'}
          aria-label="Or paste a link"
          className="flex-1 min-w-0 bg-transparent py-2.5 text-[13.5px] outline-none" style={{ color: t.text }} />
      </div>
    </div>
  );
}
