'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { ApplicationRelatedCards } from '@/components/ApplicationRelatedCards';
import { ApplicationFramedImage } from '@/components/ApplicationFramedImage';
import { applicationCoverFrame } from '@/lib/application-cover';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { applicationThemeColors } from '@/lib/application-theme-presets';
import { useC, cardStyle } from '@/lib/theme';

export function ApplicationPortal({ token }: { token: string }) {
  const baseC = useC();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`/api/public/applications/${encodeURIComponent(token)}`)
      .then(async response => ({ ok: response.ok, value: await response.json() }))
      .then(({ ok, value }) => {
        if (!ok) throw new Error(value.error || 'Application not found.');
        setData(value);
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center" style={{ background: baseC.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: baseC.cta }} /></div>;
  }
  if (!data) {
    return <div className="min-h-screen grid place-items-center px-4" style={{ background: baseC.page, color: baseC.errorText }}>{message}</div>;
  }

  const { form, submission } = data;
  // The application's own look (colours, light or dark, cover framing), as on the form itself.
  const C = applicationThemeColors(baseC, form.config.themeColor, form.config.theme ?? 'platform', form.config.customTheme, form.config.themeMode ?? 'light');
  const pageStyle = { background: C.page };
  if (submission.state !== 'submitted') {
    return (
      <main className="application-theme-scope platform-font-scope min-h-screen px-4 py-10" style={pageStyle}>
        <div className="max-w-xl mx-auto rounded-xl p-7 text-center" style={cardStyle(C)}>
          <h1 className="text-xl font-bold" style={{ color: C.text }}>Application not submitted</h1>
          <p className="text-sm mt-2" style={{ color: C.muted }}>Complete the application in one session using the registration form.</p>
          <a href={`/apply/${encodeURIComponent(form.slug)}`} className="inline-flex items-center gap-2 mt-5 rounded-xl px-5 py-3 text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Open registration form</a>
        </div>
      </main>
    );
  }

  const post = form.config.postSubmission;
  const coverImage = form.config.coverImage?.trim();
  const coverAlt = form.config.coverImageAlt?.trim() || `${form.config.title} cover`;
  const accepted = submission.accepted === true;
  return (
    <main className="application-theme-scope platform-font-scope min-h-screen px-4 py-10" style={pageStyle}>
      <div className="max-w-2xl mx-auto space-y-4">
        {coverImage && <ApplicationFramedImage src={coverImage} alt={coverAlt} frame={applicationCoverFrame(form.config)} className="h-44 sm:h-56" style={{ ...cardStyle(C), background: C.skeleton, borderRadius: 12 }} />}
        <div className="rounded-xl p-7 sm:p-9 text-center" style={cardStyle(C)}>
          {accepted
            ? <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: C.successText }} />
            : <FileText className="w-14 h-14 mx-auto mb-4" style={{ color: C.muted }} />}
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Application status</h1>
          <p className="mt-2 text-sm" style={{ color: C.muted }}>{form.config.title}</p>
          <div className="mt-6 grid sm:grid-cols-2 gap-3 text-left">
            <div className="rounded-xl p-4" style={{ background: C.input }}><p className="text-xs" style={{ color: C.faint }}>Reference number</p><p className="font-bold mt-1" style={{ color: C.text }}>{submission.reference}</p></div>
            <div className="rounded-xl p-4" style={{ background: C.input }}><p className="text-xs" style={{ color: C.faint }}>Current status</p><p className="font-bold mt-1" style={{ color: accepted ? C.successText : C.text }}>{submission.status}</p></div>
          </div>
        </div>
        {post.type === 'notice' && <div className="rounded-xl p-5" style={cardStyle(C)}><h2 className="font-bold" style={{ color: C.text }}>{post.noticeTitle || 'What happens next'}</h2><p className="text-sm mt-2 whitespace-pre-line" style={{ color: C.muted }}>{post.noticeBody}</p></div>}
        {post.type === 'button' && post.buttonUrl && <a href={post.buttonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl p-3 font-semibold text-sm" style={{ background: C.cta, color: C.ctaText }}>{post.buttonLabel || 'Continue'} <ExternalLink className="w-4 h-4" /></a>}
        {post.type === 'events' && data.relatedItems?.length > 0 && <div className="rounded-xl p-5" style={cardStyle(C)}><h2 className="mb-4 font-bold" style={{ color: C.text }}>You might also like</h2><ApplicationRelatedCards items={data.relatedItems as ApplicationRelatedItem[]} C={C} /></div>}
      </div>
    </main>
  );
}
