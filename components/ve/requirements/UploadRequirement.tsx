'use client';

import { CheckCircle2, Loader2, AlertTriangle, Link as LinkIcon, Upload as UploadIcon } from 'lucide-react';
import { repairVeSubmissionUrl, VE_SUBMISSION_ACCEPT } from '@/lib/ve-upload';
import type { RequirementProps } from './types';

/** File upload or shared link. */
export function UploadRequirement({ req, rowStyle, ctx }: RequirementProps) {
  const {
    isDark, accentColor, fieldBg, fieldBorder, fieldShadow, progress, handleFileUpload,
    setUploadLink, uploadingReq, uploadErrors,
  } = ctx;
  const done           = !!progress[req.id]?.completed;

  const fileUrl  = progress[req.id]?.fileUrl || '';
  const linkUrl  = progress[req.id]?.linkUrl || '';
  const uploading = uploadingReq === req.id;
  return (
    <div style={rowStyle} className="px-4 sm:px-8 py-5 space-y-3">
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded mt-0.5 flex-shrink-0"
          style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }}>Upload</span>
        <div className="flex-1 min-w-0">
          <p className="text-[14.5px] font-semibold" style={{ color: isDark ? '#f0f0f0' : '#111' }}>{req.label}</p>
          {req.description && <p className="text-[12.5px] mt-0.5 leading-snug" style={{ color: isDark ? '#888' : '#666' }}>{req.description}</p>}
        </div>
        {done && <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: accentColor }} />}
      </div>

      <label className="block cursor-pointer">
        <div className="rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1.5 py-5 px-4 transition-all hover:opacity-80"
          style={{
            borderColor: fileUrl ? accentColor : fieldBorder,
            background: fileUrl ? `${accentColor}0d` : fieldBg,
            boxShadow: fieldShadow,
          }}>
          {uploading
            ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: accentColor }} />
            : fileUrl
              ? <CheckCircle2 className="w-4 h-4" style={{ color: accentColor }} />
              : <UploadIcon className="w-4 h-4" style={{ color: isDark ? '#666' : '#aaa' }} />}
          <p className="text-[12.5px] font-medium text-center" style={{ color: fileUrl ? accentColor : isDark ? '#666' : '#aaa' }}>
            {fileUrl ? 'File uploaded. Click to replace.' : 'Click to upload your file'}
          </p>
          {fileUrl && (
            <a href={repairVeSubmissionUrl(fileUrl)} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-[11px] underline" style={{ color: accentColor }}>
              View uploaded file
            </a>
          )}
        </div>
        <input type="file" accept={VE_SUBMISSION_ACCEPT} className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) await handleFileUpload(req.id, f); e.target.value = ''; }} />
      </label>
      {uploadErrors[req.id] && <p role="alert" className="text-[12px] mt-2 flex items-center gap-1.5" style={{ color: '#ef4444' }}><AlertTriangle className="w-3.5 h-3.5" />{uploadErrors[req.id]}</p>}

      <div className="space-y-1">
        <p className="text-[12.5px] font-medium" style={{ color: isDark ? '#888' : '#666' }}>Or share a link</p>
        <div className="ve-field-shell flex items-center gap-2 px-3 py-2 rounded-lg"
          style={{
            background: fieldBg,
            border: `1.5px solid ${linkUrl ? `${accentColor}80` : fieldBorder}`,
            boxShadow: fieldShadow,
          }}>
          <LinkIcon className="w-3 h-3 flex-shrink-0" style={{ color: isDark ? '#666' : '#aaa' }} />
          <input type="url" value={linkUrl} onChange={e => setUploadLink(req.id, e.target.value)}
            placeholder="https://docs.google.com/... or GitHub link..."
            className="flex-1 bg-transparent text-[12.5px] outline-none"
            style={{ color: isDark ? '#f0f0f0' : '#111' }} />
        </div>
      </div>
    </div>
  );
}
