"use client";

// The public badge page, on the shared credential layout (components/credential/PublicCredential).

import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';
import { useTenant } from "@/components/TenantProvider";
import { useC } from "@/lib/theme";
import type { BadgeData } from "@/lib/badge";
import {
  AwardedTo, BadgeArt, CredentialActions, CredentialFacts, CredentialLayout, CredentialShell, CredentialTitle,
  IssuerNote, TypePill, downloadImage,
} from "@/components/credential/PublicCredential";

export default function BadgePageClient({ badgeId, data }: { badgeId: string; data: BadgeData }) {
  const C = useC();
  const { orgName, appName } = useTenant();
  const awarded = new Date(data.awardedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const slug = data.badgeName.replace(/\s+/g, '-').toLowerCase();
  // A badge drawn from an icon has no image file to save.
  const downloads = data.badgeImageUrl
    ? [{ label: 'Badge (image)', run: () => downloadImage(data.badgeImageUrl!, `${slug}-badge.png`) }]
    : [];
  const linkedIn = (certUrl: string) => linkedInAddCertUrl({ name: data.badgeName, issuedAt: data.awardedAt, certId: badgeId, certUrl });

  return (
    <CredentialShell>
      <CredentialLayout art={<BadgeArt imageUrl={data.badgeImageUrl} icon={data.badgeIcon} name={data.badgeName} tint={data.badgeColor}/>}>
        <TypePill>Badge</TypePill>
        <CredentialTitle>{data.badgeName}</CredentialTitle>
        {data.badgeDescription && <p className="text-sm" style={{ color: C.muted }}>{data.badgeDescription}</p>}
        <AwardedTo label="Earned by" name={data.studentName} avatarUrl={data.studentAvatarUrl} username={data.studentUsername}/>
        <CredentialFacts dateLabel="Awarded" date={awarded} idLabel="Badge ID" id={badgeId}/>
        <CredentialActions downloads={downloads} linkedIn={linkedIn}/>
        <IssuerNote issuer={orgName || appName || ''}/>
      </CredentialLayout>
    </CredentialShell>
  );
}
