import CertificatePageClient from "./CertificatePageClient";
import { CertificateSettings, DEFAULT_CERT_SETTINGS } from "@/components/CertificateTemplate";
import { loadCertificate } from "@/lib/certificate";

// Server component: the certificate is fetched and rendered on the server so it
// appears in the initial HTML (no client-side spinner) -- important for a public
// page people open from shared links.

function Notice({ heading, body }: { heading: string; body: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center p-8 max-w-sm">
        <h1 className="text-xl font-bold text-gray-800 mb-2">{heading}</h1>
        <p className="text-gray-500 text-sm">{body}</p>
      </div>
    </div>
  );
}

export default async function CertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadCertificate(id);

  if (result.status === "revoked") {
    return <Notice heading="Certificate Revoked" body="This certificate has been revoked by the issuer." />;
  }
  if (result.status === "notfound") {
    return <Notice heading="Certificate Not Found" body="This certificate ID does not exist." />;
  }
  if (result.status === "unavailable") {
    return <Notice heading="Certificate Unavailable" body="We could not load this certificate right now. Please refresh the page to try again." />;
  }

  const { settings, ...rest } = result.data;
  return <CertificatePageClient {...rest} settings={(settings ?? DEFAULT_CERT_SETTINGS) as CertificateSettings} />;
}
