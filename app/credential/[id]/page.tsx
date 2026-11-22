import OpenCertPageClient from "../../open-cert/[id]/OpenCertPageClient";
import { CertificateSettings, DEFAULT_CERT_SETTINGS } from "@/components/CertificateTemplate";
import { loadOpenCert } from "@/lib/open-cert";

// Server component: the credential is fetched and rendered on the server so it
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

export default async function CredentialPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadOpenCert(id);

  if (result.status === "revoked") {
    return <Notice heading="Credential revoked" body="This credential has been revoked by the issuer." />;
  }
  if (result.status === "notfound") {
    return <Notice heading="Credential not found" body="This credential ID does not exist." />;
  }

  const { settings, ...rest } = result.data;
  return <OpenCertPageClient {...rest} settings={(settings ?? DEFAULT_CERT_SETTINGS) as CertificateSettings} />;
}
