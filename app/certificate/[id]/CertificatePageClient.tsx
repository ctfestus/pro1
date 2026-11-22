"use client";

// The public certificate page for a course, virtual experience, learning path or certification,
// on the shared credential layout (components/credential/PublicCredential).

import { useRef, useState } from "react";
import { type CertificateSettings } from "@/components/CertificateTemplate";
import { resolveCoverUrl } from "@/lib/cloudinary-url";
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';
import { useTenant } from "@/components/TenantProvider";
import { useC } from "@/lib/theme";
import { BookOpen } from "@phosphor-icons/react";
import {
  ArtSwitch, AwardedTo, BadgeArt, CredentialActions, CredentialFacts, CredentialLayout, CredentialShell, CredentialTitle,
  IssuerNote, PdfSource, ScaledCertificate, SkillChips, TypePill, downloadCertificatePdf, downloadImage, type DownloadOption,
} from "@/components/credential/PublicCredential";

interface Props {
  certId:            string;
  studentName:       string;
  studentAvatarUrl?: string | null;
  studentUsername?:  string | null;
  courseName:        string;
  issueDate:         string;
  settings:          CertificateSettings;
  issuedAt:          string;
  certType:          'course' | 'virtual_experience' | 'learning_path' | 'certification';
  badgeImageUrl?:    string | null;
  partnerName?:      string | null;
  partnerLogoUrl?:   string | null;
  pathItems?:        { id: string; title: string; coverImage: string | null }[];
  pathCoverImage?:   string | null;
  /** The tags (a learning path's skills) its instructor set on the content. */
  skills?:           string[];
}

const TYPE_LABEL: Record<Props['certType'], string> = {
  course: 'Course', virtual_experience: 'Virtual experience', learning_path: 'Learning path', certification: 'Certification',
};

export default function CertificatePageClient({
  certId, studentName, studentAvatarUrl, studentUsername, courseName, issueDate, settings, issuedAt,
  certType, badgeImageUrl, partnerName, partnerLogoUrl, pathItems, pathCoverImage, skills = [],
}: Props) {
  const C = useC();
  const { orgName, appName } = useTenant();
  const certRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<'certificate' | 'badge'>('certificate');
  const template = { certId, studentName, courseName, issueDate, partnerName, partnerLogoUrl, settings };
  const issuer = settings.institutionName || orgName || appName || '';
  const slug = courseName.replace(/\s+/g, '-').toLowerCase();

  const downloads: DownloadOption[] = [
    { label: 'Certificate (PDF)', run: () => downloadCertificatePdf(certRef.current, `certificate-${slug}.pdf`) },
    ...(badgeImageUrl ? [{ label: 'Badge (image)', run: () => downloadImage(badgeImageUrl, `${slug}-badge.png`) }] : []),
  ];
  const linkedIn = (certUrl: string) => linkedInAddCertUrl({ name: courseName, organizationName: issuer || undefined, issuedAt, certId, certUrl });

  return (
    <CredentialShell>
      <CredentialLayout art={
        <>
          {view === 'certificate' ? <ScaledCertificate {...template}/> : <BadgeArt imageUrl={badgeImageUrl} name={courseName}/>}
          {badgeImageUrl && <ArtSwitch value={view} onChange={setView}/>}
        </>
      }>
        <TypePill>{TYPE_LABEL[certType]}</TypePill>
        <CredentialTitle>{courseName}</CredentialTitle>
        <AwardedTo name={studentName} avatarUrl={studentAvatarUrl} username={studentUsername}/>
        <CredentialFacts date={issueDate} id={certId}/>
        <CredentialActions downloads={downloads} linkedIn={linkedIn}/>
        <SkillChips skills={skills}/>

        {certType === 'learning_path' && (pathCoverImage || (pathItems?.length ?? 0) > 0) && (
          <div>
            <p className="mb-1 text-[13px] font-semibold" style={{ color: C.text }}>In this learning path</p>
            {pathCoverImage && (
              <img src={resolveCoverUrl(pathCoverImage)} alt="" className="mb-2 h-24 w-full rounded-lg object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>
            )}
            {/* A timeline: one numbered step per item, in the path's order, joined by a dashed line; green, as
                every step of a certified path is done. */}
            <ol className="relative">
              {pathItems?.map((item, i) => (
                <li key={item.id ?? i} className="relative flex items-center gap-3 pb-5 last:pb-0">
                  {i < (pathItems?.length ?? 0) - 1 && (
                    <span aria-hidden className="absolute left-[13px] top-7 bottom-0" style={{ borderLeft: '2px dashed rgba(18,161,80,0.45)' }}/>
                  )}
                  <span className="relative z-10 grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums"
                    style={{ background: 'color-mix(in srgb, #12A150 14%, ' + C.card + ')', color: '#12A150' }}>
                    {i + 1}
                  </span>
                  <span className="grid h-8 w-12 flex-shrink-0 place-items-center overflow-hidden rounded-md" style={{ background: C.pill, color: C.faint }}>
                    {item.coverImage
                      ? <img src={resolveCoverUrl(item.coverImage)} alt="" className="h-full w-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>
                      : <BookOpen size={14} weight="duotone"/>}
                  </span>
                  <span className="line-clamp-2 min-w-0 text-[13px] font-medium" style={{ color: C.text }}>{item.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <IssuerNote issuer={issuer}/>
      </CredentialLayout>
      <PdfSource nodeRef={certRef} {...template}/>
    </CredentialShell>
  );
}
