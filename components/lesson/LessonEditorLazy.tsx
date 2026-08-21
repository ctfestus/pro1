'use client';

// Lazy wrapper around LessonEditor.
//
// LessonEditor pulls the whole TipTap stack with it (starter-kit, the table extensions,
// image, placeholder, and every custom lesson node). Six authoring surfaces render it and
// none of them shows it on first paint -- it appears only once an author opens a lesson --
// so importing it statically put TipTap in the initial bundle of /create,
// /create/assignment, /create/guided-project and the dashboard editor for nothing.
//
// Behavior is unchanged: props pass straight through, and the stable per-lesson `key`
// callers must supply still remounts the editor exactly as before.

import dynamic from 'next/dynamic';

export const LessonEditor = dynamic(
  () => import('@/components/lesson/LessonEditor').then(m => m.LessonEditor),
  {
    ssr: false,
    // Hold roughly the editor's own height so opening a lesson does not shift the form.
    loading: () => <div style={{ minHeight: 220, borderRadius: 12, background: 'rgba(127,127,127,0.08)' }} />,
  },
);
