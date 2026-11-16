"use client";

import { useRef, useState, useEffect } from "react";
import CertificateTemplate, { CertificateSettings } from "@/components/CertificateTemplate";
import { resolveCoverUrl } from "@/lib/cloudinary-url";
import { Download, Loader2, Check, Link as LinkIcon } from "lucide-react";
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';

const CERT_W = 1860;
const CERT_H = 1200;

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
}

const CERT_TYPE_BADGE: Record<string, { label: string; bg: string; color: string; border: string }> = {
  course:             { label: 'Course',            bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
  virtual_experience: { label: 'Virtual Experience', bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' },
  learning_path:      { label: 'Learning Path',     bg: '#f1f5f9', color: '#475569', border: '#e2e8f0' },
  certification:      { label: 'Certification',     bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
};

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18}>
      <path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function CertificatePageClient({
  certId, studentName, studentAvatarUrl, studentUsername, courseName, issueDate, settings, issuedAt,
  certType, badgeImageUrl, partnerName, partnerLogoUrl, pathItems, pathCoverImage,
}: Props) {
  const certRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadingBadge, setDownloadingBadge] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'certificate' | 'badge'>('certificate');

  const [mainScale, setMainScale] = useState(0.38);
  // Read the page URL only after mount so SSR and the client's first render
  // agree (empty string). Setting it during render breaks hydration.
  const [certUrl, setCertUrl] = useState("");

  const THUMB_W  = 100;
  const thumbScale = THUMB_W / CERT_W;
  const thumbH     = Math.round(CERT_H * thumbScale);

  useEffect(() => {
    const calc = () => {
      const isMob  = window.innerWidth < 640;
      // On mobile thumbnails sit above (no width consumed); on desktop they're a left sidebar
      const sidebarW = isMob ? 0 : THUMB_W + 24;
      const availW   = Math.min(window.innerWidth - 32 - sidebarW, 760);
      setMainScale(Math.max(availW / CERT_W, 0.08));
    };
    calc();
    setCertUrl(window.location.href);
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const previewW = Math.round(CERT_W * mainScale);
  const previewH = Math.round(CERT_H * mainScale);


  const initials = studentName
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

  const handleDownload = async () => {
    if (!certRef.current) return;
    setDownloading(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF }   = await import("jspdf");
      await document.fonts.ready;
      const canvas  = await html2canvas(certRef.current, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdf     = new jsPDF({ orientation: "landscape", unit: "px", format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`certificate-${courseName.replace(/\s+/g, "-").toLowerCase()}.pdf`);
    } catch {
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadBadge = async () => {
    if (!badgeImageUrl) return;
    setDownloadingBadge(true);
    try {
      const res = await fetch(badgeImageUrl);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `${courseName.replace(/\s+/g, '-')}-badge.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
    } catch {
      alert('Badge download failed.');
    } finally {
      setDownloadingBadge(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(certUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const linkedInUrl = certUrl
    ? linkedInAddCertUrl({ name: courseName, organizationName: settings.institutionName, issuedAt, certId, certUrl })
    : "#";

  const certTypeMeta = CERT_TYPE_BADGE[certType];

  return (
    <div className="min-h-screen" style={{ background: '#F2F5FA' }}>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

        {/* Mobile: thumbnails above, main below. Desktop: thumbnails left, main right */}
        <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 items-start">

          {/* Thumbnails: horizontal row on mobile, vertical column on desktop */}
          <div className="flex flex-row sm:flex-col gap-3 flex-shrink-0 sm:w-[120px]">
            {/* Certificate thumbnail */}
            <button
              onClick={() => setActiveTab('certificate')}
              className="flex flex-col items-center gap-1 group"
            >
              <div
                style={{
                  width: THUMB_W,
                  height: thumbH,
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 6,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                  border: activeTab === 'certificate' ? '2px solid #00bf63' : '2px solid transparent',
                  opacity: activeTab === 'certificate' ? 1 : 0.55,
                  transition: 'opacity 0.15s, border-color 0.15s',
                }}
              >
                <div style={{ transform: `scale(${thumbScale})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H, pointerEvents: 'none' }}>
                  <CertificateTemplate
                    certId={certId}
                    studentName={studentName}
                    courseName={courseName}
                    issueDate={issueDate}
                    partnerName={partnerName}
                    partnerLogoUrl={partnerLogoUrl}
                    settings={settings}
                  />
                </div>
              </div>
              <span className="text-[11px] font-medium text-gray-500 group-hover:text-gray-800 transition-colors">Certificate</span>
            </button>

            {/* Badge thumbnail -- only if badgeImageUrl exists */}
            {badgeImageUrl && (
              <button
                onClick={() => setActiveTab('badge')}
                className="flex flex-col items-center gap-1 group"
              >
                <div
                  style={{
                    width: THUMB_W,
                    height: THUMB_W,
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: activeTab === 'badge' ? '2px solid #00bf63' : '2px solid transparent',
                    opacity: activeTab === 'badge' ? 1 : 0.55,
                    transition: 'opacity 0.15s, border-color 0.15s',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
                    background: '#f8fafc',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img src={badgeImageUrl} alt="Badge" className="w-full h-full object-contain" />
                </div>
                <span className="text-[11px] font-medium text-gray-500 group-hover:text-gray-800 transition-colors">Badge</span>
              </button>
            )}
          </div>

          {/* Main view */}
          <div className="flex-1 min-w-0 w-full">
            {activeTab === 'certificate' ? (
              <div
                style={{
                  width: previewW,
                  height: previewH,
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 10,
                  boxShadow: '0 8px 40px rgba(0,0,0,0.16)',
                  flexShrink: 0,
                  maxWidth: '100%',
                }}
              >
                <div style={{ transform: `scale(${mainScale})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H }}>
                  <CertificateTemplate
                    certId={certId}
                    studentName={studentName}
                    courseName={courseName}
                    issueDate={issueDate}
                    partnerName={partnerName}
                    partnerLogoUrl={partnerLogoUrl}
                    settings={settings}
                  />
                </div>
              </div>
            ) : (
              <div
                className="flex items-center justify-center rounded-2xl"
                style={{
                  width: previewW,
                  minHeight: Math.min(previewH, 340),
                  background: '#f1f5f9',
                  maxWidth: '100%',
                }}
              >
                {badgeImageUrl && (
                  <div style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.18))' }}>
                    <img
                      src={badgeImageUrl}
                      alt={`${courseName} badge`}
                      style={{ width: 'min(220px, 70vw)', height: 'auto', maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Below main content */}
        <div className="mt-6">
          {/* Course name + type badge */}
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{courseName}</h1>
            {certTypeMeta && (
              <span
                className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full"
                style={{
                  background: certTypeMeta.bg,
                  color: certTypeMeta.color,
                  border: `1px solid ${certTypeMeta.border}`,
                }}
              >
                {certTypeMeta.label}
              </span>
            )}
          </div>

          {/* Issued date + institution */}
          <p className="mt-1 text-xs text-gray-400">
            Issued on {issueDate} &middot; {settings.institutionName}
          </p>

          {/* Action buttons: 2-col grid on mobile, flex row on desktop */}
          <div className="mt-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-lg hover:brightness-95 disabled:opacity-60 transition-all" style={{ background: '#00bf63' }}
            >
              {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              <span>{downloading ? "Generating..." : "Download Certificate"}</span>
            </button>

            {badgeImageUrl && (
              <button
                onClick={handleDownloadBadge}
                disabled={downloadingBadge}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-white text-sm font-semibold rounded-lg hover:brightness-95 disabled:opacity-60 transition-all" style={{ background: '#3E93FF' }}
              >
                {downloadingBadge ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                <span>{downloadingBadge ? "Downloading..." : "Download Badge"}</span>
              </button>
            )}

            <a
              href={linkedInUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors" style={{ background: '#f4f5f7' }}
            >
              <LinkedInIcon />
              <span>Add to LinkedIn</span>
            </a>

            <button
              onClick={copyLink}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors" style={{ background: '#f4f5f7' }}
            >
              {copied ? <Check className="w-4 h-4 text-[#00bf63]" /> : <LinkIcon className="w-4 h-4" />}
              <span>{copied ? "Copied!" : "Copy Link"}</span>
            </button>
          </div>

          {/* Student row */}
          <div className="mt-6 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center" style={{ background: '#00bf63' }}>
              {studentAvatarUrl
                ? <img src={studentAvatarUrl} alt={studentName} className="w-full h-full object-cover" />
                : <span className="text-white font-bold text-sm">{initials}</span>
              }
            </div>
            <div>
              <p className="font-semibold text-gray-900 leading-tight">{studentName}</p>
              {studentUsername && (
                <a href={`/s/${studentUsername}`} className="text-xs hover:underline" style={{ color: '#00bf63' }}>View Profile</a>
              )}
            </div>
          </div>

          {/* Learning path items */}
          {certType === 'learning_path' && (pathCoverImage || (pathItems && pathItems.length > 0)) && (
            <div className="mt-10">
              {pathCoverImage && (
                <div className="mb-5 rounded-xl overflow-hidden" style={{ height: 160, boxShadow: '0 2px 12px rgba(0,0,0,0.10)' }}>
                  <img src={resolveCoverUrl(pathCoverImage)} alt={courseName} className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                </div>
              )}
              {pathItems && pathItems.length > 0 && (
                <>
                  <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">In this learning path</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {pathItems.map((item, i) => (
                      <div
                        key={item.id ?? i}
                        className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 overflow-hidden"
                        style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}
                      >
                        <div
                          className="w-16 h-16 flex-shrink-0 overflow-hidden"
                          style={{ background: item.coverImage ? undefined : '#f1f5f9' }}
                        >
                          {item.coverImage
                            ? <img src={resolveCoverUrl(item.coverImage)} alt={item.title} className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
                            : (
                              <div className="w-full h-full flex items-center justify-center">
                                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
                                </svg>
                              </div>
                            )
                          }
                        </div>
                        <p className="text-sm font-medium text-gray-800 pr-3 leading-snug line-clamp-2">{item.title}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Hidden full-size for PDF capture */}
      <div aria-hidden style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
        <CertificateTemplate
          ref={certRef}
          certId={certId}
          studentName={studentName}
          courseName={courseName}
          issueDate={issueDate}
          partnerName={partnerName}
          partnerLogoUrl={partnerLogoUrl}
          settings={settings}
        />
      </div>
    </div>
  );
}
