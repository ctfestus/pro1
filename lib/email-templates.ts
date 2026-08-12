import { tenant } from './tenant';
import { resolveCoverUrl, IMG_EMAIL, IMG_EMAIL_THUMB } from './cloudinary-url';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const BANNER  = tenant.logoUrl;
const APP_URL = process.env.APP_URL || tenant.appUrl;

export interface EmailBranding {
  logoUrl?:        string;
  emailBannerUrl?: string;
  teamName?:       string;
  appName?:        string;
  appUrl?:         string;
}

// -- Shared shell ---
function shell(content: string, opts?: { bannerUrl?: string } & EmailBranding) {
  const bannerUrl = opts?.bannerUrl || opts?.emailBannerUrl;
  const logoUrl   = opts?.logoUrl || BANNER;
  const appName   = opts?.appName   || tenant.appName  || 'the platform';
  const appUrl_   = opts?.appUrl    || APP_URL;
  const teamName  = opts?.teamName;

  const headerHtml = bannerUrl
    ? `<tr><td>
        <img src="${bannerUrl}" alt="${appName}" width="600" style="width:100%;height:auto;display:block;" />
      </td></tr>`
    : logoUrl
    ? `<tr><td style="padding:20px 20px 0;">
        <img src="${logoUrl}" alt="${appName}" style="height:48px;width:auto;display:block;object-fit:contain;" />
      </td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#ffffff;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table style="max-width:600px;width:100%;margin:0 auto;" cellpadding="0" cellspacing="0">

        ${headerHtml}

        <!-- Content -->
        <tr><td style="padding:20px;">
          ${content}
          ${teamName ? `<p style="color:#374151;font-size:14px;">${teamName}</p>` : ''}

          <!-- Footer -->
          <p style="font-size:12px;color:#a1a1aa;margin-top:24px;">
            You received this because you are enrolled on ${appName}. &middot;
            <a href="${appUrl_}" style="color:#2563eb;">Visit ${appName}</a>
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function cta(label: string, url: string) {
  return `<table cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <tr><td>
      <a href="${url}" style="background-color:#2563eb;color:#ffffff;padding:14px 26px;border-radius:0;text-decoration:none;font-weight:bold;display:inline-block;">${label}</a>
    </td></tr>
  </table>`;
}

function detailBlock(label: string, value: string) {
  return `<p style="margin:4px 0;"><b>${label}:</b> ${value}</p>`;
}

// -- helpers for meeting platform ---
function platformName(url?: string): string {
  if (!url) return 'Meeting Link';
  const u = url.toLowerCase();
  if (u.includes('meet.google.com')) return 'Google Meet';
  if (u.includes('zoom.us')) return 'Zoom';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'Microsoft Teams';
  return 'Join Meeting';
}
function platformColor(url?: string): string {
  if (!url) return '#1f1bc3';
  const u = url.toLowerCase();
  if (u.includes('meet.google.com')) return '#1a73e8';
  if (u.includes('zoom.us')) return '#2d8cff';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return '#6264a7';
  return '#1f1bc3';
}

function badgeBlock(badgeName: string, badgeImageUrl: string, badgesUrl: string) {
  return `
    <div style="margin:24px 0;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;letter-spacing:0.1em;">You Earned a Badge</p>
      <img src="${badgeImageUrl}" alt="${esc(badgeName)}" width="96" height="96" style="display:block;width:96px;height:96px;object-fit:contain;margin-bottom:8px;" />
      <p style="margin:0 0 12px;font-size:18px;font-weight:900;color:#111827;">${esc(badgeName)}</p>
      <a href="${badgesUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;padding:10px 24px;border-radius:0;text-decoration:none;font-weight:800;font-size:13px;">View in Your Profile</a>
    </div>
  `;
}

// -- 1. Event Registration Confirmation ---
export function confirmationEmail(data: {
  name?: string;
  eventTitle: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  eventTimezone?: string;
  meetingLink?: string;
  joinUrl?: string;
  eventType?: string;
  formUrl: string;
  customTitle?: string;
  customBody?: string;
  bannerUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, eventDate, eventTime, eventLocation, eventTimezone, meetingLink, joinUrl, formUrl, customTitle, customBody, bannerUrl, branding } = data;
  const joinHref = joinUrl || meetingLink;

  const meetingBlock = meetingLink ? `
    <div style="margin:16px 0;padding:16px;background:#f0f7ff;border-radius:0;border:1px solid #c5deff;text-align:center;">
      <p style="margin:0 0 10px;font-weight:600;color:#333;">${platformName(meetingLink)}</p>
      <a href="${joinHref}" style="display:inline-block;padding:10px 24px;background:${platformColor(meetingLink)};color:white;border-radius:0;text-decoration:none;font-weight:600;font-size:14px;">Join Meeting</a>
      <p style="margin:8px 0 0;font-size:12px;color:#888;">Keep this link. You will need it to attend.</p>
    </div>` : '';

  const content = `
    <p><b>Hi ${esc(name || 'there')},</b></p>
    <p>${customBody ? esc(customBody) : 'Your registration has been confirmed. We look forward to seeing you!'}</p>

    <p style="font-size:18px;font-weight:bold;margin-top:16px;">${customTitle ? esc(customTitle) : 'Registration Confirmed ✓'}</p>
    <p><b>${esc(eventTitle)}</b></p>

    ${eventDate ? detailBlock('Date', [eventDate, eventTime, eventTimezone].filter(Boolean).join(' · ')) : ''}
    ${eventLocation ? detailBlock('Location', eventLocation) : ''}
    ${meetingBlock}

    ${cta('View Event', formUrl)}

    <p>Keep this email for your records. You'll receive a reminder before the event starts.</p>
    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, { ...branding, bannerUrl: bannerUrl || undefined });
}

// -- 2. Event Reminder ---
export function reminderEmail(data: {
  name?: string;
  eventTitle: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  eventTimezone?: string;
  meetingLink?: string;
  joinUrl?: string;
  formUrl: string;
  isOneHour?: boolean;
  bannerUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, eventDate, eventTime, eventLocation, eventTimezone, meetingLink, joinUrl, formUrl, isOneHour, bannerUrl, branding } = data;
  const timeLabel = isOneHour ? '1 hour' : 'tomorrow';
  const joinHref  = joinUrl || meetingLink;

  const meetingBlock = meetingLink ? `
    <div style="margin:16px 0;padding:16px;background:#f0f7ff;border-radius:0;border:1px solid #c5deff;text-align:center;">
      <p style="margin:0 0 10px;font-weight:600;color:#333;">${platformName(meetingLink)}</p>
      <a href="${joinHref}" style="display:inline-block;padding:10px 24px;background:${platformColor(meetingLink)};color:white;border-radius:0;text-decoration:none;font-weight:600;font-size:14px;">Join Meeting</a>
    </div>` : '';

  const content = `
    <p><b>Hi ${esc(name || 'there')},</b></p>
    <p>This is a friendly reminder that <b>${eventTitle}</b> is starting in <b>${timeLabel}</b>${isOneHour ? '. Get ready!' : '.'}</p>

    <p style="font-size:18px;font-weight:bold;margin-top:16px;">Event Reminder</p>
    <p><b>${eventTitle}</b></p>

    ${eventDate ? detailBlock('Date', [eventDate, eventTime, eventTimezone].filter(Boolean).join(' · ')) : ''}
    ${eventLocation ? detailBlock('Location', eventLocation) : ''}
    ${meetingBlock}

    ${cta('View Event Details', formUrl)}

    <p>You can access your dashboard anytime to view your upcoming events.</p>
    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, { ...branding, bannerUrl: bannerUrl || undefined });
}

// -- 3. Course Result ---
export function courseResultEmail(data: {
  name?: string;
  courseTitle: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  points?: number;
  passmark?: number;
  formUrl: string;
  certUrl?: string;
  correctQuestions?: number;
  totalQuestions?: number;
  skills?: Array<{ name: string; correct: number; total: number; pct: number }>;
  badgeName?: string;
  badgeImageUrl?: string;
  recommendations?: Array<{ title: string; slug: string; coverImage?: string | null }>;
  branding?: EmailBranding;
}) {
  const { name, courseTitle, score, total, percentage, passed, points, passmark, formUrl, certUrl, correctQuestions, totalQuestions, skills, badgeName, badgeImageUrl, recommendations, branding } = data;
  const appUrl = branding?.appUrl || process.env.APP_URL || tenant.appUrl;

  const recsHtml = recommendations?.length ? `
    <p style="font-size:16px;font-weight:bold;margin-top:32px;margin-bottom:4px;">What to take next</p>
    <p style="color:#666;font-size:14px;margin-top:0;margin-bottom:20px;">Based on what you just completed, you might enjoy these:</p>
    ${recommendations.slice(0, 3).map(r => `
      <a href="${appUrl}/${r.slug}?go=1" style="display:block;text-decoration:none;margin-bottom:14px;border-radius:0;overflow:hidden;border:1px solid #e5e7eb;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.06);">
        ${r.coverImage ? `
          <img src="${resolveCoverUrl(r.coverImage, IMG_EMAIL)}" width="100%" height="140" style="display:block;width:100%;height:140px;object-fit:cover;" />
        ` : `
          <table width="100%" cellpadding="0" cellspacing="0"><tr><td height="140" style="background:#f0fdf4;text-align:center;vertical-align:middle;font-size:40px;">📘</td></tr></table>
        `}
        <div style="padding:14px 16px 16px;">
          <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111;line-height:1.3;">${esc(r.title)}</p>
          <p style="margin:0;font-size:12px;font-weight:600;color:#00bf63;">Start course </p>
        </div>
      </a>
    `).join('')}
  ` : '';

  // Embedded performance report (certifications only -- courses do not pass `skills`). Email-safe:
  // percentage bars via nested tables with bgcolor, so it renders without CSS/SVG support.
  const pm = passmark ?? 70;
  // Shown for certification passes (they pass correctQuestions); the per-skill list appears only
  // when skill areas exist. Course/VE emails pass neither, so they're unaffected.
  const resultsHtml = (passed && (correctQuestions != null || (skills && skills.length))) ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0;border:1px solid #e5e7eb;border-radius:12px;">
      <tr><td style="padding:20px 22px;">
        <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">Your results</p>
        <p style="margin:0 0 16px;font-size:15px;color:#111;">Overall score <b style="font-size:22px;color:#16a34a;">${percentage}%</b>${correctQuestions != null && totalQuestions != null ? ` <span style="color:#6b7280;">&middot; scored ${correctQuestions} of ${totalQuestions}, pass mark ${pm}%</span>` : ''}</p>
        ${(skills ?? []).map(s => `
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0;"><tr>
            <td width="150" style="font-size:14px;color:#374151;vertical-align:middle;">${esc(s.name)}</td>
            <td style="vertical-align:middle;padding:0 10px;">
              <table width="100%" cellpadding="0" cellspacing="0" bgcolor="#e5e7eb" style="border-radius:999px;"><tr>
                <td style="padding:0;font-size:0;line-height:0;">
                  <table width="${Math.max(3, Math.min(100, s.pct))}%" cellpadding="0" cellspacing="0" bgcolor="#16a34a" style="border-radius:999px;"><tr><td height="8" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
                </td>
              </tr></table>
            </td>
            <td width="42" style="font-size:13px;color:#6b7280;text-align:right;vertical-align:middle;">${s.pct}%</td>
          </tr></table>
        `).join('')}
      </td></tr>
    </table>
  ` : '';

  const content = `
    <p><b>Hi ${esc(name || 'there')},</b></p>

    ${passed ? `
      <p style="color:#555;">You have successfully completed <b>${esc(courseTitle)}</b>. Your certificate is ready to view, download, and share.</p>
      ${resultsHtml}
      ${certUrl ? cta('🎓 View Your Certificate', certUrl) : cta('View Course', formUrl)}
    ` : `
      <p>Thanks for completing <b>${esc(courseTitle)}</b>. Keep practising. You can retake it to improve your score.</p>
      ${cta('Retake Course', formUrl)}
    `}

    ${passed && badgeName && badgeImageUrl ? badgeBlock(badgeName, badgeImageUrl, `${appUrl}/student?section=badges`) : ''}

    ${recsHtml}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 4. Course OTP Verification ---
export function otpEmail(data: { code: string; courseName?: string; branding?: EmailBranding }) {
  const { code, courseName, branding } = data;

  const content = `
    <p><b>Hi there,</b></p>
    <p>Use the code below to verify your email and start${courseName ? ` <b>${courseName}</b>` : ' the course'}. This code expires in <b>10 minutes</b>.</p>

    <p style="font-size:18px;font-weight:bold;margin-top:16px;">Your Verification Code</p>

    <div style="margin:20px 0;padding:24px;background:#f0fdf4;border:2px solid #22c55e;border-radius:0;text-align:center;">
      <span style="font-size:36px;font-weight:900;letter-spacing:0.3em;color:#16a34a;font-family:'Courier New',Courier,monospace;">${code}</span>
    </div>

    <p>Enter this code on the course page to continue. Do not share it with anyone.</p>
    <p style="color:#a1a1aa;font-size:13px;">If you did not request this, you can safely ignore this email.</p>
    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 5. Student Nudge (not started / in_progress / stalled) ---
export function nudgeEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  status: 'not_started' | 'stalled' | 'in_progress' | 'failed';
  formUrl: string;
  coverImage?: string | null;
  relatedAssignmentTitle?: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, status, formUrl, coverImage, relatedAssignmentTitle, branding } = data;
  const typeLabel = contentType === 'virtual_experience' ? 'virtual experience' : contentType;
  const ctaLabel  = status === 'not_started' ? `Start ${typeLabel}` : status === 'failed' ? `Review and retake ${typeLabel}` : 'Continue where you left off';

  const intro = status === 'not_started'
    ? `We noticed you have not started <b>${contentTitle}</b> yet. We just wanted to reach out with a little encouragement.`
    : status === 'in_progress'
    ? `You are making progress on <b>${contentTitle}</b>. Great work so far! We are reaching out because we want to make sure you do not miss the deadline. Now is the time to push through and finish strong.`
    : status === 'failed'
    ? `You submitted <b>${contentTitle}</b>, but did not pass yet. That is not the end of the road. Review the material, try again, and use this as feedback for your next attempt.`
    : `We noticed you have not visited <b>${contentTitle}</b> in a while. We are checking in because we believe in you and do not want you to miss out.`;

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>${intro}</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0 0 10px;font-weight:700;color:#15803d;font-size:15px;">Why upskilling matters 🚀</p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">
        In today's fast-moving world, the skills you build today directly shape the opportunities you unlock tomorrow.
        Every lesson you complete, every challenge you tackle puts you ahead, and the learning you do here is
        directly relevant to real roles in the industry.
      </p>
    </div>

    ${status === 'stalled' ? `
    <p style="color:#374151;">
      <b>You've already taken the first step</b>, which is the hardest part. Getting back on track is easier than you think.
      Remember why you started, and know that each module you complete brings you closer to a real skill you can use.
    </p>` : status === 'in_progress' ? `
    <p style="color:#374151;">
      <b>You are already on your way</b>. Do not let the momentum slip. Even 20 minutes a day can get you across the finish line.
      The effort you have already put in is worth protecting. Keep going.
    </p>` : status === 'failed' ? `
    <p style="color:#374151;">
      <b>A failed attempt is useful data</b>. It shows exactly where to focus next. Revisit the feedback, strengthen the weak spots, and retake when ready.
    </p>` : `
    <p style="color:#374151;">
      It only takes a few minutes to begin. Once you start, you will find the content is practical, relevant, and designed
      to give you real skills. Not just theory.
    </p>`}

    <div style="margin:20px 0;padding:20px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0;">
      <p style="margin:0 0 6px;font-weight:700;color:#92400e;font-size:14px;">Need support? We are here for you. 🤝</p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.7;">
        If anything felt unclear, you got stuck, or life simply got in the way. Please do not hesitate to reach out.
        Our team is available to help you through any challenges. You are not on this journey alone.
      </p>
    </div>

    ${cta(ctaLabel, formUrl)}

    ${relatedAssignmentTitle ? `
    <p style="margin:20px 0 10px;font-weight:700;color:#111827;font-size:14px;">📋 Related assignment waiting for you</p>
    <a href="${formUrl}" style="display:block;text-decoration:none;border-radius:0;overflow:hidden;border:1px solid #e5e7eb;margin-bottom:16px;">
      ${coverImage ? `<img src="${resolveCoverUrl(coverImage, IMG_EMAIL)}" alt="${contentTitle}" style="display:block;width:100%;height:160px;object-fit:cover;" />` : `<div style="width:100%;height:120px;background:linear-gradient(135deg,#1e3a5f,#0f766e);display:flex;align-items:center;justify-content:center;"><span style="color:white;font-size:28px;">📚</span></div>`}
      <div style="padding:14px 16px;background:#ffffff;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">Continue Learning</p>
        <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111827;">${contentTitle}</p>
        <p style="margin:0;font-size:13px;color:#374151;line-height:1.6;">
          Complete this course to unlock the <b>"${relatedAssignmentTitle}"</b> assignment, a hands-on task to apply what you have learned.
        </p>
      </div>
    </a>` : ''}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 6. 80% Milestone ---
export function milestoneEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  formUrl: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, formUrl, branding } = data;
  const typeLabel = contentType === 'virtual_experience' ? 'virtual experience' : contentType;

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>You are <b>80% of the way through</b> <b>${contentTitle}</b>. That is incredible progress! 🎉</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;text-align:center;">
      <div style="font-size:40px;font-weight:900;color:#16a34a;">80%</div>
      <div style="font-size:14px;color:#15803d;font-weight:600;margin-top:4px;">Almost there!</div>
    </div>

    <p style="color:#374151;">
      You have put in the hard work and you are so close to the finish line. Do not stop now.
      Completing this ${typeLabel} will add a real, demonstrable skill to your profile.
    </p>

    <div style="margin:20px 0;padding:16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0;">
      <p style="margin:0;font-weight:700;color:#92400e;font-size:14px;">💡 Did you know?</p>
      <p style="margin:8px 0 0;color:#374151;font-size:14px;line-height:1.7;">
        Students who reach 80% completion are <b>3× more likely to finish</b>. You are already in that group.
        One final push and you will have something to be genuinely proud of.
      </p>
    </div>

    ${cta('Finish strong ', formUrl)}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 7. Weekly Digest ---
export function weeklyDigestEmail(data: {
  name: string;
  completed: { title: string; contentType: string; score?: number | null }[];
  inProgress: { title: string; contentType: string }[];
  notStarted: { title: string; contentType: string }[];
  missedDeadlines: { title: string; contentType: string; daysOverdue: number }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, completed, inProgress, notStarted, missedDeadlines, dashboardUrl, branding } = data;

  const typeLabel = (t: string) => t === 'virtual_experience' ? 'Virtual Experience' : t === 'course' ? 'Course' : t;

  const completedRows = completed.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="display:inline-block;width:20px;text-align:center;">✅</span>
        <b style="color:#111;">${item.title}</b>
        <span style="margin-left:8px;font-size:12px;color:#6b7280;">${typeLabel(item.contentType)}${item.score != null ? ` · Score: ${item.score}%` : ''}</span>
      </td>
    </tr>`).join('');

  const inProgressRows = inProgress.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="display:inline-block;width:20px;text-align:center;">📚</span>
        <b style="color:#111;">${item.title}</b>
        <span style="margin-left:8px;font-size:12px;color:#6b7280;">${typeLabel(item.contentType)} · In progress</span>
      </td>
    </tr>`).join('');

  const notStartedRows = notStarted.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
        <span style="display:inline-block;width:20px;text-align:center;">⏳</span>
        <b style="color:#111;">${item.title}</b>
        <span style="margin-left:8px;font-size:12px;color:#6b7280;">${typeLabel(item.contentType)} · Not started</span>
      </td>
    </tr>`).join('');

  const missedRows = missedDeadlines.map(item => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #fee2e2;">
        <span style="display:inline-block;width:20px;text-align:center;">⚠️</span>
        <b style="color:#111;">${item.title}</b>
        <span style="margin-left:8px;font-size:12px;color:#ef4444;">${typeLabel(item.contentType)} · ${item.daysOverdue === 0 ? 'Due today' : `${item.daysOverdue} day${item.daysOverdue > 1 ? 's' : ''} overdue`}</span>
      </td>
    </tr>`).join('');

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Here's your weekly learning update. Stay consistent. Every lesson counts! 🚀</p>

    ${completed.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#111;margin-top:24px;">✅ Completed this week</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0f0f0;">
      ${completedRows}
    </table>` : ''}

    ${inProgress.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#111;margin-top:24px;">📚 Still in progress</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0f0f0;">
      ${inProgressRows}
    </table>` : ''}

    ${missedDeadlines.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#dc2626;margin-top:24px;">⚠️ Overdue: action needed</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #fee2e2;background:#fff5f5;border-radius:0;">
      ${missedRows}
    </table>
    <p style="font-size:13px;color:#6b7280;margin-top:8px;">These items have passed their deadline. Reach out to your instructor if you need an extension.</p>` : ''}

    ${notStarted.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#111;margin-top:24px;">⏳ Not started yet</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #f0f0f0;">
      ${notStartedRows}
    </table>
    <p style="font-size:13px;color:#6b7280;margin-top:8px;">You have been assigned these programs. Starting is the hardest part. Log in and take the first step.</p>` : ''}

    <div style="margin:24px 0;padding:16px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0;color:#15803d;font-size:14px;line-height:1.7;">
        <b>Every week counts.</b> The skills you are building here open doors to real opportunities.
        Consistency is the single most powerful habit you can build as a learner.
      </p>
    </div>

    ${cta('Go to my dashboard', dashboardUrl)}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 8. Blast / Announcement ---
export function deadlineReminderEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  formUrl: string;
  daysLeft: number;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, formUrl, daysLeft, branding } = data;
  const typeLabel = contentType === 'course' ? 'course' : contentType === 'assignment' ? 'assignment' : 'virtual experience';
  const urgency = daysLeft <= 0 ? 'Your deadline has passed'
    : daysLeft === 1 ? 'You have 1 day left'
    : `You have ${daysLeft} days left`;
  const urgencyColor = daysLeft <= 0 ? '#ef4444' : daysLeft <= 1 ? '#dc2626' : '#f59e0b';

  const content = `
    <h2 style="color:#111;font-size:22px;margin-bottom:8px;">⏰ ${urgency}</h2>
    <p>Hi ${esc(name)},</p>
    <p>This is a reminder that your deadline for the following ${typeLabel} is approaching:</p>
    <div style="background:#f9fafb;border-left:4px solid ${urgencyColor};border-radius:0;padding:16px;margin:16px 0;">
      <p style="font-weight:700;font-size:16px;margin:0;">${contentTitle}</p>
      <p style="color:#ef4444;font-weight:600;margin:6px 0 0;">${urgency}</p>
    </div>
    <p>Do not let your progress go to waste. Every skill you build today is an investment in your future career. Log in now and keep going.</p>
    <p style="background:#f0fdf4;border-radius:0;padding:12px;font-size:14px;color:#166534;">
      💡 <b>Quick tip:</b> Even 15 minutes of focused learning counts. You can do this!
    </p>
    ${cta('Complete Now', formUrl)}
    <p>If you need any help or have questions, our team is always here for you. Just reply to this email.</p>
    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 9. Onboarding Welcome ---
export function welcomeEmail(data: { name: string; studentUrl: string; branding?: EmailBranding }) {
  const { name, studentUrl, branding } = data;
  const appName = branding?.appName || tenant.appName;
  const content = `
    <p><b>Welcome to ${appName}, ${esc(name)}! 🎉</b></p>
    <p>We are thrilled to have you on board. You have just taken the first step toward building industry-relevant skills that will shape your career.</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0 0 10px;font-weight:700;color:#15803d;font-size:15px;">Here is what to expect 🚀</p>
      <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:2;">
        <li>Practical courses built around real African industry scenarios</li>
        <li>Hands-on assignments to apply what you learn</li>
        <li>Certificates to showcase your skills</li>
        <li>A leaderboard to track your progress against peers</li>
      </ul>
    </div>

    <p style="color:#374151;">Your cohort and courses are already set up for you. Head to your dashboard and start your first course today.</p>

    ${cta('Go to My Dashboard', studentUrl)}

    <br>
    <p><b>Welcome aboard,</b></p>
  `;
  return shell(content, branding);
}

// -- 10. Onboarding Day-3 Check-in ---
export function day3CheckInEmail(data: { name: string; studentUrl: string; courseTitle?: string; courseUrl?: string; branding?: EmailBranding }) {
  const { name, studentUrl, courseTitle, courseUrl, branding } = data;
  const appName = branding?.appName || tenant.appName;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>It has been a few days since you joined ${appName}. We just wanted to check in. Have you had a chance to explore your courses yet?</p>

    ${courseTitle && courseUrl ? `
    <div style="margin:20px 0;border-radius:0;overflow:hidden;border:1px solid #e5e7eb;">
      <div style="padding:16px;background:#ffffff;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#22c55e;text-transform:uppercase;letter-spacing:0.05em;">Ready for you</p>
        <p style="margin:0 0 8px;font-size:16px;font-weight:700;color:#111827;">${courseTitle}</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">Start this course and take your first step toward a new skill.</p>
      </div>
      <div style="padding:12px 16px;background:#f9fafb;">
        <a href="${courseUrl}" style="background:#22c55e;color:#fff;padding:10px 20px;border-radius:0;text-decoration:none;font-weight:bold;font-size:13px;display:inline-block;">Start Course </a>
      </div>
    </div>` : `
    <p style="color:#374151;">Log in now and pick a course to get started. Even 15 minutes a day adds up fast.</p>
    ${cta('Browse My Courses', studentUrl)}`}

    <br>
    <p><b>Cheering you on,</b></p>
  `;
  return shell(content, branding);
}

// -- 11. Onboarding Day-7 Encouragement ---
export function day7EncouragementEmail(data: { name: string; studentUrl: string; hasStarted: boolean; coursesCompleted: number; branding?: EmailBranding }) {
  const { name, studentUrl, hasStarted, coursesCompleted, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    ${hasStarted && coursesCompleted > 0 ? `
    <p>One week in and you have already completed <b>${coursesCompleted} course${coursesCompleted > 1 ? 's' : ''}</b>. That is outstanding progress! 🏆</p>
    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;text-align:center;">
      <div style="font-size:40px;font-weight:900;color:#16a34a;">${coursesCompleted}</div>
      <div style="font-size:14px;color:#15803d;font-weight:600;margin-top:4px;">Course${coursesCompleted > 1 ? 's' : ''} completed in your first week</div>
    </div>
    <p style="color:#374151;">Keep the momentum going. Every course you complete builds your profile and brings you closer to your career goals.</p>
    ` : hasStarted ? `
    <p>You have started your learning journey, and that is great! The hardest part is always the beginning, and you have done it. 💪</p>
    <p style="color:#374151;">Even if life got busy, come back and pick up where you left off. Your progress is saved.</p>
    ` : `
    <p>We noticed you have not started a course yet, and that is completely okay. Life gets busy. But we want to make sure you do not miss out.</p>
    <p style="color:#374151;">Your courses are waiting. It only takes a few minutes to begin, and the skills you build here are directly relevant to real jobs.</p>
    `}
    ${cta('Continue Learning', studentUrl)}
    <br>
    <p><b>Best,</b></p>
  `;
  return shell(content, branding);
}

export function blastEmail(data: {
  subject: string;
  body: string;
  senderName?: string;
  formTitle: string;
  formUrl: string;
  bannerUrl?: string;
  ctaLabel?: string;
  branding?: EmailBranding;
}) {
  const { body, senderName, formTitle, formUrl, bannerUrl, ctaLabel, branding } = data;

  const content = `
    <p>${body.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>

    ${cta(ctaLabel || 'View Page', formUrl)}

    <br>
    <p><b>Best regards,</b></p>
    <p>${senderName || formTitle}</p>
  `;

  // blastEmail uses senderName as sign-off -- do not pass teamName to shell
  return shell(content, { ...branding, bannerUrl: bannerUrl || undefined, teamName: undefined });
}

// -- 12. Learning Path Assignment ---
export function learningPathAssignedEmail(data: {
  name: string;
  pathTitle: string;
  pathDescription?: string;
  dashboardUrl: string;
  items: Array<{ title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean; description?: string }>;
  branding?: EmailBranding;
}) {
  const { name, pathTitle, pathDescription, dashboardUrl, items, branding } = data;

  const visibleItems = items.slice(0, 6);

  const itemsHtml = visibleItems.map((item, idx) => {
    const isLast = idx === visibleItems.length - 1;
    const circleColor = item.isVE ? '#6366f1' : '#22c55e';
    const badgeColor  = item.isVE ? '#6366f1' : item.isCert ? '#15803d' : '#3b82f6';
    const badgeLabel  = item.isVE ? 'Virtual Experience' : item.isCert ? 'Certification' : 'Course';
    const emoji       = item.isVE ? '💼' : item.isCert ? '🎓' : '📘';

    const circle = `
      <table cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;">
        <tr>
          <td width="28" height="28" bgcolor="${circleColor}" style="border-radius:0;color:#ffffff;font-size:12px;font-weight:800;text-align:center;vertical-align:middle;font-family:Arial,sans-serif;line-height:28px;">${idx + 1}</td>
        </tr>
      </table>`;

    const connector = '';

    const imageCell = item.coverImage
      ? `<td width="72" style="padding:0;vertical-align:top;"><img src="${resolveCoverUrl(item.coverImage, IMG_EMAIL_THUMB)}" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:4px;" /></td>`
      : `<td width="72" bgcolor="#1e3a5f" style="padding:0;vertical-align:top;text-align:center;height:72px;border-radius:4px;"><span style="font-size:24px;line-height:72px;">${emoji}</span></td>`;

    return `
    <tr>
      <td width="40" style="vertical-align:top;text-align:center;padding:0 0 0 0;">
        ${circle}${connector}
      </td>
      <td style="padding:0 0 12px 12px;vertical-align:top;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:transparent;">
          <tr>
            ${imageCell}
            <td style="padding:10px 14px;vertical-align:middle;">
              <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#111827;line-height:1.35;font-family:Arial,sans-serif;">${item.title}</p>
              ${item.description ? `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.4;font-family:Arial,sans-serif;">${item.description}</p>` : `<p style="margin:0;font-size:11px;font-weight:600;color:${badgeColor};text-transform:uppercase;letter-spacing:0.05em;font-family:Arial,sans-serif;">${badgeLabel}</p>`}
            </td>
            <td width="36" style="padding:0 12px;text-align:center;vertical-align:middle;">
              <span style="font-size:18px;color:#9ca3af;font-family:Arial,sans-serif;"></span>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
  }).join('');

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>You have been enrolled in a new learning path. This is a structured programme designed to build your skills step by step, and you will earn a certificate when you complete every item.</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em;">Your Learning Path</p>
      <p style="margin:0 0 8px;font-size:20px;font-weight:800;color:#111827;">${pathTitle}</p>
      ${pathDescription ? `<p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${pathDescription}</p>` : ''}
    </div>

    ${items.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#111;margin-top:24px;margin-bottom:16px;">What's included (${items.length} item${items.length !== 1 ? 's' : ''})</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemsHtml}
    </table>` : ''}

    <div style="margin:20px 0;padding:16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0;">
      <p style="margin:0;font-size:14px;color:#92400e;line-height:1.6;">
        <b>Complete each item in order</b> to earn your individual course certificates along the way.
        Once you finish the entire path, you will receive a <b>Learning Path Certificate</b> to add to your profile.
      </p>
    </div>

    ${cta('Start Learning Now', dashboardUrl)}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Recording Published ---
export function recordingPublishedEmail(data: {
  name: string;
  recordingTitle: string;
  newWeeks: number[];
  dashboardUrl: string;
  coverImage?: string | null;
  branding?: EmailBranding;
}) {
  const { name, recordingTitle, newWeeks, dashboardUrl, coverImage, branding } = data;

  const weekLabel = newWeeks.length === 1
    ? `Week ${newWeeks[0]}`
    : newWeeks.map(w => `Week ${w}`).join(', ');

  const content = `
    <p><b>Hi ${esc(name)},</b></p>

    ${coverImage ? `
    <a href="${dashboardUrl}" style="display:block;text-decoration:none;margin:16px 0;border-radius:0;overflow:hidden;border:1px solid #e5e7eb;">
      <img src="${resolveCoverUrl(coverImage, IMG_EMAIL)}" alt="${recordingTitle}" width="600" style="display:block;width:100%;height:200px;object-fit:cover;" />
    </a>` : ''}

    <p><b>${weekLabel}</b> recordings for <b>${recordingTitle}</b> are now available. Log in to watch them and stay on track with your programme.</p>

    ${cta('Watch Recordings', dashboardUrl)}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 13. Learning Path Certificate ---
export function learningPathCertificateEmail(data: {
  name: string;
  pathTitle: string;
  pathDescription?: string;
  certUrl: string;
  items: Array<{ title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean }>;
  badgeName?: string;
  badgeImageUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, pathTitle, pathDescription, certUrl, items, badgeName, badgeImageUrl, branding } = data;
  const appUrl = branding?.appUrl || process.env.APP_URL || tenant.appUrl;

  const itemsHtml = items.slice(0, 6).map((item) => `
    <tr>
      <td style="padding:0 0 8px 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:0;overflow:hidden;border:1px solid #d1fae5;background:#f0fdf4;">
          <tr>
            ${item.coverImage ? `
            <td width="64" style="padding:0;vertical-align:middle;">
              <img src="${resolveCoverUrl(item.coverImage, IMG_EMAIL_THUMB)}" width="64" height="52" style="display:block;width:64px;height:52px;object-fit:cover;" />
            </td>` : `
            <td width="64" style="padding:0;vertical-align:middle;background:linear-gradient(135deg,#064e3b,#065f46);text-align:center;height:52px;">
              <span style="font-size:20px;line-height:52px;">${item.isVE ? '💼' : item.isCert ? '🎓' : '📘'}</span>
            </td>`}
            <td style="padding:10px 14px;vertical-align:middle;">
              <p style="margin:0 0 2px;font-size:10px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em;">${item.isVE ? 'Virtual Experience' : item.isCert ? 'Certification' : 'Course'} · Completed ✓</p>
              <p style="margin:0;font-size:13px;font-weight:700;color:#111827;">${item.title}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p style="color:#374151;">This is a major achievement. You have completed every item in your learning path and your certificate is ready.</p>

    <div style="margin:20px 0;padding:24px;background:linear-gradient(135deg,#064e3b,#0f766e);border-radius:0;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;color:#6ee7b7;text-transform:uppercase;letter-spacing:0.1em;">Learning Path Completed</p>
      <p style="margin:0 0 8px;font-size:22px;font-weight:900;color:#ffffff;line-height:1.2;">${pathTitle}</p>
      ${pathDescription ? `<p style="margin:0 0 16px;font-size:13px;color:#a7f3d0;line-height:1.5;">${pathDescription}</p>` : '<div style="margin-bottom:16px;"></div>'}
      <a href="${certUrl}" style="display:inline-block;background:#ffffff;color:#064e3b;padding:12px 28px;border-radius:0;text-decoration:none;font-weight:800;font-size:14px;">🎓 View Your Certificate</a>
    </div>

    ${items.length > 0 ? `
    <p style="font-size:15px;font-weight:700;color:#111;margin-top:24px;margin-bottom:12px;">Everything you completed</p>
    <table width="100%" cellpadding="0" cellspacing="0">
      ${itemsHtml}
    </table>` : ''}

    <div style="margin:20px 0;padding:16px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0;font-size:14px;color:#15803d;line-height:1.6;">
        Add this certificate to your LinkedIn profile and CV to showcase the skills you have built.
        Every credential you earn makes your profile stronger.
      </p>
    </div>

    ${badgeName && badgeImageUrl ? badgeBlock(badgeName, badgeImageUrl, `${appUrl}/student?section=badges`) : ''}

    ${cta('View & Download Certificate', certUrl)}

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 14. Course completed -- next up in learning path ---
export function courseCompletedNextUpEmail(data: {
  name: string;
  pathTitle: string;
  completedTitle: string;
  completedNumber: number;
  totalItems: number;
  nextTitle: string;
  nextUrl: string;
  nextCoverImage?: string | null;
  nextIsVE?: boolean;
  nextIsCert?: boolean;
  nextDescription?: string | null;
  branding?: EmailBranding;
}) {
  const { name, pathTitle, completedTitle, completedNumber, totalItems, nextTitle, nextUrl, nextCoverImage, nextIsVE, nextIsCert, nextDescription, branding } = data;
  const emoji = nextIsVE ? '💼' : nextIsCert ? '🎓' : '📘';

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p style="color:#374151;">You have completed item ${completedNumber} of ${totalItems} in <b>${pathTitle}</b>. Keep the momentum going!</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em;">Just Completed ✓</p>
      <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${completedTitle}</p>
    </div>

    <p style="font-size:15px;font-weight:700;color:#111;margin:24px 0 12px;">Up next</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:transparent;margin-bottom:20px;">
      <tr>
        ${nextCoverImage
          ? `<td width="72" style="padding:0;vertical-align:top;"><img src="${resolveCoverUrl(nextCoverImage, IMG_EMAIL_THUMB)}" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:cover;border-radius:4px;" /></td>`
          : `<td width="72" bgcolor="#1e3a5f" style="padding:0;vertical-align:top;text-align:center;height:72px;border-radius:4px;"><span style="font-size:24px;line-height:72px;">${emoji}</span></td>`}
        <td style="padding:10px 14px;vertical-align:middle;">
          <p style="margin:0 0 3px;font-size:13px;font-weight:700;color:#111827;line-height:1.35;font-family:Arial,sans-serif;">${nextTitle}</p>
          ${nextDescription
            ? `<p style="margin:0;font-size:12px;color:#6b7280;line-height:1.4;font-family:Arial,sans-serif;">${nextDescription}</p>`
            : `<p style="margin:0;font-size:11px;font-weight:600;color:#15803d;text-transform:uppercase;letter-spacing:0.05em;font-family:Arial,sans-serif;">${nextIsVE ? 'Virtual Experience' : nextIsCert ? 'Certification' : 'Course'}</p>`}
        </td>
        <td width="36" style="padding:0 12px;text-align:center;vertical-align:middle;">
          <span style="font-size:18px;color:#9ca3af;font-family:Arial,sans-serif;"></span>
        </td>
      </tr>
    </table>

    ${cta('Start Now', nextUrl)}

    <br>
    <p><b>Keep going,</b></p>
  `;

  return shell(content, branding);
}

// -- 15. Assignment Graded ---
export function assignmentGradedEmail(data: {
  name: string;
  assignmentTitle: string;
  score: number | null;
  passed: boolean;
  feedback?: string | null;
  studentUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, score, passed, feedback, studentUrl, branding } = data;

  const scoreHtml = score != null
    ? `<p style="font-size:32px;font-weight:900;margin:8px 0;color:${passed ? '#10b981' : '#ef4444'};">${score}<span style="font-size:16px;font-weight:600;color:#6b7280;">/100</span></p>`
    : '';

  const feedbackHtml = feedback
    ? `<div style="margin-top:20px;padding:16px;border-radius:0;background:${passed ? '#f0fdf4' : '#fff1f2'};border:1px solid ${passed ? '#bbf7d0' : '#fecdd3'};">
        <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${passed ? '#059669' : '#e11d48'};">Instructor Feedback</p>
        <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${feedback}</p>
       </div>`
    : '';

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p style="color:#555;">Your assignment <b>${esc(assignmentTitle)}</b> has been graded.</p>

    <div style="margin:20px 0;padding:20px;border-radius:0;background:#f9fafb;border:1px solid #e5e7eb;text-align:center;">
      ${scoreHtml}
      <span style="display:inline-block;padding:4px 14px;border-radius:0;font-size:12px;font-weight:700;background:${passed ? '#dcfce7' : '#fee2e2'};color:${passed ? '#15803d' : '#dc2626'};">
        ${passed ? 'PASSED' : 'FAILED'}
      </span>
    </div>

    ${feedbackHtml}

    ${passed
      ? `<p style="color:#555;margin-top:20px;">Great work! Log in to view your full results.</p>`
      : `<p style="color:#555;margin-top:20px;">Don't be discouraged. You can review the feedback and resubmit.</p>`
    }

    ${cta('View Assignment', studentUrl)}

    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Grace Period Warning ---
export function gracePeriodWarningEmail(data: {
  name: string;
  graceEndDate: string;
  daysLeft: number;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, graceEndDate, daysLeft, dashboardUrl, branding } = data;
  const urgency = daysLeft <= 1
    ? 'Your grace period ends tomorrow'
    : `Your grace period ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
  const urgencyColor = daysLeft <= 1 ? '#dc2626' : '#d97706';

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>A payment installment on your account is overdue. As a courtesy, you have been granted a <b>grace period</b> and your access remains active for now.</p>

    <div style="margin:20px 0;padding:20px;background:#fffbeb;border-left:4px solid ${urgencyColor};border-radius:0;">
      <p style="margin:0 0 6px;font-size:14px;font-weight:700;color:${urgencyColor};">${urgency}</p>
      <p style="margin:0;font-size:14px;color:#92400e;">Make your payment before <b>${graceEndDate}</b> to avoid losing access to your course materials.</p>
    </div>

    <p style="color:#374151;">Once the grace period expires, your access will be restricted until your balance is settled. Please log in and submit a payment confirmation as soon as possible.</p>

    <div style="margin:20px 0;padding:16px;background:#f9fafb;border-radius:0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">How to pay</p>
      <ol style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:2;">
        <li>Go to your dashboard and open the <b>Payments</b> section</li>
        <li>Submit a payment confirmation with your method, reference, and amount</li>
        <li>Your access will be restored once an admin approves your payment</li>
      </ol>
    </div>

    ${cta('Go to Payments', `${dashboardUrl}#payments`)}

    <p style="color:#6b7280;font-size:13px;">If you have already made this payment, please submit a confirmation so our team can verify and restore your full access.</p>

    <br>
    <p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Assignment Due Reminder ---
export function assignmentDueReminderEmail(data: {
  name: string;
  assignmentTitle: string;
  dueDate: string;
  daysLeft: number;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, dueDate, daysLeft, dashboardUrl, branding } = data;
  const urgency = daysLeft <= 0 ? 'is due today' : daysLeft === 1 ? 'is due tomorrow' : `is due in ${daysLeft} days`;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>This is a friendly reminder that your assignment <b>${esc(assignmentTitle)}</b> ${urgency}${dueDate ? ` (${esc(dueDate)})` : ''}, and we have not received your submission yet.</p>

    <div style="margin:20px 0;padding:20px;background:#fffbeb;border-left:4px solid #d97706;border-radius:0;">
      <p style="margin:0;font-size:14px;font-weight:700;color:#d97706;">Please submit before the deadline so you do not lose marks.</p>
    </div>

    <p style="color:#374151;">Log in to your dashboard, open the assignment, and submit your work.</p>

    ${cta('Open Assignment', dashboardUrl)}

    <p style="color:#6b7280;font-size:13px;">If you have already submitted, you can ignore this message.</p>

    <br>
    <p><b>Best of luck,</b></p>
  `;
  return shell(content, branding);
}

// -- Overdue Notification ---
export function overdueNotificationEmail(data: {
  name: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, dashboardUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Your account has an <b>overdue payment</b>. Your access to course materials has been restricted until your balance is settled.</p>

    <div style="margin:20px 0;padding:20px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:0;">
      <p style="margin:0;font-size:14px;font-weight:700;color:#dc2626;">Action required: Please make your payment as soon as possible.</p>
    </div>

    <div style="margin:20px 0;padding:16px;background:#f9fafb;border-radius:0;border:1px solid #e5e7eb;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;">How to complete your payment</p>
      <ol style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:2;">
        <li>Log in and open the <b>Payments</b> section of your dashboard</li>
        <li>Click the <b>Make Payment</b> tab to view available payment options</li>
        <li>Make your payment using <b>Bank Transfer</b>, <b>Mobile Money</b>, or <b>Online Payment</b></li>
        <li>Once payment is made, return to the Payments section and submit a <b>payment confirmation</b> with your method, reference, and amount</li>
        <li>Your access will be restored once our team verifies and approves your confirmation</li>
      </ol>
    </div>

    ${cta('Go to Payments', `${dashboardUrl}#payments`)}

    <p style="color:#6b7280;font-size:13px;">If you have already made this payment, please submit a payment confirmation so our team can verify and restore your access promptly.</p>
    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Payment Receipt ---
export function paymentReceiptEmail(data: {
  name: string;
  amount: number;
  currency: string;
  paidAt: string;
  method?: string | null;
  reference?: string | null;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, paidAt, method, reference, dashboardUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>A payment has been recorded on your account. Here are the details:</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#374151;">
        <tr><td style="padding:4px 0;font-weight:700;width:140px;">Amount</td><td>${currency} ${Number(amount).toLocaleString()}</td></tr>
        <tr><td style="padding:4px 0;font-weight:700;">Date</td><td>${paidAt}</td></tr>
        ${method ? `<tr><td style="padding:4px 0;font-weight:700;">Method</td><td>${esc(method)}</td></tr>` : ''}
        ${reference ? `<tr><td style="padding:4px 0;font-weight:700;">Reference</td><td>${esc(reference)}</td></tr>` : ''}
      </table>
    </div>

    <p style="color:#374151;">You can view your full payment history and outstanding balance on your dashboard.</p>

    ${cta('View Payments', `${dashboardUrl}#payments`)}

    <p style="color:#6b7280;font-size:13px;">If you did not expect this payment record, please contact our support team.</p>
    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Payment Confirmation Acknowledged (student submitted) ---
export function subscriptionPaymentAssignedEmail(data: {
  name: string;
  planName: string;
  amount: number;
  currency: string;
  dueDate: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, planName, amount, currency, dueDate, dashboardUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>A payment request has been assigned for your <b>${esc(planName)}</b> subscription.</p>
    <div style="margin:20px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#374151;">
        <tr><td style="padding:4px 0;font-weight:700;width:140px;">Amount</td><td>${esc(currency)} ${Number(amount).toLocaleString()}</td></tr>
        <tr><td style="padding:4px 0;font-weight:700;">Payment deadline</td><td>${esc(dueDate)}</td></tr>
      </table>
    </div>
    <p style="color:#374151;">Open the Payments section to view the available payment options and submit your confirmation. Access starts after your payment is approved.</p>
    ${cta('View Payment Request', `${dashboardUrl}#payments`)}
    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Payment Confirmation Acknowledged (student submitted) ---
export function paymentConfirmationAcknowledgedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>We have received your payment confirmation of <b>${currency} ${Number(amount).toLocaleString()}</b>. Our team will review and approve it shortly.</p>

    <div style="margin:20px 0;padding:16px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:0;">
      <p style="margin:0;font-size:14px;color:#1d4ed8;">Once approved, your account balance will be updated and your access status will be refreshed automatically.</p>
    </div>

    <p style="color:#374151;">You can track the status of your confirmation in the <b>Payments</b> section of your dashboard.</p>

    ${cta('View Payments', `${dashboardUrl}#payments`)}

    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Payment Confirmation Approved (student notified) ---
export function paymentConfirmationApprovedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  adminNotes?: string | null;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, adminNotes, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Great news! Your payment confirmation of <b>${currency} ${Number(amount).toLocaleString()}</b> has been <b style="color:#16a34a;">approved</b>.</p>

    <div style="margin:20px 0;padding:16px;background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0;">
      <p style="margin:0;font-size:14px;color:#15803d;">Your account balance has been updated and your access status has been refreshed.</p>
    </div>

    ${adminNotes ? `<p style="color:#374151;"><b>Note from our team:</b> ${esc(adminNotes)}</p>` : ''}

    <p style="color:#374151;">You can view your updated payment history in the <b>Payments</b> section of your dashboard.</p>

    ${cta('View Payments', `${dashboardUrl}#payments`)}

    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Payment Confirmation Rejected (student notified) ---
export function paymentConfirmationRejectedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  adminNotes?: string | null;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, adminNotes, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Unfortunately, your payment confirmation of <b>${currency} ${Number(amount).toLocaleString()}</b> could not be verified and has been <b style="color:#dc2626;">rejected</b>.</p>

    ${adminNotes ? `
    <div style="margin:20px 0;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:0;">
      <p style="margin:0;font-size:14px;color:#b91c1c;"><b>Reason:</b> ${esc(adminNotes)}</p>
    </div>` : ''}

    <p style="color:#374151;">Please double-check your payment details and resubmit your confirmation, or contact our support team if you believe this is an error.</p>

    ${cta('Resubmit Confirmation', `${dashboardUrl}#payments`)}

    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Admin: New Payment Confirmation Pending ---
export function adminPaymentConfirmationEmail(data: {
  studentName: string;
  studentEmail: string;
  amount: number;
  currency: string;
  adminUrl: string;
  branding?: EmailBranding;
}) {
  const { studentName, studentEmail, amount, currency, adminUrl, branding } = data;
  const content = `
    <p><b>Hi,</b></p>
    <p>A student has submitted a payment confirmation pending your review.</p>

    <div style="margin:20px 0;padding:20px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0;">
      <table cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;color:#374151;">
        <tr><td style="padding:4px 0;font-weight:700;width:140px;">Student</td><td>${esc(studentName)}</td></tr>
        <tr><td style="padding:4px 0;font-weight:700;">Email</td><td>${esc(studentEmail)}</td></tr>
        <tr><td style="padding:4px 0;font-weight:700;">Amount</td><td>${currency} ${Number(amount).toLocaleString()}</td></tr>
      </table>
    </div>

    ${cta('Review Confirmation', adminUrl)}

    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Cohort Invitation ---
export function cohortInviteEmail(data: {
  cohortName: string;
  signupUrl: string;
  branding?: EmailBranding;
}) {
  const { cohortName, signupUrl, branding } = data;
  const appName = branding?.appName || 'the platform';

  const content = `
    <p><b>Hi there,</b></p>
    <p>You have been invited to join <b>${esc(cohortName)}</b> on ${appName}.</p>
    <p>Click the button below to create your account and get started.</p>

    ${cta('Accept Invitation', signupUrl)}

    <p style="color:#888;font-size:13px;">If you weren't expecting this invitation, you can safely ignore this email.</p>
    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Provisioned Student Account ---
export function studentAccountCreatedEmail(data: {
  name?: string | null;
  cohortName: string;
  setupUrl: string;
  branding?: EmailBranding;
}) {
  const { name, cohortName, setupUrl, branding } = data;
  const appName = branding?.appName || 'the platform';

  const content = `
    <p><b>Hi ${esc(name || 'there')},</b></p>
    <p>Your student account for <b>${esc(cohortName)}</b> on ${esc(appName)} is ready.</p>
    <p>You do not need to create an account. Set your password with the button below to get started.</p>

    ${cta('Set Password', setupUrl)}

    <p style="color:#888;font-size:13px;">If you were not expecting this account, you can safely ignore this email.</p>
    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 16. Assignment Submission Confirmation ---
export function submissionConfirmEmail(data: {
  name: string;
  assignmentTitle: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, dashboardUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Your submission for <b>${esc(assignmentTitle)}</b> has been received. Your instructor will review it and share feedback with you soon.</p>
    <div style="margin:20px 0;padding:16px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
      <p style="margin:0;font-weight:600;color:#15803d;">Submission received</p>
      <p style="margin:4px 0 0;font-size:13px;color:#166534;">${esc(assignmentTitle)}</p>
    </div>
    ${cta('View Submission', dashboardUrl)}
    <p>Well done for submitting. Keep up the great work!</p>
    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

export function groupSubmissionReceivedEmail(data: {
  name: string;
  assignmentTitle: string;
  groupName: string;
  submittedByName?: string | null;
  isParticipant: boolean;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, groupName, submittedByName, isParticipant, dashboardUrl, branding } = data;
  const participantBlock = isParticipant
    ? `<div style="margin:20px 0;padding:16px;background:#f0fdf4;border-left:4px solid #22c55e;border-radius:0;">
        <p style="margin:0;font-weight:700;color:#15803d;">You were marked as a participant</p>
        <p style="margin:4px 0 0;font-size:13px;color:#166534;">When this assignment is graded, the grade will be added to your record.</p>
      </div>`
    : `<div style="margin:20px 0;padding:16px;background:#fffbeb;border-left:4px solid #f59e0b;border-radius:0;">
        <p style="margin:0;font-weight:700;color:#92400e;">You were not marked as a participant</p>
        <p style="margin:4px 0 0;font-size:13px;color:#78350f;">You can still view the group submission. If you believe this is incorrect, contact your group leader or instructor.</p>
      </div>`;

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>Your group has submitted <b>${esc(assignmentTitle)}</b>.</p>
    <div style="margin:20px 0;padding:16px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:0;">
      ${detailBlock('Group', esc(groupName))}
      ${submittedByName ? detailBlock('Submitted by', esc(submittedByName)) : ''}
    </div>
    ${participantBlock}
    ${cta('View Assignment', dashboardUrl)}
    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- 17. At-Risk Student Digest (to instructors) ---
export function atRiskDigestEmail(data: {
  instructorName: string;
  students: { name: string; email: string; riskScore: number; reasons: string[] }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { instructorName, students, dashboardUrl, branding } = data;

  const rows = students.map(s => `
    <tr style="border-bottom:1px solid #e5e7eb;">
      <td style="padding:8px 12px;font-size:13px;color:#111;">${esc(s.name)}</td>
      <td style="padding:8px 12px;font-size:13px;color:#6b7280;">${esc(s.email)}</td>
      <td style="padding:8px 12px;">
        <span style="background:${s.riskScore >= 5 ? '#fee2e2' : '#fef3c7'};color:${s.riskScore >= 5 ? '#dc2626' : '#d97706'};padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;">
          ${s.riskScore >= 5 ? 'HIGH RISK' : 'AT RISK'}
        </span>
      </td>
      <td style="padding:8px 12px;font-size:12px;color:#6b7280;">${s.reasons.join(', ')}</td>
    </tr>`).join('');

  const content = `
    <p><b>Hi ${esc(instructorName || 'there')},</b></p>
    <p>Here is your weekly at-risk student digest. These <b>${students.length}</b> student${students.length !== 1 ? 's' : ''} may need your attention this week.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Student</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Email</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Risk</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Signals</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${cta('Open Dashboard', dashboardUrl)}
    <p style="font-size:12px;color:#6b7280;">Sent every Monday. Students are flagged when inactive 7+ days, stalled on content, or have overdue payments.</p>
    <br><p><b>Best regards,</b></p>
  `;
  return shell(content, branding);
}

// -- Badge Earned (standalone notification for course completion badges) ---
export function badgeEarnedEmail(data: {
  name: string;
  contentTitle: string;
  contentType: 'course' | 'virtual_experience' | 'learning_path';
  badgeName: string;
  badgeImageUrl: string;
  certUrl: string;
  badgesUrl: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, badgeName, badgeImageUrl, certUrl, badgesUrl, branding } = data;
  const label = contentType === 'course' ? 'course' : contentType === 'virtual_experience' ? 'virtual experience' : 'learning path';
  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p style="color:#374151;">Congratulations on completing <b>${esc(contentTitle)}</b>! You have earned a new badge and your certificate is ready.</p>
    ${badgeBlock(badgeName, badgeImageUrl, badgesUrl)}
    <p style="color:#374151;">Head to your profile to download the badge, add it to LinkedIn, or share it with your network.</p>
    ${cta('View Certificate', certUrl)}
    <br>
    <p><b>Well done,</b></p>
  `;
  return shell(content, branding);
}

// -- Live Session Attendance Report (to instructors + admins) ---
export function attendanceReportEmail(data: {
  eventTitle: string;
  sessionDate: string;
  attended: { name: string; email: string; joinedAt: string }[];
  missed: { name: string; email: string }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { eventTitle, sessionDate, attended, missed, dashboardUrl, branding } = data;
  const total = attended.length + missed.length;
  const dateLabel = new Date(sessionDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const tableHead = `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Name</th>
          <th style="padding:8px 12px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Email</th>
          <th style="padding:8px 12px;text-align:center;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Status</th>
          <th style="padding:8px 12px;text-align:right;font-weight:600;color:#374151;border-bottom:2px solid #e5e7eb;">Joined At</th>
        </tr>
      </thead>
      <tbody>`;

  const attendedRows = attended.map(s => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;color:#111;">${esc(s.name)}</td>
      <td style="padding:8px 12px;color:#6b7280;">${esc(s.email)}</td>
      <td style="padding:8px 12px;text-align:center;">
        <span style="background:#dcfce7;color:#16a34a;padding:2px 8px;font-size:11px;font-weight:700;">ATTENDED</span>
      </td>
      <td style="padding:8px 12px;text-align:right;color:#6b7280;">
        ${s.joinedAt ? new Date(s.joinedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '--'}
      </td>
    </tr>`).join('');

  const missedRows = missed.map(s => `
    <tr style="border-bottom:1px solid #f0f0f0;">
      <td style="padding:8px 12px;color:#111;">${esc(s.name)}</td>
      <td style="padding:8px 12px;color:#6b7280;">${esc(s.email)}</td>
      <td style="padding:8px 12px;text-align:center;">
        <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;font-size:11px;font-weight:700;">MISSED</span>
      </td>
      <td style="padding:8px 12px;text-align:right;color:#6b7280;">--</td>
    </tr>`).join('');

  const content = `
    <p><b>Hi,</b></p>
    <p>Here is the attendance report for today's live session.</p>

    <div style="margin:20px 0;padding:20px;background:#f0fdf4;border-left:4px solid #16a34a;">
      <p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111;">${esc(eventTitle)}</p>
      <p style="margin:0;font-size:13px;color:#16a34a;font-weight:600;">${esc(dateLabel)}</p>
    </div>

    <div style="margin:16px 0;padding:16px;background:#f9fafb;text-align:center;">
      <span style="font-size:36px;font-weight:900;color:${attended.length > 0 ? '#16a34a' : '#dc2626'};">${attended.length}</span>
      <span style="font-size:16px;color:#6b7280;"> / ${total} registered attended</span>
    </div>

    ${tableHead}${attendedRows}${missedRows}
      </tbody>
    </table>

    ${cta('View Full Attendance Report', dashboardUrl)}

    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Missed Session Nudge (to absent students) ---
export function missedSessionEmail(data: {
  name: string;
  eventTitle: string;
  sessionDate: string;
  joinUrl?: string;
  meetingLink?: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, sessionDate, joinUrl, meetingLink, dashboardUrl, branding } = data;
  const joinHref  = joinUrl || meetingLink;
  const dateLabel = new Date(sessionDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const joinBlock = joinHref ? `
    <div style="margin:20px 0;padding:16px;background:#f0f7ff;border-left:4px solid ${platformColor(meetingLink || joinHref)};text-align:center;">
      <p style="margin:0 0 10px;font-weight:600;color:#333;">${platformName(meetingLink || joinHref)}</p>
      <a href="${joinHref}" style="display:inline-block;padding:10px 24px;background:${platformColor(meetingLink || joinHref)};color:white;border-radius:0;text-decoration:none;font-weight:600;font-size:14px;">Join Next Session</a>
    </div>` : cta('Go to Dashboard', dashboardUrl);

  const content = `
    <p><b>Hi ${esc(name)},</b></p>
    <p>We noticed you missed <b>${esc(eventTitle)}</b> on <b>${esc(dateLabel)}</b>.</p>
    <p style="color:#374151;">No worries - we would love to see you at the next session. The link below will take you straight in.</p>

    ${joinBlock}

    <p style="color:#6b7280;font-size:13px;">If you have any questions or ran into an issue joining, please reply to this email and we will help you out.</p>
    <br><p><b>Best regards,</b></p>
  `;

  return shell(content, branding);
}

// -- Open Certificate (manual issuance for events / programs) ---
export function openCertificateEmail(data: {
  recipientName: string;
  programName:   string;
  issuedDate:    string;
  certUrl:       string;
  branding?:     EmailBranding;
}) {
  const { recipientName, programName, issuedDate, certUrl, branding } = data;
  const content = `
    <p><b>Hi ${esc(recipientName)},</b></p>
    <p style="color:#374151;">Congratulations! Your certificate for <b>${esc(programName)}</b> is ready.</p>
    ${detailBlock('Program', esc(programName))}
    ${detailBlock('Issued', esc(issuedDate))}
    <p style="color:#374151;margin-top:16px;">You can view, download, and share your certificate using the link below. It includes a button to add it directly to your LinkedIn profile.</p>
    ${cta('View Certificate', certUrl)}
    <br>
    <p><b>Congratulations,</b></p>
  `;
  return shell(content, branding);
}

export function groupAssignedEmail(data: {
  recipientName: string;
  groupName:     string;
  cohortName:    string;
  description?:  string;
  members:       { full_name: string; is_leader: boolean }[];
  dashboardUrl:  string;
  branding?:     EmailBranding;
}) {
  const { recipientName, groupName, cohortName, description, members, dashboardUrl, branding } = data;

  const leader = members.find(m => m.is_leader);
  const memberRows = members
    .map(m => `<li style="padding:4px 0;color:#374151;">${esc(m.full_name)}${m.is_leader ? ' <span style="font-size:11px;font-weight:700;color:#2563eb;text-transform:uppercase;">Leader</span>' : ''}</li>`)
    .join('');

  const content = `
    <p><b>Hi ${esc(recipientName)},</b></p>
    <p style="color:#374151;">You have been added to a group for <b>${esc(cohortName)}</b>.</p>
    <h2 style="font-size:20px;font-weight:800;color:#111827;margin:16px 0 4px;">${esc(groupName)}</h2>
    ${description ? `<p style="color:#6b7280;margin:0 0 16px;">${esc(description)}</p>` : ''}
    ${leader ? `${detailBlock('Group Leader', esc(leader.full_name))}` : ''}
    <p style="font-weight:600;color:#374151;margin:16px 0 8px;">Group Members</p>
    <ul style="margin:0;padding-left:20px;">${memberRows}</ul>
    <p style="color:#374151;margin-top:16px;">Your group assignments will appear on your student dashboard. The group leader will complete and submit on behalf of the group.</p>
    ${cta('Go to Dashboard', dashboardUrl)}
    <br>
    <p><b>Good luck!</b></p>
  `;
  return shell(content, branding);
}
