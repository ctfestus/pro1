'use client';

// Lazy wrapper around CodeMirrorEditor.
//
// CodeMirrorEditor pulls in the whole CodeMirror 6 stack -- state, view, commands,
// autocomplete, language, lang-sql, lang-python and @lezer/highlight. Its two consumers
// both imported it statically, so every route that could reach either one paid for it up
// front:
//
//   RunnableCode is registered unconditionally in lessonExtensions, so anything rendering
//   a lesson through LessonRenderer bundled CodeMirror even when no lesson on the page had
//   a runnable block. In practice that is CourseTaker, which is where lessons are actually
//   read, plus the authoring editors.
//
//   CertificationPlayground is only reached inside a certification attempt.
//
// Loading it on demand means the chunk arrives when a runnable block actually mounts. In
// RunnableCode that is already gated behind `canRun`, so a read-only code block never pays
// for it at all.
//
// Measured First Load JS, main d92360c vs this change:
//
//   /[id]                    1.08 MB -> 939 kB
//   /create                    740 kB -> 600 kB
//   /create/guided-project     693 kB -> 553 kB
//   /dashboard/[id]            744 kB -> 605 kB
//   /student                   829 kB -> 827 kB
//
// /student is deliberately in that list as a caution: it barely moves. It is the hub that
// lists courses and sections, it does not render lesson bodies, and LessonRenderer is not
// on it -- lessons are read on /[id] via CourseTaker. Do not reach for this wrapper
// expecting it to lighten /student.
//
// Behavior is unchanged: props pass straight through, and the editor stays uncontrolled
// after mount exactly as before -- the wrapper adds no state of its own.

import dynamic from 'next/dynamic';

export const CodeMirrorEditor = dynamic(
  () => import('@/components/lesson/CodeMirrorEditor').then(m => m.CodeMirrorEditor),
  {
    ssr: false,
    // Hold roughly one screen of code so the surrounding lesson or exam panel does not
    // jump when the real editor swaps in. Neutral translucent grey reads correctly on
    // both the light lesson canvas and the dark certification panel.
    loading: () => <div style={{ minHeight: 160, borderRadius: 8, background: 'rgba(127,127,127,0.08)' }} />,
  },
);
