"use client";

// The public credential page for an open certificate (events, workshops), on the shared credential
// layout (components/credential/PublicCredential). A credential can be a certificate, a badge or both.

import { useRef, useState } from "react";
import { CertificateSettings } from "@/components/CertificateTemplate";
import { sanitizeRichText } from "@/lib/sanitize";
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';
import { useTenant } from "@/components/TenantProvider";
import { useC } from "@/lib/theme";
import {
  ArtSwitch, AwardedTo, BadgeArt, CredentialActions, CredentialFacts, CredentialLayout, CredentialShell, CredentialTitle,
  IssuerNote, PdfSource, ScaledCertificate, SkillChips, TypePill, downloadCertificatePdf, downloadImage, type DownloadOption,
} from "@/components/credential/PublicCredential";

type IssueMode = 'certificate_only' | 'badge_only' | 'both';

interface Props {
  certId:        string;
  recipientName: string;
  programName:   string;
  issuedDate:    string;
  issuedAt:      string;
  settings:      CertificateSettings;
  description?:  string | null;
  skills?:       string[];
  badgeImageUrl?: string | null;
  issueMode:     IssueMode;
}

const MODE_LABEL: Record<IssueMode, string> = { certificate_only: 'Certificate', badge_only: 'Badge', both: 'Certificate and badge' };

export default function OpenCertPageClient({
  certId, recipientName, programName, issuedDate, issuedAt, settings,
  description, skills, badgeImageUrl, issueMode,
}: Props) {
  const C = useC();
  const { orgName, appName } = useTenant();
  const certRef = useRef<HTMLDivElement>(null);
  const showCert  = issueMode === 'certificate_only' || issueMode === 'both';
  const showBadge = issueMode === 'badge_only'       || issueMode === 'both';
  const [view, setView] = useState<'certificate' | 'badge'>(showCert ? 'certificate' : 'badge');
  const template = { certId, studentName: recipientName, courseName: programName, issueDate: issuedDate, settings };
  const issuer = settings.institutionName || orgName || appName || '';
  const slug = programName.replace(/\s+/g, '-').toLowerCase();

  const downloads: DownloadOption[] = [
    ...(showCert ? [{ label: 'Certificate (PDF)', run: () => downloadCertificatePdf(certRef.current, `${slug}-certificate.pdf`) }] : []),
    ...(showBadge && badgeImageUrl ? [{ label: 'Badge (image)', run: () => downloadImage(badgeImageUrl, `${slug}-badge.png`) }] : []),
  ];
  const linkedIn = (certUrl: string) => linkedInAddCertUrl({ name: programName, organizationName: issuer || undefined, issuedAt, certId, certUrl });
  const descriptionHtml = description
    ? sanitizeRichText(description.includes('<') ? description : description.replace(/\n/g, '<br/>'))
    : '';

  return (
    <CredentialShell>
      <style>{`
        .cert-desc p { margin: 0 0 6px; }
        .cert-desc ul { list-style-type: disc; padding-left: 22px; margin: 0 0 6px; }
        .cert-desc ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 6px; }
        .cert-desc li { margin-bottom: 2px; display: list-item; }
        .cert-desc p:last-child, .cert-desc li:last-child { margin-bottom: 0; }
      `}</style>
      <CredentialLayout art={
        <>
          {view === 'certificate' && showCert
            ? <ScaledCertificate {...template}/>
            : <BadgeArt imageUrl={badgeImageUrl} name={programName} tint={settings.primaryColor}/>}
          {showCert && showBadge && <ArtSwitch value={view} onChange={setView}/>}
        </>
      }>
        <TypePill>{MODE_LABEL[issueMode]}</TypePill>
        <CredentialTitle>{programName}</CredentialTitle>
        {/* Recipients of an open credential may have no account, so there is no profile to link. */}
        <AwardedTo name={recipientName}/>
        <CredentialFacts date={issuedDate} id={certId}/>
        <CredentialActions downloads={downloads} linkedIn={linkedIn}/>
        {descriptionHtml && (
          <div className="cert-desc text-sm leading-relaxed" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: descriptionHtml }}/>
        )}
        <SkillChips skills={skills ?? []}/>
        <IssuerNote issuer={issuer}/>
      </CredentialLayout>
      {showCert && <PdfSource nodeRef={certRef} {...template}/>}
    </CredentialShell>
  );
}
