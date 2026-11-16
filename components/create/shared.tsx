'use client';

// Shared create-editor building blocks, extracted verbatim from app/create/page.tsx:
// constants (FIELD_TYPE_LABELS, SOCIAL_PLATFORMS, TEMPLATES, uid), the SocialIcon helper
// (SOCIAL_SVGS is internal to it), the isRequired predicate, and the themed primitives
// Toggle/SwitchToggle. The local theme itself lives in ./theme (useC).

import React from 'react';
import { useC } from '@/components/create/theme';
import { CalendarDays, ClipboardList, HelpCircle, Video } from 'lucide-react';
import type { FieldType, FormField, FormConfig } from '@/lib/course-schema';

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
        <linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f09433"/>
          <stop offset="25%" stopColor="#e6683c"/>
          <stop offset="50%" stopColor="#dc2743"/>
          <stop offset="75%" stopColor="#cc2366"/>
          <stop offset="100%" stopColor="#bc1888"/>
        </linearGradient>
      </defs>
      <path fill="url(#ig-grad)" d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zm0 10.162a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
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

export function SocialIcon({ id, size = 16 }: { id: string; size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="inline-flex flex-shrink-0">
      {SOCIAL_SVGS[id] ?? null}
    </span>
  );
}

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  email: 'Email',
  textarea: 'Long Text',
  number: 'Number',
  select: 'Dropdown',
  phone: 'Phone',
  company: 'Company',
  social: 'Social Profile',
  description: 'Description Block',
};

const uid = () => Math.random().toString(36).slice(2, 9);

export const TEMPLATES: { key: string; label: string; description: string; icon: React.ElementType; color: string; config: FormConfig }[] = [
  {
    key: 'event',
    label: 'Event Registration',
    description: 'Collect RSVPs with ticket type, dietary needs & more.',
    icon: CalendarDays,
    color: '#1f1bc3',
    config: {
      title: 'Untitled event',
      description: '',
      coverImage: '',
      theme: 'forest',
      mode: 'dark',
      font: 'google-sans-text',
      eventDetails: { isEvent: true, date: '', time: '', location: '', timezone: '' },
      fields: [
        { id: uid(), name: 'full_name', label: 'Full Name', type: 'text', placeholder: 'Enter your full name...', required: true },
        { id: uid(), name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', required: true },
        { id: uid(), name: 'phone', label: 'Contact Number', type: 'phone', required: true },
      ],
    },
  },
  {
    key: 'course',
    label: 'Course',
    description: 'Interactive course with scoring, timer & answer reveal.',
    icon: HelpCircle,
    color: '#ff9933',
    config: {
      title: 'Untitled course',
      description: '',
      coverImage: '',
      theme: 'forest',
      mode: 'dark',
      font: 'google-sans-text',
      isCourse: true,
      fields: [],
      showAnswers: 'per_question',
      passmark: 50,
      // Starts empty: anything pre-filled here could be published by mistake.
      questions: [],
    },
  },
  {
    key: 'survey',
    label: 'Survey',
    description: 'Gather feedback with rating scales and open questions.',
    icon: ClipboardList,
    color: '#10b981',
    config: {
      title: 'Untitled survey',
      description: '',
      coverImage: '',
      theme: 'emerald',
      mode: 'dark',
      font: 'google-sans-text',
      fields: [
        { id: uid(), name: 'first_name', label: 'First Name', type: 'text', placeholder: 'Enter your first name...', required: true },
        { id: uid(), name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', required: false },
        { id: uid(), name: 'overall_rating', label: 'Overall Experience', type: 'select', options: ['⭐ Poor', '⭐⭐ Fair', '⭐⭐⭐ Good', '⭐⭐⭐⭐ Very Good', '⭐⭐⭐⭐⭐ Excellent'], required: true },
        { id: uid(), name: 'what_liked', label: 'What did you like most?', type: 'textarea', placeholder: 'Tell us what stood out...', required: false },
        { id: uid(), name: 'improvements', label: 'What could we improve?', type: 'textarea', placeholder: 'Your suggestions help us grow...', required: false },
        { id: uid(), name: 'recommend', label: 'Would you recommend us?', type: 'select', options: ['Definitely Yes', 'Probably Yes', 'Not Sure', 'Probably Not', 'Definitely Not'], required: true },
      ],
    },
  },
  {
    key: 'webinar',
    label: 'Webinar',
    description: 'Register attendees for your online session or live stream.',
    icon: Video,
    color: '#00a4ef',
    config: {
      title: 'Untitled webinar',
      description: '',
      coverImage: '',
      theme: 'forest',
      mode: 'dark',
      font: 'google-sans-text',
      eventDetails: { isEvent: true, date: '', time: '', location: '', timezone: '' },
      fields: [
        { id: uid(), name: 'full_name', label: 'Full Name', type: 'text', placeholder: 'Enter your full name...', required: true },
        { id: uid(), name: 'email', label: 'Email Address', type: 'email', placeholder: 'you@example.com', required: true },
        { id: uid(), name: 'phone', label: 'Contact Number', type: 'phone', required: true },
      ],
    },
  },
];

export const SOCIAL_PLATFORMS = [
  { id: 'linkedin',  name: 'LinkedIn',    placeholder: 'linkedin.com/in/username' },
  { id: 'twitter',   name: 'X (Twitter)', placeholder: 'x.com/username'           },
  { id: 'instagram', name: 'Instagram',   placeholder: 'instagram.com/username'   },
  { id: 'facebook',  name: 'Facebook',    placeholder: 'facebook.com/username'    },
  { id: 'tiktok',    name: 'TikTok',      placeholder: 'tiktok.com/@username'     },
  { id: 'youtube',   name: 'YouTube',     placeholder: 'youtube.com/@channel'     },
  { id: 'github',    name: 'GitHub',      placeholder: 'github.com/username'      },
  { id: 'website',   name: 'Website',     placeholder: 'https://yourwebsite.com' },
];

export const isRequired = (f: FormField) => f.required !== false;

export function Toggle({ checked, onChange, accentColor }: { checked: boolean; onChange: () => void; accentColor?: string }) {
  const C = useC();
  return (
    <button type="button" onClick={onChange} className="flex items-center gap-1.5">
      <span className="relative inline-flex w-7 h-4 rounded-full transition-colors"
        style={{ background: checked ? (accentColor ?? C.green) : C.toggleOff }}>
        <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-3' : ''}`} />
      </span>
      <span className="text-[11px] font-medium" style={{ color: checked ? (accentColor ?? C.green) : C.faint }}>
        {checked ? 'Required' : 'Optional'}
      </span>
    </button>
  );
}

export function SwitchToggle({ checked, onChange, accentColor }: { checked: boolean; onChange: (v: boolean) => void; accentColor?: string }) {
  const C = useC();
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex-shrink-0">
      <span
        className="relative inline-flex w-9 h-5 rounded-full transition-colors"
        style={{ background: checked ? (accentColor ?? C.green) : C.toggleOff }}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

// --- UI primitives ---
export const inputCls = "w-full rounded-lg px-3.5 py-2.5 text-sm outline-none transition-colors placeholder:text-[#bbb]";
export const labelCls = "block text-xs font-medium mb-2";
