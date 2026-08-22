'use client';

// Lazy wrapper around CodeMirrorEditor.
//
// CodeMirrorEditor pulls in the whole CodeMirror 6 stack -- state, view, commands,
// autocomplete, language, lang-sql, lang-python and @lezer/highlight. Its two consumers
// both reach students through paths that render for every lesson, not just the ones with
// code in them:
//
//   RunnableCode is registered unconditionally in lessonExtensions, so LessonRenderer --
//   and therefore /student -- bundled CodeMirror for every lesson even when no lesson on
//   the page had a runnable block.
//
//   CertificationPlayground is only reached inside a certification attempt.
//
// Loading it on demand means the chunk arrives when a runnable block actually mounts.
// In RunnableCode that is already gated behind `canRun`, so a read-only code block never
// pays for it at all.
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
