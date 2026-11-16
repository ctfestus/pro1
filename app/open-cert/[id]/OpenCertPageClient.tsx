"use client";

import { useRef, useState, useEffect } from "react";
import CertificateTemplate, { CertificateSettings } from "@/components/CertificateTemplate";
import { Download, Loader2, Check, Link as LinkIcon, ChevronDown, BadgeCheck } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { sanitizeRichText } from "@/lib/sanitize";
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';

const CERT_W = 1860;
const CERT_H = 1200;
const THUMB_W = 96;
const THUMB_W_MOB = 72;

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

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18}>
      <path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function OpenCertPageClient({
  certId, recipientName, programName, issuedDate, issuedAt, settings,
  description, skills, badgeImageUrl, issueMode,
}: Props) {
  const certRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const cl = {
    pageBg:     isDark ? '#111827' : 'white',
    viewerBg:   isDark ? '#0f172a' : '#f1f5f9',
    cardBg:     isDark ? '#1e293b' : 'white',
    text:       isDark ? '#f1f5f9' : '#0f172a',
    muted:      '#94a3b8',
    body:       isDark ? '#94a3b8' : '#475569',
    skillText:  isDark ? '#cbd5e1' : '#334155',
    border:     isDark ? '#334155' : '#e2e8f0',
    divider:    isDark ? '#1e293b' : '#e2e8f0',
    skillBg:    isDark ? '#1e293b' : '#f1f5f9',
    pillBg:     isDark ? '#1e293b' : '#e2e8f0',
    pillText:   isDark ? '#94a3b8' : '#64748b',
    btnPrimBg:  isDark ? '#f1f5f9' : '#0f172a',
    btnPrimTxt: isDark ? '#0f172a' : 'white',
    btnSecBg:   isDark ? '#1e293b' : 'white',
    hoverBg:    isDark ? '#0f172a' : '#f8fafc',
    thumbAct:   isDark ? '#334155' : '#0f172a',
    thumbInact: isDark ? '#1e293b' : '#cbd5e1',
  };

  const modePillBg = isDark
    ? { badge_only: 'rgba(124,45,18,0.25)', both: 'rgba(29,78,216,0.2)', certificate_only: 'rgba(20,83,45,0.25)' }
    : { badge_only: '#fff7ed',              both: '#eff6ff',              certificate_only: '#f0fdf4' };
  const modePillColor = isDark
    ? { badge_only: '#fb923c', both: '#60a5fa', certificate_only: '#4ade80' }
    : { badge_only: '#c2410c', both: '#1d4ed8', certificate_only: '#15803d' };
  const modePillBorder = isDark
    ? { badge_only: 'rgba(154,52,18,0.5)', both: 'rgba(29,78,216,0.5)', certificate_only: 'rgba(22,101,52,0.5)' }
    : { badge_only: '#fed7aa',              both: '#bfdbfe',              certificate_only: '#bbf7d0' };

  const showCert  = issueMode === 'certificate_only' || issueMode === 'both';
  const showBadge = issueMode === 'badge_only'       || issueMode === 'both';

  const [activeView, setActiveView] = useState<'certificate' | 'badge'>(showCert ? 'certificate' : 'badge');
  const [downloading, setDownloading] = useState(false);
  const [dlBadge, setDlBadge]         = useState(false);
  const [dlOpen, setDlOpen]           = useState(false);
  const [copied, setCopied]           = useState(false);
  const [mainScale, setMainScale]     = useState(0.38);
  const [isMobile, setIsMobile]       = useState(false);
  // Read the page URL only after mount so SSR and the client's first render
  // agree (empty string). Setting it during render breaks hydration.
  const [certUrl, setCertUrl]         = useState("");

  useEffect(() => {
    const calc = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      const sidePad   = mobile ? 32 : 40;
      const thumbSpace = mobile ? 0 : THUMB_W + 24;
      const availW    = Math.min(window.innerWidth - sidePad - thumbSpace, 760);
      setMainScale(Math.max(availW / CERT_W, 0.08));
    };
    calc();
    setCertUrl(window.location.href);
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);

  const previewW = Math.round(CERT_W * mainScale);
  const previewH = Math.round(CERT_H * mainScale);

  const thumbScale    = THUMB_W / CERT_W;
  const thumbH        = Math.round(CERT_H * thumbScale);
  const thumbScaleMob = THUMB_W_MOB / CERT_W;
  const thumbHMob     = Math.round(CERT_H * thumbScaleMob);


  const initials = recipientName
    .split(" ").slice(0, 2).map(p => p[0]?.toUpperCase() ?? "").join("");

  const handleDownloadCert = async () => {
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
      pdf.save(`${programName.replace(/\s+/g, "-").toLowerCase()}-certificate.pdf`);
    } catch {
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const handleDownloadBadge = async () => {
    if (!badgeImageUrl) return;
    setDlBadge(true);
    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve();
        img.onerror = reject;
        img.src = badgeImageUrl;
      });
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth  || 400;
      canvas.height = img.naturalHeight || 400;
      canvas.getContext('2d')!.drawImage(img, 0, 0);
      await new Promise<void>(resolve => {
        canvas.toBlob(blob => {
          if (!blob) { resolve(); return; }
          const url = URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `${programName.replace(/\s+/g, '-')}-badge.png`;
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
          URL.revokeObjectURL(url);
          resolve();
        }, 'image/png');
      });
    } catch {
      window.open(badgeImageUrl, '_blank');
    } finally {
      setDlBadge(false);
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
    ? linkedInAddCertUrl({ name: programName, organizationName: settings.institutionName, issuedAt, certId, certUrl })
    : "#";

  const tw = isMobile ? THUMB_W_MOB : THUMB_W;
  const th = isMobile ? thumbHMob   : thumbH;
  const ts = isMobile ? thumbScaleMob : thumbScale;
  const descriptionHtml = description
    ? sanitizeRichText(description.includes('<') ? description : description.replace(/\n/g, '<br/>'))
    : '';

  const CertThumb = (
    <div
      onClick={() => setActiveView('certificate')}
      title="Certificate"
      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', opacity: activeView === 'certificate' ? 1 : 0.55, transition: 'opacity 0.15s', flexShrink: 0 }}
    >
      <div style={{ width: tw, height: th, position: 'relative', overflow: 'hidden', pointerEvents: 'none' }}>
        <div style={{ transform: `scale(${ts})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H }}>
          <CertificateTemplate certId={certId} studentName={recipientName} courseName={programName} issueDate={issuedDate} settings={settings} />
        </div>
      </div>
      <div style={{ background: activeView === 'certificate' ? cl.thumbAct : cl.thumbInact, padding: '4px 0', textAlign: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Cert</span>
      </div>
    </div>
  );

  const BadgeThumb = (
    <div
      onClick={() => setActiveView('badge')}
      title="Badge"
      style={{ cursor: 'pointer', borderRadius: 8, overflow: 'hidden', opacity: activeView === 'badge' ? 1 : 0.55, transition: 'opacity 0.15s', flexShrink: 0 }}
    >
      <div style={{ width: tw, height: tw, display: 'flex', alignItems: 'center', justifyContent: 'center', background: isDark ? '#1e293b' : 'white', pointerEvents: 'none' }}>
        {badgeImageUrl
          ? <img src={badgeImageUrl} alt="Badge" style={{ width: tw - 12, height: tw - 12, objectFit: 'contain' }} />
          : <span style={{ fontSize: 32 }}>🏅</span>
        }
      </div>
      <div style={{ background: activeView === 'badge' ? cl.thumbAct : cl.thumbInact, padding: '4px 0', textAlign: 'center' }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'white', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Badge</span>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: cl.pageBg, fontFamily: "var(--font-sans, Inter, system-ui, sans-serif)" }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        .cert-desc p { margin: 0 0 6px; }
        .cert-desc ul { list-style-type: disc; padding-left: 22px; margin: 0 0 6px; }
        .cert-desc ol { list-style-type: decimal; padding-left: 22px; margin: 0 0 6px; }
        .cert-desc li { margin-bottom: 2px; display: list-item; }
        .cert-desc p:last-child, .cert-desc li:last-child { margin-bottom: 0; }
      `}</style>

      {/* -- Viewer section -- */}
      <div style={{ background: cl.viewerBg, padding: isMobile ? '24px 16px 20px' : '40px 20px 36px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>

          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
              {showCert && showBadge && (
                <div style={{ display: 'flex', background: cl.pillBg, borderRadius: 99, padding: 3, gap: 0 }}>
                  <button
                    onClick={() => setActiveView('certificate')}
                    style={{ padding: '7px 20px', borderRadius: 99, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', background: activeView === 'certificate' ? settings.primaryColor : 'transparent', color: activeView === 'certificate' ? 'white' : cl.pillText }}>
                    Certificate
                  </button>
                  <button
                    onClick={() => setActiveView('badge')}
                    style={{ padding: '7px 20px', borderRadius: 99, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s', background: activeView === 'badge' ? settings.primaryColor : 'transparent', color: activeView === 'badge' ? 'white' : cl.pillText }}>
                    Badge
                  </button>
                </div>
              )}
              <div style={{ width: '100%' }}>
                {activeView === 'certificate' && showCert && (
                  <div style={{ width: previewW, height: previewH, position: 'relative', overflow: 'hidden', borderRadius: 10, boxShadow: isDark ? '0 6px 28px rgba(0,0,0,0.5)' : '0 6px 28px rgba(0,0,0,0.14)', maxWidth: '100%', margin: '0 auto' }}>
                    <div style={{ transform: `scale(${mainScale})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H }}>
                      <CertificateTemplate certId={certId} studentName={recipientName} courseName={programName} issueDate={issuedDate} settings={settings} />
                    </div>
                  </div>
                )}
                {activeView === 'badge' && showBadge && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '8px 0' }}>
                    {badgeImageUrl ? (
                      <div style={{ filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.28))' }}>
                        <img src={badgeImageUrl} alt={`${programName} badge`} fetchPriority="high"
                          style={{ width: 'min(180px, 70vw)', height: 'auto', maxWidth: '100%', maxHeight: 200, objectFit: 'contain', display: 'block' }} />
                      </div>
                    ) : (
                      <div style={{ width: 160, height: 160, borderRadius: '50%', background: settings.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 24px rgba(0,0,0,0.2)' }}>
                        <span style={{ fontSize: 52 }}>🏅</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0, width: THUMB_W }}>
                {showCert  && CertThumb}
                {showBadge && BadgeThumb}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {activeView === 'certificate' && showCert && (
                  <div style={{ width: previewW, height: previewH, position: 'relative', overflow: 'hidden', borderRadius: 10, boxShadow: isDark ? '0 8px 40px rgba(0,0,0,0.5)' : '0 8px 40px rgba(0,0,0,0.14)', maxWidth: '100%' }}>
                    <div style={{ transform: `scale(${mainScale})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H }}>
                      <CertificateTemplate certId={certId} studentName={recipientName} courseName={programName} issueDate={issuedDate} settings={settings} />
                    </div>
                  </div>
                )}
                {activeView === 'badge' && showBadge && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px 0' }}>
                    {badgeImageUrl ? (
                      <div style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.28))' }}>
                        <img src={badgeImageUrl} alt={`${programName} badge`} fetchPriority="high"
                          style={{ width: Math.min(previewW * 0.5, 220), height: 'auto', maxWidth: '100%', maxHeight: 260, objectFit: 'contain', display: 'block' }} />
                      </div>
                    ) : (
                      <div style={{ width: 200, height: 200, borderRadius: '50%', background: settings.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
                        <span style={{ fontSize: 64 }}>🏅</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* -- Details section -- */}
      <div style={{ background: cl.pageBg, padding: isMobile ? '28px 16px 40px' : '36px 20px 48px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>

          {/* Institution name */}
          <p style={{ margin: '0 0 6px', fontSize: 12, fontWeight: 700, color: cl.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {settings.institutionName}
          </p>

          {/* Program name + type pill */}
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 10, flexWrap: 'wrap', marginBottom: 22 }}>
            <h1 style={{ margin: 0, fontSize: isMobile ? 21 : 24.5, fontWeight: 900, color: cl.text, lineHeight: 1.2, fontFamily: "var(--font-lato, Lato, sans-serif)" }}>{programName}</h1>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
              background: modePillBg[issueMode],
              color:      modePillColor[issueMode],
              border:     `1px solid ${modePillBorder[issueMode]}`,
              textTransform: 'uppercase', letterSpacing: '0.05em', alignSelf: 'flex-start',
            }}>
              {issueMode === 'certificate_only' ? 'Certificate' : issueMode === 'badge_only' ? 'Badge' : 'Certificate + Badge'}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>

            {(showCert || (showBadge && badgeImageUrl)) && (
              <div style={{ position: 'relative' }}>
                {dlOpen && <div style={{ position: 'fixed', inset: 0, zIndex: 19 }} onClick={() => setDlOpen(false)} />}
                <button
                  onClick={() => setDlOpen(o => !o)}
                  disabled={downloading || dlBadge}
                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: cl.btnPrimBg, color: cl.btnPrimTxt, border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: (downloading || dlBadge) ? 'not-allowed' : 'pointer', opacity: (downloading || dlBadge) ? 0.7 : 1 }}>
                  {(downloading || dlBadge) ? <Loader2 style={{ width: 15, height: 15, animation: 'spin 1s linear infinite' }} /> : <Download style={{ width: 15, height: 15 }} />}
                  {downloading ? "Generating..." : dlBadge ? "Downloading..." : "Download"}
                  <ChevronDown style={{ width: 14, height: 14, marginLeft: 2 }} />
                </button>
                {dlOpen && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 20, background: cl.cardBg, border: `1px solid ${cl.border}`, borderRadius: 10, boxShadow: isDark ? '0 8px 24px rgba(0,0,0,0.4)' : '0 8px 24px rgba(0,0,0,0.12)', minWidth: 200, overflow: 'hidden' }}>
                    {showCert && (
                      <button onClick={() => { setDlOpen(false); handleDownloadCert(); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 16px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: cl.text, cursor: 'pointer', textAlign: 'left' }}
                        onMouseEnter={e => (e.currentTarget.style.background = cl.hoverBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <Download style={{ width: 14, height: 14, color: cl.muted }} /> Download Certificate
                      </button>
                    )}
                    {showBadge && badgeImageUrl && (
                      <button onClick={() => { setDlOpen(false); handleDownloadBadge(); }}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '11px 16px', background: 'none', border: 'none', fontSize: 13, fontWeight: 600, color: cl.text, cursor: 'pointer', textAlign: 'left', borderTop: showCert ? `1px solid ${cl.divider}` : 'none' }}
                        onMouseEnter={e => (e.currentTarget.style.background = cl.hoverBg)}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}>
                        <Download style={{ width: 14, height: 14, color: cl.muted }} /> Download Badge
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <a href={linkedInUrl} target="_blank" rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: cl.btnSecBg, color: cl.text, border: `1px solid ${cl.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
              <LinkedInIcon /> Add to LinkedIn
            </a>

            <button onClick={copyLink}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: cl.btnSecBg, color: copied ? '#16a34a' : cl.text, border: `1px solid ${cl.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {copied ? <Check style={{ width: 15, height: 15 }} /> : <LinkIcon style={{ width: 15, height: 15 }} />}
              {copied ? "Copied!" : "Copy Link"}
            </button>
          </div>

          <div style={{ height: 1, background: cl.divider, marginBottom: 22 }} />

          {/* Recipient */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: settings.primaryColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span style={{ color: 'white', fontWeight: 800, fontSize: 15 }}>{initials}</span>
            </div>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 15, color: cl.text, fontFamily: "var(--font-lato, Lato, sans-serif)" }}>{recipientName}</p>
              <p style={{ margin: '1px 0 0', fontSize: 12, color: cl.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                <BadgeCheck style={{ width: 13, height: 13, color: '#22c55e' }} />
                Verified
              </p>
            </div>
          </div>

          {/* Description */}
          {description && (
            <div
              className="cert-desc"
              style={{ margin: '0 0 20px', fontSize: isMobile ? 14 : 15, color: cl.body, lineHeight: 1.75 }}
              dangerouslySetInnerHTML={{ __html: descriptionHtml }}
            />
          )}

          {/* Skills */}
          {skills && skills.length > 0 && (
            <div style={{ marginBottom: 22 }}>
              <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: cl.muted }}>Skills</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {skills.map(skill => (
                  <span key={skill} style={{ fontSize: 13, fontWeight: 600, padding: '5px 12px', borderRadius: 8, background: cl.skillBg, color: cl.skillText, border: `1px solid ${cl.border}` }}>
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Date */}
          <p style={{ margin: 0, fontSize: 13, color: cl.muted }}>
            Issued on {issuedDate}
          </p>

        </div>
      </div>

      {/* Hidden full-size cert for PDF capture */}
      {showCert && (
        <div aria-hidden style={{ position: "fixed", top: 0, left: "-10000px", zIndex: -1 }}>
          <CertificateTemplate ref={certRef} certId={certId} studentName={recipientName} courseName={programName} issueDate={issuedDate} settings={settings} />
        </div>
      )}
    </div>
  );
}
