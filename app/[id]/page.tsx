'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, CheckCircle2, ArrowRight, MapPin, Building2, ExternalLink, Calendar, Download, Copy, Check, Star, BookOpen, FileText, Zap, Clock, Lock } from 'lucide-react';
import { AnimatedField, ThemeColor, ThemeMode } from '@/components/AnimatedField';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { courseXpOnOffer } from '@/lib/course-progress';
import { CourseTaker } from '@/components/CourseTaker';
import dynamic from 'next/dynamic';
const VirtualExperienceTaker = dynamic(() => import('@/components/VirtualExperienceTaker'), { ssr: false });
const CertificationTaker = dynamic(() => import('@/components/CertificationTaker'), { ssr: false });
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { sanitizeRichText } from '@/lib/sanitize';
import { getFontById } from '@/lib/fonts';
import { buildGoogleCalUrl, buildOutlookCalUrl, buildYahooCalUrl, downloadIcs, buildCalendarFields, isRecurring } from '@/lib/calendar-links';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';
import { StudentModeBanner } from '@/components/student/StudentModeBanner';
import { publicGuide, GuideAvatar, GuideByline, GuideCard } from '@/components/ve/guide';
import { clearStudentMode, getStudentMode, installStudentModeFetchBridge, type StudentModeContext } from '@/lib/student-mode-client';
import {
  lowestUnlockPrice,
  sellablePlans,
  unlockDurationLabel,
  unlockMoney,
  type UnlockInfo,
} from '@/lib/unlock-pricing';

// --- Social platform data (mirrors page.tsx) ---
const SOCIAL_PLATFORMS = [
  { id: 'linkedin',  name: 'LinkedIn',    placeholder: 'linkedin.com/in/username' },
  { id: 'twitter',   name: 'X (Twitter)', placeholder: 'x.com/username'           },
  { id: 'instagram', name: 'Instagram',   placeholder: 'instagram.com/username'   },
  { id: 'facebook',  name: 'Facebook',    placeholder: 'facebook.com/username'    },
  { id: 'tiktok',    name: 'TikTok',      placeholder: 'tiktok.com/@username'     },
  { id: 'youtube',   name: 'YouTube',     placeholder: 'youtube.com/@channel'     },
  { id: 'github',    name: 'GitHub',      placeholder: 'github.com/username'      },
  { id: 'website',   name: 'Website',     placeholder: 'https://yourwebsite.com' },
];

const SOCIAL_SVGS: Record<string, React.ReactNode> = {
  linkedin: (
    <svg viewBox="0 0 24 24" fill="#0A66C2" className="w-full h-full">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  ),
  twitter: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="w-full h-full">
      <defs>
        <linearGradient id="ig-pub" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433"/>
          <stop offset="25%" stopColor="#e6683c"/>
          <stop offset="50%" stopColor="#dc2743"/>
          <stop offset="75%" stopColor="#cc2366"/>
          <stop offset="100%" stopColor="#bc1888"/>
        </linearGradient>
      </defs>
      <path fill="url(#ig-pub)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" fill="#1877F2" className="w-full h-full">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.27 8.27 0 004.84 1.55V6.79a4.85 4.85 0 01-1.07-.1z"/>
    </svg>
  ),
  youtube: (
    <svg viewBox="0 0 24 24" fill="#FF0000" className="w-full h-full">
      <path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  ),
  github: (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-full h-full">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
    </svg>
  ),
  website: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-full h-full">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
    </svg>
  ),
};

const buttonThemes: Record<ThemeColor, string> = {
  forest:  'bg-[#00bf63] hover:bg-[#00a050] text-white',
  lime:    'bg-[#ADEE66] hover:bg-[#9ad94d] text-black',
  emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white',
  rose:    'bg-rose-500 hover:bg-rose-600 text-white',
  amber:   'bg-amber-500 hover:bg-amber-600 text-white',
  ocean:   'bg-[#3E93FF] hover:bg-[#2f7fe0] text-white',
};

function stripExerciseSecrets(questions: any[] = []) {
  return questions.map(q => {
    if (!q || typeof q !== 'object') return q;
    const { sqlSolution, sqlExpectedResult, pythonSolution, pythonExpectedOutput, ...safeQuestion } = q;
    if (q.type === 'python_exercise') {
      return {
        ...safeQuestion,
        pythonHasExpectedOutput: !!String(pythonExpectedOutput ?? '').trim(),
      };
    }
    if (q.type === 'sql_exercise') {
      return {
        ...safeQuestion,
        sqlHasExpectedResult: !!sqlExpectedResult || !!String(sqlSolution ?? '').trim(),
      };
    }
    return safeQuestion;
  });
}

/* --- Theme tokens (mirrors profile page) --- */
const LIGHT_P = {
  page:         '#ffffff',
  blob:         '#ADEE66',
  nav:          '#1f1bc3',
  navBorder:    'rgba(0,0,0,0.07)',
  navText:      '#ffffff',
  logoText:     '#111',
  card:         'white',
  cardBorder:   'rgba(0,0,0,0.07)',
  cardShadow:   '0 2px 20px rgba(0,0,0,0.06)',
  title:        '#111',
  body:         '#555',
  muted:        '#888',
  label:        '#555',
  sectionBg:    '#eef0f3',
  sectionBorder:'rgba(0,0,0,0.07)',
  divider:      'rgba(0,0,0,0.08)',
  statusBg:     '#e8f5ee',
  statusText:   '#00bf63',
  pillBg:       '#eef0f3',
  pillText:     '#555',
  shareBg:      '#eef0f3',
  pastBg:       '#fef9c3',
  pastText:     '#854d0e',
  footerText:   '#999',
  footerBold:   '#111',
};
const DARK_P = {
  page:         '#17181E',
  blob:         '#1a3a1a',
  nav:          'rgba(23,24,30,0.9)',
  navBorder:    'rgba(255,255,255,0.07)',
  navText:      '#aaa',
  logoText:     '#f0f0f0',
  card:         '#1E1F26',
  cardBorder:   'rgba(255,255,255,0.07)',
  cardShadow:   '0 2px 20px rgba(0,0,0,0.4)',
  title:        '#f0f0f0',
  body:         '#aaa',
  muted:        '#777',
  label:        '#aaa',
  sectionBg:    '#242630',
  sectionBorder:'rgba(255,255,255,0.07)',
  divider:      'rgba(255,255,255,0.07)',
  statusBg:     'rgba(173,238,102,0.12)',
  statusText:   '#ADEE66',
  pillBg:       '#242630',
  pillText:     '#aaa',
  shareBg:      '#242630',
  pastBg:       'rgba(234,179,8,0.12)',
  pastText:     '#fbbf24',
  footerText:   '#555',
  footerBold:   '#aaa',
};

const formatDateParts = (dateString?: string) => {
  if (!dateString) return null;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return null;

    const monthShort = date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const day = date.toLocaleDateString('en-US', { day: 'numeric' });
    const fullDate = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    return { monthShort, day, fullDate };
  } catch (e) {
    return null;
  }
};

const formatLocation = (locationString?: string) => {
  if (!locationString) return { main: '', sub: '' };
  const parts = locationString.split(',');
  if (parts.length > 1) {
    return {
      main: parts[0].trim(),
      sub: parts.slice(1).join(',').trim()
    };
  }
  return { main: locationString, sub: '' };
};

// Detect meeting platform from a URL
const PLATFORM_LOGOS = {
  meet:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Meet.png',
  zoom:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Zoom.png',
  teams: 'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Teams.png',
};

const detectPlatform = (url?: string): { name: string; color: string; icon: React.ReactNode } | null => {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes('meet.google.com')) return {
    name: 'Google Meet', color: '#1a73e8',
    icon: <img src={PLATFORM_LOGOS.meet} alt="Google Meet" style={{ width: 20, height: 20, objectFit: 'contain' }}/>,
  };
  if (u.includes('zoom.us')) return {
    name: 'Zoom', color: '#2D8CFF',
    icon: <img src={PLATFORM_LOGOS.zoom} alt="Zoom" style={{ width: 20, height: 20, objectFit: 'contain' }}/>,
  };
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return {
    name: 'Microsoft Teams', color: '#5059C9',
    icon: <img src={PLATFORM_LOGOS.teams} alt="Microsoft Teams" style={{ width: 20, height: 20, objectFit: 'contain' }}/>,
  };
  return { name: 'Join Meeting', color: '#555', icon: null };
};

export default function PublicFormPage() {
  const { logoUrl, logoDarkUrl } = useTenant();
  const { id } = useParams();
  const [form, setForm] = useState<any>(null);
  const [lockedPreview, setLockedPreview] = useState<any>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [studentMode, setStudentModeContext] = useState<StudentModeContext | null>(() => getStudentMode());
  const [studentTheme, setStudentTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return localStorage.getItem('ff-theme') === 'dark' ? 'dark' : 'light';
  });

  // Read student's saved theme preference (used for virtual experiences, course
  // overview, and the 'auto' appearance mode, which follows the app theme)
  useEffect(() => {
    const handler = () => {
      const v = localStorage.getItem('ff-theme') as 'light' | 'dark' | null;
      setStudentTheme(v === 'dark' ? 'dark' : 'light');
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  // Keep certifications aligned with the learner's dashboard preference. Other
  // public experiences continue to respect the creator's chosen appearance.
  useEffect(() => {
    if (!form) return;
    const rawMode = form.config?.mode ?? 'dark';
    const resolved = form.config?.isCertification
      ? studentTheme
      : rawMode === 'auto' ? studentTheme : rawMode;
    const prev = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', resolved);
    return () => {
      if (prev) document.documentElement.setAttribute('data-theme', prev);
      else document.documentElement.removeAttribute('data-theme');
    };
  }, [form, studentTheme]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [joinErr, setJoinErr] = useState('');
  const [isCohortMember, setIsCohortMember] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [relatedForms, setRelatedForms] = useState<any[]>([]);
  const [relatedAssignment, setRelatedAssignment] = useState<{ id: string; title: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [certificateId, setCertificateId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [attendeeCount, setAttendeeCount] = useState<number | null>(null);
  // Virtual experience flow
  const [projectStarted,      setProjectStarted]      = useState(false);
  const [projectStudentName,  setProjectStudentName]  = useState('');
  const [projectStudentEmail, setProjectStudentEmail] = useState('');
  const [projectUserId,       setProjectUserId]       = useState('');
  const [projectSessionToken, setProjectSessionToken] = useState('');
  const [projectProgress,     setProjectProgress]     = useState<Record<string,any>>({});
  const [projectInitModId,    setProjectInitModId]    = useState('');
  const [projectInitLesId,    setProjectInitLesId]    = useState('');
  const [projectPreviewMode,  setProjectPreviewMode]  = useState(false);
  // Course sign-up flow
  const [courseStarted, setCourseStarted] = useState(true);
  const [retakeKey, setRetakeKey] = useState(0);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [prefilledName, setPrefilledName] = useState('');
  const [prefilledEmail, setPrefilledEmail] = useState('');
  const [calPopupOpen, setCalPopupOpen] = useState(false);
  const [calBusy, setCalBusy] = useState(false);
  const [creatorProfile, setCreatorProfile] = useState<any>(null);
  const [profilePopupOpen, setProfilePopupOpen] = useState(false);
  const profileHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Certification taker auth (resolved after the content loads; certifications require login).
  const [certAuth, setCertAuth] = useState<{ name: string; email: string; token: string } | null>(null);

  useEffect(() => installStudentModeFetchBridge(), []);

  const copyToClipboard = (text: string, id: string) => {
    const done = () => { setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(done).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.focus(); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta); done();
      });
    } else {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta); done();
    }
  };

  useEffect(() => {
    const fetchForm = async () => {
      setLockedPreview(null);
      // Restore session first so the auth token is attached to the forms query.
      // Running the query in parallel with getUser() meant it fired as anon,
      // which blocked RLS on courses/VEs.
      const { data: { session: authSession } } = await supabase.auth.getSession();
      setSignedOut(!authSession?.access_token);
      // Content offered to everyone is readable without an account, so a course would otherwise
      // open straight into its material for a signed-out visitor. Hold the overview instead --
      // they can see what it is, and starting it asks them to sign in.
      if (!authSession?.access_token) setCourseStarted(false);
      const { data: { user } } = await supabase.auth.getUser();
      // Validate any persisted Student Mode session; a stale one (e.g. left by a
      // prior admin on a shared browser) is cleared so it cannot drive this page.
      let activeStudentMode = getStudentMode();
      if (activeStudentMode) {
        try {
          const check = await fetch('/api/student-mode', {
            headers: authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {},
          });
          if (!check.ok) { clearStudentMode(); activeStudentMode = null; }
        } catch { /* network error: leave RLS to protect reads */ }
      }
      setStudentModeContext(activeStudentMode);
      const effectiveUserId = activeStudentMode?.studentId ?? user?.id;

      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id as string);
      const lookupField = isUUID ? 'id' : 'slug';
      const requestedType = new URLSearchParams(window.location.search).get('catalogueType');

      // Query all content tables. Certifications are resolved separately via the service-role API
      // (their base table denies student SELECT because it holds exam answer keys).
      const [{ data: course }, { data: event }, { data: ve }] = await Promise.all([
        supabase.from('courses').select('*').eq(lookupField, id).maybeSingle(),
        supabase.from('events').select('*').eq(lookupField, id).maybeSingle(),
        supabase.from('virtual_experiences').select('*').eq(lookupField, id).maybeSingle(),
      ]);

      // Reconstruct a form-compatible object with config shape for the viewer
      let data: any = null;
      if (course && (!requestedType || requestedType === 'course')) {
        data = { ...course, content_type: 'course', config: {
          title: course.title, description: course.description,
          isCourse: true, questions: stripExerciseSecrets(course.questions ?? []), fields: course.fields ?? [],
          passmark: course.passmark, courseTimer: course.course_timer,
          learnOutcomes: course.learn_outcomes,
          pointsSystem: pointsSystemFromCourseRow(course),
          postSubmission: course.post_submission,
          coverImage: course.cover_image, deadline_days: course.deadline_days,
          theme: course.theme, mode: course.mode, font: course.font, customAccent: course.custom_accent,
          lessonTiming: course.lesson_timing ?? undefined,
          showAnswers:  course.show_answers  ?? 'per_question',
          maxAttempts:  course.max_attempts  ?? 0,
          enableAiTutor: course.ai_tutor_enabled ?? false,
        }};
      } else if (event && !requestedType) {
        data = { ...event, content_type: 'event', config: {
          title: event.title, description: event.description,
          fields: event.fields ?? [],
          eventDetails: { isEvent: true, date: event.event_date, time: event.event_time,
            timezone: event.timezone, location: event.location, eventType: event.event_type,
            capacity: event.capacity, meetingLink: event.meeting_link, isPrivate: event.is_private,
            speakers: event.speakers ?? [] },
          postSubmission: event.post_submission, coverImage: event.cover_image,
          deadline_days: event.deadline_days, theme: event.theme, mode: event.mode,
          font: event.font, customAccent: event.custom_accent,
        }};
      } else if (ve && (!requestedType || requestedType === 'virtual_experience')) {
        data = { ...ve, content_type: 'virtual_experience', config: {
          title: ve.title, description: ve.description,
          isVirtualExperience: true, modules: ve.modules ?? [],
          industry: ve.industry, difficulty: ve.difficulty, role: ve.role, company: ve.company,
          duration: ve.duration, tools: ve.tools, toolLogos: ve.tool_logos ?? {}, tagline: ve.tagline, background: ve.background,
          learnOutcomes: ve.learn_outcomes, managerName: ve.manager_name, managerTitle: ve.manager_title,
          guideId: ve.guide_id, guideSnapshot: ve.guide_snapshot,
          dataset: ve.dataset, coverImage: ve.cover_image, deadline_days: ve.deadline_days,
          theme: ve.theme, mode: ve.mode, font: ve.font, customAccent: ve.custom_accent,
        }};
      }

      // Certifications: resolved through the service-role API, which access-checks the student and
      // returns answer-stripped questions (the base table is not student-readable).
      if (!data && (!requestedType || requestedType === 'certification')) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const res = await fetch('/api/certification-attempt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
            body: JSON.stringify({ action: 'get-exam', certification_id: id }),
          });
          if (res.ok) {
            const { certification } = await res.json();
            if (certification) data = { id: certification.id, slug: certification.slug, user_id: certification.user_id, content_type: 'certification', config: certification.config };
          }
        } catch { /* fall through to not-found */ }
      }

      // RLS correctly hides the authored row when this learner has no access. In that case, ask
      // the catalogue endpoint for display-only metadata so this existing detail route can show
      // its locked state without exposing lessons, modules, questions, or answer keys.
      if (!data && authSession?.access_token) {
        try {
          const typeQuery = requestedType ? `&type=${encodeURIComponent(requestedType)}` : '';
          const previewRes = await fetch(`/api/student/catalogue?ref=${encodeURIComponent(id as string)}${typeQuery}`, {
            headers: { Authorization: `Bearer ${authSession.access_token}` },
          });
          if (previewRes.ok) {
            const { item } = await previewRes.json();
            if (item?.locked && item.type === 'course') {
              data = {
                id: item.id,
                slug: item.slug,
                content_type: 'course',
                locked: true,
                unlock: item.unlock,
                config: {
                  title: item.title,
                  description: item.description,
                  category: item.category,
                  coverImage: item.coverImage,
                  isCourse: true,
                  questions: (item.outline ?? []).map((entry: any) => entry.type === 'section'
                    ? { id: entry.id, isSection: true, sectionTitle: entry.title }
                    : { id: entry.id, lesson: { title: entry.title } }),
                },
              };
              setCourseStarted(false);
            } else if (item?.locked && item.type !== 'learning_path') {
              setLockedPreview(item);
            }
          }
        } catch { /* fall through to not-found */ }
      }

      // Signed out. RLS hides paid rows and the student catalogue needs a session, so a shared
      // link to paid content used to render "Not found" -- a broken page where the sales page
      // belongs. Ask the public preview, which returns the cover, the blurb and the price and
      // deliberately no outline.
      if (!data && !authSession?.access_token) {
        try {
          const typeQuery = requestedType ? `&type=${encodeURIComponent(requestedType)}` : '';
          const publicRes = await fetch(`/api/catalogue-preview?ref=${encodeURIComponent(id as string)}${typeQuery}`);
          if (publicRes.ok) {
            const { item } = await publicRes.json();
            if (item?.locked) setLockedPreview(item);
          }
        } catch { /* fall through to not-found */ }
      }

      if (data) {
        setForm(data);
        if (data.config?.isCertification && user && effectiveUserId) {
          const { data: { session } } = await supabase.auth.getSession();
          const { data: student } = await supabase.from('students').select('full_name, email').eq('id', effectiveUserId).single();
          setCertAuth({
            name:  student?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '',
            email: student?.email || user.email || '',
            token: session?.access_token ?? '',
          });
        }
        if (data.config?.eventDetails?.isEvent) {
          const { data: count } = await supabase.rpc('get_response_count', { p_form_id: data.id });
          if (count !== null) setAttendeeCount(Number(count));
          // Fetch join token and cohort membership for the logged-in student
          if (user && effectiveUserId) {
            const [{ data: reg }, { data: student }] = await Promise.all([
              supabase.from('event_registrations').select('join_token').eq('event_id', data.id).eq('student_id', effectiveUserId).maybeSingle(),
              supabase.from('students').select('cohort_id').eq('id', effectiveUserId).maybeSingle(),
            ]);
            if (reg?.join_token) setJoinToken(reg.join_token);
            if (student?.cohort_id && (data.cohort_ids ?? []).includes(student.cohort_id)) {
              setIsCohortMember(true);
            }
          }
        }
        if (data.user_id) {
          const { data: prof } = await supabase
            .from('public_profiles')
            .select('id, username, name, bio, avatar_url, account_type, industry, location, social_links')
            .eq('id', data.user_id)
            .single();
          if (prof) setCreatorProfile(prof);
        }
        // Fetch related assignment for this course (capstone feature)
        if (data.config?.isCourse) {
          supabase
            .from('assignments')
            .select('id, title')
            .eq('related_course', data.id)
            .eq('status', 'published')
            .limit(1)
            .single()
            .then(({ data: asgn }) => { if (asgn) setRelatedAssignment(asgn); });
        }

        // Auto-resume VE: only skip cover page if the user already has saved progress
        if (user && effectiveUserId && (data.config?.isVirtualExperience || data.config?.isGuidedProject)) {
          const { data: { session } } = await supabase.auth.getSession();
          const { data: student } = await supabase.from('students').select('full_name, email, role').eq('id', effectiveUserId).single();
          const name  = student?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '';
          const email = student?.email || user.email || '';
          const isPreviewUser = !activeStudentMode && student?.role !== 'student';
          let hasProgress = false;
          if (!isPreviewUser) {
            try {
              const r = await fetch(`/api/guided-project-progress?formId=${data.id}&studentId=${effectiveUserId}`, {
                headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
              });
              if (r.ok) {
                const { attempt } = await r.json();
                if (attempt) {
                  setProjectProgress(attempt.progress || {});
                  setProjectInitModId(attempt.current_module_id || '');
                  setProjectInitLesId(attempt.current_lesson_id || '');
                  hasProgress = true;
                }
              }
            } catch {}
          }
          setProjectStudentName(name);
          setProjectStudentEmail(email);
          setProjectUserId(effectiveUserId);
          setProjectSessionToken(session?.access_token ?? '');
          setProjectPreviewMode(isPreviewUser);
          if (hasProgress) setProjectStarted(true);
        }

        // Pre-fill from logged-in student
        if (user && effectiveUserId && data.config?.isCourse) {
          const { data: student } = await supabase
            .from('students')
            .select('full_name, email')
            .eq('id', effectiveUserId)
            .single();
          const name  = student?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '';
          const email = student?.email || user.email || '';
          if (email) {
            setPrefilledName(name);
            setPrefilledEmail(email);

          }
        }
      }
      setLoading(false);
    };
    fetchForm();
  }, [id]);

  useEffect(() => {
    if (!form) return;
    const name = form.config?.title || form.title;
    if (name) document.title = name;
    return () => { document.title = process.env.NEXT_PUBLIC_APP_NAME || ''; };
  }, [form]);

  useEffect(() => {
    if (!success || !form) return;
    const ps = form.config?.postSubmission;
    if (ps?.type === 'redirect' && ps.redirectUrl) {
      try {
        const url = new URL(ps.redirectUrl);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          setTimeout(() => { window.location.href = url.toString(); }, 1800);
        }
      } catch { /* invalid URL -- skip redirect */ }
      return;
    }
    if (ps?.type === 'events' && ps.relatedEventIds?.length) {
      const ids = ps.relatedEventIds;
      Promise.all([
        supabase.from('events').select('id, slug, title, event_date, event_time, cover_image').in('id', ids),
        supabase.from('courses').select('id, slug, title, cover_image').in('id', ids),
      ]).then(([{ data: events }, { data: courses }]) => {
        const combined = [
          ...(events ?? []).map((e: any) => ({
            ...e,
            config: { title: e.title, coverImage: e.cover_image, eventDetails: { isEvent: true, date: e.event_date, time: e.event_time } },
          })),
          ...(courses ?? []).map((c: any) => ({
            ...c,
            config: { title: c.title, coverImage: c.cover_image },
          })),
        ];
        // preserve the order the instructor selected
        combined.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        setRelatedForms(combined);
      });
    }
  }, [success, form]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>, customData?: any) => {
    e.preventDefault();
    setSubmitting(true);

    let data: Record<string, any> = {};
    if (customData) {
      data = customData;
    } else {
      const formData = new FormData(e.currentTarget);
      form.config.fields?.forEach((f: any) => {
        data[f.name] = formData.get(f.name) as string;
      });
    }

    // Reject oversized payloads before hitting the DB
    if (JSON.stringify(data).length > 65536) {
      setSubmitting(false);
      alert('Submission is too large. Please shorten your responses.');
      return;
    }

    // Pre-generate UUID so we don't need SELECT after INSERT
    // (anon RLS may allow INSERT but not SELECT on responses table)
    const responseId = crypto.randomUUID();

    if (form.config?.eventDetails?.isEvent) {
      // Events are pre-enrolled via cohort assignment -- no form submission needed.
      setSubmitting(false);
      setSuccess(true);
      return;
    } else if (!form.config?.isCourse) {
      // Pure registration forms only -- courses track state in course_attempts
      const { error } = await supabase.from('responses').insert({
        id: responseId,
        form_id: form.id,
        data,
      });
      if (error) {
        console.error('[responses insert] failed:', error);
        setSubmitting(false);
        alert('Failed to submit. Please try again.');
        return;
      }
    }

    setSubmitting(false);
    setSuccess(true);
    setAttendeeCount(c => c !== null ? c + 1 : 1);
      const cfg = form.config;
      const formUrl = `${window.location.origin}/${form.slug || form.id}`;
      const eventBannerUrl = cfg.coverImage
        ? (/^https?:\/\//i.test(cfg.coverImage)
            ? cfg.coverImage
            : `${window.location.origin}/api/og/${form.id}`)
        : undefined;

      // -- Auto-issue certificate + send one combined email --
      const recipientEmail = data.email;
      const validEmail = recipientEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail);

      if (cfg.eventDetails?.isEvent) {
        // Confirmation email is now sent server-side inside /api/event-register.
        // Nothing to do here.
      } else if (cfg.isCourse && data.score !== undefined) {
        // Issue certificate first (if passed), then send one email with cert link
        let certUrl: string | undefined;

        const { data: { session: courseSession } } = await supabase.auth.getSession();

        if (data.passed === true && data.name) {
          try {
            const certRes = await fetch('/api/course', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(courseSession?.access_token ? { Authorization: `Bearer ${courseSession.access_token}` } : {}),
              },
              body: JSON.stringify({
                action:       'issue-certificate',
                course_id:    form.id,
                student_name: data.name,
              }),
            });
            const certJson = await certRes.json();
            if (!certRes.ok) {
              console.error('[issue-certificate] server error', certRes.status, certJson);
            } else if (certJson.certId) {
              setCertificateId(certJson.certId);
              certUrl = `${window.location.origin}/certificate/${certJson.certId}`;
            }
          } catch (certErr) {
            console.error('[issue-certificate] request failed', certErr);
          }
        }

        // Skip generic result email when a cert was issued: the cert side effects
        // already sent the certificate email server-side.
        if (validEmail && courseSession?.access_token && !certUrl) {
          fetch('/api/email', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${courseSession.access_token}`,
            },
            body: JSON.stringify({
              type: 'course-result',
              to: recipientEmail,
              data: {
                formId: form.id,
                responseId,
              },
            }),
          }).catch(() => {});
        }
      }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#F2F5FA', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); .ff-pub{font-family:'Inter',sans-serif;}`}</style>
        <div className="ff-pub animate-pulse" style={{ width: '100%', maxWidth: 860 }}>
          <div style={{ background: 'white', borderRadius: 24, overflow: 'hidden', boxShadow: '0 2px 20px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.07)' }}>
            <div style={{ height: 200, background: '#E0DDD6' }}/>
            <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ height: 28, width: '60%', borderRadius: 12, background: '#E0DDD6' }}/>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ height: 14, borderRadius: 8, background: 'rgba(0,0,0,0.07)' }}/>
                <div style={{ height: 14, width: '80%', borderRadius: 8, background: 'rgba(0,0,0,0.07)' }}/>
              </div>
              {[...Array(3)].map((_,i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ height: 12, width: 80, borderRadius: 6, background: 'rgba(0,0,0,0.07)' }}/>
                  <div style={{ height: 44, borderRadius: 12, background: '#eef0f3', border: '1px solid rgba(0,0,0,0.07)' }}/>
                </div>
              ))}
              <div style={{ height: 48, borderRadius: 16, background: '#E0DDD6', marginTop: 8 }}/>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!form) {
    if (lockedPreview) return <LockedContentPreview item={lockedPreview} />;
    // Nothing to show a signed-out visitor: either this is private to a cohort, or the link is
    // wrong. Both look the same on purpose, so this never reveals which links exist. Sign-in is
    // the only useful next step, and it is what they used to be sent to anyway.
    if (signedOut) return (
      <div style={{ minHeight: '100vh', background: '#F2F5FA', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24, textAlign: 'center' }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); .ff-pub{font-family:'Inter',sans-serif;}`}</style>
        <h1 className="ff-pub" style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>Sign in to view this</h1>
        <p className="ff-pub" style={{ fontSize: 14, color: '#555', maxWidth: 420 }}>This content is not open to everyone. Sign in with the account it was shared with, or go back to browse what is available.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link href="/auth" className="ff-pub" style={{ fontSize: 14, fontWeight: 700, background: '#00bf63', color: '#fff', padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>Sign in</Link>
          <Link href="/" className="ff-pub" style={{ fontSize: 14, fontWeight: 700, color: '#344054', padding: '10px 18px', borderRadius: 10, textDecoration: 'none' }}>Browse courses</Link>
        </div>
      </div>
    );
    return (
      <div style={{ minHeight: '100vh', background: '#F2F5FA', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); .ff-pub{font-family:'Inter',sans-serif;}`}</style>
        <p style={{ fontSize: 48 }}>🤷</p>
        <h1 className="ff-pub" style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>Not found</h1>
        <p className="ff-pub" style={{ fontSize: 14, color: '#555' }}>This page has been deleted or doesn&apos;t exist.</p>
        <Link href="/" className="ff-pub" style={{ fontSize: 14, color: '#00bf63', textDecoration: 'underline' }}>Go home</Link>
      </div>
    );
  }

  const config = form.config;
  const rawMode: ThemeMode = config.mode ?? 'dark';
  const resolvedMode: 'light' | 'dark' = config.isCertification
    ? studentTheme
    : rawMode === 'auto' ? studentTheme : rawMode;
  const dark = resolvedMode === 'dark';
  const t = dark ? DARK_P : LIGHT_P;
  const pageUrl = typeof window !== 'undefined' ? window.location.href : '';
  const configuredAccent = config.customAccent ?? ({
    forest: '#00bf63', lime: '#ADEE66', emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b', ocean: '#3E93FF',
  }[config.theme as string] ?? '#00bf63');
  // Blue-on-charcoal is visually harsh for the credential experience. Keep the
  // configured accent in light mode and use the platform green in dark mode.
  const accentColor = config.isCertification && dark ? '#00bf63' : configuredAccent;
  const fontOption = getFontById(config.font ?? 'google-sans-text');
  const fontFace = fontOption.cssFamily;
  const googleFontImport = fontOption.googleFamily
    ? `@import url('https://fonts.googleapis.com/css2?family=${fontOption.googleFamily}&display=swap');`
    : '';

  const themeGradients: Record<string, string> = {
    forest:  'linear-gradient(135deg, #00bf63, #ADEE66)',
    lime:    'linear-gradient(135deg, #ADEE66, #00bf63)',
    emerald: 'linear-gradient(135deg, #34d399, #10b981)',
    rose:    'linear-gradient(135deg, #fb7185, #f43f5e)',
    amber:   'linear-gradient(135deg, #fbbf24, #f59e0b)',
  };
  const privateGradient = themeGradients[config.theme] ?? themeGradients.forest;
  const privateTagStyle: React.CSSProperties = {
    background: privateGradient,
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  };
  const inputBg = resolvedMode === 'light' ? 'bg-transparent text-zinc-900 placeholder:text-zinc-400' : 'bg-transparent text-white placeholder:text-zinc-600';
  const selectOptionBg = resolvedMode === 'light' ? 'bg-white text-zinc-900' : 'bg-zinc-900 text-white';
  const selectPlaceholderColor = resolvedMode === 'light' ? 'text-zinc-400' : 'text-zinc-500';

  // -- Certification (full-screen, protected exam) ---
  // Certifications require login + cohort access (RLS), so the row only loads for an authed
  // participant; render the taker once auth is resolved (brief loader otherwise).
  if (config.isCertification) {
    if (!certAuth) {
      return (
        <div style={{ minHeight: '100vh', background: dark ? '#17181E' : '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <StudentModeBanner context={studentMode} fixed />
          <Loader2 className="w-7 h-7 animate-spin" style={{ color: accentColor }} />
        </div>
      );
    }
    return (
      <><StudentModeBanner context={studentMode} fixed />
      <CertificationTaker
        certificationId={form.id}
        slug={form.slug}
        config={config}
        studentName={certAuth.name}
        studentEmail={certAuth.email}
        sessionToken={certAuth.token || undefined}
        isDark={dark}
        accentColor={accentColor}
        logoUrl={logoUrl}
        logoDarkUrl={logoDarkUrl}
        onExit={() => { window.location.href = '/student'; }}
      /></>
    );
  }

  // -- Virtual Experience ---
  if (config.isVirtualExperience || config.isGuidedProject) {
    const modules     = config.modules || [];
    const totalLessons = modules.reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0);
    const totalReqs   = modules.reduce((a: number, m: any) =>
      a + m.lessons.reduce((b: number, l: any) => b + (l.requirements?.length || 0), 0), 0);

    const indColor = '#00b95c';

    const handleStartProject = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const activeStudentMode = getStudentMode();
      const effectiveUserId = activeStudentMode?.studentId ?? user.id;
      const { data: { session } } = await supabase.auth.getSession();
      const { data: student } = await supabase.from('students').select('full_name, email, role').eq('id', effectiveUserId).single();
      const name  = student?.full_name || user.user_metadata?.full_name || user.email?.split('@')[0] || '';
      const email = student?.email || user.email || '';
      const isPreviewUser = !activeStudentMode && student?.role !== 'student';
      // Restore any saved progress
      if (!isPreviewUser) {
        try {
          const r = await fetch(`/api/guided-project-progress?formId=${form.id}&studentId=${effectiveUserId}`, {
            headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
          });
          if (r.ok) {
            const { attempt } = await r.json();
            if (attempt) {
              setProjectProgress(attempt.progress || {});
              setProjectInitModId(attempt.current_module_id || '');
              setProjectInitLesId(attempt.current_lesson_id || '');
            }
          }
        } catch {}
      }
      setProjectStudentName(name);
      setProjectStudentEmail(email);
      setProjectUserId(effectiveUserId);
      setProjectSessionToken(session?.access_token ?? '');
      setProjectPreviewMode(isPreviewUser);
      setProjectStarted(true);
    };

    if (projectStarted) {
      return (
        <><StudentModeBanner context={studentMode} fixed />
        <VirtualExperienceTaker
          formId={form.id}
          formSlug={form.slug}
          config={config}
          studentName={projectStudentName}
          studentEmail={projectStudentEmail}
          userId={projectUserId}
          sessionToken={projectSessionToken}
          initialProgress={projectProgress}
          initialModuleId={projectInitModId}
          initialLessonId={projectInitLesId}
          isDark={studentTheme === 'dark'}
          accentColor={indColor}
          shortCourse={!!form.is_short_course}
          logoUrl={logoUrl}
          logoDarkUrl={logoDarkUrl}
          previewMode={projectPreviewMode}
        /></>
      );
    }

    const isLight = studentTheme === 'light';
    const gp = {
      bg:        isLight ? '#F5F5F3' : '#0d0d0d',
      card:      isLight ? '#ffffff' : '#161616',
      border:    isLight ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.08)',
      divider:   isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.05)',
      title:     isLight ? '#0d0d0d' : '#f0f0f0',
      body:      isLight ? '#333' : '#bbb',
      muted:     isLight ? '#777' : '#666',
      subtle:    isLight ? '#f4f5f7' : '#1E1F26',
    };
    const companyInitials = config.company?.split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase() || '??';
    const managerInitials = ((config as any).managerName || 'M').split(' ').map((w: string) => w[0]).join('').slice(0,2).toUpperCase();
    const dataset = (config as any).dataset;
    const isShortCourse = !!(form as any).is_short_course;
    // The real professional behind the experience. Shown before enrolment on the hero,
    // the brief header and the sidebar; null when the VE has no consented guide, in
    // which case every block below falls back to the fictional manager as before.
    const guide = isShortCourse ? null : publicGuide(config);
    const guideTheme = { text: gp.title, muted: gp.muted, faint: gp.muted, surface: gp.card, border: gp.border, accent: indColor };

    return (
      <div style={{ minHeight: '100vh', background: gp.bg, color: gp.title, fontFamily: fontFace }}>
        <StudentModeBanner context={studentMode} fixed />
        <style>{googleFontImport}</style>

        {/* -- Sticky nav -- */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(14px)', background: isLight ? 'rgba(255,255,255,0.98)' : 'rgba(13,13,13,0.88)', borderBottom: `1px solid ${isLight ? 'rgba(0,0,0,0.07)' : gp.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 56 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <img src={(isLight ? logoUrl : logoDarkUrl || logoUrl) || undefined} alt="" style={{ height: 28, width: 'auto' }} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isShortCourse
              ? <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: `${indColor}18`, color: indColor, fontWeight: 700, letterSpacing: '0.02em' }}>Short Course</span>
              : <>
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: `${indColor}18`, color: indColor, fontWeight: 700, textTransform: 'capitalize', letterSpacing: '0.02em' }}>{config.industry}</span>
                  <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: gp.divider, color: gp.muted, fontWeight: 600, textTransform: 'capitalize' }}>{config.difficulty}</span>
                </>
            }
          </div>
        </nav>

        {/* -- Hero banner -- */}
        <div style={{ position: 'relative', width: '100%', minHeight: 340, background: '#0a0a0a', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
          {config.coverImage
            ? <img src={resolveCoverUrl(config.coverImage)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />
            : <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${indColor}55 0%, #0a0a0a 70%)` }} />
          }
          {/* Gradient overlay */}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 55%, transparent 100%)' }} />
          {/* Content */}
          <div style={{ position: 'relative', zIndex: 2, maxWidth: 1140, margin: '0 auto', width: '100%', padding: '32px 16px 36px' }}>
            {/* Company row (VE only) */}
            {!isShortCourse && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.75)' }}>{config.company}</span>
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: `${indColor}30`, color: indColor, fontWeight: 700, border: `1px solid ${indColor}40` }}>{config.role}</span>
              </div>
            )}
            {/* Title */}
            <h1 style={{ fontSize: 'clamp(22px,4.5vw,36px)', fontWeight: 800, color: '#ffffff', lineHeight: 1.2, marginBottom: 10, letterSpacing: '-0.02em' }}>
              {config.title || form.title}
            </h1>
            {/* Tagline */}
            {config.tagline && (
              <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, maxWidth: 620, margin: 0 }}>{config.tagline}</p>
            )}
            {/* Manager credit -- the reason to enrol, above the fold. Fixed light-on-dark
                palette because the hero sits on the cover image, not the page surface. */}
            {guide && (
              <div style={{ marginTop: 16 }}>
                <GuideByline
                  guide={guide}
                  size={30}
                  withRole
                  ring="rgba(255,255,255,0.35)"
                  theme={{ text: '#ffffff', muted: 'rgba(255,255,255,0.72)', faint: 'rgba(255,255,255,0.55)', surface: 'transparent', border: 'transparent', accent: '#ffffff' }}
                />
              </div>
            )}
          </div>
        </div>

        {/* -- Main layout -- */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]"
          style={{ maxWidth: 1140, margin: '0 auto', padding: '24px 16px 80px', gap: 20, alignItems: 'start' }}>

          {/* Left column */}
          <div className="order-2 lg:order-1" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Manager brief (VE only) */}
            {!isShortCourse && config.background && (
              <div style={{ background: gp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${gp.border}` }}>
                {/* Email header */}
                <div style={{ padding: '14px 20px', background: gp.subtle, borderBottom: `1px solid ${gp.divider}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* The brief stays in-fiction (the guide's role inside the simulated company);
                      their real employer is credited in the sidebar profile instead. */}
                  {guide && <GuideAvatar guide={guide} size={34} accent={indColor} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 14.5, fontWeight: 700, color: gp.title, margin: 0, lineHeight: 1.3 }}>
                      {guide?.fullName || (config as any).managerName || 'Your Manager'}
                      <span style={{ fontWeight: 400, fontSize: 13, color: gp.muted }}> · {(config as any).managerTitle || 'Manager'}, {config.company}</span>
                    </p>
                    <p style={{ fontSize: 12, color: gp.muted, margin: 0, marginTop: 1 }}>To: You (New {config.role})</p>
                  </div>
                  <span style={{ fontSize: 10, padding: '3px 9px', borderRadius: 6, background: `${indColor}15`, color: indColor, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', flexShrink: 0 }}>Your Brief</span>
                </div>
                <div className="rich-content" style={{ padding: '20px 24px', fontSize: 14.5, lineHeight: 1.6, color: gp.body }}
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.background) || '' }} />
              </div>
            )}

            {/* What you'll learn */}
            {config.learnOutcomes?.length > 0 && (
              <div style={{ background: gp.card, borderRadius: 14, padding: '22px 24px', border: `1px solid ${gp.border}` }}>
                <h2 style={{ fontSize: 14, fontWeight: 700, color: gp.title, marginBottom: 16, letterSpacing: '-0.01em' }}>What you&apos;ll learn</h2>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '10px 20px' }}>
                  {config.learnOutcomes.map((o: string, i: number) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                      <div style={{ width: 18, height: 18, borderRadius: 5, background: `${indColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                        <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                          <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke={indColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                      <span style={{ fontSize: 14, color: gp.body, lineHeight: 1.5 }}>{o}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Project outline */}
            {modules.length > 0 && (
              <div style={{ background: gp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${gp.border}` }}>
                <div style={{ padding: '18px 24px 14px', borderBottom: `1px solid ${gp.divider}` }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: gp.title, margin: 0, letterSpacing: '-0.01em' }}>Project Outline</h2>
                </div>
                {modules.map((mod: any, mi: number) => (
                  <div key={mod.id} style={{ borderBottom: mi < modules.length - 1 ? `1px solid ${gp.divider}` : 'none' }}>
                    {/* Module header */}
                    <div style={{ padding: '13px 24px', display: 'flex', alignItems: 'center', gap: 10, background: gp.subtle }}>
                      <div style={{ width: 22, height: 22, borderRadius: 7, background: `${indColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <span style={{ fontSize: 10, fontWeight: 800, color: indColor }}>{mi + 1}</span>
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: gp.title, flex: 1 }}>{mod.title}</span>
                      <span style={{ fontSize: 11, color: gp.muted, fontWeight: 500 }}>{mod.lessons?.length || 0} mission{mod.lessons?.length !== 1 ? 's' : ''}</span>
                    </div>
                    {/* Lessons */}
                    {(mod.lessons || []).map((les: any, li: number) => (
                      <div key={les.id} style={{ padding: '10px 16px 10px 32px', display: 'flex', alignItems: 'center', gap: 8, borderTop: `1px solid ${gp.divider}` }}>
                        <BookOpen style={{ width: 12, height: 12, color: gp.muted, flexShrink: 0 }} />
                        <span style={{ fontSize: 14, color: gp.body, flex: 1, lineHeight: 1.4 }}>{les.title}</span>
                        {les.requirements?.length > 0 && (
                          <span style={{ fontSize: 11, color: gp.muted, fontWeight: 500, flexShrink: 0 }}>{les.requirements.length} deliverable{les.requirements.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right sidebar */}
          <div className="order-1 lg:order-2 lg:sticky" style={{ top: 72, display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Enrollment card */}
            <div style={{ background: gp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${gp.border}` }}>
              {/* Cover thumbnail */}
              {config.coverImage && (
                <div style={{ height: 140, overflow: 'hidden', position: 'relative' }}>
                  <img src={resolveCoverUrl(config.coverImage)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 60%)' }} />
                </div>
              )}
              <div style={{ padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Tools */}
                {config.tools?.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: gp.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>Tools</p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {config.tools.map((t: string) => {
                        const logo = (config.toolLogos || {})[t];
                        return (
                          <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 10px', borderRadius: 6, background: gp.subtle, color: gp.body, fontWeight: 600, border: `1px solid ${gp.divider}` }}>
                            {logo && <img src={logo} alt={t} style={{ width: 14, height: 14, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }} />}
                            {t}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* CTA */}
                {signedOut ? (
                  <>
                  <Link
                    href="/auth"
                    style={{ width: '100%', padding: '13px', borderRadius: 10, background: indColor, color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, letterSpacing: '-0.01em' }}
                  >
                    Start for free <ArrowRight style={{ width: 15, height: 15 }} />
                  </Link>
                  <p style={{ fontSize: 11, color: gp.muted, textAlign: 'center', marginTop: 8 }}>Free - a quick account keeps your progress</p>
                  </>
                ) : (
                <button onClick={handleStartProject}
                  style={{ width: '100%', padding: '13px', borderRadius: 10, background: indColor, color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, letterSpacing: '-0.01em' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.9'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}>
                  {isShortCourse ? 'Start Course' : 'Start Virtual Experience'} <ArrowRight style={{ width: 15, height: 15 }} />
                </button>
                )}

                {/* Dataset download (VE only) */}
                {!isShortCourse && (dataset?.csvContent || dataset?.url) && (
                  <button onClick={() => {
                    if (dataset.csvContent) {
                      const blob = new Blob([dataset.csvContent], { type: 'text/csv' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a'); a.href = url; a.download = dataset.filename || 'dataset.csv'; a.click(); URL.revokeObjectURL(url);
                    } else if (dataset.url) {
                      window.open(dataset.url, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  style={{ width: '100%', padding: '11px', borderRadius: 10, background: 'transparent', color: gp.body, fontSize: 13, fontWeight: 600, border: `1px solid ${gp.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  <Download style={{ width: 14, height: 14 }} /> Download Dataset
                  </button>
                )}
              </div>
            </div>

            {/* Guide profile (VE only) -- the real professional playing the manager, with
                their actual title, employer and LinkedIn. */}
            {guide && <GuideCard guide={guide} theme={guideTheme} />}

            {/* Difficulty badge (VE only) */}
            {!isShortCourse && (
              <div style={{ background: gp.card, borderRadius: 14, padding: '14px 18px', border: `1px solid ${gp.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 10, background: `${indColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Star style={{ width: 16, height: 16, color: indColor }} />
                </div>
                <div>
                  <p style={{ fontSize: 12, color: gp.muted, margin: 0, fontWeight: 500 }}>Difficulty</p>
                  <p style={{ fontSize: 13, color: gp.title, margin: 0, fontWeight: 700, textTransform: 'capitalize' }}>{config.difficulty}</p>
                </div>
              </div>
            )}
          </div>
        </div>

      </div>
    );
  }

  if (config.isCourse) {
    const questions = config.questions || [];
    const lessonCount = questions.filter((q: any) => q.lesson?.title || q.lesson?.body || q.lesson?.doc).length;

    const cp = {
      bg:      dark ? '#0d0d0d' : '#F5F5F3',
      card:    dark ? '#161616' : '#ffffff',
      border:  dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.09)',
      divider: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
      title:   dark ? '#f0f0f0' : '#0d0d0d',
      body:    dark ? '#bbb'    : '#444',
      muted:   dark ? '#666'    : '#888',
      subtle:  dark ? '#1E1F26' : '#f4f5f7',
    };

    return (
      <div style={{ minHeight: '100vh', background: cp.bg, color: cp.title, fontFamily: fontFace }}>
        <StudentModeBanner context={studentMode} fixed />
        <style>{googleFontImport}</style>

        {/* Sticky nav */}
        <nav style={{ position: 'sticky', top: 0, zIndex: 30, backdropFilter: 'blur(14px)', background: dark ? 'rgba(13,13,13,0.88)' : 'rgba(255,255,255,0.98)', borderBottom: `1px solid ${dark ? cp.border : 'rgba(0,0,0,0.07)'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', height: 56 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
            <img src={(!dark ? logoUrl : logoDarkUrl || logoUrl) || undefined} alt="" style={{ height: 28, width: 'auto' }} />
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: cp.divider, color: cp.muted, fontWeight: 700, letterSpacing: '0.02em' }}>Course</span>
            {config.difficulty && (
              <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999, background: cp.divider, color: cp.muted, fontWeight: 600, textTransform: 'capitalize' as const }}>{config.difficulty}</span>
            )}
          </div>
        </nav>

        {/* Hero banner */}
        {!courseStarted && (
          <div style={{ position: 'relative', width: '100%', minHeight: 420, background: '#0a0a0a', overflow: 'hidden', display: 'flex', alignItems: 'flex-end' }}>
            {config.coverImage
              ? <img src={resolveCoverUrl(config.coverImage)} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: 0.55 }} />
              : <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${accentColor}55 0%, #0a0a0a 70%)` }} />
            }
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 55%, transparent 100%)' }} />
            <div style={{ position: 'relative', zIndex: 2, maxWidth: 1140, margin: '0 auto', width: '100%', padding: '32px 16px 36px' }}>
              <h1 style={{ fontSize: 'clamp(22px,4.5vw,36px)', fontWeight: 800, color: '#ffffff', lineHeight: 1.2, marginBottom: 10, letterSpacing: '-0.02em' }}>
                {config.title || form.title}
              </h1>
              {config.tagline && (
                <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, maxWidth: 620, margin: 0 }}>{config.tagline}</p>
              )}
            </div>
          </div>
        )}

        {/* Main layout */}
        {!courseStarted && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px]"
            style={{ maxWidth: 1140, margin: '0 auto', padding: '24px 16px 80px', gap: 20, alignItems: 'start' }}>

            {/* Left column */}
            <div className="order-2 lg:order-1" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

              {/* About */}
              {config.description && (
                <div style={{ background: cp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${cp.border}` }}>
                  <div style={{ padding: '14px 20px', background: cp.subtle, borderBottom: `1px solid ${cp.divider}` }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: cp.title, margin: 0 }}>About this course</p>
                  </div>
                  <div className="rich-preview" style={{ padding: '20px 24px', fontSize: 14.5, lineHeight: 1.6, color: cp.body }}
                    dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) || '' }} />
                </div>
              )}

              {/* What you'll learn */}
              {(config.learnOutcomes || []).length > 0 && (
                <div style={{ background: cp.card, borderRadius: 14, padding: '22px 24px', border: `1px solid ${cp.border}` }}>
                  <h2 style={{ fontSize: 14, fontWeight: 700, color: cp.title, marginBottom: 16, letterSpacing: '-0.01em' }}>What you&apos;ll learn</h2>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: '10px 20px' }}>
                    {(config.learnOutcomes as string[]).map((o: string, i: number) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
                        <div style={{ width: 18, height: 18, borderRadius: 5, background: `${accentColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 5L3.8 7.5L8.5 2.5" stroke={accentColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </div>
                        <span style={{ fontSize: 14, color: cp.body, lineHeight: 1.5 }}>{o}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Course outline */}
              {lessonCount > 0 && (() => {
                // Group questions into sections
                const sectionGroups: { id: string; title: string; items: any[] }[] = [];
                let cur: { id: string; title: string; items: any[] } | null = null;
                questions.forEach((q: any) => {
                  if (q.isSection) {
                    if (cur) sectionGroups.push(cur);
                    cur = { id: q.id, title: q.sectionTitle || 'Section', items: [] };
                  } else if (q.lesson?.title || q.lesson?.body || q.lesson?.doc) {
                    if (!cur) cur = { id: '__default__', title: '', items: [] };
                    cur.items.push(q);
                  }
                });
                if (cur && (cur as any).items.length > 0) sectionGroups.push(cur as any);
                const hasSections = sectionGroups.some(g => g.id !== '__default__');

                return (
                  <div style={{ background: cp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${cp.border}` }}>
                    <div style={{ padding: '18px 24px 14px', borderBottom: `1px solid ${cp.divider}` }}>
                      <h2 style={{ fontSize: 14, fontWeight: 700, color: cp.title, margin: 0, letterSpacing: '-0.01em' }}>Course Outline</h2>
                    </div>
                    {hasSections ? sectionGroups.map((group, gi) => {
                      const isCollapsed = collapsedSections.has(group.id);
                      const toggleSection = () => setCollapsedSections(prev => {
                        const s = new Set(prev); s.has(group.id) ? s.delete(group.id) : s.add(group.id); return s;
                      });
                      return (
                        <div key={group.id} style={{ borderBottom: gi < sectionGroups.length - 1 ? `1px solid ${cp.divider}` : 'none' }}>
                          {group.id !== '__default__' && (
                            <button onClick={toggleSection} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', background: cp.subtle, border: 'none', cursor: 'pointer', gap: 10 }}>
                              <span style={{ fontSize: 12, fontWeight: 700, color: accentColor, textTransform: 'uppercase' as const, letterSpacing: '0.06em', textAlign: 'left' as const }}>{group.title}</span>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                                <span style={{ fontSize: 11, color: cp.muted, fontWeight: 500 }}>{group.items.length} lesson{group.items.length !== 1 ? 's' : ''}</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cp.muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                                  <path d="M6 9l6 6 6-6"/>
                                </svg>
                              </div>
                            </button>
                          )}
                          {!isCollapsed && group.items.map((q: any, i: number) => (
                            <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px', borderTop: `1px solid ${cp.divider}`, background: 'transparent' }}>
                              <div style={{ width: 22, height: 22, borderRadius: 7, background: `${accentColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <span style={{ fontSize: 10, fontWeight: 800, color: accentColor }}>{i + 1}</span>
                              </div>
                              <span style={{ fontSize: 13, fontWeight: 500, color: cp.title, flex: 1, lineHeight: 1.4 }}>{q.lesson?.title || q.question}</span>
                            </div>
                          ))}
                        </div>
                      );
                    }) : questions.filter((q: any) => q.lesson?.title || q.lesson?.body || q.lesson?.doc).map((q: any, i: number, arr: any[]) => (
                      <div key={q.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 24px', borderBottom: i < arr.length - 1 ? `1px solid ${cp.divider}` : 'none', background: i % 2 === 0 ? 'transparent' : cp.subtle }}>
                        <div style={{ width: 22, height: 22, borderRadius: 7, background: `${accentColor}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: accentColor }}>{i + 1}</span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 500, color: cp.title, flex: 1, lineHeight: 1.4 }}>{q.lesson?.title || q.question}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Right sidebar */}
            <div className="order-1 lg:order-2 lg:sticky" style={{ top: 72, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ background: cp.card, borderRadius: 14, overflow: 'hidden', border: `1px solid ${cp.border}` }}>
                {/* Cover thumbnail */}
                {config.coverImage && (
                  <div style={{ height: 140, overflow: 'hidden', position: 'relative' }}>
                    <img src={resolveCoverUrl(config.coverImage)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.35) 0%, transparent 60%)' }} />
                  </div>
                )}
                <div style={{ padding: '20px 20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {/* Pass mark / XP */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    {config.pointsSystem?.enabled ? (
                      <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: cp.muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Total XP</span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: accentColor }}>
                          {courseXpOnOffer(questions, config.pointsSystem)} XP
                        </span>
                      </>
                    ) : (
                      <>
                        <span style={{ fontSize: 12, fontWeight: 600, color: cp.muted, textTransform: 'uppercase' as const, letterSpacing: '0.06em' }}>Pass mark</span>
                        <span style={{ fontSize: 16, fontWeight: 800, color: accentColor }}>{config.passmark ?? 50}%</span>
                      </>
                    )}
                  </div>
                  {/* CTA */}
                  {form.locked ? (
                    <>
                    {(() => {
                      const from = lowestUnlockPrice(form.unlock);
                      return from ? (
                        <div style={{ width: '100%', marginBottom: 9, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: cp.muted }}>From</span>
                          <span style={{ fontSize: 17, fontWeight: 800, color: cp.title, fontVariantNumeric: 'tabular-nums' }}>{unlockMoney(from.currency, from.amount)}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: cp.muted }}>for {unlockDurationLabel(from.durationMonths)}</span>
                        </div>
                      ) : null;
                    })()}
                    <Link
                      href={`/student?contentTable=courses&contentId=${encodeURIComponent(form.id)}#payments`}
                      style={{ width: '100%', padding: '13px', borderRadius: 10, background: accentColor, color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, letterSpacing: '-0.01em' }}
                    >
                      Purchase or enroll <ArrowRight style={{ width: 15, height: 15 }} />
                    </Link>
                    </>
                  ) : signedOut ? (
                    <>
                    <Link
                      href="/auth"
                      style={{ width: '100%', padding: '13px', borderRadius: 10, background: accentColor, color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, letterSpacing: '-0.01em' }}
                    >
                      Start for free <ArrowRight style={{ width: 15, height: 15 }} />
                    </Link>
                    <p style={{ fontSize: 11, color: cp.muted, textAlign: 'center', marginTop: 8 }}>Free - a quick account keeps your progress</p>
                    </>
                  ) : (
                    <button onClick={() => setCourseStarted(true)}
                      style={{ width: '100%', padding: '13px', borderRadius: 10, background: accentColor, color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, letterSpacing: '-0.01em' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.9'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}>
                      Start Course <ArrowRight style={{ width: 15, height: 15 }} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CourseTaker */}
        {courseStarted && (
          <CourseTaker
            key={retakeKey}
            config={config}
            isSubmitting={submitting}
            onSubmit={handleSubmit}
            isSuccess={success}
            onReset={() => {}}
            onClose={() => setCourseStarted(false)}
            onRetake={() => { setSuccess(false); setSubmitting(false); setRetakeKey(k => k + 1); }}
            isSharedView={true}
            collectStudentInfo={false}
            initialStudentName={prefilledName}
            initialStudentEmail={prefilledEmail}
            formId={form.id}
            postSubmission={config.postSubmission}
            relatedForms={relatedForms}
            certificateId={certificateId}
            relatedAssignment={relatedAssignment}
            logoUrl={logoUrl}
            logoDarkUrl={logoDarkUrl}
          />
        )}

      </div>
    );
  }

  return (
    <div className="ff-pub" style={{ minHeight: '100vh', background: t.page, position: 'relative', transition: 'background 0.3s' }}>
      {studentMode && <StudentModeBanner context={studentMode} fixed />}
      <style>{`${googleFontImport} .ff-pub{font-family:${fontFace};}`}</style>
      {/* Navbar */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 30, background: t.nav, borderBottom: `1px solid ${t.navBorder}`, backdropFilter: 'blur(12px)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', height: 56, transition: 'background 0.3s' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <img src={(dark ? logoDarkUrl || logoUrl : logoUrl) || undefined} alt="" style={{ height: 32, width: 'auto' }} />
        </Link>
      </nav>

      <main style={{ position: 'relative', zIndex: 10, maxWidth: 860, margin: '0 auto', padding: '32px 24px 0' }}>
        <AnimatePresence mode="wait">
        {success ? (
          <motion.div key="success"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
          >
            {/* Success card */}
            <div style={{ background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 24, padding: 32, boxShadow: t.cardShadow, transition: 'background 0.3s' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12, paddingBottom: 24 }}>
                <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'rgba(16,185,129,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CheckCircle2 style={{ width: 28, height: 28, color: '#10b981' }} />
                </div>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 700, color: t.title, transition: 'color 0.3s' }}>
                    {config.postSubmission?.type === 'redirect'
                      ? 'Redirecting you...'
                      : config.eventDetails?.isEvent
                        ? "You're enrolled!"
                        : 'Successfully Submitted!'}
                  </h2>
                  <p style={{ fontSize: 14, marginTop: 4, color: t.body, transition: 'color 0.3s' }}>
                    {config.postSubmission?.type === 'redirect'
                      ? 'You will be redirected in a moment.'
                      : config.eventDetails?.isEvent && config.eventDetails.date
                        ? `See you on ${formatDateParts(config.eventDetails.date)?.fullDate ?? config.eventDetails.date}${config.eventDetails.time ? ' at ' + config.eventDetails.time : ''}.`
                        : 'Your response has been recorded.'}
                  </p>
                </div>
              </div>
              {/* Meeting link / address on success for events */}
              {config.eventDetails?.isEvent && config.postSubmission?.type !== 'redirect' && (() => {
                const ev = config.eventDetails;
                if (ev.eventType === 'virtual' && joinToken) {
                  const platform = detectPlatform(ev.meetingLink ?? '');
                  return (
                    <div style={{ marginBottom: 20, padding: '16px 20px', borderRadius: 14, background: dark ? 'rgba(16,185,129,0.06)' : '#edf7f1', border: `1px solid ${dark ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.2)'}`, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {platform?.icon}
                        <span style={{ fontSize: 13, fontWeight: 600, color: t.title }}>{platform?.name ?? 'Meeting Link'}</span>
                      </div>
                      <a href={`/api/join?token=${joinToken}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, background: platform?.color ?? accentColor, color: 'white', textDecoration: 'none' }}>
                        Join Meeting <ExternalLink style={{ width: 13, height: 13 }}/>
                      </a>
                    </div>
                  );
                }
                if (ev.eventType !== 'virtual' && ev.location) {
                  return (
                    <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 14, background: t.sectionBg, border: `1px solid ${t.sectionBorder}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                      <MapPin style={{ width: 16, height: 16, color: t.muted, flexShrink: 0 }}/>
                      <span style={{ fontSize: 13, color: t.body }}>{ev.location}</span>
                    </div>
                  );
                }
                return null;
              })()}

              {/* Add to calendar on success for events */}
              {config.eventDetails?.isEvent && config.eventDetails.date && config.postSubmission?.type !== 'redirect' && (() => {
                const ev = config.eventDetails;
                const isVirtual = ev.eventType === 'virtual';
                // Absolute join link so a tap from the calendar reminder reaches /api/join and records attendance.
                const origin = typeof window !== 'undefined' ? window.location.origin : '';
                const joinHref = joinToken ? `${origin}/api/join?token=${joinToken}` : '';
                const recurring = isRecurring(form.recurrence);
                const { calLocation, calDescription } = buildCalendarFields({ isVirtual, joinUrl: joinHref, location: ev.location, description: config.description });
                const googleUrl  = buildGoogleCalUrl(config.title, ev.date, ev.time, ev.timezone, calLocation, calDescription, form.recurrence, form.recurrence_end_date, form.recurrence_days);
                // Outlook.com and Yahoo web links can't encode a recurrence -- only offer them for one-time events; the .ics carries the full series.
                const outlookUrl = recurring ? null : buildOutlookCalUrl(config.title, ev.date, ev.time, ev.timezone, calLocation, calDescription);
                const yahooUrl   = recurring ? null : buildYahooCalUrl(config.title, ev.date, ev.time, ev.timezone, calLocation, calDescription);
                const GoogleIcon = () => (
                  <svg width="18" height="18" viewBox="0 0 18 18" style={{ flexShrink: 0 }}>
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.657 14.013 17.64 11.71 17.64 9.2z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                );
                const OutlookIcon = () => (
                  <svg width="18" height="18" viewBox="0 0 21 21" style={{ flexShrink: 0 }}>
                    <rect x="0" y="0" width="10" height="10" rx="1" fill="#f25022"/>
                    <rect x="11" y="0" width="10" height="10" rx="1" fill="#7fba00"/>
                    <rect x="0" y="11" width="10" height="10" rx="1" fill="#00a4ef"/>
                    <rect x="11" y="11" width="10" height="10" rx="1" fill="#ffb900"/>
                  </svg>
                );
                const YahooIcon = () => (
                  <svg width="18" height="18" viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
                    <path d="M0 4h8.6l7.4 11.2L23.4 4H32L18.6 22.4V32h-5.2V22.4z" fill="white"/>
                  </svg>
                );
                const btnBase: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', textDecoration: 'none', width: '100%', textAlign: 'left' as const };
                // For virtual events without a token yet, register on demand so the calendar entry carries a tracked join link.
                const openCal = async () => {
                  setJoinErr('');
                  let preparedToken = joinToken;
                  if (isVirtual && !preparedToken) {
                    setCalBusy(true);
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (session?.access_token) {
                        const res = await fetch('/api/event-register', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                          body: JSON.stringify({ formId: form.id }),
                        });
                        const json = await res.json();
                        if (json.join_token) {
                          preparedToken = json.join_token;
                          setJoinToken(json.join_token);
                        }
                      }
                    } catch {}
                    setCalBusy(false);
                  }
                  if (isVirtual && !preparedToken) {
                    setJoinErr('Could not prepare your calendar link. Please refresh and try again.');
                    return;
                  }
                  setCalPopupOpen(true);
                };
                return (
                  <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 24 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={openCal}
                        disabled={calBusy}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, border: `1px solid ${t.sectionBorder}`, background: t.sectionBg, color: t.label, cursor: calBusy ? 'default' : 'pointer', opacity: calBusy ? 0.65 : 1 }}
                      >
                        <Calendar style={{ width: 15, height: 15 }}/> {calBusy ? 'Preparing...' : 'Add to Calendar'}
                      </button>
                      {joinErr && <p style={{ margin: 0, fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{joinErr}</p>}
                    </div>
                    {calPopupOpen && (
                      <>
                        <div onClick={() => setCalPopupOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }} />
                        <div style={{ position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', zIndex: 101, background: dark ? '#18181b' : '#ffffff', borderRadius: 22, boxShadow: '0 24px 64px rgba(0,0,0,0.28)', width: 'min(340px, calc(100vw - 32px))', padding: '28px 20px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                          {/* Header */}
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                            <div style={{ width: 56, height: 56, borderRadius: '50%', background: dark ? '#27272a' : '#f4f4f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Calendar style={{ width: 26, height: 26, color: accentColor }}/>
                            </div>
                            <div>
                              <p style={{ fontWeight: 700, fontSize: 17, color: t.title, margin: 0 }}>Add to Calendar</p>
                              <p style={{ fontSize: 13, color: t.body, marginTop: 6, lineHeight: 1.55 }}>{recurring ? 'Saves every session in the series to your calendar.' : 'Save this event to your preferred calendar app.'}</p>
                            </div>
                          </div>
                          {/* Options */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {googleUrl && (
                              <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalPopupOpen(false)}
                                style={{ ...btnBase, background: '#ffffff', color: '#3c4043', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}>
                                <GoogleIcon/> Google Calendar
                              </a>
                            )}
                            {yahooUrl && (
                              <a href={yahooUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalPopupOpen(false)}
                                style={{ ...btnBase, background: '#6001D2', color: 'white' }}>
                                <YahooIcon/> Yahoo Calendar
                              </a>
                            )}
                            {outlookUrl && (
                              <a href={outlookUrl} target="_blank" rel="noopener noreferrer" onClick={() => setCalPopupOpen(false)}
                                style={{ ...btnBase, background: dark ? '#1e3a5f' : '#e8f1fb', color: dark ? 'white' : '#0078D4' }}>
                                <OutlookIcon/> Outlook.com
                              </a>
                            )}
                            <button onClick={() => { downloadIcs(config.title, ev.date, ev.time, ev.timezone, calLocation, calDescription, form.recurrence, form.recurrence_end_date, form.recurrence_days); setCalPopupOpen(false); }}
                              style={{ ...btnBase, background: dark ? '#27272a' : '#f4f4f5', color: dark ? '#a1a1aa' : '#52525b' }}>
                              <Download style={{ width: 18, height: 18, flexShrink: 0 }}/> iCal (Apple / Outlook)
                            </button>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* CTA Button */}
              {config.postSubmission?.type === 'button' && config.postSubmission.buttonUrl && (
                <a href={config.postSubmission.buttonUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', borderRadius: 16, fontWeight: 600, color: 'white', fontSize: 14, background: accentColor, textDecoration: 'none' }}>
                  {config.postSubmission.buttonLabel || 'Continue'}
                  <ExternalLink style={{ width: 16, height: 16 }} />
                </a>
              )}

              {/* Notice */}
              {config.postSubmission?.type === 'notice' && (
                <div style={{ marginTop: 8, padding: 20, borderRadius: 16, background: t.sectionBg, border: `1px solid ${t.sectionBorder}` }}>
                  {config.postSubmission.noticeTitle && (
                    <h3 style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: t.title }}>{config.postSubmission.noticeTitle}</h3>
                  )}
                  {config.postSubmission.noticeBody && (
                    <p style={{ fontSize: 14, lineHeight: 1.6, color: t.body }}>{config.postSubmission.noticeBody}</p>
                  )}
                </div>
              )}

              {/* Redirect spinner */}
              {config.postSubmission?.type === 'redirect' && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 8 }}>
                  <Loader2 style={{ width: 16, height: 16, color: t.muted }} className="animate-spin" />
                  <span style={{ fontSize: 14, color: t.muted }}>{config.postSubmission.redirectUrl}</span>
                </div>
              )}
            </div>

            {/* Related events */}
            {config.postSubmission?.type === 'events' && relatedForms.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.muted, padding: '0 4px' }}>You might also like</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {relatedForms.map((rf: any) => {
                    const rfConfig = rf.config || {};
                    const href = rf.slug ? `/${rf.slug}` : `/${rf.id}`;
                    return (
                      <a key={rf.id} href={href} style={{ borderRadius: 20, overflow: 'hidden', display: 'flex', background: t.card, border: `1px solid ${t.cardBorder}`, boxShadow: t.cardShadow, textDecoration: 'none', transition: 'transform 0.2s, box-shadow 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = dark ? '0 8px 28px rgba(0,0,0,0.5)' : '0 8px 28px rgba(0,0,0,0.12)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = t.cardShadow; }}>
                        {rfConfig.coverImage ? (
                          <div style={{ width: 112, flexShrink: 0, minHeight: 110 }}>
                            <img src={resolveCoverUrl(rfConfig.coverImage)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          </div>
                        ) : (
                          <div style={{ width: 112, flexShrink: 0, minHeight: 110, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, background: t.sectionBg }}>🗓</div>
                        )}
                        <div style={{ flex: 1, minWidth: 0, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
                          <div>
                            <p style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, color: t.title }}>{rfConfig.title || rf.title}</p>
                            {rfConfig.description && (
                              <p style={{ fontSize: 12, marginTop: 4, color: t.body, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(rfConfig.description) }} />
                            )}
                          </div>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 600, color: accentColor }}>
                            {rfConfig.eventDetails?.isEvent ? 'View event' : 'Start learning'} <ArrowRight style={{ width: 12, height: 12 }} />
                          </span>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div key="form"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            style={{ transition: 'opacity 0.3s' }}
          >
            {/* Non-event form header -- single column */}
            {!config.eventDetails?.isEvent && (() => {
              const fBtnBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
              const fBtnBorder = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
              const fShareBtn: React.CSSProperties = { padding: 8, borderRadius: 10, border: `1px solid ${fBtnBorder}`, background: fBtnBg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginBottom: 32 }}>
                  {/* Cover image */}
                  {config.coverImage && (
                    <div style={{ borderRadius: 18, overflow: 'hidden', background: '#1a1a1a', aspectRatio: '16/9' }}>
                      <img src={resolveCoverUrl(config.coverImage)} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', display: 'block' }}/>
                    </div>
                  )}

                  {/* Title + description */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <h2 style={{ fontSize: 26, fontWeight: 800, color: t.title, margin: 0, lineHeight: 1.2, transition: 'color 0.3s' }}>{config.title}</h2>
                    {config.description && (
                      <div className="rich-preview" style={{ fontSize: 15, lineHeight: 1.6, color: t.body, transition: 'color 0.3s' }}
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) }}/>
                    )}
                  </div>

                  {/* Created by */}
                  {creatorProfile && (() => {
                    const socials = Object.entries((creatorProfile.social_links ?? {}) as Record<string, string>).filter(([, v]) => !!v);
                    const iconColor = dark ? '#c0c0c0' : '#555';
                    const socialIconPaths: Record<string, { label: string; path: string }> = {
                      twitter:   { label: 'X', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.264 5.638L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' },
                      linkedin:  { label: 'LinkedIn', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
                      instagram: { label: 'Instagram', path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
                      facebook:  { label: 'Facebook', path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
                      youtube:   { label: 'YouTube', path: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
                      github:    { label: 'GitHub', path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' },
                      website:   { label: 'Website', path: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13v6l5 3-1 1.5-6-3.5V7h2z' },
                    };
                    return (
                      <div>
                        <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted, marginBottom: 8 }}>Created by</p>
                        <div style={{ position: 'relative' }}
                          onMouseEnter={() => { if (profileHoverTimer.current) clearTimeout(profileHoverTimer.current); setProfilePopupOpen(true); }}
                          onMouseLeave={() => { profileHoverTimer.current = setTimeout(() => setProfilePopupOpen(false), 180); }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                            <div style={{ width: 32, height: 32, borderRadius: creatorProfile.account_type === 'company' ? 8 : '50%', overflow: 'hidden', flexShrink: 0, background: dark ? '#1a3a24' : '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: dark ? '#ADEE66' : '#00bf63' }}>
                              {creatorProfile.avatar_url
                                ? <img src={creatorProfile.avatar_url} alt={creatorProfile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                                : (creatorProfile.name || creatorProfile.username || '?').slice(0, 2).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: t.body }}>{creatorProfile.name || creatorProfile.username}</span>
                          </div>
                          {profilePopupOpen && (
                            <div
                              onMouseEnter={() => { if (profileHoverTimer.current) clearTimeout(profileHoverTimer.current); }}
                              onMouseLeave={() => { profileHoverTimer.current = setTimeout(() => setProfilePopupOpen(false), 180); }}
                              style={{ position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 50, width: 260, borderRadius: 16, padding: 16, background: dark ? '#1E1F26' : '#ffffff', boxShadow: dark ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.14)', border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                <div style={{ width: 44, height: 44, borderRadius: creatorProfile.account_type === 'company' ? 10 : '50%', overflow: 'hidden', flexShrink: 0, background: dark ? '#1a3a24' : '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: dark ? '#ADEE66' : '#00bf63' }}>
                                  {creatorProfile.avatar_url
                                    ? <img src={creatorProfile.avatar_url} alt={creatorProfile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                                    : (creatorProfile.name || creatorProfile.username || '?').slice(0, 2).toUpperCase()}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontSize: 14, fontWeight: 700, color: t.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{creatorProfile.name || creatorProfile.username}</div>
                                  {creatorProfile.username && <div style={{ fontSize: 12, color: t.muted }}>@{creatorProfile.username}</div>}
                                </div>
                              </div>
                              {creatorProfile.bio && (
                                <p style={{ fontSize: 12, lineHeight: 1.5, color: t.body, margin: '0 0 8px' }}>{creatorProfile.bio}</p>
                              )}
                              {(creatorProfile.industry || creatorProfile.location) && (
                                <div style={{ fontSize: 11, color: t.muted, display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                                  {creatorProfile.industry && <span>{creatorProfile.industry}</span>}
                                  {creatorProfile.industry && creatorProfile.location && <span>·</span>}
                                  {creatorProfile.location && <span>{creatorProfile.location}</span>}
                                </div>
                              )}
                              {socials.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                  {socials.slice(0, 6).map(([key, url]) => {
                                    const s = socialIconPaths[key];
                                    if (!s) return null;
                                    const href = /^https?:\/\//i.test(url as string) ? url as string : `https://${url}`;
                                    return (
                                      <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={s.label}
                                        style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', flexShrink: 0 }}>
                                        <svg viewBox="0 0 24 24" width="13" height="13" fill={iconColor}><path d={s.path}/></svg>
                                      </a>
                                    );
                                  })}
                                </div>
                              )}
                              {creatorProfile.username && (
                                <div style={{ paddingTop: 10, borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                                  <a href={`/u/${creatorProfile.username}`} target="_blank" rel="noopener noreferrer"
                                    style={{ fontSize: 12, fontWeight: 600, color: accentColor, textDecoration: 'none' }}>
                                    View full profile
                                  </a>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              );
            })()}

            {config.eventDetails?.isEvent && (() => {
              const ev = config.eventDetails;
              const _today = new Date(); _today.setHours(0, 0, 0, 0);
              const _recurrenceEnd = form.recurrence_end_date ? new Date(form.recurrence_end_date) : null;
              const isPast = ev.date
                ? new Date(ev.date) < _today && (!_recurrenceEnd || _recurrenceEnd < _today)
                : false;
              const mapsUrl = ev.location ? `https://maps.google.com/?q=${encodeURIComponent(ev.location)}` : null;
              const isVirtual = ev.eventType === 'virtual' && ev.meetingLink;
              const evBtnBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
              const evBtnBorder = dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
              const shareBtnStyle: React.CSSProperties = { padding: 8, borderRadius: 10, border: `1px solid ${evBtnBorder}`, background: evBtnBg, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' };
              const cap = ev.capacity as number | undefined;
              const isSoldOut = cap !== undefined && attendeeCount !== null && attendeeCount >= cap;
              return (
                <>
                  {/* Past event banner */}
                  {isPast && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', fontSize: 13, fontWeight: 500, borderRadius: 10, marginBottom: 20, background: t.pastBg, color: t.pastText }}>
                      <Calendar style={{ width: 15, height: 15, flexShrink: 0 }}/>
                      This event has already taken place.
                    </div>
                  )}

                  {/* -- Two-column layout --- */}
                  {/* Cover image -- mobile only (always first) */}
                  {config.coverImage && (
                    <div className="block sm:hidden" style={{ borderRadius: 18, overflow: 'hidden', background: '#1a1a1a', aspectRatio: '4/3', marginBottom: 16 }}>
                      <img src={resolveCoverUrl(config.coverImage)} alt="Cover" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row gap-8 sm:gap-10 sm:items-start" style={{ marginBottom: 32 }}>

                    {/* Left -- cover image (desktop only) + creator */}
                    <div className="flex-shrink-0 w-full sm:w-[300px] order-2 sm:order-1" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {config.coverImage && (
                        <div className="hidden sm:block" style={{ borderRadius: 18, overflow: 'hidden', background: '#1a1a1a', aspectRatio: '4/3' }}>
                          <img src={resolveCoverUrl(config.coverImage)} alt="Cover"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}/>
                        </div>
                      )}

                      {/* Hosted by -- with hover popup */}
                      {creatorProfile && (() => {
                        const socials = Object.entries((creatorProfile.social_links ?? {}) as Record<string, string>).filter(([, v]) => !!v);
                        const iconColor = dark ? '#c0c0c0' : '#555';
                        const socialIcons: Record<string, { label: string; path: string }> = {
                          twitter:   { label: 'X', path: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.264 5.638L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z' },
                          linkedin:  { label: 'LinkedIn', path: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z' },
                          instagram: { label: 'Instagram', path: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z' },
                          facebook:  { label: 'Facebook', path: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z' },
                          youtube:   { label: 'YouTube', path: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z' },
                          github:    { label: 'GitHub', path: 'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12' },
                          website:   { label: 'Website', path: 'M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18c-4.411 0-8-3.589-8-8s3.589-8 8-8 8 3.589 8 8-3.589 8-8 8zm-1-13v6l5 3-1 1.5-6-3.5V7h2z' },
                        };
                        return (
                          <div>
                            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted, marginBottom: 8 }}>Hosted by</p>
                            <div style={{ position: 'relative' }}
                              onMouseEnter={() => { if (profileHoverTimer.current) clearTimeout(profileHoverTimer.current); setProfilePopupOpen(true); }}
                              onMouseLeave={() => { profileHoverTimer.current = setTimeout(() => setProfilePopupOpen(false), 180); }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                <div style={{ width: 30, height: 30, borderRadius: creatorProfile.account_type === 'company' ? 7 : '50%', overflow: 'hidden', flexShrink: 0, background: dark ? '#1a3a24' : '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: dark ? '#ADEE66' : '#00bf63' }}>
                                  {creatorProfile.avatar_url
                                    ? <img src={creatorProfile.avatar_url} alt={creatorProfile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                                    : (creatorProfile.name || creatorProfile.username || '?').slice(0, 2).toUpperCase()}
                                </div>
                                <span style={{ fontSize: 14, fontWeight: 600, color: t.body }}>{creatorProfile.name || creatorProfile.username}</span>
                              </div>

                              {/* Hover popup */}
                              {profilePopupOpen && (
                                <div
                                  onMouseEnter={() => { if (profileHoverTimer.current) clearTimeout(profileHoverTimer.current); }}
                                  onMouseLeave={() => { profileHoverTimer.current = setTimeout(() => setProfilePopupOpen(false), 180); }}
                                  style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, zIndex: 50, width: 260, borderRadius: 16, padding: 16, background: dark ? '#1E1F26' : '#ffffff', boxShadow: dark ? '0 8px 32px rgba(0,0,0,0.6)' : '0 8px 32px rgba(0,0,0,0.14)', border: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                                  {/* Avatar + name */}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                                    <div style={{ width: 44, height: 44, borderRadius: creatorProfile.account_type === 'company' ? 10 : '50%', overflow: 'hidden', flexShrink: 0, background: dark ? '#1a3a24' : '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: dark ? '#ADEE66' : '#00bf63' }}>
                                      {creatorProfile.avatar_url
                                        ? <img src={creatorProfile.avatar_url} alt={creatorProfile.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}/>
                                        : (creatorProfile.name || creatorProfile.username || '?').slice(0, 2).toUpperCase()}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontSize: 14, fontWeight: 700, color: t.title, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{creatorProfile.name || creatorProfile.username}</div>
                                      {creatorProfile.username && <div style={{ fontSize: 12, color: t.muted }}>@{creatorProfile.username}</div>}
                                    </div>
                                  </div>

                                  {/* Bio */}
                                  {creatorProfile.bio && (
                                    <p style={{ fontSize: 12, lineHeight: 1.5, color: t.body, margin: '0 0 8px' }}>{creatorProfile.bio}</p>
                                  )}

                                  {/* Industry · Location */}
                                  {(creatorProfile.industry || creatorProfile.location) && (
                                    <div style={{ fontSize: 11, color: t.muted, display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                                      {creatorProfile.industry && <span>{creatorProfile.industry}</span>}
                                      {creatorProfile.industry && creatorProfile.location && <span>·</span>}
                                      {creatorProfile.location && <span>{creatorProfile.location}</span>}
                                    </div>
                                  )}

                                  {/* Socials */}
                                  {socials.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                                      {socials.slice(0, 6).map(([key, url]) => {
                                        const s = socialIcons[key];
                                        if (!s) return null;
                                        const href = /^https?:\/\//i.test(url as string) ? url as string : `https://${url}`;
                                        return (
                                          <a key={key} href={href} target="_blank" rel="noopener noreferrer" title={s.label}
                                            style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)', flexShrink: 0 }}>
                                            <svg viewBox="0 0 24 24" width="13" height="13" fill={iconColor}><path d={s.path}/></svg>
                                          </a>
                                        );
                                      })}
                                    </div>
                                  )}

                                  {/* View profile link */}
                                  {creatorProfile.username && (
                                    <div style={{ paddingTop: 10, borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}>
                                      <a href={`/u/${creatorProfile.username}`} target="_blank" rel="noopener noreferrer"
                                        style={{ fontSize: 12, fontWeight: 600, color: accentColor, textDecoration: 'none' }}>
                                        View full profile
                                      </a>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Speakers */}
                      {(() => {
                        const speakers: any[] = config.eventDetails?.speakers ?? [];
                        if (!speakers.length) return null;
                        return (
                          <div style={{ marginTop: 20 }}>
                            <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: t.muted, marginBottom: 10 }}>Speakers</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {speakers.map((sp: any) => (
                                <div key={sp.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                  {/* Avatar */}
                                  <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: dark ? '#1a3a24' : '#d4edda', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: dark ? '#ADEE66' : '#00bf63' }}>
                                    {sp.avatar_url
                                      ? <img src={sp.avatar_url} alt={sp.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                      : (sp.name || '?').slice(0, 2).toUpperCase()}
                                  </div>
                                  <div style={{ minWidth: 0 }}>
                                    <p style={{ fontSize: 13, fontWeight: 700, color: t.title, margin: 0, lineHeight: 1.3 }}>{sp.name}</p>
                                    {sp.title && <p style={{ fontSize: 11, color: t.muted, margin: '2px 0 0' }}>{sp.title}</p>}
                                    {sp.bio && <p style={{ fontSize: 12, color: t.body, margin: '4px 0 0', lineHeight: 1.5 }}>{sp.bio}</p>}
                                    {sp.linkedin_url && (
                                      <a
                                        href={sp.linkedin_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 5, fontSize: 11, fontWeight: 500, color: '#0A66C2', textDecoration: 'none' }}
                                      >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                                        LinkedIn
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Right -- all event info + about (shown first on mobile) */}
                    <div className="order-1 sm:order-2" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

                      {/* Private badge */}
                      {config.eventDetails?.isPrivate && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 9999, fontSize: 12, fontWeight: 600, alignSelf: 'flex-start', background: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: t.muted }}>
                          🔒 Private
                        </span>
                      )}

                      {/* Title */}
                      <h2 style={{ fontSize: 28, fontWeight: 800, color: t.title, margin: 0, lineHeight: 1.2, transition: 'color 0.3s' }}>{config.title}</h2>

                      {/* Date · Time · Timezone */}
                      {(ev.date || ev.time) && (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                          <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 12, overflow: 'hidden', border: `1px solid ${evBtnBorder}`, background: evBtnBg, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
                            <div style={{ height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', background: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', color: t.muted }}>
                              {formatDateParts(ev.date)?.monthShort || 'DATE'}
                            </div>
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: t.title }}>
                              {formatDateParts(ev.date)?.day || '--'}
                            </div>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 48 }}>
                            <div style={{ fontSize: 15, fontWeight: 600, color: t.title }}>{formatDateParts(ev.date)?.fullDate || ev.date || 'Date TBD'}</div>
                            {(ev.time || ev.timezone) && (
                              <div style={{ fontSize: 13, marginTop: 2, color: t.body }}>{ev.time}{ev.timezone ? ` · ${ev.timezone}` : ''}</div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Location / Meeting link */}
                      {isVirtual ? (
                        (() => {
                          const platform = detectPlatform(ev.meetingLink);
                          return (
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                              <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 12, border: `1px solid ${evBtnBorder}`, background: platform ? platform.color + '18' : evBtnBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {platform?.icon ?? <ExternalLink style={{ width: 20, height: 20, color: t.muted }}/>}
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 48 }}>
                                <div style={{ fontSize: 15, fontWeight: 600, color: t.title }}>{platform?.name ?? 'Virtual Event'}</div>
                                <div style={{ fontSize: 13, marginTop: 2, color: t.body }}>{joinToken ? 'Link included in your invitation email' : 'Link sent to enrolled students'}</div>
                              </div>
                            </div>
                          );
                        })()
                      ) : ev.location ? (
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                          <div style={{ flexShrink: 0, width: 48, height: 48, borderRadius: 12, border: `1px solid ${evBtnBorder}`, background: evBtnBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <MapPin style={{ width: 20, height: 20, color: t.muted }}/>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 48 }}>
                            <a href={mapsUrl!} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 15, fontWeight: 600, color: accentColor, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                              {formatLocation(ev.location).main}
                              <ExternalLink style={{ width: 12, height: 12, opacity: 0.7 }}/>
                            </a>
                            {formatLocation(ev.location).sub && (
                              <div style={{ fontSize: 13, marginTop: 2, color: t.body }}>{formatLocation(ev.location).sub}</div>
                            )}
                          </div>
                        </div>
                      ) : null}

                      {/* Spots left */}
                      {attendeeCount !== null && cap && (() => {
                        const spotsLeft = cap - attendeeCount;
                        return (
                          <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: spotsLeft <= 0 ? 'rgba(239,68,68,0.1)' : spotsLeft <= 10 ? 'rgba(245,158,11,0.1)' : 'rgba(16,185,129,0.1)', color: spotsLeft <= 0 ? '#ef4444' : spotsLeft <= 10 ? '#d97706' : '#10b981' }}>
                            {spotsLeft <= 0 ? 'Sold out' : `${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left`}
                          </span>
                        );
                      })()}

                      {/* Join link for cohort members (no registration required) */}
                      {(joinToken || isCohortMember) && !isPast && ev.meetingLink && (() => {
                        const platform = detectPlatform(ev.meetingLink);
                        return (
                          <>
                            <button
                              style={{ alignSelf: 'flex-start', marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 24px', borderRadius: 12, fontWeight: 600, fontSize: 14, background: platform?.color ?? accentColor, color: 'white', border: 'none', cursor: 'pointer' }}
                              onClick={async () => {
                                setJoinErr('');
                                if (joinToken) {
                                  window.open(`/api/join?token=${joinToken}`, '_blank', 'noopener,noreferrer');
                                  return;
                                }
                                const win = window.open('', '_blank', 'noopener,noreferrer');
                                try {
                                  const { data: { session } } = await supabase.auth.getSession();
                                  if (session?.access_token) {
                                    const res = await fetch('/api/event-register', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                                      body: JSON.stringify({ formId: form.id }),
                                    });
                                    const json = await res.json();
                                    if (json.join_token) {
                                      setJoinToken(json.join_token);
                                      if (win) { win.location.href = `/api/join?token=${json.join_token}`; return; }
                                    }
                                  }
                                } catch {}
                                win?.close();
                                setJoinErr('Could not get your join link. Please refresh and try again.');
                              }}>
                              Join Meeting <ExternalLink style={{ width: 14, height: 14 }}/>
                            </button>
                            {joinErr && (
                              <p style={{ margin: 0, fontSize: 12, color: '#ef4444' }}>{joinErr}</p>
                            )}
                          </>
                        );
                      })()}

                      {/* Divider */}
                      <div style={{ borderTop: `1px solid ${dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}`, marginTop: 8 }}/>

                      {/* About this event */}
                      {config.description && (
                        <>
                          <h3 style={{ fontSize: 15, fontWeight: 700, color: t.title, margin: 0, transition: 'color 0.3s' }}>About this event</h3>
                          <div className="rich-preview" style={{ fontSize: 16, lineHeight: 1.6, color: t.body, transition: 'color 0.3s' }}
                            dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) }}/>
                        </>
                      )}

                    </div>
                  </div>

                </>
              );
            })()}
            <div style={!config.eventDetails?.isEvent ? { background: t.card, border: `1px solid ${t.cardBorder}`, borderRadius: 20, padding: 28, boxShadow: t.cardShadow, transition: 'background 0.3s' } : {}}>

              {!config.eventDetails?.isEvent && (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 0 }}>
                {(config.fields ?? []).map((field: any, idx: number) => {
                  const req = field.required !== false;
                  const dividerCls = resolvedMode === 'light' ? 'bg-zinc-200' : 'bg-zinc-700';

                  // Standalone description block
                  if (field.type === 'description') {
                    return (
                      <motion.div key={field.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: idx * 0.04 }}>
                        {field.label && field.label !== 'Section' && (
                          <p style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, color: t.title }}>{field.label}</p>
                        )}
                        {field.description && (
                          <div className="rich-preview" style={{ fontSize: 14, lineHeight: 1.6, color: t.body }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(field.description) }} />
                        )}
                      </motion.div>
                    );
                  }

                  const renderInput = () => {
                    if (field.type === 'social') {
                      const platforms = SOCIAL_PLATFORMS.filter((p: any) =>
                        !field.socialPlatforms?.length || field.socialPlatforms.includes(p.id)
                      );
                      return (
                        <div className="space-y-3">
                          {platforms.map((platform: any, pIdx: number) => (
                            <AnimatedField key={platform.id} theme={config.theme} mode={resolvedMode}>
                              <div className="flex items-center">
                                <span className="px-3 py-3 flex-shrink-0">
                                  <span style={{ width: 18, height: 18 }} className="inline-flex flex-shrink-0">
                                    {SOCIAL_SVGS[platform.id] ?? null}
                                  </span>
                                </span>
                                <span className={`w-px self-stretch my-2 ${dividerCls}`} />
                                <input
                                  name={`${field.name}_${platform.id}`}
                                  type="url"
                                  required={pIdx === 0 && req}
                                  placeholder={platform.placeholder}
                                  className={`flex-1 border-none outline-none px-4 py-3 text-sm ${inputBg}`}
                                />
                              </div>
                            </AnimatedField>
                          ))}
                        </div>
                      );
                    }

                    if (field.type === 'company') {
                      return (
                        <AnimatedField theme={config.theme} mode={resolvedMode}>
                          <div className="flex items-center">
                            <span className={`px-3 py-3 flex-shrink-0 ${resolvedMode === 'light' ? 'text-zinc-400' : 'text-zinc-600'}`}>
                              <Building2 className="w-4 h-4" />
                            </span>
                            <span className={`w-px self-stretch my-2 ${dividerCls}`} />
                            <input name={field.name} type="text" required={req} placeholder={field.placeholder || 'Company name...'} className={`flex-1 border-none outline-none px-4 py-3 text-sm ${inputBg}`} />
                          </div>
                        </AnimatedField>
                      );
                    }

                    return (
                      <AnimatedField theme={config.theme} mode={resolvedMode}>
                        {field.type === 'textarea' ? (
                          <textarea name={field.name} required={req} placeholder={field.placeholder} className={`w-full border-none outline-none px-4 py-3 min-h-[110px] resize-y text-sm ${inputBg}`} />
                        ) : field.type === 'select' ? (
                          <select name={field.name} required={req} defaultValue="" className={`w-full border-none outline-none px-4 py-3 appearance-none cursor-pointer text-sm ${inputBg}`}>
                            <option value="" disabled className={`${selectOptionBg}`}>{field.placeholder || 'Select an option...'}</option>
                            {field.options?.map((opt: string) => <option key={opt} value={opt} className={selectOptionBg}>{opt}</option>)}
                          </select>
                        ) : (
                          <input
                            name={field.name}
                            type={field.type === 'email' ? 'email' : field.type === 'phone' ? 'tel' : field.type === 'number' ? 'number' : 'text'}
                            required={req}
                            placeholder={field.placeholder || (field.type === 'phone' ? '+233 24 000 0000' : undefined)}
                            className={`w-full border-none outline-none px-4 py-3 text-sm ${inputBg}`}
                          />
                        )}
                      </AnimatedField>
                    );
                  };

                  return (
                  <motion.div
                    key={field.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.04 }}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    <div style={{ marginLeft: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: t.label }}>{field.label}</label>
                        {!req && (
                          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: t.sectionBg, color: t.muted }}>optional</span>
                        )}
                      </div>
                      {field.description && (
                        <div className="rich-preview" style={{ fontSize: 11, lineHeight: 1.5, color: t.body }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(field.description) }} />
                      )}
                    </div>
                    {renderInput()}
                  </motion.div>
                  );
                })}

                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  type="submit"
                  disabled={submitting}
                  style={{ marginTop: 8 }}
                  className={`w-full py-4 rounded-xl font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-70 ${buttonThemes[config.theme as ThemeColor]}`}
                >
                  {submitting ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Submit Form <ArrowRight className="w-5 h-5" />
                    </>
                  )}
                </motion.button>
              </form>
              )}
            </div>
          </motion.div>
        )}
        </AnimatePresence>
      </main>

    </div>
  );
}

function UnlockPrices({ unlock }: { unlock: UnlockInfo }) {
  const plans = sellablePlans(unlock);
  if (!plans.length) {
    return (
      <p className="mt-2 text-sm leading-relaxed text-[#667085]">
        This content is part of a subscription plan. Contact the learning team to ask about access.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-4">
      {plans.map(plan => (
        <div key={plan.id}>
          <p className="text-sm font-bold text-[#101828]">{plan.name}</p>
          <ul className="mt-2 space-y-1.5">
            {(plan.prices ?? []).map(price => (
              <li key={price.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-[#667085]">{unlockDurationLabel(price.durationMonths)}</span>
                <span className="font-bold text-[#101828]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {unlockMoney(price.currency, price.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function LockedContentPreview({ item }: { item: any }) {
  const cover = resolveCoverUrl(item.coverImage) || '';
  const label = item.type === 'virtual_experience'
    ? 'Virtual Experience'
    : item.type === 'certification' ? 'Certification'
    : item.type === 'learning_path' ? 'Learning Path' : 'Course';
  const contentTable = item.type === 'virtual_experience' ? 'virtual_experiences' : `${item.type}s`;
  const paymentHref = `/student?contentTable=${encodeURIComponent(contentTable)}&contentId=${encodeURIComponent(item.id)}#payments`;

  return (
    <main className="ff-pub min-h-screen bg-[#f4f6f8] text-[#101828]">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); .ff-pub{font-family:'Inter',sans-serif;}`}</style>
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <Link href="/student#explore" className="inline-flex items-center text-sm font-semibold text-[#475467] hover:text-[#101828]">
          Back to Explore
        </Link>

        <section className="mt-6 overflow-hidden bg-white">
          <div className="relative aspect-[16/7] min-h-56 bg-[#0b0b0d]">
            {cover ? <img src={cover} alt={item.title} className="h-full w-full object-cover" /> : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
              <span className="inline-flex items-center gap-2 rounded-md bg-white/95 px-2.5 py-1 text-xs font-bold text-[#344054]">
                <Lock className="h-3.5 w-3.5" />
                {label}
              </span>
              <h1 className="mt-4 max-w-4xl text-3xl font-bold leading-tight text-white sm:text-5xl">{item.title}</h1>
            </div>
          </div>

          <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1fr_300px]">
            <div>
              <h2 className="text-xl font-bold">About this {label.toLowerCase()}</h2>
              {item.description ? (
                <div
                  className="prose prose-slate mt-4 max-w-none text-sm leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(item.description) }}
                />
              ) : (
                <p className="mt-4 text-sm leading-relaxed text-[#667085]">This content is available through a subscription plan.</p>
              )}
              {item.category ? <p className="mt-5 text-sm font-semibold text-[#475467]">Category: {item.category}</p> : null}
            </div>

            <aside className="h-fit bg-[#f8fafc] p-5">
              <h2 className="text-lg font-bold">Unlock this content</h2>
              <UnlockPrices unlock={item.unlock} />
              <Link
                href={paymentHref}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#00bf63] px-4 py-3 text-sm font-bold text-white hover:opacity-90"
              >
                Purchase or enroll
                <ArrowRight className="h-4 w-4" />
              </Link>
            </aside>
          </div>
        </section>
      </div>
    </main>
  );
}
