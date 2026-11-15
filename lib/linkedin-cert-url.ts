// The LinkedIn "Add to profile" link that prefills the Licenses and Certifications form.
// Shared by the course and virtual experience completion screens and /api/linkedin.

export function linkedInAddCertUrl(opts: {
  name: string;
  certId: string;
  certUrl: string;
  organizationName?: string;
  /** When the certificate was issued; today when unknown. */
  issuedAt?: string | null;
}): string {
  const d = opts.issuedAt ? new Date(opts.issuedAt) : new Date();
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: opts.name,
    issueYear: String(d.getFullYear()),
    issueMonth: String(d.getMonth() + 1),
    certId: opts.certId,
    certUrl: opts.certUrl,
  });
  if (opts.organizationName) params.set('organizationName', opts.organizationName);
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}
