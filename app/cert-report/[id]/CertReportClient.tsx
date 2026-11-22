'use client';

// The public certification report: the score dial and the skill bars, with the share actions at the
// top, in the shared credential page frame (components/credential/PublicCredential).

import { useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { useC } from '@/lib/theme';
import type { CertReportData } from '@/lib/cert-report';
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';
import { DISPLAY_FONT, btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { ArrowSquareOut, CalendarBlank, Check, CheckCircle, LinkSimple, LinkedinLogo, SealCheck, XCircle } from '@phosphor-icons/react';
import { CARD_SHADOW, CredentialShell, usePageUrl } from '@/components/credential/PublicCredential';

export default function CertReportClient({ data }: { data: CertReportData }) {
  const C = useC();
  const P = palette(C);
  const { appName, orgName } = useTenant();
  const org = orgName || appName || '';
  const pageUrl = usePageUrl();
  const origin = pageUrl ? new URL(pageUrl).origin : '';
  const reportUrl = `${origin}/cert-report/${data.certId}`;
  const certUrl = `${origin}/certificate/${data.certId}`;
  const [copied, setCopied] = useState(false);
  const copyLink = () => navigator.clipboard?.writeText(reportUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});

  // Half dial: the green fill is the score; the tick marks the pass mark.
  const gCx = 108, gCy = 108, gR = 88, gStroke = 15;
  const gArc = Math.PI * gR;
  const scoreFrac = Math.max(0, Math.min(100, data.score)) / 100;
  const passFrac = Math.max(0, Math.min(100, data.passmark)) / 100;
  const pcos = Math.cos(passFrac * Math.PI), psin = Math.sin(passFrac * Math.PI);
  const tickIn = gR - gStroke / 2 - 2, tickOut = gR + gStroke / 2 + 2;
  const gaugePath = `M ${gCx - gR} ${gCy} A ${gR} ${gR} 0 0 1 ${gCx + gR} ${gCy}`;
  const skills = [...data.skills].sort((a, b) => b.pct - a.pct);
  const initials = data.studentName.split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
  const card = `rounded-2xl p-5 ${CARD_SHADOW}`;

  return (
    <CredentialShell>
      <div className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {data.badgeImageUrl && <img src={data.badgeImageUrl} alt="" className="h-14 w-14 flex-shrink-0 object-contain"/>}
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: C.muted }}>Assessment report</p>
              <h1 className="mt-1 text-[28px] font-semibold leading-9" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{data.certTitle}</h1>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" style={{ color: C.muted }}>
                <span className="inline-flex items-center gap-2">
                  <span className="grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold" style={{ background: C.pill, color: C.text }}>{initials}</span>
                  <b className="font-semibold" style={{ color: C.text }}>{data.studentName}</b>
                </span>
                <span className="inline-flex items-center gap-1.5"><CalendarBlank size={14} weight="bold"/>{data.issueDate}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={origin ? linkedInAddCertUrl({ name: data.certTitle, organizationName: org || undefined, issuedAt: data.issuedAt, certId: data.certId, certUrl }) : '#'}
              target="_blank" rel="noopener noreferrer" className={btnClass} style={btnStyle('sec', C)}>
              <LinkedinLogo size={16} weight="fill" style={{ color: '#0A66C2' }}/> Add to LinkedIn
            </a>
            <a href={origin ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(reportUrl)}` : '#'}
              target="_blank" rel="noopener noreferrer" className={btnClass} style={btnStyle('sec', C)}>
              <LinkedinLogo size={16} weight="fill" style={{ color: '#0A66C2' }}/> Share a post
            </a>
            <button type="button" onClick={copyLink} className={btnClass} style={btnStyle('sec', C)}>
              {copied ? <Check size={15} weight="bold" style={{ color: P.good }}/> : <LinkSimple size={15} weight="bold"/>}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a href={`/certificate/${data.certId}`} target="_blank" rel="noopener noreferrer" className={btnClass} style={btnStyle('sec', C)}>
              <ArrowSquareOut size={15} weight="bold"/> View certificate
            </a>
          </div>
        </div>

        <div className={`${card} flex flex-wrap items-center gap-6`} style={{ background: C.card }}>
          <div className="relative h-[122px] w-[216px] flex-shrink-0">
            <svg width="216" height="122" viewBox="0 0 216 118" aria-hidden>
              <path d={gaugePath} fill="none" stroke={C.pill} strokeWidth={gStroke} strokeLinecap="round"/>
              <path d={gaugePath} fill="none" stroke={P.good} strokeWidth={gStroke} strokeLinecap="round" strokeDasharray={`${scoreFrac * gArc} ${gArc}`}/>
              <line x1={gCx - tickIn * pcos} y1={gCy - tickIn * psin} x2={gCx - tickOut * pcos} y2={gCy - tickOut * psin} stroke={C.text} strokeWidth={3} strokeLinecap="round"/>
            </svg>
            <div className="absolute inset-x-0 bottom-0.5 flex flex-col items-center">
              <span className="text-[32px] font-semibold leading-none" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{data.score}%</span>
              <span className="mt-1 text-xs" style={{ color: C.muted }}>Overall score</span>
            </div>
          </div>
          <div className="min-w-0 flex-[1_1_240px]">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold leading-6"
              style={data.passed ? { color: P.good, background: C.card, boxShadow: `inset 0 0 0 1px ${P.goodSoft}` } : { color: P.bad, background: P.badSoft }}>
              {data.passed ? <CheckCircle size={14} weight="fill"/> : <XCircle size={14} weight="fill"/>}
              {data.passed ? 'Passed' : 'Not passed'}
            </span>
            <p className="mt-2.5 text-[15px]" style={{ color: C.text }}>
              Scored <b>{data.correctQuestions} of {data.totalQuestions}</b> questions correct.
            </p>
            <p className="mt-1 text-[13px]" style={{ color: C.muted }}>Pass mark {data.passmark}%, marked on the dial and each skill bar.</p>
          </div>
        </div>

        {skills.length > 0 && (
          <section className={card} style={{ background: C.card }}>
            <h2 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>By skill</h2>
            <p className="mb-3 mt-0.5 text-xs" style={{ color: C.muted }}>Strongest first. Bars below the pass mark are in amber.</p>
            {skills.map(s => {
              const fill = s.pct >= data.passmark ? P.good : P.warn;
              return (
                <div key={s.id} className="grid grid-cols-[110px_minmax(0,1fr)_40px] items-center gap-3 py-1.5 text-[13px] sm:grid-cols-[170px_minmax(0,1fr)_44px]">
                  <span className="truncate" style={{ color: C.text }}>{s.name}</span>
                  <span className="relative h-2 rounded-full" style={{ background: C.pill, boxShadow: 'inset 0 1px 2px rgba(15,23,42,0.12)' }}>
                    <span className="absolute inset-y-0 left-0 rounded-full"
                      style={{ width: `${s.pct}%`, minWidth: s.pct > 0 ? 8 : 0, background: `linear-gradient(90deg, color-mix(in srgb, ${fill} 70%, #ffffff), ${fill})` }}/>
                    <span title={`Pass mark ${data.passmark}%`} className="absolute -top-[3px] -bottom-[3px] w-0.5 -translate-x-1/2 rounded" style={{ left: `${data.passmark}%`, background: C.text, opacity: 0.55 }}/>
                  </span>
                  <b className="text-right font-semibold tabular-nums" style={{ color: C.text }}>{s.pct}%</b>
                </div>
              );
            })}
          </section>
        )}

        <p className="flex items-start gap-1.5 text-xs" style={{ color: C.muted }}>
          <SealCheck size={14} weight="fill" className="mt-px flex-shrink-0" style={{ color: P.good }}/>
          <span>Verified credential. ID <span className="font-mono" style={{ color: C.text }}>{data.certId}</span>{org ? `, issued by ${org}.` : '.'}</span>
        </p>
      </div>
    </CredentialShell>
  );
}
