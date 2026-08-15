'use client';

// Shared stylesheet for interactive lesson content. Both LessonEditor (authoring)
// and LessonRenderer (player) wrap their content in `.lesson-content` (plus `.dark`
// in dark mode), so this single stylesheet themes both surfaces identically and the
// React node views never need theme props. Rendering it twice is harmless.
//
// Palette stays within the platform guardrails: neutral / emerald / amber only.
// No indigo, purple, or blue accents.

import { ATTACHMENT_EXTENSIONS } from '@/lib/lesson-attachment';

export function LessonContentStyles() {
  // Stepper progressive reveal: when N steps are revealed, show steps 0..N-1. Generated
  // (rather than hand-written) so the cumulative selectors don't bloat the source.
  const stepReveal = Array.from({ length: 12 }, (_, r) => {
    const revealed = r + 1;
    const show = Array.from({ length: revealed }, (_, i) =>
      `.lesson-content .lesson-stepper[data-revealed="${revealed}"] .lesson-step[data-step-index="${i}"]`,
    ).join(',\n');
    // Only the newest revealed step (index revealed-1) animates in -- already-shown
    // steps match a rule with no animation, so they don't re-play on each reveal. It
    // also has no connector below it (would dangle into empty space).
    const last = `.lesson-content .lesson-stepper[data-revealed="${revealed}"] .lesson-step[data-step-index="${revealed - 1}"]`;
    // Walkthrough-only: the "current step" emphasis and the numbers-become-checks rules are
    // scoped to data-reveal="sequential". A 'show all' stepper is reference instructions, so
    // every step keeps its number and none is singled out as current.
    const current = `.lesson-content .lesson-stepper[data-editable="false"][data-reveal="sequential"][data-revealed="${revealed}"]:not([data-complete="true"]) .lesson-step[data-step-index="${revealed - 1}"]`;
    const completed = Array.from({ length: Math.max(0, revealed - 1) }, (_, i) =>
      `.lesson-content .lesson-stepper[data-editable="false"][data-reveal="sequential"][data-revealed="${revealed}"] .lesson-step[data-step-index="${i}"]`,
    ).join(',\n');
    return `${show} { display: flex; }\n${last} { animation: lesson-step-in 0.34s cubic-bezier(0.2,0.7,0.3,1); }\n${last}::after { display: none; }\n${current} .lesson-step__main { background: color-mix(in oklab, var(--lesson-accent-base) 5%, transparent); }\n${current} .lesson-step__num { box-shadow: 0 0 0 5px var(--lesson-accent-ring); }${completed ? `\n${completed} .lesson-step__num { display: none; }\n${completed} .lesson-step__check { display: inline-flex; }` : ''}`;
  }).join('\n');

  // Authored inline links get a marker chosen by where they lead, so it carries
  // information: a file pulls down, an outside site points away, an in-app path stays
  // bare. Generated rather than hand-written because each type needs three forms --
  // bare, `?query` (Supabase download URLs) and `#fragment` (pdf page anchors) -- and
  // because the extension list is shared with the attachment block, so the two can
  // never disagree about what counts as a file.
  const authoredLink = '.lesson-content .ProseMirror a:not([class])';
  // An absolute link back to this same app is not leaving it, so it earns no marker.
  // The tenant domain is only knowable at runtime; this stylesheet renders on the client
  // only (both lesson surfaces return null until their editor exists), so reading
  // location here cannot cause a hydration mismatch.
  // Wrapped in :where() so the exclusion costs no specificity -- a bare :not() would
  // outrank the file rules below and steal the download glyph from every external file.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const notThisApp = origin ? `:where(:not([href="${origin}"]):not([href^="${origin}/"]))` : '';
  const externalLink = `${authoredLink}[href^="http"]${notThisApp}::after`;
  const fileLink = ATTACHMENT_EXTENSIONS.flatMap((ext) => [
    `${authoredLink}[href$=".${ext}" i]::after`,
    `${authoredLink}[href*=".${ext}?" i]::after`,
    `${authoredLink}[href*=".${ext}#" i]::after`,
  ]).join(',\n');

  return (
    <style>{`
.lesson-content { font-size: 15.5px; line-height: 1.6; color: #3f3f46; }
.lesson-content.dark { color: #d4d4d8; }
/* Brand accent for decorative interactive chrome (timeline dot, stepper marker/line/
   button, carousel check, glossary underline). --lesson-accent-base is set from the
   tenant primary color on the .lesson-content container (default emerald), and the
   shades are derived from it with color-mix so they track any theme. Semantic colors
   (correct=green, callout variants, etc.) intentionally stay fixed. */
.lesson-content { --lesson-accent-base: #10b981; --lesson-accent: var(--lesson-accent-base); --lesson-accent-ink: color-mix(in oklab, var(--lesson-accent) 80%, #000); --lesson-accent-ring: color-mix(in oklab, var(--lesson-accent) 22%, transparent); --lesson-accent-strong: color-mix(in oklab, var(--lesson-accent) 85%, #000); }
.lesson-content.dark { --lesson-accent: color-mix(in oklab, var(--lesson-accent-base) 85%, #fff); --lesson-accent-ink: color-mix(in oklab, var(--lesson-accent) 70%, #fff); }
/* Per-block accent override (see accentScope in StyleControls). The shades above are computed on
   .lesson-content, so a block that sets only --lesson-accent-base would keep inheriting the
   container's ink/ring. Re-declaring the set here re-derives all of them from the local base. */
.lesson-content .lesson-accent-scope { --lesson-accent: var(--lesson-accent-base); --lesson-accent-ink: color-mix(in oklab, var(--lesson-accent) 80%, #000); --lesson-accent-ring: color-mix(in oklab, var(--lesson-accent) 22%, transparent); --lesson-accent-strong: color-mix(in oklab, var(--lesson-accent) 85%, #000); }
.lesson-content.dark .lesson-accent-scope { --lesson-accent: color-mix(in oklab, var(--lesson-accent-base) 85%, #fff); --lesson-accent-ink: color-mix(in oklab, var(--lesson-accent) 70%, #fff); }
.lesson-content p { margin: 0 0 0.75rem; }
.lesson-content p:last-child { margin-bottom: 0; }
.lesson-content ul { list-style: disc; padding-left: 1.4rem; margin: 0.4rem 0 0.75rem; }
.lesson-content ol { list-style: decimal; padding-left: 1.4rem; margin: 0.4rem 0 0.75rem; }
.lesson-content li { margin: 0.2rem 0; }
.lesson-content b, .lesson-content strong { font-weight: 700; color: #18181b; }
.lesson-content.dark b, .lesson-content.dark strong { color: #fafafa; }
.lesson-content i, .lesson-content em { font-style: italic; }
.lesson-content u { text-decoration: underline; }
.lesson-content a { color: #047857; text-decoration: underline; }
.lesson-content.dark a { color: #6ee7b7; }
.lesson-content a:hover { opacity: 0.8; }
.lesson-content h1 { font-size: 1.9rem; font-weight: 700; margin: 1.25rem 0 0.5rem; letter-spacing: -0.02em; color: #18181b; }
.lesson-content h2 { font-size: 1.6rem; font-weight: 700; margin: 1.25rem 0 0.4rem; letter-spacing: -0.02em; color: #18181b; }
.lesson-content h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.3rem; letter-spacing: -0.01em; color: #18181b; }
.lesson-content.dark h1, .lesson-content.dark h2, .lesson-content.dark h3 { color: #ffffff; }
.lesson-content h1:first-child, .lesson-content h2:first-child, .lesson-content h3:first-child { margin-top: 0; }
.lesson-content hr { border: none; border-top: 1px solid #e4e4e7; margin: 1.25rem 0; }
.lesson-content.dark hr { border-top-color: #27272a; }

.lesson-content code { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 0.88em; background: rgba(0,0,0,0.06); color: #166534; border-radius: 4px; padding: 1px 5px; }
.lesson-content.dark code { background: rgba(255,255,255,0.08); color: #86efac; }
.lesson-content pre { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 0.85em; background: #f6f8fa; color: #1a1d2e; border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 16px; margin: 0.75rem 0; overflow-x: auto; white-space: pre; }
.lesson-content.dark pre { background: #0f1120; color: #c9d1d9; border-color: #2e2e33; }
.lesson-content pre code { background: none; padding: 0; border-radius: 0; color: inherit; font-size: inherit; }
/* Dark block-code reset must out-specify .lesson-content.dark code (two classes), or
   inline-code green/background leaks onto block code inside <pre> in dark mode. */
.lesson-content.dark pre code { background: none; color: inherit; }

.lesson-content blockquote { border-left: 3px solid #10b981; padding-left: 0.875rem; margin: 0.75rem 0; color: #52525b; font-style: normal; }
.lesson-content.dark blockquote { color: #a1a1aa; }

.lesson-content img { max-width: 100%; height: auto; border-radius: 10px; margin: 0.75rem 0; display: block; }
.lesson-content img.ProseMirror-selectednode { outline: 2px solid #10b981; outline-offset: 2px; }

.lesson-content .tableWrapper { position: relative; overflow-x: auto; margin: 1rem 0; border-radius: 0; container-type: inline-size; overscroll-behavior-inline: contain; scrollbar-width: thin; scrollbar-color: var(--lesson-accent-ring) transparent; }
.lesson-content .tableWrapper[data-table-radius="soft"] { border-radius: 8px; }
.lesson-content .tableWrapper[data-table-radius="rounded"] { border-radius: 14px; }
.lesson-content table { width: 100%; margin: 0; border-collapse: separate; border-spacing: 0; overflow: hidden; font-size: 0.94em; }
.lesson-content th, .lesson-content td { position: relative; padding: 9px 12px; border: 1px solid #e4e4e7; border-width: 0 1px 1px 0; text-align: left; vertical-align: top; background: var(--cell-bg, transparent); transition: background-color 0.14s ease; }
.lesson-content tr:first-child > th, .lesson-content tr:first-child > td { border-top-width: 1px; }
.lesson-content tr > :first-child { border-left-width: 1px; }
.lesson-content th { color: #18181b; background: var(--cell-bg, color-mix(in oklab, var(--lesson-accent-base) 6%, #f4f4f5)); font-weight: 700; }
.lesson-content tbody tr:hover > td { background-color: var(--cell-bg, color-mix(in oklab, var(--lesson-accent-base) 3%, transparent)); }
.lesson-content.dark th, .lesson-content.dark td { border-color: #3f3f46; }
.lesson-content.dark th { color: #fafafa; background: var(--cell-bg, color-mix(in oklab, var(--lesson-accent-base) 9%, rgba(255,255,255,0.045))); }
.lesson-content.dark tbody tr:hover > td { background-color: var(--cell-bg, rgba(255,255,255,0.025)); }
.lesson-content td[data-cb], .lesson-content th[data-cb] { border-color: var(--cbc, #e4e4e7); }
.lesson-content.dark td[data-cb], .lesson-content.dark th[data-cb] { border-color: var(--cbc, #3f3f46); }
.lesson-content td[data-cb="none"], .lesson-content th[data-cb="none"] { border: 0; }
.lesson-content td[data-cb="all"], .lesson-content th[data-cb="all"] { border-width: 1px; border-style: solid; }
.lesson-content td[data-cb="horizontal"], .lesson-content th[data-cb="horizontal"] { border-width: 1px 0; border-style: solid; }
.lesson-content td[data-cb="vertical"], .lesson-content th[data-cb="vertical"] { border-width: 0 1px; border-style: solid; }
/* Narrow column: keep columns readable and let the table scroll sideways instead of crushing every cell to a few characters. Keyed to the wrapper's own width. */
@container (max-width: 560px) { .lesson-content th, .lesson-content td { min-width: 7.5rem; } }
.lesson-content .column-resize-handle { position: absolute; top: 0; right: -2px; bottom: 0; z-index: 4; width: 4px; background: var(--lesson-accent); pointer-events: none; }
.lesson-content .selectedCell:after { content: ""; position: absolute; inset: 0; z-index: 2; background: var(--lesson-accent-ring); box-shadow: inset 0 0 0 1px var(--lesson-accent); pointer-events: none; }
.lesson-content .lesson-table-caption { padding: 8px 2px 0; caption-side: bottom; color: #71717a; text-align: left; font-size: 11.5px; line-height: 1.5; }
.lesson-content.dark .lesson-table-caption { color: #a1a1aa; }
.lesson-content .lesson-table-scroll-hint { display: none; position: sticky; left: 0; align-items: center; gap: 6px; width: fit-content; padding-top: 8px; color: #71717a; font-size: 10px; font-weight: 650; pointer-events: none; }
.lesson-content.dark .lesson-table-scroll-hint { color: #a1a1aa; }
.lesson-content .lesson-table-scroll-hint > span { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 999px; background: var(--lesson-accent); animation: lesson-table-scroll-pulse 1.65s ease-in-out infinite; }
@keyframes lesson-table-scroll-pulse { 0%,100% { opacity: 0.55; transform: scale(0.72); } 50% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 0 5px var(--lesson-accent-ring); } }
@container (max-width: 560px) { .lesson-content .lesson-table-scroll-hint:not([data-editor="true"]) { display: flex; } }
@media (prefers-reduced-motion: reduce) { .lesson-content .lesson-table-scroll-hint > span { animation: none; opacity: 1; transform: none; } }

.lesson-table-toolbar { display: flex; align-items: center; gap: 5px; padding: 6px 8px; border-bottom: 1px solid rgba(0,0,0,0.07); background: rgba(0,0,0,0.018); }
.lesson-table-toolbar[data-theme="dark"] { border-bottom-color: rgba(255,255,255,0.07); background: rgba(255,255,255,0.018); }
.lesson-table-toolbar__identity { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; border-radius: 8px; color: color-mix(in oklab, var(--lesson-accent-base) 82%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 11%, transparent); }
.lesson-table-toolbar[data-theme="dark"] .lesson-table-toolbar__identity { color: color-mix(in oklab, var(--lesson-accent-base) 72%, #fff); }
.lesson-table-toolbar .lesson-table-tool { border: 0 !important; color: #52525b !important; background: transparent !important; }
.lesson-table-toolbar[data-theme="dark"] .lesson-table-tool { color: #a1a1aa !important; }
.lesson-table-toolbar .lesson-table-tool:hover { color: color-mix(in oklab, var(--lesson-accent-base) 82%, #000) !important; background: color-mix(in oklab, var(--lesson-accent-base) 10%, transparent) !important; }
.lesson-table-caption-input { width: 130px; padding: 4px 6px; border: 1px solid rgba(0,0,0,0.1); border-radius: 7px; outline: 0; color: #3f3f46; background: rgba(0,0,0,0.025); font: inherit; font-size: 10.5px; }
.lesson-content.dark .lesson-table-caption-input { border-color: rgba(255,255,255,0.1); color: #d4d4d8; background: rgba(255,255,255,0.045); }
.lesson-table-caption-input:focus { border-color: var(--lesson-accent-base); box-shadow: 0 0 0 2px color-mix(in oklab, var(--lesson-accent-base) 14%, transparent); }
.lesson-table-format-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 0; }
.lesson-table-format-grid > section { display: flex; min-width: 0; flex-direction: column; gap: 9px; padding: 1px 12px 1px 0; }
.lesson-table-format-grid > section + section { padding: 1px 0 1px 12px; border-left: 1px solid #e4e4e7; }
.lesson-style-menu__panel.dark .lesson-table-format-grid > section + section { border-left-color: #2e2e33; }
.lesson-table-format-grid__heading { color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); font-size: 10px; font-weight: 800; letter-spacing: 0.09em; text-transform: uppercase; }
.lesson-style-menu__panel.dark .lesson-table-format-grid__heading { color: color-mix(in oklab, var(--lesson-accent-base) 68%, #fff); }
@media (max-width: 460px) {
  .lesson-table-format-grid { grid-template-columns: 1fr; }
  .lesson-table-format-grid > section { padding-right: 0; }
  .lesson-table-format-grid > section + section { margin-top: 11px; padding: 11px 0 0; border-top: 1px solid #e4e4e7; border-left: 0; }
  .lesson-style-menu__panel.dark .lesson-table-format-grid > section + section { border-top-color: #2e2e33; border-left: 0; }
}

.lesson-content .lesson-callout { --callout-accent: var(--lesson-accent); --callout-ink: var(--lesson-accent-ink); --callout-surface: color-mix(in oklab, var(--callout-accent) 5%, #ffffff); --callout-border: color-mix(in oklab, var(--callout-accent) 18%, #e2e8f0); position: relative; display: grid; grid-template-columns: 38px minmax(0,1fr); gap: 12px; overflow: hidden; margin: 1rem 0; padding: 16px 17px 16px 14px; border: 0; border-radius: 15px; color: #3f3f46; background: var(--callout-surface); box-shadow: 0 8px 24px rgba(15,23,42,0.045); }
.lesson-content .lesson-callout::before { content: ''; position: absolute; inset: 0 auto 0 0; width: 3px; background: var(--callout-accent); }
.lesson-content.dark .lesson-callout { --callout-surface: rgba(255,255,255,0.035); --callout-border: color-mix(in oklab, var(--callout-accent) 24%, rgba(255,255,255,0.08)); color: #d4d4d8; box-shadow: none; }
.lesson-content .lesson-callout__icon-wrap { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 11px; color: var(--callout-ink); background: color-mix(in oklab, var(--callout-accent) 12%, transparent); }
.lesson-content.dark .lesson-callout__icon-wrap { color: color-mix(in oklab, var(--callout-accent) 60%, #fff); background: color-mix(in oklab, var(--callout-accent) 15%, transparent); }
.lesson-content .lesson-callout__icon { flex: 0 0 auto; }
.lesson-content .lesson-callout__main { min-width: 0; }
.lesson-content .lesson-callout__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; min-height: 36px; margin-bottom: 5px; user-select: none; }
.lesson-content .lesson-callout__heading { min-width: 0; flex: 1; }
.lesson-content .lesson-callout__eyebrow { display: block; color: var(--callout-ink); font-size: 9.5px; font-weight: 800; letter-spacing: 0.13em; line-height: 1.45; text-transform: uppercase; }
.lesson-content.dark .lesson-callout__eyebrow { color: color-mix(in oklab, var(--callout-accent) 60%, #fff); }
/* Editor twin of the eyebrow: same small-caps look, with a dashed underline marking it editable. */
.lesson-content .lesson-callout__eyebrow-input { display: block; width: 100%; padding: 0 0 1px; border: 0; border-bottom: 1px dashed color-mix(in oklab, var(--callout-accent) 24%, #d4d4d8); outline: 0; color: var(--callout-ink); background: transparent; font: inherit; font-size: 9.5px; font-weight: 800; letter-spacing: 0.13em; line-height: 1.45; text-transform: uppercase; }
.lesson-content.dark .lesson-callout__eyebrow-input { border-bottom-color: rgba(255,255,255,0.13); color: color-mix(in oklab, var(--callout-accent) 60%, #fff); }
.lesson-content .lesson-callout__eyebrow-input::placeholder { color: color-mix(in oklab, var(--callout-ink) 50%, #a1a1aa); }
.lesson-content .lesson-callout__title { margin: 2px 0 0; color: #18181b; font-size: 14.5px; font-weight: 740; letter-spacing: -0.005em; line-height: 1.4; }
.lesson-content.dark .lesson-callout__title { color: #fafafa; }
.lesson-content .lesson-callout__title-input { display: block; width: 100%; margin-top: 1px; padding: 1px 0; border: 0; border-bottom: 1px dashed color-mix(in oklab, var(--callout-accent) 20%, #d4d4d8); outline: 0; color: #18181b; background: transparent; font: inherit; font-size: 14.5px; font-weight: 740; line-height: 1.4; }
.lesson-content.dark .lesson-callout__title-input { color: #fafafa; border-bottom-color: rgba(255,255,255,0.13); }
.lesson-content .lesson-callout__title-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-callout__body { color: inherit; }
.lesson-content .lesson-callout__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-callout__controls { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; transition: opacity 0.15s ease; }
.lesson-content .lesson-callout__control { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-callout__control:hover { color: var(--callout-ink); background: color-mix(in oklab, var(--callout-accent) 10%, transparent); }
.lesson-content .lesson-callout__remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
@media (hover: hover) {
  .lesson-content .lesson-callout__controls { opacity: 0; }
  .lesson-content .lesson-callout:hover .lesson-callout__controls, .lesson-content .lesson-callout:focus-within .lesson-callout__controls { opacity: 1; }
}
.lesson-content .lesson-callout__add-action { display: inline-flex; align-items: center; gap: 5px; margin-top: 9px; padding: 4px 7px; border: 0; border-radius: 7px; color: var(--callout-ink); background: transparent; cursor: pointer; font: inherit; font-size: 11px; font-weight: 680; }
.lesson-content .lesson-callout__add-action:hover { background: color-mix(in oklab, var(--callout-accent) 10%, transparent); }
.lesson-content .lesson-callout__action-editor { display: grid; grid-template-columns: minmax(90px,0.7fr) minmax(150px,1.3fr) 24px; gap: 7px; align-items: center; margin-top: 10px; padding: 8px; border-radius: 9px; background: rgba(255,255,255,0.62); }
.lesson-content.dark .lesson-callout__action-editor { background: rgba(255,255,255,0.045); }
.lesson-content .lesson-callout__action-input { min-width: 0; width: 100%; padding: 5px 7px; border: 1px solid rgba(15,23,42,0.09); border-radius: 7px; outline: 0; color: #27272a; background: rgba(255,255,255,0.78); font: inherit; font-size: 10.5px; }
.lesson-content.dark .lesson-callout__action-input { border-color: rgba(255,255,255,0.09); color: #e4e4e7; background: rgba(255,255,255,0.035); }
.lesson-content .lesson-callout__action-input:focus { border-color: var(--callout-accent); box-shadow: 0 0 0 2px color-mix(in oklab, var(--callout-accent) 14%, transparent); }
.lesson-content .lesson-callout__remove-action { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-callout__remove-action:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-callout__action { display: inline-flex; align-items: center; gap: 5px; width: fit-content; margin-top: 10px; padding: 6px 9px; border-radius: 8px; color: var(--callout-ink); background: color-mix(in oklab, var(--callout-accent) 10%, transparent); text-decoration: none; font-size: 11px; font-weight: 720; }
.lesson-content .lesson-callout__action:hover { opacity: 1; background: color-mix(in oklab, var(--callout-accent) 16%, transparent); }

.lesson-content .lesson-callout[data-variant="tip"] { --callout-accent: #10b981; --callout-ink: #047857; }
.lesson-content .lesson-callout[data-variant="warning"] { --callout-accent: #f59e0b; --callout-ink: #a16207; }
.lesson-content .lesson-callout[data-variant="info"] { --callout-accent: #3b82f6; --callout-ink: #1d4ed8; }
.lesson-content .lesson-callout[data-variant="success"] { --callout-accent: #22c55e; --callout-ink: #15803d; }
@media (max-width: 560px) {
  .lesson-content .lesson-callout { grid-template-columns: 32px minmax(0,1fr); gap: 10px; padding: 13px 13px 13px 11px; border-radius: 13px; }
  .lesson-content .lesson-callout__icon-wrap { width: 32px; height: 32px; border-radius: 9px; }
  .lesson-content .lesson-callout__action-editor { grid-template-columns: 1fr 24px; }
  .lesson-content .lesson-callout__action-editor .lesson-callout__action-input:first-child { grid-column: 1; }
  .lesson-content .lesson-callout__action-editor .lesson-callout__action-input:nth-child(2) { grid-column: 1; }
  .lesson-content .lesson-callout__remove-action { grid-column: 2; grid-row: 1 / span 2; }
}

/* Suppress the global :focus-visible outline (globals.css) on the editor surface.
   Needs :focus-visible + !important to beat that rule; the editor shows its own
   cursor/active state, so the green box around the whole editor is unwanted. */
.lesson-content .ProseMirror:focus,
.lesson-content .ProseMirror:focus-visible { outline: none !important; }
.lesson-content .ProseMirror > :last-child { margin-bottom: 0; }
.lesson-content .ProseMirror p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #a1a1aa; float: left; height: 0; pointer-events: none; }

/* Shared authoring controls for complete interactive blocks. */
.lesson-content .lesson-block-corner { display: flex; align-items: center; gap: 4px; }
.lesson-content .lesson-block-delete { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 26px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: rgba(255,255,255,0.92); box-shadow: 0 1px 4px rgba(0,0,0,0.18); cursor: pointer; transition: color 0.15s ease, background 0.15s ease, opacity 0.15s ease; }
.lesson-content.dark .lesson-block-delete { color: #a1a1aa; background: rgba(30,30,34,0.94); box-shadow: 0 1px 5px rgba(0,0,0,0.42); }
.lesson-content .lesson-block-delete:hover { color: #dc2626; background: #fff1f2; }
.lesson-content.dark .lesson-block-delete:hover { color: #fda4af; background: rgba(244,63,94,0.14); }
.lesson-content .lesson-block-delete:focus-visible { outline: 2px solid #f43f5e !important; outline-offset: 2px; }
.lesson-content .lesson-block-actions { display: inline-flex; align-items: center; gap: 4px; }
.lesson-content .lesson-block-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; }
.lesson-content .lesson-block-footer > button { margin-top: 0; }
/* Keeps the controls on the right even when the "Add ..." button is gone (a block at its maximum
   leaves the footer with one child, and space-between alone would park it on the left). */
.lesson-content .lesson-block-footer > .lesson-block-actions { margin-left: auto; }
.lesson-content .lesson-block-footer .lesson-block-delete { margin-left: auto; box-shadow: none; background: rgba(0,0,0,0.045); }
.lesson-content.dark .lesson-block-footer .lesson-block-delete { background: rgba(255,255,255,0.07); }
.lesson-content .lesson-block-actions .lesson-block-delete { box-shadow: none; background: rgba(0,0,0,0.045); }
.lesson-content.dark .lesson-block-actions .lesson-block-delete { background: rgba(255,255,255,0.07); }

.lesson-content .lesson-accordion { margin: 1rem 0; --acc-border-default: #e2e8f0; }
.lesson-content.dark .lesson-accordion { --acc-border-default: rgba(255,255,255,0.09); }
.lesson-content .lesson-accordion__toolbar { display: flex; justify-content: flex-end; margin-bottom: 7px; }
.lesson-content .lesson-accordion__items { overflow: hidden; border-style: var(--acc-border-style, solid); border-width: var(--acc-border-width, 1px); border-color: var(--acc-border-color, var(--acc-border-default, #e2e8f0)); border-radius: 16px; background: #ffffff; box-shadow: 0 8px 24px rgba(15,23,42,0.045); }
.lesson-content.dark .lesson-accordion__items { background: rgba(255,255,255,0.025); box-shadow: none; }
.lesson-content .lesson-accordion__items > [data-node-view-content-react] { display: flex; flex-direction: column; }
.lesson-content .lesson-accordion__items > [data-node-view-content-react] > .node-accordionItem + .node-accordionItem { border-top: 1px solid var(--acc-border-color, var(--acc-border-default, #e2e8f0)); }
.lesson-content .lesson-accordion__item { position: relative; overflow: hidden; background: transparent; }
/* Deliberately the same size as the guided-steps title (1.05rem), at every width -- a section
   heading and a step title should read as the same level. Change both together or neither. */
.lesson-content .lesson-accordion__head { display: flex; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-height: 62px; margin: 0; padding: 15px 18px 15px 20px; border: 0; border-radius: 0; color: #18181b; background: transparent; cursor: pointer; user-select: none; text-align: left; font: inherit; font-size: 1.05rem; font-weight: 720; line-height: 1.35; transition: background 0.16s ease, color 0.16s ease; }
/* The editor head carries more controls than the player's (logo, accent menu, collapse, remove),
   so it runs a tighter gap to keep the title from being squeezed on a phone. The player head is a
   <button>, the editor head a <div> -- that is the distinction. */
.lesson-content div.lesson-accordion__head { gap: 10px; }
.lesson-content .lesson-accordion__head:hover { background: color-mix(in oklab, var(--lesson-accent-base) 4%, transparent); }
.lesson-content .lesson-accordion__head:focus-visible { position: relative; z-index: 3; outline: 2px solid var(--lesson-accent) !important; outline-offset: -3px; }
.lesson-content.dark .lesson-accordion__head { color: #f4f4f5; }
.lesson-content.dark .lesson-accordion__head:hover { background: rgba(255,255,255,0.035); }
/* Header identity: optional logo, then a title + subtitle stack, then the toggle. */
.lesson-content .lesson-accordion__heading { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.lesson-content .lesson-accordion__title { color: inherit; }
.lesson-content .lesson-accordion__title-input { width: 100%; min-width: 0; padding: 2px 0; border: none; outline: none; color: inherit; background: transparent; font: inherit; font-weight: 720; }
.lesson-content .lesson-accordion__title-input::placeholder { color: #a1a1aa; font-weight: 550; }
.lesson-content .lesson-accordion__subtitle { color: #71717a; font-size: 13px; font-weight: 500; line-height: 1.4; }
.lesson-content.dark .lesson-accordion__subtitle { color: #9b9ba3; }
.lesson-content .lesson-accordion__subtitle-input { width: 100%; min-width: 0; padding: 1px 0; border: none; outline: none; color: #71717a; background: transparent; font: inherit; font-size: 13px; font-weight: 500; line-height: 1.4; }
.lesson-content.dark .lesson-accordion__subtitle-input { color: #9b9ba3; }
.lesson-content .lesson-accordion__subtitle-input::placeholder { color: #a1a1aa; font-weight: 450; }
/* The logo renders bare -- no tile, border, or fill -- so an uploaded mark sits on the header the
   way it was designed. The accent still colours the rest of the section header. */
/* margin:0 is load-bearing. The generic image rule near the top of this sheet gives every lesson
   image a 0.75rem vertical margin. In the player the logo is a direct flex child of the header, so
   without this reset those margins add about 24px to the header height. */
.lesson-content .lesson-accordion__logo { width: 100%; height: 100%; margin: 0; object-fit: contain; border: 0; border-radius: 9px; background: transparent; }
/* Roughly the height of the title + subtitle stack beside it, so the tile anchors the row. */
.lesson-content .lesson-accordion__head > .lesson-accordion__logo { width: 46px; height: 46px; flex: 0 0 46px; }
/* The clear control is pinned to the tile's corner rather than nudged with margins, so it
   cannot shift the header row as the logo is added or removed. */
.lesson-content .lesson-accordion__logo-slot { position: relative; display: inline-flex; flex: 0 0 auto; }
.lesson-content .lesson-accordion__logo-btn { display: inline-flex; align-items: center; justify-content: center; width: 46px; height: 46px; flex: 0 0 46px; padding: 0; overflow: hidden; border: 0; border-radius: 12px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-accordion__logo-btn[data-empty="true"] { border: 1px dashed var(--acc-border-color, var(--acc-border-default, #e2e8f0)); }
.lesson-content .lesson-accordion__logo-btn[data-empty="true"]:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-accordion__logo-clear { position: absolute; top: -6px; right: -6px; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 999px; color: #71717a; background: #ffffff; box-shadow: 0 1px 4px rgba(15,23,42,0.2); cursor: pointer; }
.lesson-content.dark .lesson-accordion__logo-clear { color: #d4d4d8; background: #27272a; box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
.lesson-content .lesson-accordion__logo-clear:hover { color: #ef4444; }
.lesson-content .lesson-accordion__editor-toggle { display: inline-flex; flex: 0 0 auto; padding: 0; border: 0; border-radius: 9px; color: inherit; background: transparent; cursor: pointer; }
.lesson-content .lesson-accordion__remove { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 26px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-accordion__remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
/* Accent-coloured at rest, not only on hover. This is the section's ONLY always-visible accent
   surface -- the open-state bar and the tinted logo tile were both removed by request -- and
   phones have no hover at all, so a hover-only treatment would mean the colour a student sees is
   never the one the author picked. */
.lesson-content .lesson-accordion__toggle-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex: 0 0 30px; border-radius: 9px; color: var(--lesson-accent-ink); transition: color 0.16s ease, background 0.16s ease; }
.lesson-content .lesson-accordion__head:hover .lesson-accordion__toggle-icon, .lesson-content .lesson-accordion__editor-toggle:hover .lesson-accordion__toggle-icon { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
/* An open section reads as active without needing hover either. */
.lesson-content .lesson-accordion__item[data-open="true"] .lesson-accordion__toggle-icon { background: var(--lesson-accent-ring); }
.lesson-content .lesson-accordion__plus, .lesson-content .lesson-accordion__minus { position: absolute; transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.2,0.7,0.3,1); }
.lesson-content .lesson-accordion__minus { opacity: 0; transform: rotate(-90deg) scale(0.7); }
.lesson-content .lesson-accordion__item[data-open="true"] .lesson-accordion__plus { opacity: 0; transform: rotate(90deg) scale(0.7); }
.lesson-content .lesson-accordion__item[data-open="true"] .lesson-accordion__minus { opacity: 1; transform: rotate(0) scale(1); }
.lesson-content .lesson-accordion__body-shell { display: grid; grid-template-rows: 1fr; opacity: 1; transition: grid-template-rows 0.24s cubic-bezier(0.2,0.7,0.3,1), opacity 0.18s ease; }
.lesson-content .lesson-accordion__body { min-height: 0; overflow: hidden; padding: 2px 20px 20px; color: #52525b; }
.lesson-content.dark .lesson-accordion__body { color: #b4b4bc; }
.lesson-content .lesson-accordion__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-accordion__item[data-open="false"] > .lesson-accordion__body-shell { grid-template-rows: 0fr; opacity: 0; }
.lesson-content .lesson-accordion__item[data-open="false"] .lesson-accordion__body { padding-top: 0; padding-bottom: 0; }
.lesson-content .lesson-accordion__add { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; padding: 6px 10px; border: 0; border-radius: 8px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; }
.lesson-content .lesson-accordion__add:hover { background: var(--lesson-accent-ring); }
@media (max-width: 560px) {
  .lesson-content .lesson-accordion__items { border-radius: 13px; }
  /* No font-size override: guided steps does not shrink on mobile either, so overriding here is
     what let the two drift apart in the first place. */
  .lesson-content .lesson-accordion__head { min-height: 56px; padding: 13px 13px 13px 16px; }
  .lesson-content .lesson-accordion__head { gap: 11px; }
  .lesson-content .lesson-accordion__head > .lesson-accordion__logo, .lesson-content .lesson-accordion__logo-btn { width: 38px; height: 38px; flex-basis: 38px; }
  .lesson-content .lesson-accordion__subtitle, .lesson-content .lesson-accordion__subtitle-input { font-size: 12px; }
  .lesson-content .lesson-accordion__body { padding: 1px 16px 16px; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-accordion__plus, .lesson-content .lesson-accordion__minus, .lesson-content .lesson-accordion__body-shell { transition: none; }
}

.lesson-content .lesson-tabs { --tabs-border: #e2e8f0; overflow: hidden; margin: 1rem 0; border: 0; border-radius: 16px; background: #ffffff; box-shadow: 0 8px 24px rgba(15,23,42,0.05); }
.lesson-content.dark .lesson-tabs { --tabs-border: rgba(255,255,255,0.09); background: rgba(255,255,255,0.03); box-shadow: none; }
.lesson-content .lesson-tabs__bar { display: flex; flex-wrap: nowrap; align-items: center; gap: 4px; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: none; padding: 7px; background: #f4f4f5; }
.lesson-content .lesson-tabs__bar::-webkit-scrollbar { display: none; }
.lesson-content.dark .lesson-tabs__bar { background: rgba(255,255,255,0.04); }
.lesson-content .lesson-tabs__style { position: sticky; right: 0; display: inline-flex; align-items: center; flex: 0 0 auto; margin-left: auto; padding-left: 4px; background: #f4f4f5; box-shadow: -8px 0 10px #f4f4f5; }
.lesson-content.dark .lesson-tabs__style { background: #242428; box-shadow: -8px 0 10px #242428; }
.lesson-content .lesson-tabs__tab { position: relative; display: inline-flex; align-items: center; gap: 1px; min-height: 34px; flex: 0 0 auto; padding: 2px; border-radius: 10px; color: #71717a; transition: color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease; }
.lesson-content .lesson-tabs__tab::after { content: ''; position: absolute; left: 50%; bottom: 2px; width: 16px; height: 2px; border-radius: 999px; background: var(--lesson-accent); opacity: 0; transform: translateX(-50%) scaleX(0.4); transition: opacity 0.18s ease, transform 0.2s ease; }
.lesson-content .lesson-tabs__tab[data-active="true"] { color: var(--lesson-accent-ink); background: #ffffff; box-shadow: 0 2px 7px rgba(15,23,42,0.08); }
.lesson-content .lesson-tabs__tab[data-active="true"]::after { opacity: 1; transform: translateX(-50%) scaleX(1); }
.lesson-content.dark .lesson-tabs__tab { color: #a1a1aa; }
.lesson-content.dark .lesson-tabs__tab[data-active="true"] { color: var(--lesson-accent-ink); background: rgba(255,255,255,0.1); box-shadow: none; }
.lesson-content .lesson-tabs__trigger { min-height: 28px; padding: 5px 10px 7px; border: 0; border-radius: 8px; color: inherit; background: transparent; cursor: pointer; white-space: nowrap; font: inherit; font-size: 12.5px; font-weight: 680; }
.lesson-content .lesson-tabs__trigger:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 1px; }
.lesson-content .lesson-tabs__label-input { width: 96px; min-width: 58px; padding: 5px 7px 7px; border: 0; outline: 0; color: inherit; background: transparent; font: inherit; font-size: 12.5px; font-weight: 680; }
.lesson-content .lesson-tabs__label-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-tabs__remove, .lesson-content .lesson-tabs__add { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; flex: 0 0 25px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-tabs__remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-tabs__add:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-tabs__panels { min-height: 84px; padding: 18px 20px 20px; }
.lesson-content .lesson-tab-panel { display: none; color: #52525b; }
.lesson-content.dark .lesson-tab-panel { color: #c4c4cc; }
.lesson-content .lesson-tab-panel > :last-child { margin-bottom: 0; }
.lesson-content .lesson-tabs[data-active="0"] .lesson-tab-panel[data-tab-index="0"],
.lesson-content .lesson-tabs[data-active="1"] .lesson-tab-panel[data-tab-index="1"],
.lesson-content .lesson-tabs[data-active="2"] .lesson-tab-panel[data-tab-index="2"],
.lesson-content .lesson-tabs[data-active="3"] .lesson-tab-panel[data-tab-index="3"],
.lesson-content .lesson-tabs[data-active="4"] .lesson-tab-panel[data-tab-index="4"],
.lesson-content .lesson-tabs[data-active="5"] .lesson-tab-panel[data-tab-index="5"],
.lesson-content .lesson-tabs[data-active="6"] .lesson-tab-panel[data-tab-index="6"],
.lesson-content .lesson-tabs[data-active="7"] .lesson-tab-panel[data-tab-index="7"],
.lesson-content .lesson-tabs[data-active="8"] .lesson-tab-panel[data-tab-index="8"],
.lesson-content .lesson-tabs[data-active="9"] .lesson-tab-panel[data-tab-index="9"],
.lesson-content .lesson-tabs[data-active="10"] .lesson-tab-panel[data-tab-index="10"],
.lesson-content .lesson-tabs[data-active="11"] .lesson-tab-panel[data-tab-index="11"] { display: block; animation: lesson-tab-panel-in 0.2s cubic-bezier(0.2,0.7,0.3,1); }
@keyframes lesson-tab-panel-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 560px) {
  .lesson-content .lesson-tabs { border-radius: 13px; }
  .lesson-content .lesson-tabs__bar { padding: 6px; }
  .lesson-content .lesson-tabs__panels { min-height: 72px; padding: 15px 16px 17px; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-tabs__tab, .lesson-content .lesson-tabs__tab::after, .lesson-content .lesson-tab-panel { animation: none; transition: none; }
}

.lesson-content .lesson-check { --check-border: #e4e4e7; position: relative; margin: 1rem 0; padding: 19px 20px 20px; border: 0; border-radius: 16px; color: #3f3f46; background: #ffffff; box-shadow: 0 8px 26px rgba(15,23,42,0.06); }
.lesson-content.dark .lesson-check { --check-border: rgba(255,255,255,0.1); color: #d4d4d8; background: rgba(255,255,255,0.035); box-shadow: none; }
.lesson-content .lesson-check__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.lesson-content .lesson-check__identity, .lesson-content .lesson-check__learner-head { display: flex; align-items: center; gap: 10px; }
.lesson-content .lesson-check__identity-icon { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex: 0 0 34px; border-radius: 10px; color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-check__identity > span:last-child { display: flex; flex-direction: column; gap: 1px; }
.lesson-content .lesson-check__identity strong { color: #27272a; font-size: 12.5px; font-weight: 740; line-height: 1.3; }
.lesson-content.dark .lesson-check__identity strong { color: #f4f4f5; }
.lesson-content .lesson-check__identity small { color: #8b8b93; font-size: 10px; line-height: 1.3; }
.lesson-content .lesson-check__learner-head { margin-bottom: 13px; }
.lesson-content .lesson-check__learner-head > div { display: flex; flex-direction: column; gap: 1px; }
.lesson-content .lesson-check__eyebrow { color: var(--lesson-accent-ink); font-size: 9.5px; font-weight: 800; letter-spacing: 0.12em; line-height: 1.4; text-transform: uppercase; }
.lesson-content .lesson-check__instruction { color: #8b8b93; font-size: 10.5px; line-height: 1.35; }
.lesson-content .lesson-check__question { margin: 0 0 14px; color: #18181b; font-size: 16px; font-weight: 720; letter-spacing: -0.005em; line-height: 1.45; }
.lesson-content.dark .lesson-check__question { color: #fafafa; }
.lesson-content .lesson-check__options { display: flex; flex-direction: column; gap: 8px; }
.lesson-content .lesson-check__option { display: flex; align-items: center; gap: 11px; width: 100%; min-height: 44px; padding: 8px 11px; border: 0; border-radius: 11px; color: #3f3f46; background: #fafafa; cursor: pointer; text-align: left; font: inherit; font-size: 13.5px; line-height: 1.45; transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease; }
.lesson-content.dark .lesson-check__option { color: #d4d4d8; background: rgba(255,255,255,0.035); }
.lesson-content .lesson-check__option:hover:not(:disabled) { color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent-base) 6%, #fafafa); transform: translateY(-1px); }
.lesson-content.dark .lesson-check__option:hover:not(:disabled) { background: color-mix(in oklab, var(--lesson-accent-base) 8%, rgba(255,255,255,0.035)); }
.lesson-content .lesson-check__option:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-check__option:disabled { cursor: default; }
.lesson-content .lesson-check__opt-text { min-width: 0; flex: 1; }
.lesson-content .lesson-check__option-end { display: inline-flex; align-items: center; gap: 7px; flex: 0 0 auto; color: #a1a1aa; }
.lesson-content .lesson-check__option-number { color: #8b8b93; font-size: 11px; font-weight: 760; font-variant-numeric: tabular-nums; line-height: 1; }
.lesson-content.dark .lesson-check__option-number { color: #8b8b93; }
.lesson-content .lesson-check__option[data-correct="true"] { color: #065f46; background: #ecfdf5; font-weight: 620; }
.lesson-content.dark .lesson-check__option[data-correct="true"] { color: #a7f3d0; background: rgba(16,185,129,0.13); }
.lesson-content .lesson-check__option[data-correct="true"] .lesson-check__option-end, .lesson-content .lesson-check__option[data-correct="true"] .lesson-check__option-number { color: #10b981; }
.lesson-content .lesson-check__option[data-wrong="true"] { color: #9f1239; background: #fff1f2; font-weight: 620; }
.lesson-content.dark .lesson-check__option[data-wrong="true"] { color: #fecdd3; background: rgba(244,63,94,0.12); }
.lesson-content .lesson-check__option[data-wrong="true"] .lesson-check__option-end, .lesson-content .lesson-check__option[data-wrong="true"] .lesson-check__option-number { color: #f43f5e; }
.lesson-content .lesson-check__feedback { display: grid; grid-template-columns: 30px minmax(0,1fr) auto; gap: 10px; align-items: start; margin-top: 12px; padding: 12px 13px; border-radius: 11px; }
.lesson-content .lesson-check__feedback[data-kind="correct"] { color: #065f46; background: #ecfdf5; }
.lesson-content .lesson-check__feedback[data-kind="incorrect"] { color: #9f1239; background: #fff1f2; }
.lesson-content.dark .lesson-check__feedback[data-kind="correct"] { color: #a7f3d0; background: rgba(16,185,129,0.12); }
.lesson-content.dark .lesson-check__feedback[data-kind="incorrect"] { color: #fecdd3; background: rgba(244,63,94,0.11); }
.lesson-content .lesson-check__feedback-icon { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 9px; background: rgba(255,255,255,0.62); }
.lesson-content.dark .lesson-check__feedback-icon { background: rgba(255,255,255,0.06); }
.lesson-content .lesson-check__feedback-copy { min-width: 0; padding-top: 1px; }
.lesson-content .lesson-check__verdict { margin: 0 0 2px; color: inherit; font-size: 12.5px; font-weight: 780; line-height: 1.35; }
.lesson-content .lesson-check__explain { margin: 0; color: color-mix(in oklab, currentColor 76%, #52525b); font-size: 12px; line-height: 1.48; }
.lesson-content.dark .lesson-check__explain { color: color-mix(in oklab, currentColor 76%, #d4d4d8); }
.lesson-content .lesson-check__retry { display: inline-flex; align-items: center; gap: 5px; align-self: center; padding: 6px 8px; border: 0; border-radius: 8px; color: inherit; background: rgba(255,255,255,0.6); cursor: pointer; white-space: nowrap; font: inherit; font-size: 10.5px; font-weight: 720; }
.lesson-content.dark .lesson-check__retry { background: rgba(255,255,255,0.06); }
.lesson-content .lesson-check__retry:hover { background: rgba(255,255,255,0.9); }
.lesson-content.dark .lesson-check__retry:hover { background: rgba(255,255,255,0.1); }
.lesson-content .lesson-check__q-input { display: block; width: 100%; margin: 0 0 13px; padding: 3px 0 7px; border: 0; border-bottom: 1px dashed #d4d4d8; outline: 0; color: #18181b; background: transparent; font: inherit; font-size: 16px; font-weight: 720; line-height: 1.45; }
.lesson-content.dark .lesson-check__q-input { border-bottom-color: rgba(255,255,255,0.13); color: #fafafa; }
.lesson-content .lesson-check__q-input::placeholder { color: #a1a1aa; font-weight: 620; }
.lesson-content .lesson-check__opt-edit { display: flex; align-items: center; gap: 7px; padding: 6px 7px; border: 0; border-radius: 10px; background: #fafafa; }
.lesson-content.dark .lesson-check__opt-edit { background: rgba(255,255,255,0.03); }
.lesson-content .lesson-check__correct-toggle { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; flex: 0 0 22px; padding: 0; border: 1.5px solid #cbd5e1; border-radius: 999px; color: #ffffff; background: transparent; cursor: pointer; }
.lesson-content.dark .lesson-check__correct-toggle { border-color: #52525b; }
.lesson-content .lesson-check__correct-toggle[data-correct="true"] { border-color: var(--lesson-accent); background: var(--lesson-accent); }
.lesson-content .lesson-check__correct-toggle:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-check__opt-input { min-width: 0; flex: 1; padding: 3px 2px; border: 0; outline: 0; color: #3f3f46; background: transparent; font: inherit; font-size: 13.5px; }
.lesson-content.dark .lesson-check__opt-input { color: #e4e4e7; }
.lesson-content .lesson-check__opt-input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-check__opt-remove { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: 0 0 24px; padding: 0; border: 0; border-radius: 6px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-check__opt-remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-check__add { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; padding: 5px 7px; border: 0; border-radius: 7px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 11px; font-weight: 680; }
.lesson-content .lesson-check__add:hover { background: var(--lesson-accent-ring); }
.lesson-content .lesson-check__explain-input { display: block; width: 100%; min-height: 58px; margin-top: 12px; padding: 9px 10px; border: 1px solid #e4e4e7; border-radius: 10px; outline: 0; resize: vertical; color: #3f3f46; background: #fafafa; font: inherit; font-size: 12.5px; line-height: 1.5; }
.lesson-content.dark .lesson-check__explain-input { border-color: rgba(255,255,255,0.08); color: #d4d4d8; background: rgba(255,255,255,0.03); }
.lesson-content .lesson-check__explain-input:focus { border-color: var(--lesson-accent); box-shadow: 0 0 0 3px var(--lesson-accent-ring); }
.lesson-content .lesson-check__explain-input::placeholder { color: #a1a1aa; }
/* Editor: format / feedback-mode pickers and the field captions above each answer-key list. */
.lesson-content .lesson-check__config { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 12px; }
.lesson-content .lesson-check__config-label { color: #8b8b93; font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.lesson-content .lesson-check__field-label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; margin: 12px 0 7px; color: #52525b; font-size: 11px; font-weight: 760; }
.lesson-content.dark .lesson-check__field-label { color: #d4d4d8; }
.lesson-content .lesson-check__field-label small { color: #8b8b93; font-size: 10px; font-weight: 500; }
/* The captioned inputs already get their spacing from the caption above them. */
.lesson-content .lesson-check__field-label + .lesson-check__explain-input { margin-top: 0; }
/* Learner: typed answer for the fill-in and written formats. */
.lesson-content .lesson-check__answer-form { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lesson-content .lesson-check__answer-form[data-multiline="true"] { flex-direction: column; align-items: stretch; }
.lesson-content .lesson-check__answer-input { min-width: 0; flex: 1; width: 100%; padding: 11px 13px; border: 1px solid #e4e4e7; border-radius: 11px; outline: 0; resize: vertical; color: #3f3f46; background: #fafafa; font: inherit; font-size: 13.5px; line-height: 1.55; }
.lesson-content.dark .lesson-check__answer-input { border-color: rgba(255,255,255,0.09); color: #e4e4e7; background: rgba(255,255,255,0.035); }
.lesson-content .lesson-check__answer-input:focus { border-color: var(--lesson-accent); box-shadow: 0 0 0 3px var(--lesson-accent-ring); }
.lesson-content .lesson-check__answer-input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-check__answer-input:disabled { opacity: 0.75; cursor: default; }
.lesson-content .lesson-check__submit { display: inline-flex; align-items: center; justify-content: center; gap: 6px; align-self: flex-start; min-height: 40px; padding: 9px 15px; border: 0; border-radius: 10px; color: #fff; background: var(--lesson-accent); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 720; }
.lesson-content .lesson-check__submit:hover:not(:disabled) { opacity: 0.9; }
.lesson-content .lesson-check__submit:disabled { opacity: 0.45; cursor: default; }
.lesson-content .lesson-check__spin { animation: lesson-check-spin 0.9s linear infinite; }
.lesson-content .lesson-check__error { margin: 0; color: #dc2626; font-size: 11.5px; font-weight: 620; }
.lesson-content.dark .lesson-check__error { color: #fca5a5; }
.lesson-content .lesson-check__score { margin-left: 7px; font-size: 11px; font-weight: 760; font-variant-numeric: tabular-nums; opacity: 0.8; }
.lesson-content .lesson-check__model { margin-top: 9px; padding: 9px 11px; border-radius: 9px; background: rgba(255,255,255,0.6); }
.lesson-content.dark .lesson-check__model { background: rgba(255,255,255,0.06); }
.lesson-content .lesson-check__model-label { display: block; margin-bottom: 3px; color: color-mix(in oklab, currentColor 70%, #52525b); font-size: 9.5px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.lesson-content .lesson-check__model p { margin: 0; font-size: 12px; line-height: 1.55; white-space: pre-wrap; }
.lesson-content .lesson-check__rubric { margin: 9px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 5px; }
.lesson-content .lesson-check__rubric li { display: flex; align-items: flex-start; gap: 7px; font-size: 11.5px; line-height: 1.5; }
.lesson-content .lesson-check__rubric-icon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: 0 0 16px; margin-top: 1px; border-radius: 999px; color: #fff; background: #10b981; }
.lesson-content .lesson-check__rubric li[data-passed="false"] .lesson-check__rubric-icon { background: #f43f5e; }
@media (max-width: 560px) {
  .lesson-content .lesson-check { padding: 16px 14px 17px; border-radius: 14px; }
  .lesson-content .lesson-check__feedback { grid-template-columns: 28px minmax(0,1fr); }
  .lesson-content .lesson-check__retry { grid-column: 2; justify-self: start; }
  .lesson-content .lesson-check__submit { width: 100%; }
}
@keyframes lesson-check-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-check__option { transition: none; }
  .lesson-content .lesson-check__spin { animation: none; }
}

.lesson-content .lesson-code { position: relative; margin: 1rem 0; overflow: hidden; border: 1px solid rgba(15,23,42,0.09); border-radius: 16px; background: #f6f8fa; box-shadow: 0 10px 30px rgba(15,23,42,0.065); }
.lesson-content.dark .lesson-code { border-color: rgba(255,255,255,0.075); background: #0f1120; box-shadow: none; }
.lesson-content .lesson-code__bar { display: flex; min-height: 58px; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 12px; border-bottom: 1px solid rgba(15,23,42,0.075); background: #ffffff; }
.lesson-content.dark .lesson-code__bar { border-bottom-color: rgba(255,255,255,0.065); background: #191b24; }
.lesson-content .lesson-code__identity { display: flex; min-width: 0; align-items: center; gap: 10px; }
.lesson-content .lesson-code__identity-icon { display: inline-flex; width: 34px; height: 34px; flex: 0 0 34px; align-items: center; justify-content: center; border-radius: 10px; color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-code__identity-copy { display: flex; min-width: 0; flex-direction: column; gap: 1px; }
.lesson-content .lesson-code__identity-copy strong { overflow: hidden; color: #202228; font-size: 12.5px; font-weight: 750; line-height: 1.3; text-overflow: ellipsis; white-space: nowrap; }
.lesson-content.dark .lesson-code__identity-copy strong { color: #f4f4f5; }
.lesson-content .lesson-code__identity-copy small { color: #8b8b93; font-size: 10px; line-height: 1.3; }
.lesson-content .lesson-code__identity-copy small[data-on="true"] { color: color-mix(in oklab, var(--lesson-accent) 75%, #166534); font-weight: 680; }
.lesson-content.dark .lesson-code__identity-copy small[data-on="true"] { color: color-mix(in oklab, var(--lesson-accent) 60%, #fff); }
.lesson-content .lesson-code__lang { min-height: 29px; padding: 4px 26px 4px 9px; border: 1px solid #e2e4e9; border-radius: 8px; color: #52525b; background-color: #f7f7f8; cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 720; letter-spacing: 0.025em; }
.lesson-content.dark .lesson-code__lang { border-color: rgba(255,255,255,0.08); color: #d4d4d8; background-color: rgba(255,255,255,0.055); }
.lesson-content .lesson-code__lang:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-code__bar-right { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 7px; }
.lesson-content .lesson-code__actions { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.lesson-content .lesson-code__btn { display: inline-flex; min-height: 31px; align-items: center; justify-content: center; gap: 5px; padding: 5px 9px; border: 0; border-radius: 8px; color: #52525b; background: #f1f2f4; cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; transition: color 0.15s ease, background 0.15s ease, transform 0.15s ease; }
.lesson-content.dark .lesson-code__btn { color: #d4d4d8; background: rgba(255,255,255,0.065); }
.lesson-content .lesson-code__btn:hover:not(:disabled) { color: #27272a; background: #e8e9ec; transform: translateY(-1px); }
.lesson-content.dark .lesson-code__btn:hover:not(:disabled) { color: #fafafa; background: rgba(255,255,255,0.11); }
.lesson-content .lesson-code__btn:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-code__btn:disabled { cursor: wait; opacity: 0.62; transform: none; }
.lesson-content .lesson-code__btn[data-primary="true"] { color: #fff; background: var(--lesson-accent); box-shadow: 0 5px 14px var(--lesson-accent-ring); }
.lesson-content .lesson-code__btn[data-primary="true"]:hover:not(:disabled) { color: #fff; background: color-mix(in oklab, var(--lesson-accent) 88%, #000); }
.lesson-content .lesson-code__btn[data-active="true"] { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content.dark .lesson-code__btn[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent) 58%, #fff); background: color-mix(in oklab, var(--lesson-accent) 18%, transparent); }
.lesson-content .lesson-code__btn[data-success="true"] { color: #047857; background: #ecfdf5; }
.lesson-content.dark .lesson-code__btn[data-success="true"] { color: #6ee7b7; background: rgba(16,185,129,0.15); }
/* Dataset preview popover ("Available data") -- portaled to <body>, so it floats over
   the lesson and is never clipped. Carries the lesson-content class so the scoped result
   table styles (incl. the perimeter-border fix) apply inside it. */
.lesson-data-pop { z-index: 1000; max-height: 62vh; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding: 10px 11px; border-radius: 12px; background: #ffffff; border: 1px solid #e4e4e7; box-shadow: 0 12px 32px rgba(0,0,0,0.18); font-size: 13px; color: #3f3f46; }
.lesson-data-pop.dark { background: #1c1c20; border-color: #2e2e33; color: #d4d4d8; box-shadow: 0 12px 32px rgba(0,0,0,0.5); }
.lesson-data-pop__head { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; }
.lesson-data-pop__head button { display: inline-flex; padding: 2px; border: none; background: transparent; color: #a1a1aa; cursor: pointer; border-radius: 5px; }
.lesson-data-pop__head button:hover { background: rgba(0,0,0,0.06); color: #52525b; }
.lesson-data-pop.dark .lesson-data-pop__head button:hover { background: rgba(255,255,255,0.08); color: #d4d4d8; }
.lesson-data-pop__tabs { display: flex; flex-wrap: wrap; gap: 4px; }
.lesson-data-pop__tabs button { font: inherit; font-family: "JetBrains Mono",ui-monospace,monospace; font-size: 11.5px; font-weight: 600; padding: 3px 9px; border: none; border-radius: 999px; background: rgba(0,0,0,0.05); color: #52525b; cursor: pointer; }
.lesson-data-pop.dark .lesson-data-pop__tabs button { background: rgba(255,255,255,0.08); color: #a1a1aa; }
.lesson-data-pop__tabs button[data-active="true"] { background: #10b981; color: #fff; }
.lesson-data-pop__meta { display: flex; align-items: baseline; gap: 8px; font-size: 11px; color: #71717a; }
.lesson-data-pop__meta strong { font-family: "JetBrains Mono",ui-monospace,monospace; font-size: 12px; color: #18181b; }
.lesson-data-pop.dark .lesson-data-pop__meta strong { color: #fafafa; }
.lesson-data-pop__note { font-size: 12px; color: #71717a; margin: 2px 0; }
.lesson-data-pop .lesson-code__result { border: 1px solid #e4e4e7; border-radius: 6px; overflow: hidden; }
.lesson-data-pop.dark .lesson-code__result { border-color: #2e2e33; }
.lesson-content .lesson-code__spin { animation: lesson-code-spin 0.8s linear infinite; }
@keyframes lesson-code-spin { to { transform: rotate(360deg); } }
.lesson-content .lesson-code__editor { display: block; width: 100%; min-height: 76px; box-sizing: border-box; padding: 14px 15px; border: 0; outline: 0; resize: vertical; color: #1f2328; background: #f6f8fa; font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 13px; line-height: 1.55; }
.lesson-content.dark .lesson-code__editor { color: #c9d1d9; background: #0f1120; }
.lesson-content .lesson-code__editor--run { white-space: pre; overflow-x: auto; }
.lesson-content .lesson-code__editor::placeholder { color: #8c959f; }
.lesson-content.dark .lesson-code__editor::placeholder { color: #5a6376; }
.lesson-content .lesson-code__setup-shell { border-top: 1px solid rgba(15,23,42,0.07); background: #fbfbfc; }
.lesson-content.dark .lesson-code__setup-shell { border-top-color: rgba(255,255,255,0.06); background: #151720; }
.lesson-content .lesson-code__setup-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px 8px 12px; }
.lesson-content .lesson-code__setup-toggle { display: flex; min-width: 0; flex: 1; align-items: center; gap: 8px; padding: 3px 2px; border: 0; color: #71717a; background: transparent; cursor: pointer; text-align: left; }
.lesson-content.dark .lesson-code__setup-toggle { color: #a1a1aa; }
.lesson-content .lesson-code__setup-toggle > span { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 1px; }
.lesson-content .lesson-code__setup-toggle strong { color: #3f3f46; font-size: 11px; font-weight: 720; line-height: 1.3; }
.lesson-content.dark .lesson-code__setup-toggle strong { color: #e4e4e7; }
.lesson-content .lesson-code__setup-toggle small { color: #8b8b93; font-size: 9.5px; line-height: 1.3; }
.lesson-content .lesson-code__setup-toggle > svg:last-child { transition: transform 0.16s ease; }
.lesson-content .lesson-code__setup-shell[data-open="true"] .lesson-code__setup-toggle > svg:last-child { transform: rotate(180deg); }
.lesson-content .lesson-code__setup-toggle:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; border-radius: 7px; }
.lesson-content .lesson-code__scope { display: inline-flex; flex: 0 0 auto; gap: 2px; padding: 2px; border-radius: 8px; background: rgba(15,23,42,0.055); }
.lesson-content.dark .lesson-code__scope { background: rgba(255,255,255,0.065); }
.lesson-content .lesson-code__scope button { min-height: 25px; padding: 3px 8px; border: 0; border-radius: 6px; color: #71717a; background: transparent; cursor: pointer; font: inherit; font-size: 10px; font-weight: 680; }
.lesson-content.dark .lesson-code__scope button { color: #a1a1aa; }
.lesson-content .lesson-code__scope button[data-active="true"] { color: var(--lesson-accent-ink); background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.1); }
.lesson-content.dark .lesson-code__scope button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent) 58%, #fff); background: #20222d; box-shadow: none; }
.lesson-content .lesson-code__scope button:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 1px; }
.lesson-content .lesson-code__setup { border-top: 1px solid rgba(15,23,42,0.065); }
.lesson-content.dark .lesson-code__setup { border-top-color: rgba(255,255,255,0.055); }
.lesson-content .lesson-code__setup-label { display: block; padding: 9px 14px 0; color: #71717a; font-size: 10.5px; line-height: 1.45; }
.lesson-content.dark .lesson-code__setup-label { color: #8b93a7; }
.lesson-content .lesson-code__pre { margin: 0; border-radius: 0; background: #f6f8fa; color: #1f2328; padding: 12px 14px; overflow-x: auto; }
.lesson-content.dark .lesson-code__pre { background: #0f1120; color: #c9d1d9; }
.lesson-content .lesson-code__pre code { background: none; color: inherit; padding: 0; font-size: 13px; }
.lesson-content .lesson-code__error { padding: 10px 14px; border-top: 1px solid rgba(244,63,94,0.18); color: #b42318; background: #fff1f2; white-space: pre-wrap; font-family: "JetBrains Mono",ui-monospace,monospace; font-size: 12px; line-height: 1.5; }
.lesson-content.dark .lesson-code__error { color: #fda4af; background: rgba(244,63,94,0.1); border-top-color: rgba(244,63,94,0.25); }
.lesson-content .lesson-code__result { background: #ffffff; border-top: 1px solid #e4e4e7; }
.lesson-content.dark .lesson-code__result { background: #141416; border-top-color: #2e2e33; }
.lesson-content .lesson-code__result-scroll { overflow: auto; max-height: 320px; }
.lesson-content .lesson-code__result table { border-collapse: collapse; width: 100%; font-size: 12.5px; margin: 0; }
.lesson-content .lesson-code__result th, .lesson-content .lesson-code__result td { border: 1px solid #e4e4e7; padding: 5px 9px; text-align: left; white-space: nowrap; color: #3f3f46; }
.lesson-content.dark .lesson-code__result th, .lesson-content.dark .lesson-code__result td { border-color: #2e2e33; color: #d4d4d8; }
.lesson-content .lesson-code__result th { background: #f4f4f5; font-weight: 600; position: sticky; top: 0; }
.lesson-content.dark .lesson-code__result th { background: #1a1d2e; }
/* Drop the table's perimeter borders so they don't double up against the block's own
   container border -- keep only the internal gridlines. */
.lesson-content .lesson-code__result table tr > :first-child { border-left: none; }
.lesson-content .lesson-code__result table tr > :last-child { border-right: none; }
.lesson-content .lesson-code__result thead tr:first-child > * { border-top: none; }
.lesson-content .lesson-code__result tbody tr:last-child > * { border-bottom: none; }
.lesson-content .lesson-code__result-note { margin: 0; padding: 8px 12px; color: #71717a; font-size: 11px; }
.lesson-content .lesson-code__stdout { background: #0d1117; border-top: 1px solid #2e2e33; }
.lesson-content.dark .lesson-code__stdout { background: #0a0c14; border-top-color: #2e2e33; }
.lesson-content .lesson-code__stdout-pre { margin: 0; padding: 10px 14px; font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 12.5px; color: #c9d1d9; white-space: pre-wrap; word-break: break-all; }
.lesson-content .lesson-code__stdout-pre--return { color: #79c0ff; }
.lesson-content .lesson-code__plots { display: grid; gap: 12px; padding: 12px 14px 14px; }
.lesson-content .lesson-code__plot { background: #fff; border-radius: 8px; padding: 10px; overflow: hidden; }
.lesson-content .lesson-code__plot img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
@media (max-width: 560px) {
  .lesson-content .lesson-code { border-radius: 14px; }
  .lesson-content .lesson-code__bar { min-height: 0; align-items: flex-start; flex-direction: column; padding: 10px; }
  .lesson-content .lesson-code__bar-right, .lesson-content .lesson-code__actions { width: 100%; }
  .lesson-content .lesson-code__bar-right { justify-content: space-between; }
  .lesson-content .lesson-code__actions { justify-content: flex-start; }
  .lesson-content .lesson-code__btn { flex: 1 1 auto; }
  .lesson-content .lesson-code__setup-head { align-items: stretch; flex-direction: column; }
  .lesson-content .lesson-code__scope { align-self: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-code__btn, .lesson-content .lesson-code__setup-toggle > svg:last-child { transition: none; }
}

.lesson-content .lesson-style__seg { display: inline-flex; gap: 2px; }
.lesson-content .lesson-style__seg button { font-size: 11px; font-weight: 600; padding: 3px 8px; border: 1px solid transparent; border-radius: 6px; background: rgba(0,0,0,0.05); color: #52525b; cursor: pointer; }
.lesson-content.dark .lesson-style__seg button { background: rgba(255,255,255,0.08); color: #a1a1aa; }
.lesson-content .lesson-style__seg button[data-active="true"] { background: #10b981; color: #fff; }
.lesson-content .lesson-style__color { display: inline-flex; align-items: center; gap: 4px; }
.lesson-content .lesson-style__color input[type="color"] { width: 26px; height: 22px; padding: 0; border: 1px solid rgba(0,0,0,0.15); border-radius: 6px; background: none; cursor: pointer; }
.lesson-content.dark .lesson-style__color input[type="color"] { border-color: rgba(255,255,255,0.2); }
.lesson-content .lesson-style__color-reset { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border: none; background: transparent; color: #a1a1aa; cursor: pointer; border-radius: 5px; }
.lesson-content .lesson-style__color-reset:hover { background: rgba(0,0,0,0.06); color: #52525b; }
.lesson-content.dark .lesson-style__color-reset:hover { background: rgba(255,255,255,0.08); }
.lesson-content .lesson-style__label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #a1a1aa; }
/* Icon grid: wraps to the popover width, so adding icons to a block's set needs no layout change. */
.lesson-content .lesson-style__icons { display: grid; grid-template-columns: repeat(8, 1fr); gap: 3px; width: 100%; }
.lesson-content .lesson-style__icons button { display: inline-flex; align-items: center; justify-content: center; aspect-ratio: 1; padding: 0; border: 1px solid transparent; border-radius: 6px; background: rgba(0,0,0,0.05); color: #52525b; cursor: pointer; }
.lesson-content.dark .lesson-style__icons button { background: rgba(255,255,255,0.08); color: #a1a1aa; }
.lesson-content .lesson-style__icons button:hover { background: rgba(0,0,0,0.1); color: #18181b; }
.lesson-content.dark .lesson-style__icons button:hover { background: rgba(255,255,255,0.14); color: #fafafa; }
.lesson-content .lesson-style__icons button[data-active="true"] { background: #10b981; color: #fff; }
.lesson-content .lesson-style__icons button:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 1px; }

.lesson-style-menu { display: inline-flex; }
.lesson-style-menu__trigger { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: 26px; height: 26px; padding: 0; border-radius: 7px; border: none; background: rgba(0,0,0,0.05); color: #52525b; cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 700; }
.lesson-style-menu__trigger:has(span) { width: auto; padding: 0 9px; }
.lesson-style-menu__trigger[data-theme="dark"] { background: rgba(255,255,255,0.08); color: #a1a1aa; }
.lesson-style-menu__trigger:hover, .lesson-style-menu__trigger[data-open="true"] { background: rgba(0,0,0,0.1); color: #18181b; }
.lesson-style-menu__trigger[data-theme="dark"]:hover, .lesson-style-menu__trigger[data-theme="dark"][data-open="true"] { background: rgba(255,255,255,0.16); color: #fafafa; }
.lesson-content .lesson-block-corner { position: absolute; top: 8px; right: 8px; z-index: 5; }
.lesson-block-corner .lesson-style-menu__trigger { background: rgba(255,255,255,0.92); color: #3f3f46; box-shadow: 0 1px 4px rgba(0,0,0,0.25); }
.lesson-block-corner .lesson-style-menu__trigger[data-theme="dark"] { background: rgba(30,30,34,0.92); color: #e4e4e7; }
.lesson-style-menu__panel { z-index: 1000; min-width: 220px; max-width: 280px; display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: #ffffff; border: 1px solid #e4e4e7; box-shadow: 0 10px 30px rgba(0,0,0,0.16); font-size: 13px; }
.lesson-style-menu__panel.dark { background: #1c1c20; border-color: #2e2e33; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
.lesson-style-menu__row { display: flex; flex-direction: column; gap: 5px; }
.lesson-style-menu__row-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #71717a; }
.lesson-style-menu__panel.dark .lesson-style-menu__row-label { color: #a1a1aa; }
.lesson-style-menu__row-control { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }

/* Main lesson-editor toolbar. It stays single-line at every width; secondary
   controls move into More instead of wrapping into an unpredictable second row. */
.lesson-editor-shell { container-type: inline-size; }
.lesson-editor-viewbar { display: flex; min-height: 42px; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 8px; background: rgba(0,0,0,0.012); }
.lesson-editor-viewbar[data-theme="dark"] { background: rgba(255,255,255,0.012); }
.lesson-editor-viewbar__switch { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(0,0,0,0.045); }
.lesson-editor-viewbar[data-theme="dark"] .lesson-editor-viewbar__switch { background: rgba(255,255,255,0.055); }
.lesson-editor-viewbar__switch button { display: inline-flex; height: 28px; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 720; }
.lesson-editor-viewbar[data-theme="dark"] .lesson-editor-viewbar__switch button { color: #8b8b93; }
.lesson-editor-viewbar__switch button[data-active="true"] { color: #27272a; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.08); }
.lesson-editor-viewbar[data-theme="dark"] .lesson-editor-viewbar__switch button[data-active="true"] { color: #f4f4f5; background: rgba(255,255,255,0.09); box-shadow: none; }
.lesson-editor-viewbar__switch button:focus-visible, .lesson-editor-viewbar__devices button:focus-visible { outline: 2px solid var(--lesson-accent-base) !important; outline-offset: 1px; }
.lesson-editor-viewbar__devices { display: inline-flex; align-items: center; gap: 2px; }
.lesson-editor-viewbar__devices button { display: inline-flex; width: 28px; height: 28px; align-items: center; justify-content: center; border: 0; border-radius: 7px; color: #8b8b93; background: transparent; cursor: pointer; }
.lesson-editor-viewbar__devices button:hover { color: #3f3f46; background: rgba(0,0,0,0.045); }
.lesson-editor-viewbar[data-theme="dark"] .lesson-editor-viewbar__devices button:hover { color: #e4e4e7; background: rgba(255,255,255,0.055); }
.lesson-editor-viewbar__devices button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 11%, transparent); }
.lesson-editor-viewbar[data-theme="dark"] .lesson-editor-viewbar__devices button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 66%, #fff); }
.lesson-editor-preview-stage { padding: 14px; border-top: 1px solid rgba(0,0,0,0.06); background: #f4f4f5; }
.lesson-editor-preview-stage[data-theme="dark"] { border-top-color: rgba(255,255,255,0.06); background: #151518; }
.lesson-editor-preview-canvas { width: 100%; margin-inline: auto; border-radius: 8px; background: #fff; transition: width 0.22s ease, max-width 0.22s ease; }
.lesson-editor-preview-canvas.dark { background: #202024; }
.lesson-editor-preview-canvas[data-preview-size="tablet"] { width: min(100%, 768px); }
.lesson-editor-preview-canvas[data-preview-size="mobile"] { width: min(100%, 390px); }
@media (prefers-reduced-motion: reduce) { .lesson-editor-preview-canvas { transition: none; } }
.lesson-editor-toolbar { display: flex; min-width: 0; align-items: center; gap: 6px; padding: 7px 8px; border-bottom: 1px solid rgba(0,0,0,0.07); background: rgba(0,0,0,0.012); }
.lesson-editor-toolbar[data-theme="dark"] { border-bottom-color: rgba(255,255,255,0.07); background: rgba(255,255,255,0.012); }
.lesson-editor-toolbar__group { display: inline-flex; min-width: 0; flex: 0 0 auto; align-items: center; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(0,0,0,0.025); }
.lesson-editor-toolbar[data-theme="dark"] .lesson-editor-toolbar__group { background: rgba(255,255,255,0.035); }
.lesson-editor-toolbar__interactive { padding: 0; background: transparent !important; }
.lesson-editor-toolbar__button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; transition: color 0.14s ease, background-color 0.14s ease, transform 0.14s ease; }
.lesson-editor-toolbar__button svg { width: 14px; height: 14px; stroke-width: 1.9; }
.lesson-editor-toolbar__button:hover { color: #27272a; background: rgba(0,0,0,0.055); }
.lesson-editor-toolbar__button[data-theme="dark"] { color: #8b8b93; }
.lesson-editor-toolbar__button[data-theme="dark"]:hover { color: #e4e4e7; background: rgba(255,255,255,0.07); }
.lesson-editor-toolbar__button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 12%, transparent); }
.lesson-editor-toolbar__button[data-theme="dark"][data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 66%, #fff); background: color-mix(in oklab, var(--lesson-accent-base) 14%, transparent); }
.lesson-editor-toolbar__button:focus-visible, .lesson-editor-toolbar .lesson-style-menu__trigger:focus-visible { outline: 2px solid var(--lesson-accent-base) !important; outline-offset: 1px; }
.lesson-editor-toolbar__more { display: none; flex: 0 0 auto; margin-left: auto; }
.lesson-editor-toolbar__more .lesson-style-menu__trigger { height: 30px; color: #52525b; background: rgba(0,0,0,0.045); }
.lesson-editor-toolbar[data-theme="dark"] .lesson-editor-toolbar__more .lesson-style-menu__trigger { color: #a1a1aa; background: rgba(255,255,255,0.06); }
.lesson-editor-toolbar__menu-button { display: inline-flex; min-height: 29px; flex: 1 1 calc(50% - 3px); align-items: center; justify-content: flex-start; gap: 7px; padding: 6px 8px; border: 0; border-radius: 7px; color: #52525b; background: rgba(0,0,0,0.035); cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 650; }
.lesson-editor-toolbar__menu-button svg { width: 13px; height: 13px; }
.lesson-editor-toolbar__menu-button:hover, .lesson-editor-toolbar__menu-button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 10%, transparent); }
.lesson-style-menu__panel.dark .lesson-editor-toolbar__menu-button { color: #b4b4ba; background: rgba(255,255,255,0.045); }
.lesson-style-menu__panel.dark .lesson-editor-toolbar__menu-button:hover, .lesson-style-menu__panel.dark .lesson-editor-toolbar__menu-button[data-active="true"] { color: color-mix(in oklab, var(--lesson-accent-base) 66%, #fff); background: color-mix(in oklab, var(--lesson-accent-base) 13%, transparent); }
@container (max-width: 720px) {
  .lesson-editor-toolbar__secondary, .lesson-editor-toolbar__media { display: none; }
  .lesson-editor-toolbar__more { display: inline-flex; }
}
@container (max-width: 430px) {
  .lesson-editor-toolbar { gap: 4px; padding-inline: 6px; }
  .lesson-editor-toolbar__optional-core { display: none; }
  .lesson-editor-toolbar .lesson-insert-trigger > span { display: none; }
  .lesson-editor-toolbar .lesson-insert-trigger { width: 54px; justify-content: center; padding-inline: 7px; }
}

/* Portaled interactive insert palette. */
.lesson-insert-trigger { display: inline-flex; align-items: center; gap: 6px; height: 29px; padding: 0 9px; border: 1px solid color-mix(in oklab, var(--insert-accent) 18%, transparent); border-radius: 8px; color: color-mix(in oklab, var(--insert-accent) 76%, #000); background: color-mix(in oklab, var(--insert-accent) 10%, transparent); cursor: pointer; font: inherit; font-size: 11.5px; font-weight: 700; transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease; }
.lesson-insert-trigger:hover, .lesson-insert-trigger[data-open="true"] { border-color: color-mix(in oklab, var(--insert-accent) 30%, transparent); background: color-mix(in oklab, var(--insert-accent) 15%, transparent); }
.lesson-insert-trigger[data-theme="dark"] { color: color-mix(in oklab, var(--insert-accent) 58%, #fff); background: color-mix(in oklab, var(--insert-accent) 13%, transparent); }
.lesson-insert-trigger:focus-visible { outline: 2px solid var(--insert-accent) !important; outline-offset: 2px; }
.lesson-insert-trigger svg:last-child { margin-left: 1px; transition: transform 0.16s ease; }
.lesson-insert-trigger[data-open="true"] svg:last-child { transform: rotate(180deg); }
.lesson-insert-menu { z-index: 1200; display: flex; width: 368px; max-width: calc(100vw - 16px); min-height: 0; overflow: hidden; flex-direction: column; border: 1px solid rgba(15,23,42,0.08); border-radius: 18px; color: #27272a; background: #ffffff; box-shadow: 0 22px 60px rgba(15,23,42,0.18), 0 4px 14px rgba(15,23,42,0.08); }
.lesson-insert-menu.dark { border-color: rgba(255,255,255,0.09); color: #e4e4e7; background: #1c1c20; box-shadow: 0 24px 64px rgba(0,0,0,0.55); }
.lesson-insert-menu__header { display: flex; align-items: center; justify-content: space-between; padding: 16px 17px 10px; }
.lesson-insert-menu__header div { display: flex; flex-direction: column; gap: 2px; }
.lesson-insert-menu__header strong { color: #18181b; font-size: 14px; font-weight: 760; letter-spacing: -0.01em; }
.lesson-insert-menu.dark .lesson-insert-menu__header strong { color: #fafafa; }
.lesson-insert-menu__header span { color: #71717a; font-size: 11.5px; }
.lesson-insert-menu.dark .lesson-insert-menu__header span { color: #a1a1aa; }
.lesson-insert-menu__search { display: flex; align-items: center; gap: 8px; margin: 0 12px 10px; padding: 8px 10px; border: 1px solid #e4e4e7; border-radius: 10px; color: #a1a1aa; background: #fafafa; }
.lesson-insert-menu.dark .lesson-insert-menu__search { border-color: rgba(255,255,255,0.08); background: rgba(255,255,255,0.04); }
.lesson-insert-menu__search:focus-within { border-color: color-mix(in oklab, var(--insert-accent) 58%, #a1a1aa); box-shadow: 0 0 0 3px color-mix(in oklab, var(--insert-accent) 10%, transparent); }
.lesson-insert-menu__search input { min-width: 0; flex: 1; padding: 0; border: 0; outline: 0; color: #27272a; background: transparent; font: inherit; font-size: 12.5px; }
.lesson-insert-menu__search input:focus, .lesson-insert-menu__search input:focus-visible { outline: none !important; box-shadow: none !important; }
.lesson-insert-menu.dark .lesson-insert-menu__search input { color: #f4f4f5; }
.lesson-insert-menu__search input::placeholder { color: #a1a1aa; }
.lesson-insert-menu__results { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 10px; scrollbar-width: thin; }
.lesson-insert-menu__group + .lesson-insert-menu__group { margin-top: 7px; padding-top: 8px; border-top: 1px solid #f1f1f3; }
.lesson-insert-menu.dark .lesson-insert-menu__group + .lesson-insert-menu__group { border-top-color: rgba(255,255,255,0.06); }
.lesson-insert-menu__group-label { display: flex; align-items: center; gap: 5px; padding: 4px 7px 6px; color: #8b8b93; font-size: 9.5px; font-weight: 780; letter-spacing: 0.1em; text-transform: uppercase; }
.lesson-insert-menu__grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 3px; }
.lesson-insert-menu__item { display: grid; grid-template-columns: 32px minmax(0,1fr); gap: 9px; align-items: start; min-width: 0; padding: 9px; border: 0; border-radius: 11px; color: inherit; background: transparent; cursor: pointer; text-align: left; }
.lesson-insert-menu__item:hover, .lesson-insert-menu__item:focus-visible { outline: 0; background: color-mix(in oklab, var(--insert-accent) 8%, transparent); }
.lesson-insert-menu__icon { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9px; color: color-mix(in oklab, var(--insert-accent) 75%, #064e3b); background: color-mix(in oklab, var(--insert-accent) 11%, transparent); }
.lesson-insert-menu.dark .lesson-insert-menu__icon { color: color-mix(in oklab, var(--insert-accent) 60%, #fff); background: color-mix(in oklab, var(--insert-accent) 14%, transparent); }
.lesson-insert-menu__copy { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.lesson-insert-menu__copy strong { overflow: hidden; color: #27272a; font-size: 11.5px; font-weight: 720; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.lesson-insert-menu.dark .lesson-insert-menu__copy strong { color: #f4f4f5; }
.lesson-insert-menu__copy small { display: -webkit-box; overflow: hidden; color: #71717a; font-size: 9.75px; line-height: 1.38; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.lesson-insert-menu.dark .lesson-insert-menu__copy small { color: #a1a1aa; }
.lesson-insert-menu__empty { padding: 28px 14px 32px; color: #71717a; text-align: center; font-size: 12px; }
@media (max-width: 430px) {
  .lesson-insert-menu { width: calc(100vw - 16px); border-radius: 15px; }
  .lesson-insert-menu__grid { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-insert-trigger, .lesson-insert-trigger svg:last-child { transition: none; }
}

.lesson-content .lesson-image { position: relative; margin: 1rem 0; }
.lesson-content .lesson-image__media { position: relative; min-width: 0; overflow: visible; }
.lesson-content .lesson-image__media img { display: block; box-sizing: border-box; margin: 0; }
.lesson-content .lesson-image__caption { width: 100%; margin-top: 7px; color: #71717a; font-size: 12px; line-height: 1.5; text-align: center; }
.lesson-content.dark .lesson-image__caption { color: #a1a1aa; }
.lesson-content .lesson-image__caption-editor { width: 100%; }
.lesson-content .lesson-image__caption-input { width: 100%; margin-top: 7px; padding: 2px 0; border: 0; border-bottom: 1px dashed #d4d4d8; outline: 0; color: #71717a; background: transparent; text-align: center; font: inherit; font-size: 12px; }
.lesson-content.dark .lesson-image__caption-input { color: #a1a1aa; border-bottom-color: #3f3f46; }
.lesson-content .lesson-image__caption-input::placeholder { color: #c4c4c8; }
.lesson-content .lesson-image__alt-input { font: inherit; font-size: 11px; width: 110px; padding: 3px 7px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.12); background: rgba(0,0,0,0.02); color: #52525b; outline: none; }
.lesson-content.dark .lesson-image__alt-input { border-color: rgba(255,255,255,0.15); background: rgba(255,255,255,0.04); color: #d4d4d8; }
.lesson-content .lesson-image__controls { position: absolute; top: 8px; right: 8px; z-index: 3; gap: 3px; padding: 4px; border-radius: 10px; background: rgba(255,255,255,0.9); box-shadow: 0 4px 16px rgba(15,23,42,0.12); backdrop-filter: blur(10px); }
.lesson-content.dark .lesson-image__controls { background: rgba(24,24,27,0.9); box-shadow: 0 5px 18px rgba(0,0,0,0.34); }
.lesson-content .lesson-image__control { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; }
.lesson-content .lesson-image__control:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-image__expand { position: relative; display: block; width: 100%; padding: 0; border: 0; border-radius: inherit; background: transparent; cursor: zoom-in; font: inherit; }
.lesson-content .lesson-image__expand > span { position: absolute; right: 10px; bottom: 10px; display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px; border-radius: 8px; color: #fff; background: rgba(15,23,42,0.68); opacity: 0; transform: translateY(3px); transition: opacity 0.16s ease, transform 0.16s ease; font-size: 10px; font-weight: 650; backdrop-filter: blur(7px); }
.lesson-content .lesson-image__expand:hover > span, .lesson-content .lesson-image__expand:focus-visible > span { opacity: 1; transform: translateY(0); }
.lesson-content .lesson-image__expand:focus-visible { outline: 3px solid var(--lesson-accent-ring) !important; outline-offset: 3px; }
.lesson-content .lesson-image__error { width: 100%; margin-top: 6px; color: #dc2626; font-size: 11px; text-align: center; }
@media (hover: hover) {
  .lesson-content .lesson-image__controls { opacity: 0; transition: opacity 0.15s ease; }
  .lesson-content .lesson-image__media:hover .lesson-image__controls, .lesson-content .lesson-image__media:focus-within .lesson-image__controls { opacity: 1; }
}
@media (max-width: 560px) {
  .lesson-content .lesson-image__media, .lesson-content .lesson-image__caption, .lesson-content .lesson-image__caption-editor { max-width: 100% !important; }
}
.lesson-image-lightbox { position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 44px 22px 22px; background: rgba(9,9,11,0.9); backdrop-filter: blur(12px); }
.lesson-image-lightbox > img { display: block; max-width: min(94vw, 1400px); max-height: 82vh; object-fit: contain; border-radius: 12px; box-shadow: 0 24px 70px rgba(0,0,0,0.48); }
.lesson-image-lightbox > p { max-width: 720px; margin: 0; color: #d4d4d8; text-align: center; font-size: 12px; }
.lesson-image-lightbox__close { position: absolute; top: 16px; right: 18px; display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; color: #fff; background: rgba(255,255,255,0.1); cursor: pointer; font-size: 22px; line-height: 1; }
.lesson-image-lightbox__close:hover { background: rgba(255,255,255,0.17); }
@media (prefers-reduced-motion: reduce) { .lesson-content .lesson-image__expand > span { transition: none; } }

.lesson-content .lesson-audio { position: relative; width: 100%; margin: 1rem 0; }
.lesson-content .lesson-audio__stage { position: relative; width: 100%; max-width: 560px; }
.lesson-content .lesson-audio__caption { width: 100%; max-width: 560px; margin-top: 7px; color: #71717a; font-size: 12px; line-height: 1.5; }
.lesson-content.dark .lesson-audio__caption { color: #a1a1aa; }
.lesson-content .lesson-audio__authoring { width: 100%; max-width: 560px; }
.lesson-content .lesson-audio__caption-input { width: 100%; margin-top: 7px; padding: 2px 0; border: 0; border-bottom: 1px dashed #d4d4d8; outline: 0; color: #71717a; background: transparent; font: inherit; font-size: 12px; }
.lesson-content.dark .lesson-audio__caption-input { color: #a1a1aa; border-bottom-color: #3f3f46; }
.lesson-content .lesson-audio__caption-input::placeholder { color: #c4c4c8; }
.lesson-content .lesson-audio__controls { position: static; gap: 1px; padding: 0; background: transparent; box-shadow: none; }
.lesson-content .lesson-audio__control { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; }
.lesson-content .lesson-audio__control:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-audio__add-transcript { display: inline-flex; align-items: center; gap: 5px; margin-top: 7px; padding: 4px 6px; border: 0; border-radius: 7px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
.lesson-content .lesson-audio__add-transcript:hover { background: var(--lesson-accent-ring); }
.lesson-content .lesson-audio__transcript-editor { position: relative; margin-top: 8px; }
.lesson-content .lesson-audio__transcript-input { width: 100%; min-height: 76px; box-sizing: border-box; padding: 10px 34px 10px 11px; border: 0; border-radius: 10px; outline: 0; resize: vertical; color: #3f3f46; background: #f4f4f5; font: inherit; font-size: 12px; line-height: 1.5; }
.lesson-content.dark .lesson-audio__transcript-input { color: #d4d4d8; background: rgba(255,255,255,0.055); }
.lesson-content .lesson-audio__transcript-input:focus { box-shadow: 0 0 0 2px var(--lesson-accent-ring); }
.lesson-content .lesson-audio__remove-transcript { position: absolute; top: 7px; right: 7px; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-audio__remove-transcript:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
@media (max-width: 560px) {
  .lesson-content .lesson-audio__stage, .lesson-content .lesson-audio__authoring, .lesson-content .lesson-audio__caption { max-width: 100%; }
}

/* File attachment: borderless accent-washed card. The whole card is the download target
   in the player, so the button inside it is a span -- a nested button would be invalid
   markup and would swallow the click on touch. */
.lesson-content .lesson-attachment { position: relative; width: 100%; max-width: 560px; margin: 1rem 0; }
.lesson-content .lesson-attachment__card { position: relative; display: flex; align-items: center; gap: 13px; padding: 13px 15px; border-radius: 11px; background: color-mix(in oklab, var(--lesson-accent-base) 8%, transparent); text-decoration: none; }
.lesson-content a.lesson-attachment__card:hover { background: color-mix(in oklab, var(--lesson-accent-base) 13%, transparent); }
.lesson-content a.lesson-attachment__card:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-attachment__tile { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: 0 0 38px; border-radius: 9px; color: var(--lesson-accent-ink); background: #fff; }
.lesson-content.dark .lesson-attachment__tile { background: rgba(255,255,255,0.07); }
/* Basis 0, not auto: a long filename must not claim its full width and push the icon
   onto its own row when the card wraps on a phone -- it should ellipsize instead. */
.lesson-content .lesson-attachment__meta { display: flex; min-width: 0; flex: 1 1 0; flex-direction: column; gap: 2px; }
.lesson-content .lesson-attachment__name { overflow: hidden; color: #27272a; font-size: 14px; font-weight: 640; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.lesson-content.dark .lesson-attachment__name { color: #f4f4f5; }
.lesson-content .lesson-attachment__detail { color: #71717a; font-size: 11.5px; letter-spacing: 0.03em; font-variant-numeric: tabular-nums; }
.lesson-content.dark .lesson-attachment__detail { color: #a1a1aa; }
/* The accent ink is a deep green on light and a pale mint on dark, so the label flips
   with it -- white on the dark-mode fill would be unreadable. */
.lesson-content .lesson-attachment__grab { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 7px 13px; border-radius: 8px; color: #fff; background: var(--lesson-accent-ink); font-size: 12.5px; font-weight: 620; }
.lesson-content.dark .lesson-attachment__grab { color: #0b1f17; }
.lesson-content .lesson-attachment__controls { position: static; gap: 1px; padding: 0; background: transparent; box-shadow: none; }
.lesson-content .lesson-attachment__control { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; }
.lesson-content .lesson-attachment__control:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-attachment__caption { margin-top: 7px; color: #71717a; font-size: 12px; line-height: 1.5; }
.lesson-content.dark .lesson-attachment__caption { color: #a1a1aa; }
.lesson-content .lesson-attachment__authoring { display: flex; flex-direction: column; gap: 2px; }
.lesson-content .lesson-attachment__name-input,
.lesson-content .lesson-attachment__caption-input { width: 100%; margin-top: 7px; padding: 2px 0; border: 0; border-bottom: 1px dashed #d4d4d8; outline: 0; color: #71717a; background: transparent; font: inherit; font-size: 12px; }
.lesson-content.dark .lesson-attachment__name-input,
.lesson-content.dark .lesson-attachment__caption-input { color: #a1a1aa; border-bottom-color: #3f3f46; }
.lesson-content .lesson-attachment__name-input::placeholder,
.lesson-content .lesson-attachment__caption-input::placeholder { color: #c4c4c8; }
@media (max-width: 560px) {
  .lesson-content .lesson-attachment { max-width: 100%; }
  .lesson-content .lesson-attachment__card { flex-wrap: wrap; }
  .lesson-content .lesson-attachment__grab { width: 100%; justify-content: center; }
}

.lesson-content .lesson-carousel { --card-border-default: #e4e4e7; position: relative; margin: 1rem 0; container-type: inline-size; color: #3f3f46; }
.lesson-content.dark .lesson-carousel { --card-border-default: rgba(255,255,255,0.09); color: #d4d4d8; }
.lesson-content .lesson-carousel__hint { position: absolute; top: 18px; left: 20px; z-index: 3; display: flex; align-items: center; justify-content: flex-start; gap: 7px; max-width: calc(100% - 40px); color: #71717a; pointer-events: none; white-space: nowrap; font-size: 10.5px; font-weight: 680; letter-spacing: 0.015em; }
.lesson-content.dark .lesson-carousel__hint { color: #d4d4d8; }
.lesson-content .lesson-carousel__hint-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 999px; background: var(--lesson-accent); box-shadow: 0 0 0 0 var(--lesson-accent-ring); animation: lesson-carousel-hint-pulse 1.65s ease-in-out infinite; }
@keyframes lesson-carousel-hint-pulse {
  0%, 100% { opacity: 0.58; transform: scale(0.72); box-shadow: 0 0 0 0 var(--lesson-accent-ring); }
  50% { opacity: 1; transform: scale(1.18); box-shadow: 0 0 0 5px var(--lesson-accent-ring); }
}
.lesson-content .lesson-carousel__viewport { display: flex; align-items: center; gap: 9px; }
.lesson-content .lesson-carousel__stage { position: relative; min-width: 0; flex: 1; }
.lesson-content .lesson-carousel__slides { min-width: 0; }
.lesson-content .lesson-carousel[data-hint="true"] .lesson-carousel__body { padding-top: 52px; }
.lesson-content .lesson-carousel__slide { display: none; overflow: hidden; border-color: var(--card-border-color, var(--card-border-default, #e4e4e7)); border-width: var(--card-border-width, 0); border-style: var(--card-border-style, none); border-radius: var(--card-radius, 14px); background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.07), 0 10px 28px rgba(15,23,42,0.065); }
.lesson-content.dark .lesson-carousel__slide { background: #1a1a1e; box-shadow: none; }
.lesson-content .lesson-carousel__cover-wrap { position: relative; margin-bottom: 16px; overflow: hidden; border-radius: var(--cover-radius, 10px); }
.lesson-content .lesson-carousel__cover { display: block; width: 100%; height: auto; border-radius: var(--cover-radius, 10px); }
.lesson-content .lesson-carousel__cover-actions { position: absolute; top: 8px; right: 8px; display: flex; gap: 6px; }
.lesson-content .lesson-carousel__cover-btn { padding: 5px 9px; border: 0; border-radius: 7px; color: #fff; background: rgba(15,23,42,0.68); backdrop-filter: blur(8px); cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 680; }
.lesson-content .lesson-carousel__cover-btn:hover { background: rgba(15,23,42,0.84); }
.lesson-content .lesson-carousel__cover-add { display: flex; width: 100%; height: 112px; align-items: center; justify-content: center; gap: 7px; margin-bottom: 15px; border: 1px dashed color-mix(in oklab, var(--lesson-accent) 24%, #d4d4d8); border-radius: 11px; color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent-base) 4%, transparent); cursor: pointer; font: inherit; font-size: 12px; font-weight: 680; }
.lesson-content.dark .lesson-carousel__cover-add { border-color: color-mix(in oklab, var(--lesson-accent) 22%, rgba(255,255,255,0.09)); color: color-mix(in oklab, var(--lesson-accent) 55%, #fff); background: color-mix(in oklab, var(--lesson-accent-base) 6%, transparent); }
.lesson-content .lesson-carousel__cover-add:hover { background: color-mix(in oklab, var(--lesson-accent-base) 8%, transparent); }
.lesson-content .lesson-carousel__cover-add:focus-visible, .lesson-content .lesson-carousel__cover-btn:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-carousel__spin { animation: lesson-code-spin 0.8s linear infinite; }
.lesson-content .lesson-carousel__body { min-height: 150px; padding: 18px 20px 20px; }
.lesson-content .lesson-carousel__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-carousel__title { margin: 0 0 8px; color: #18181b; font-size: 1.12rem; font-weight: 730; letter-spacing: -0.01em; line-height: 1.4; }
.lesson-content.dark .lesson-carousel__title { color: #fafafa; }
.lesson-content .lesson-carousel__title-input { width: 100%; margin-bottom: 8px; padding: 0 0 4px; border: 0; border-bottom: 1px dashed transparent; outline: 0; color: #18181b; background: transparent; font: inherit; font-size: 1.12rem; font-weight: 730; letter-spacing: -0.01em; line-height: 1.4; }
.lesson-content .lesson-carousel__title-input:focus { border-bottom-color: color-mix(in oklab, var(--lesson-accent) 38%, transparent); }
.lesson-content.dark .lesson-carousel__title-input { color: #fafafa; }
.lesson-content .lesson-carousel__title-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-carousel[data-active="0"] .lesson-carousel__slide[data-slide-index="0"],
.lesson-content .lesson-carousel[data-active="1"] .lesson-carousel__slide[data-slide-index="1"],
.lesson-content .lesson-carousel[data-active="2"] .lesson-carousel__slide[data-slide-index="2"],
.lesson-content .lesson-carousel[data-active="3"] .lesson-carousel__slide[data-slide-index="3"],
.lesson-content .lesson-carousel[data-active="4"] .lesson-carousel__slide[data-slide-index="4"],
.lesson-content .lesson-carousel[data-active="5"] .lesson-carousel__slide[data-slide-index="5"],
.lesson-content .lesson-carousel[data-active="6"] .lesson-carousel__slide[data-slide-index="6"],
.lesson-content .lesson-carousel[data-active="7"] .lesson-carousel__slide[data-slide-index="7"],
.lesson-content .lesson-carousel[data-active="8"] .lesson-carousel__slide[data-slide-index="8"],
.lesson-content .lesson-carousel[data-active="9"] .lesson-carousel__slide[data-slide-index="9"],
.lesson-content .lesson-carousel[data-active="10"] .lesson-carousel__slide[data-slide-index="10"],
.lesson-content .lesson-carousel[data-active="11"] .lesson-carousel__slide[data-slide-index="11"],
.lesson-content .lesson-carousel[data-active="12"] .lesson-carousel__slide[data-slide-index="12"],
.lesson-content .lesson-carousel[data-active="13"] .lesson-carousel__slide[data-slide-index="13"],
.lesson-content .lesson-carousel[data-active="14"] .lesson-carousel__slide[data-slide-index="14"],
.lesson-content .lesson-carousel[data-active="15"] .lesson-carousel__slide[data-slide-index="15"],
.lesson-content .lesson-carousel[data-active="16"] .lesson-carousel__slide[data-slide-index="16"],
.lesson-content .lesson-carousel[data-active="17"] .lesson-carousel__slide[data-slide-index="17"],
.lesson-content .lesson-carousel[data-active="18"] .lesson-carousel__slide[data-slide-index="18"],
.lesson-content .lesson-carousel[data-active="19"] .lesson-carousel__slide[data-slide-index="19"] { display: block; animation: lesson-carousel-slide 0.28s ease; }
@keyframes lesson-carousel-slide { from { opacity: 0; transform: translateX(7px); } to { opacity: 1; transform: translateX(0); } }
.lesson-content .lesson-carousel__arrow { display: inline-flex; width: 38px; height: 38px; flex: 0 0 38px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 999px; color: #fff; background: var(--lesson-accent); cursor: pointer; box-shadow: 0 5px 14px var(--lesson-accent-ring); transition: opacity 0.15s ease, transform 0.15s ease; }
.lesson-content .lesson-carousel__arrow:hover:not(:disabled) { transform: translateY(-1px); }
.lesson-content .lesson-carousel__arrow:disabled { cursor: default; opacity: 0.28; box-shadow: none; transform: none; }
.lesson-content .lesson-carousel__arrow:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 3px; }
.lesson-content .lesson-carousel__footer { display: flex; align-items: center; justify-content: center; padding: 12px 8px 0; }
.lesson-content .lesson-carousel__nav { display: flex; max-width: 100%; align-items: center; justify-content: center; flex-wrap: wrap; gap: 5px; }
.lesson-content .lesson-carousel__dot { width: 7px; height: 7px; padding: 0; border: 0; border-radius: 999px; background: #c9cbd1; cursor: pointer; transition: width 0.18s ease, background 0.18s ease; }
.lesson-content.dark .lesson-carousel__dot { background: rgba(255,255,255,0.2); }
.lesson-content .lesson-carousel__dot[data-active="true"] { width: 20px; background: var(--lesson-accent); }
.lesson-content .lesson-carousel__dot:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 3px; }
.lesson-content .lesson-carousel__editor-controls { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 8px; padding: 7px 2px 0; }
.lesson-content.dark .lesson-carousel__editor-controls { background: transparent; }
.lesson-content .lesson-carousel__editor-controls > span { color: #8b8b93; font-size: 10px; font-weight: 720; }
.lesson-content .lesson-carousel__editor-controls > div { display: inline-flex; flex-wrap: wrap; justify-content: flex-end; gap: 4px; }
.lesson-content .lesson-carousel__editor-controls button { display: inline-flex; min-height: 28px; align-items: center; justify-content: center; gap: 5px; padding: 4px 7px; border: 0; border-radius: 7px; color: #71717a; background: rgba(15,23,42,0.055); cursor: pointer; font: inherit; font-size: 10px; font-weight: 680; }
.lesson-content.dark .lesson-carousel__editor-controls button { color: #a1a1aa; background: rgba(255,255,255,0.065); }
.lesson-content .lesson-carousel__editor-controls button:hover:not(:disabled) { color: #27272a; background: rgba(15,23,42,0.09); }
.lesson-content.dark .lesson-carousel__editor-controls button:hover:not(:disabled) { color: #fafafa; background: rgba(255,255,255,0.11); }
.lesson-content .lesson-carousel__editor-controls button:disabled { cursor: default; opacity: 0.35; }
.lesson-content .lesson-carousel__editor-controls button:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-carousel__editor-controls .lesson-carousel__editor-delete:hover { color: #e11d48; background: rgba(244,63,94,0.09); }
.lesson-content .lesson-carousel__editor-controls .lesson-carousel__editor-add { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
@container (max-width: 480px) {
  .lesson-content .lesson-carousel__viewport { flex-wrap: wrap; justify-content: flex-end; column-gap: 6px; row-gap: 10px; }
  .lesson-content .lesson-carousel__stage { order: 2; flex-basis: 100%; }
  .lesson-content .lesson-carousel__arrow { width: 34px; height: 34px; flex-basis: 34px; }
  .lesson-content .lesson-carousel__body { min-height: 130px; padding: 16px; }
  .lesson-content .lesson-carousel__editor-controls { align-items: flex-start; flex-direction: column; }
  .lesson-content .lesson-carousel__editor-controls > div { justify-content: flex-start; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-carousel__slide { animation: none !important; }
  .lesson-content .lesson-carousel__dot { transition: none; }
  .lesson-content .lesson-carousel__hint-dot { animation: none; opacity: 1; transform: none; }
}

/* Flip cards (flashcards) */
.lesson-content .lesson-flip-deck { position: relative; margin: 1rem 0; }
/* TipTap renders child node views inside an inner [data-node-view-content-react]
   wrapper, so the grid must sit on that wrapper -- not the NodeViewContent element --
   or the cards stack vertically (the wrapper would be the lone grid item). */
.lesson-content .lesson-flip-deck__grid > [data-node-view-content-react] { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 14px; align-items: stretch; }
.lesson-content .lesson-flip { min-width: 0; }
.lesson-content .lesson-flip__card { display: block; width: 100%; height: 100%; padding: 0; border: 0; border-radius: 15px; outline: 0; background: transparent; cursor: pointer; perspective: 1100px; font: inherit; }
.lesson-content .lesson-flip__card:focus-visible { box-shadow: 0 0 0 3px var(--lesson-accent-ring); }
/* Both faces share one grid cell so the card grows to the taller side's content
   (instead of clipping against a fixed height) while still flipping in 3D. */
.lesson-content .lesson-flip__inner { position: relative; display: grid; width: 100%; min-height: 154px; transition: transform 0.44s cubic-bezier(0.2,0.72,0.25,1); transform-style: preserve-3d; }
.lesson-content .lesson-flip[data-flipped="true"] .lesson-flip__inner { transform: rotateY(180deg); }
.lesson-content .lesson-flip__face { position: relative; grid-area: 1 / 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; overflow: hidden; padding: 38px 20px 34px; border: 0; border-radius: 15px; text-align: center; backface-visibility: hidden; -webkit-backface-visibility: hidden; box-shadow: 0 10px 28px rgba(15,23,42,0.075), 0 2px 6px rgba(15,23,42,0.04); }
.lesson-content .lesson-flip__face--front { color: #18181b; background: #ffffff; font-weight: 620; }
.lesson-content .lesson-flip__face--back { color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent-base) 9%, #ffffff); transform: rotateY(180deg); }
.lesson-content.dark .lesson-flip__face { box-shadow: none; }
.lesson-content.dark .lesson-flip__face--front { color: #fafafa; background: rgba(255,255,255,0.045); }
.lesson-content.dark .lesson-flip__face--back { color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent-base) 13%, #18181b); }
.lesson-content .lesson-flip__side-label { position: absolute; top: 13px; left: 14px; color: #a1a1aa; font-size: 9.5px; font-weight: 800; letter-spacing: 0.11em; line-height: 1; text-transform: uppercase; }
.lesson-content .lesson-flip__face--back .lesson-flip__side-label { color: var(--lesson-accent-ink); opacity: 0.78; }
.lesson-content .lesson-flip__front-icon, .lesson-content .lesson-flip__edit-icon { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; flex: 0 0 40px; overflow: hidden; border-radius: 12px; color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-flip__front-icon img, .lesson-content .lesson-flip__edit-icon img { display: block; width: 100%; height: 100%; object-fit: contain; padding: 5px; }
.lesson-content .lesson-flip__text { font-size: 14.5px; line-height: 1.48; }
.lesson-content .lesson-flip__hint { position: absolute; right: 13px; bottom: 12px; display: inline-flex; align-items: center; gap: 4px; color: #a1a1aa; font-size: 9.5px; font-weight: 650; }
.lesson-content .lesson-flip__face--back .lesson-flip__hint { color: var(--lesson-accent-ink); opacity: 0.72; }
.lesson-content .lesson-flip__card:hover .lesson-flip__face { box-shadow: 0 14px 34px rgba(15,23,42,0.1), 0 3px 8px rgba(15,23,42,0.05); }
.lesson-content.dark .lesson-flip__card:hover .lesson-flip__face { box-shadow: none; }
@media (prefers-reduced-motion: reduce) { .lesson-content .lesson-flip__inner { transition: none; } }
.lesson-content .lesson-flip__edit { position: relative; display: flex; height: 100%; min-height: 154px; box-sizing: border-box; flex-direction: column; gap: 5px; padding: 12px 12px 14px; border: 0; border-radius: 15px; background: #ffffff; box-shadow: 0 8px 24px rgba(15,23,42,0.065); }
.lesson-content.dark .lesson-flip__edit { background: rgba(255,255,255,0.045); box-shadow: none; }
.lesson-content .lesson-flip__edit-head { display: flex; align-items: center; justify-content: space-between; min-height: 26px; gap: 8px; }
.lesson-content .lesson-flip__edit-tag { color: #a1a1aa; font-size: 9.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
.lesson-content .lesson-flip__edit-icon { width: 32px; height: 32px; flex-basis: 32px; border-radius: 10px; }
.lesson-content .lesson-flip__edit-input { width: 100%; font: inherit; font-size: 13.5px; color: #18181b; background: transparent; border: none; outline: none; resize: vertical; min-height: 28px; box-sizing: border-box; }
.lesson-content.dark .lesson-flip__edit-input { color: #fafafa; }
.lesson-content .lesson-flip__edit-input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-flip__edit-divider { margin: 4px 0; border-top: 1px solid #ececef; }
.lesson-content.dark .lesson-flip__edit-divider { border-top-color: rgba(255,255,255,0.08); }
.lesson-content .lesson-flip__controls { display: inline-flex; align-items: center; gap: 1px; }
.lesson-content .lesson-flip__control { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; flex: 0 0 25px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-flip__control:hover:not(:disabled) { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-flip__control:disabled { opacity: 0.3; cursor: default; }
.lesson-content .lesson-flip__remove:hover:not(:disabled) { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-flip__icon-options { display: grid; grid-template-columns: repeat(4, 30px); gap: 4px; }
.lesson-content .lesson-flip__icon-option { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 8px; color: #71717a; background: rgba(0,0,0,0.035); cursor: pointer; }
.lesson-content.dark .lesson-flip__icon-option { color: #a1a1aa; background: rgba(255,255,255,0.055); }
.lesson-content .lesson-flip__icon-option:hover, .lesson-content .lesson-flip__icon-option[data-active="true"] { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-flip__icon-none { color: #a1a1aa; }
.lesson-content .lesson-flip__icon-custom { border: 1px dashed color-mix(in oklab, var(--lesson-accent-base) 30%, #d4d4d8); }
.lesson-content .lesson-flip-deck__add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 0; border-radius: 8px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; }
.lesson-content .lesson-flip-deck__add:hover { background: var(--lesson-accent-ring); }
@media (hover: hover) {
  .lesson-content .lesson-flip__controls { opacity: 0; transition: opacity 0.15s ease; }
  .lesson-content .lesson-flip:hover .lesson-flip__controls, .lesson-content .lesson-flip:focus-within .lesson-flip__controls { opacity: 1; }
}

/* Vertical stepper */
/* Step cards: scan-friendly numbered instruction cards with optional guidance. */
.lesson-content .lesson-step-cards { position: relative; margin: 0.9rem 0; }
/* TipTap places the individual step-card node views in an inner content wrapper. */
.lesson-content .lesson-step-cards__items > [data-node-view-content-react] { display: flex; flex-direction: column; gap: 16px; }
.lesson-content .lesson-step-card { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 14px; padding: 18px 20px 18px 16px; border: 0; border-radius: 16px; background: #ffffff; box-shadow: 0 7px 22px rgba(15,23,42,0.05); }
.lesson-content.dark .lesson-step-card { border: 0; background: rgba(255,255,255,0.035); box-shadow: none; }
.lesson-content .lesson-step-card__number { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 999px; color: #fff; background: var(--lesson-accent); box-shadow: 0 5px 14px var(--lesson-accent-ring); font-size: 15px; font-weight: 800; font-variant-numeric: tabular-nums; line-height: 1; user-select: none; }
.lesson-content .lesson-step-card__main { min-width: 0; }
.lesson-content .lesson-step-card__header { display: flex; align-items: center; gap: 8px; min-height: 36px; margin-bottom: 3px; }
.lesson-content .lesson-step-card__title { flex: 1; margin: 0; color: #18181b; font-size: 1.18rem; font-weight: 750; letter-spacing: -0.01em; line-height: 1.35; }
.lesson-content.dark .lesson-step-card__title { color: #fafafa; }
.lesson-content .lesson-step-card__title-input { flex: 1; min-width: 0; padding: 2px 0; border: 0; border-bottom: 1px dashed #d4d4d8; outline: 0; color: #18181b; background: transparent; font: inherit; font-size: 1.18rem; font-weight: 750; line-height: 1.35; }
.lesson-content.dark .lesson-step-card__title-input { border-bottom-color: #3f3f46; color: #fafafa; }
.lesson-content .lesson-step-card__title-input::placeholder { color: #a1a1aa; font-weight: 650; }
.lesson-content .lesson-step-card__controls { display: flex; align-items: center; gap: 2px; flex: 0 0 auto; transition: opacity 0.15s ease; }
.lesson-content .lesson-step-card__action { display: inline-flex; align-items: center; justify-content: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-step-card__action:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-step-card__action:disabled { opacity: 0.28; color: #a1a1aa; background: transparent; cursor: not-allowed; }
.lesson-content .lesson-step-card__remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
@media (hover: hover) {
  .lesson-content .lesson-step-card__controls { opacity: 0; }
  .lesson-content .lesson-step-card:hover .lesson-step-card__controls, .lesson-content .lesson-step-card:focus-within .lesson-step-card__controls { opacity: 1; }
}
.lesson-content .lesson-step-card__body { color: #52525b; }
.lesson-content.dark .lesson-step-card__body { color: #b4b4bc; }
.lesson-content .lesson-step-card__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-step-card__highlight { margin-top: 15px; padding: 12px 14px 12px 15px; border-left: 3px solid var(--lesson-accent); border-radius: 0 11px 11px 0; background: color-mix(in oklab, var(--lesson-accent-base) 8%, #f8fafc); }
.lesson-content .lesson-step-card__highlight[data-editing="true"] { position: relative; padding-right: 38px; }
.lesson-content.dark .lesson-step-card__highlight { background: color-mix(in oklab, var(--lesson-accent-base) 10%, rgba(255,255,255,0.035)); }
.lesson-content .lesson-step-card__highlight[data-empty="true"] { border-left-color: #cbd5e1; }
.lesson-content.dark .lesson-step-card__highlight[data-empty="true"] { border-left-color: #52525b; }
.lesson-content .lesson-step-card__highlight-title { margin: 0 0 5px; color: var(--lesson-accent-ink); font-size: 10.5px; font-weight: 800; letter-spacing: 0.12em; line-height: 1.4; text-transform: uppercase; }
.lesson-content .lesson-step-card__highlight-body { margin: 0; color: #3f3f46; font-size: 13.5px; line-height: 1.55; white-space: pre-wrap; }
.lesson-content.dark .lesson-step-card__highlight-body { color: #d4d4d8; }
.lesson-content .lesson-step-card__highlight-title-input { display: block; width: 100%; padding: 0 0 5px; border: 0; outline: 0; color: var(--lesson-accent-ink); background: transparent; font: inherit; font-size: 10.5px; font-weight: 800; letter-spacing: 0.1em; line-height: 1.4; text-transform: uppercase; }
.lesson-content .lesson-step-card__highlight-title-input::placeholder { color: #8b8b93; }
.lesson-content .lesson-step-card__highlight-body-input { display: block; width: 100%; min-height: 50px; padding: 0; border: 0; outline: 0; resize: vertical; color: #3f3f46; background: transparent; font: inherit; font-size: 13.5px; line-height: 1.55; }
.lesson-content.dark .lesson-step-card__highlight-body-input { color: #d4d4d8; }
.lesson-content .lesson-step-card__highlight-body-input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-step-card__add-guidance { display: inline-flex; align-items: center; gap: 5px; margin-top: 9px; padding: 4px 7px; border: 0; border-radius: 7px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
.lesson-content .lesson-step-card__add-guidance:hover { background: var(--lesson-accent-ring); }
.lesson-content .lesson-step-card__remove-guidance { position: absolute; top: 8px; right: 8px; display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-step-card__remove-guidance:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-step-cards__add { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; padding: 6px 11px; border: 1px dashed #cbd5e1; border-radius: 8px; color: #52525b; background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; }
.lesson-content .lesson-step-cards__add:hover { background: rgba(0,0,0,0.03); }
.lesson-content.dark .lesson-step-cards__add { border-color: #3f3f46; color: #a1a1aa; }
@media (max-width: 560px) {
  .lesson-content .lesson-step-cards__items > [data-node-view-content-react] { gap: 12px; }
  .lesson-content .lesson-step-card { grid-template-columns: 34px minmax(0, 1fr); gap: 10px; padding: 15px 14px 15px 12px; border-radius: 14px; }
  .lesson-content .lesson-step-card__number { width: 32px; height: 32px; font-size: 13px; }
  .lesson-content .lesson-step-card__header { min-height: 32px; }
  .lesson-content .lesson-step-card__title, .lesson-content .lesson-step-card__title-input { font-size: 1.06rem; }
}

.lesson-content .lesson-stepper { position: relative; margin: 1rem 0; }
.lesson-content .lesson-step { display: none; position: relative; gap: 14px; margin-top: 14px; }
.lesson-content .lesson-step[data-step-index="0"] { margin-top: 0; }
/* Static dashed connector from each marker to the next. It spans this step's full
   height plus the gap, so it reaches the next marker regardless of body length; the
   generated rules above hide it on the last revealed step. */
.lesson-content .lesson-step::after { content: ''; position: absolute; left: 17px; top: 38px; bottom: -16px; width: 2px; transform: translateX(-50%); z-index: 0; border-radius: 999px; background: color-mix(in oklab, var(--lesson-accent-base) 30%, #e4e4e7); }
.lesson-content.dark .lesson-step::after { background: color-mix(in oklab, var(--lesson-accent-base) 32%, rgba(255,255,255,0.1)); }
/* New steps animate in as they are revealed (keyed to the newest step in the rules above). */
@keyframes lesson-step-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .lesson-content .lesson-step { animation: none !important; } }
${stepReveal}
.lesson-content .lesson-step__marker { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; flex: 0 0 34px; border-radius: 11px; color: #fff; background: var(--lesson-accent); }
.lesson-content .lesson-step__num { display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 780; line-height: 1; }
.lesson-content .lesson-step__check { display: none; }
.lesson-content .lesson-step__main { flex: 1; min-width: 0; margin-top: -4px; padding: 10px 12px 12px; border-radius: 12px; transition: background 0.2s ease; }
.lesson-content.dark .lesson-step__main { background: transparent !important; }
.lesson-content .lesson-step__head { display: flex; align-items: center; gap: 8px; min-height: 26px; margin-bottom: 3px; }
.lesson-content .lesson-step__title { font-size: 1.05rem; font-weight: 700; color: #18181b; margin: 0; }
.lesson-content.dark .lesson-step__title { color: #fafafa; }
.lesson-content .lesson-step__title-input { flex: 1; min-width: 0; font: inherit; font-size: 1.05rem; font-weight: 700; color: #18181b; background: transparent; border: none; outline: none; padding: 0; }
.lesson-content.dark .lesson-step__title-input { color: #fafafa; }
.lesson-content .lesson-step__title-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-step__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-step__controls { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.lesson-content .lesson-step__control { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 26px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-step__control:hover:not(:disabled) { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-step__control:disabled { opacity: 0.3; cursor: default; }
.lesson-content .lesson-step__remove:hover:not(:disabled) { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-stepper__next { display: inline-flex; align-items: center; gap: 9px; margin: 16px 0 0 48px; padding: 8px 10px 8px 14px; border: 0; border-radius: 11px; color: #fff; background: var(--lesson-accent); cursor: pointer; font: inherit; font-size: 12.5px; font-weight: 720; transition: background 0.16s ease, transform 0.16s ease; }
.lesson-content .lesson-stepper__next:hover { background: var(--lesson-accent-strong); transform: translateY(-1px); }
.lesson-content .lesson-stepper__next-dot { width: 6px; height: 6px; flex: 0 0 6px; border-radius: 999px; background: currentColor; box-shadow: 0 0 0 0 rgba(255,255,255,0.28); animation: lesson-stepper-continue-pulse 1.65s ease-in-out infinite; }
@keyframes lesson-stepper-continue-pulse {
  0%, 100% { opacity: 0.62; transform: scale(0.72); box-shadow: 0 0 0 0 rgba(255,255,255,0.28); }
  50% { opacity: 1; transform: scale(1.2); box-shadow: 0 0 0 5px rgba(255,255,255,0.16); }
}
.lesson-content .lesson-stepper__progress { padding-left: 9px; border-left: 1px solid rgba(255,255,255,0.3); opacity: 0.82; font-size: 10.5px; font-weight: 620; }
.lesson-content .lesson-stepper__done { display: flex; align-items: center; gap: 12px; margin: 16px 0 0 48px; }
.lesson-content .lesson-stepper__done-label { display: inline-flex; align-items: center; gap: 8px; color: var(--lesson-accent-ink); font-size: 12.5px; font-weight: 680; }
.lesson-content .lesson-stepper__done-icon { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 8px; color: #fff; background: var(--lesson-accent); }
.lesson-content .lesson-stepper__restart { display: inline-flex; align-items: center; gap: 5px; padding: 5px 7px; border: 0; border-radius: 7px; color: #71717a; background: transparent; cursor: pointer; font: inherit; font-size: 11px; font-weight: 650; }
.lesson-content .lesson-stepper__restart:hover { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content.dark .lesson-stepper__restart { color: #a1a1aa; }
.lesson-content .lesson-stepper[data-complete="true"] .lesson-step__num { display: none; }
.lesson-content .lesson-stepper[data-complete="true"] .lesson-step__check { display: inline-flex; }
.lesson-content .lesson-stepper__add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 0; border-radius: 8px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; }
.lesson-content .lesson-stepper__add:hover { background: var(--lesson-accent-ring); }
@media (hover: hover) {
  .lesson-content .lesson-step__controls { opacity: 0; transition: opacity 0.15s ease; }
  .lesson-content .lesson-step:hover .lesson-step__controls, .lesson-content .lesson-step:focus-within .lesson-step__controls { opacity: 1; }
}
@media (max-width: 560px) {
  .lesson-content .lesson-step { gap: 10px; }
  .lesson-content .lesson-step__main { padding-right: 6px; }
  .lesson-content .lesson-stepper__next, .lesson-content .lesson-stepper__done { margin-left: 44px; }
  .lesson-content .lesson-stepper__done { flex-wrap: wrap; gap: 7px; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-step__main, .lesson-content .lesson-stepper__next { transition: none; }
  .lesson-content .lesson-stepper__next:hover { transform: none; }
  .lesson-content .lesson-stepper__next-dot { animation: none; opacity: 1; transform: none; }
}

/* AI Prompt Lab */
.lesson-content .lesson-prompt { position: relative; overflow: hidden; margin: 1.1rem 0; border: 0; border-radius: 18px; background: #ffffff; box-shadow: 0 14px 38px rgba(15,23,42,0.08), 0 2px 7px rgba(15,23,42,0.04); }
.lesson-content.dark .lesson-prompt { border: 1px solid rgba(255,255,255,0.065); background: #18181b; box-shadow: 0 20px 48px rgba(0,0,0,0.3); }
.lesson-content .lesson-prompt__header { display: flex; align-items: center; gap: 12px; padding: 16px 16px 14px; }
.lesson-content .lesson-prompt__heading { min-width: 0; flex: 1; }
.lesson-content .lesson-prompt__eyebrow { display: block; margin-bottom: 1px; color: var(--lesson-accent-ink); font-size: 9.5px; font-weight: 800; letter-spacing: 0.15em; line-height: 1.4; text-transform: uppercase; }
.lesson-content .lesson-prompt__title { margin: 0; color: #18181b; font-size: 15px; font-weight: 730; line-height: 1.35; }
.lesson-content.dark .lesson-prompt__title { color: #fafafa; }
.lesson-content .lesson-prompt__title-input { display: block; width: 100%; padding: 0; border: 0; outline: 0; color: #18181b; background: transparent; font: inherit; font-size: 15px; font-weight: 730; line-height: 1.35; }
.lesson-content.dark .lesson-prompt__title-input { color: #fafafa; }
.lesson-content .lesson-prompt__title-input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-prompt__status { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent) 7%, transparent); font-size: 9.5px; font-weight: 700; letter-spacing: 0.02em; }
.lesson-content .lesson-prompt__status > span { width: 6px; height: 6px; border-radius: 999px; background: var(--lesson-accent); box-shadow: 0 0 0 3px var(--lesson-accent-ring); animation: lesson-prompt-pulse 2.4s ease-in-out infinite; }
.lesson-content .lesson-prompt__surface { overflow: hidden; margin: 0 16px; border: 0; border-radius: 13px; background: #f5f7f8; }
.lesson-content.dark .lesson-prompt__surface { border: 0; background: rgba(255,255,255,0.045); box-shadow: none; }
.lesson-content .lesson-prompt__surface-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 11px; border-bottom: 1px solid rgba(15,23,42,0.045); color: #71717a; background: rgba(244,244,245,0.72); font-size: 9px; font-weight: 750; letter-spacing: 0.1em; text-transform: uppercase; }
.lesson-content.dark .lesson-prompt__surface-bar { border-bottom-color: rgba(255,255,255,0.045); color: #8b8b93; background: rgba(255,255,255,0.025); }
.lesson-content .lesson-prompt__surface-bar span:last-child { letter-spacing: 0.02em; text-transform: none; font-variant-numeric: tabular-nums; }
.lesson-content .lesson-prompt__text { min-height: 92px; max-height: 330px; overflow: auto; margin: 0; padding: 15px 16px; border: 0; border-radius: 0; color: #27272a; background: transparent; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.62; }
.lesson-content.dark .lesson-prompt__text { border: 0; color: #e4e4e7; background: transparent; }
.lesson-content .lesson-prompt__text code, .lesson-content.dark .lesson-prompt__text code { padding: 0; border-radius: 0; color: inherit; background: transparent; font: inherit; }
.lesson-content .lesson-prompt__input { display: block; width: 100%; min-height: 116px; max-height: 330px; resize: vertical; margin: 0; padding: 15px 16px; border: 0; outline: 0; color: #27272a; background: transparent; font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 13.5px; line-height: 1.62; }
.lesson-content.dark .lesson-prompt__input { color: #e4e4e7; }
.lesson-content .lesson-prompt__input::placeholder { color: #a1a1aa; }
.lesson-content .lesson-prompt__input:focus { box-shadow: inset 0 0 0 2px var(--lesson-accent-ring); }
.lesson-content .lesson-prompt__provider-settings { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 10px 16px 0; padding: 9px 10px; border-radius: 11px; background: #f5f7f8; }
.lesson-content.dark .lesson-prompt__provider-settings { background: rgba(255,255,255,0.045); }
.lesson-content .lesson-prompt__provider-settings-label { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; }
.lesson-content .lesson-prompt__provider-settings-label > span { color: #3f3f46; font-size: 10.5px; font-weight: 750; }
.lesson-content.dark .lesson-prompt__provider-settings-label > span { color: #d4d4d8; }
.lesson-content .lesson-prompt__provider-settings-label > small { color: #8b8b93; font-size: 9.5px; }
.lesson-content .lesson-prompt__provider-toggles { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
.lesson-content .lesson-prompt__provider-toggles button { display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 5px 7px 5px 8px; border: 0; border-radius: 8px; color: #71717a; background: rgba(255,255,255,0.8); cursor: pointer; font: inherit; font-size: 10px; font-weight: 700; box-shadow: 0 1px 3px rgba(15,23,42,0.06); }
.lesson-content.dark .lesson-prompt__provider-toggles button { color: #a1a1aa; background: rgba(255,255,255,0.055); box-shadow: none; }
.lesson-content .lesson-prompt__provider-toggles button[data-active="true"] { color: #18181b; background: #ffffff; }
.lesson-content.dark .lesson-prompt__provider-toggles button[data-active="true"] { color: #f4f4f5; background: rgba(255,255,255,0.1); }
.lesson-content .lesson-prompt__provider-toggles button:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 1px; }
.lesson-content .lesson-prompt__provider-toggles img { display: block; width: 13px; height: 13px; flex: 0 0 13px; margin: 0; border-radius: 3px; object-fit: contain; }
.lesson-content .lesson-prompt__provider-toggles i { position: relative; display: block; width: 22px; height: 13px; margin-left: 1px; border-radius: 999px; background: #d4d4d8; transition: background 0.16s ease; }
.lesson-content .lesson-prompt__provider-toggles i::after { content: ''; position: absolute; width: 9px; height: 9px; left: 2px; top: 2px; border-radius: 999px; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,0.16); transition: transform 0.16s ease; }
.lesson-content .lesson-prompt__provider-toggles button[data-active="true"] i { background: var(--lesson-accent); }
.lesson-content .lesson-prompt__provider-toggles button[data-active="true"] i::after { transform: translateX(9px); }
.lesson-content .lesson-prompt__footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; }
.lesson-content .lesson-prompt__guidance { display: flex; align-items: center; gap: 7px; min-width: 0; color: #71717a; font-size: 10.5px; line-height: 1.35; }
.lesson-content.dark .lesson-prompt__guidance { color: #8b8b93; }
.lesson-content .lesson-prompt__guidance svg { flex: 0 0 auto; color: var(--lesson-accent-ink); }
.lesson-content .lesson-prompt__actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex: 0 0 auto; }
.lesson-content .lesson-prompt__button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 7px 10px; border: 1px solid transparent; border-radius: 9px; text-decoration: none; white-space: nowrap; cursor: pointer; transition: transform 0.16s ease, box-shadow 0.16s ease, background 0.16s ease, border-color 0.16s ease; font: inherit; font-size: 10.5px; font-weight: 720; line-height: 1; }
.lesson-content .lesson-prompt__button:hover:not(.is-disabled):not(:disabled) { opacity: 1; transform: translateY(-1px); }
.lesson-content .lesson-prompt__button:focus-visible { outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
.lesson-content .lesson-prompt__brand-icon { display: block; width: 16px; height: 16px; flex: 0 0 16px; object-fit: contain; margin: 0; border-radius: 3px; }
.lesson-content .lesson-prompt__brand-icon--wide { width: 58px; flex-basis: 58px; border-radius: 0; }
.lesson-content .lesson-prompt__button--copy { border-color: #d4d4d8; color: #3f3f46; background: rgba(255,255,255,0.9); }
.lesson-content .lesson-prompt__button--copy:hover:not(:disabled) { border-color: #a1a1aa; box-shadow: 0 5px 14px rgba(15,23,42,0.08); }
.lesson-content.dark .lesson-prompt__button--copy { border-color: rgba(255,255,255,0.12); color: #d4d4d8; background: rgba(255,255,255,0.055); }
.lesson-content .lesson-prompt__button--chatgpt { color: #fff; background: #18181b; box-shadow: 0 5px 14px rgba(24,24,27,0.16); }
.lesson-content.dark .lesson-prompt__button--chatgpt { color: #18181b; background: #f4f4f5; box-shadow: none; }
.lesson-content .lesson-prompt__button--claude { border-color: #fcd34d; color: #78350f; background: #fef3c7; }
.lesson-content.dark .lesson-prompt__button--claude { border-color: transparent; color: #5f321f; background: #f2e8dc; box-shadow: 0 4px 12px rgba(0,0,0,0.18); }
.lesson-content .lesson-prompt__button.is-disabled, .lesson-content .lesson-prompt__button:disabled { opacity: 0.4; cursor: not-allowed; box-shadow: none; transform: none; }
@keyframes lesson-prompt-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.55; transform: scale(0.82); } }
@media (max-width: 640px) {
  .lesson-content .lesson-prompt__status { display: none; }
  .lesson-content .lesson-prompt__provider-settings { align-items: stretch; flex-direction: column; }
  .lesson-content .lesson-prompt__provider-toggles { justify-content: space-between; }
  .lesson-content .lesson-prompt__footer { align-items: stretch; flex-direction: column; }
  .lesson-content .lesson-prompt__actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(90px, 1fr)); width: 100%; }
  .lesson-content .lesson-prompt__button { padding-inline: 7px; }
  .lesson-content .lesson-prompt__button svg:last-child { display: none; }
}
@media (max-width: 390px) {
  .lesson-content .lesson-prompt__actions { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .lesson-content .lesson-prompt__status > span { animation: none; }
  .lesson-content .lesson-prompt__button { transition: none; }
}

/* Authored inline links: course-accented, clearly interactive, but quiet enough to
   remain readable inside long-form lesson copy. Classed component links opt out. */
.lesson-content .ProseMirror a:not([class]) { color: var(--lesson-accent-ink); font-weight: 620; text-decoration-color: color-mix(in oklab, var(--lesson-accent-base) 48%, transparent); text-decoration-line: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; transition: color 0.14s ease, text-decoration-color 0.14s ease; }
.lesson-content .ProseMirror a:not([class]):hover { color: var(--lesson-accent-strong); text-decoration-color: var(--lesson-accent); }
.lesson-content .ProseMirror a:not([class]):focus-visible { border-radius: 3px; outline: 2px solid var(--lesson-accent) !important; outline-offset: 2px; }
/* Destination markers. Drawn, not text, so they cannot read as a "new" badge, and never
   applied to same-origin paths -- an in-app link needs no warning. File rules come last
   so a link that is both external and a file shows the download glyph. */
${externalLink},
${fileLink} { content: ''; display: inline-block; width: 0.58em; height: 0.58em; margin-left: 3px; background: currentColor; transform: translateY(-0.1em); -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat; -webkit-mask-position: center; mask-position: center; -webkit-mask-size: contain; mask-size: contain; }
${externalLink} { -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 17 17 7'/%3E%3Cpath d='M8 7h9v9'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7 17 17 7'/%3E%3Cpath d='M8 7h9v9'/%3E%3C/svg%3E"); }
${fileLink} { width: 0.68em; height: 0.68em; transform: translateY(0.02em); -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='m7 11 5 5 5-5'/%3E%3Cpath d='M4 20h16'/%3E%3C/svg%3E"); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 3v12'/%3E%3Cpath d='m7 11 5 5 5-5'/%3E%3Cpath d='M4 20h16'/%3E%3C/svg%3E"); }

.lesson-link-editor { padding: 13px 14px 14px; border-bottom: 1px solid rgba(0,0,0,0.07); color: #3f3f46; background: #fafafa; }
.lesson-link-editor.dark { border-bottom-color: rgba(255,255,255,0.07); color: #d4d4d8; background: rgba(255,255,255,0.025); }
.lesson-link-editor__head { display: grid; grid-template-columns: 30px minmax(0,1fr) 28px; align-items: center; gap: 9px; margin-bottom: 11px; }
.lesson-link-editor__icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; color: color-mix(in oklab, var(--lesson-accent-base) 80%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 12%, transparent); }
.lesson-link-editor.dark .lesson-link-editor__icon { color: color-mix(in oklab, var(--lesson-accent-base) 68%, #fff); }
.lesson-link-editor__head > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
.lesson-link-editor__head strong { color: #27272a; font-size: 12px; font-weight: 750; line-height: 1.35; }
.lesson-link-editor.dark .lesson-link-editor__head strong { color: #f4f4f5; }
.lesson-link-editor__head small { color: #8b8b93; font-size: 9.5px; line-height: 1.4; }
.lesson-link-editor__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px; color: #8b8b93; background: transparent; cursor: pointer; }
.lesson-link-editor__close:hover { color: #27272a; background: rgba(0,0,0,0.05); }
.lesson-link-editor.dark .lesson-link-editor__close:hover { color: #f4f4f5; background: rgba(255,255,255,0.06); }
.lesson-link-editor__grid { display: grid; grid-template-columns: minmax(0,0.8fr) minmax(0,1.2fr); gap: 9px; }
.lesson-link-editor__field { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.lesson-link-editor__field > span { color: #52525b; font-size: 9.5px; font-weight: 750; }
.lesson-link-editor.dark .lesson-link-editor__field > span { color: #c4c4ca; }
.lesson-link-editor__field input { width: 100%; padding: 7px 9px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; outline: 0; color: #27272a; background: #fff; font: inherit; font-size: 11px; line-height: 1.45; }
.lesson-link-editor.dark .lesson-link-editor__field input { border-color: rgba(255,255,255,0.1); color: #e4e4e7; background: rgba(255,255,255,0.045); }
.lesson-link-editor__field input:focus { border-color: var(--lesson-accent-base); box-shadow: 0 0 0 3px color-mix(in oklab, var(--lesson-accent-base) 12%, transparent); }
.lesson-link-editor__field input[aria-invalid="true"] { border-color: #ef4444; }
.lesson-link-editor__field > small { color: #dc2626; font-size: 8.5px; line-height: 1.35; }
.lesson-link-editor__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 11px; }
.lesson-link-editor__toggle { display: inline-flex; align-items: center; gap: 7px; color: #71717a; cursor: pointer; font-size: 10px; font-weight: 650; }
.lesson-link-editor__toggle input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
.lesson-link-editor__toggle > span { position: relative; display: inline-flex; width: 25px; height: 15px; flex: 0 0 25px; border-radius: 999px; background: #d4d4d8; transition: background-color 0.15s ease; }
.lesson-link-editor__toggle > span::after { content: ''; position: absolute; top: 2px; left: 2px; width: 11px; height: 11px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: transform 0.15s ease; }
.lesson-link-editor__toggle input:checked + span { background: var(--lesson-accent-base); }
.lesson-link-editor__toggle input:checked + span::after { transform: translateX(10px); }
.lesson-link-editor__toggle input:focus-visible + span { outline: 2px solid var(--lesson-accent-base); outline-offset: 2px; }
.lesson-link-editor.dark .lesson-link-editor__toggle > span { background: #52525b; }
.lesson-link-editor__actions { display: inline-flex; align-items: center; gap: 6px; }
.lesson-link-editor__actions button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 720; }
.lesson-link-editor__remove { color: #dc2626; background: transparent; }
.lesson-link-editor__remove:hover { background: rgba(220,38,38,0.07); }
.lesson-link-editor__save { color: #fff; background: color-mix(in oklab, var(--lesson-accent-base) 82%, #000); }
.lesson-link-editor__save:disabled { opacity: 0.42; cursor: not-allowed; }
@media (max-width: 520px) {
  .lesson-link-editor__grid { grid-template-columns: 1fr; }
  .lesson-link-editor__foot { align-items: flex-start; flex-direction: column; }
  .lesson-link-editor__actions { align-self: stretch; justify-content: flex-end; }
}

/* Glossary term (inline definition tooltip) */
.lesson-content .lesson-term { padding: 0 2px 1px; border-radius: 4px; color: inherit; background: linear-gradient(to top, var(--lesson-accent-ring) 0 34%, transparent 34%); box-shadow: inset 0 -1px 0 color-mix(in oklab, var(--lesson-accent-base) 66%, transparent); cursor: help; transition: color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease; }
.lesson-content .lesson-term:hover, .lesson-content .lesson-term:focus-visible { color: var(--lesson-accent-ink); background: color-mix(in oklab, var(--lesson-accent-base) 11%, transparent); box-shadow: inset 0 -2px 0 var(--lesson-accent); outline: none; }
/* The definition popover is rendered by GlossaryTooltip into a body portal (fixed +
   global, so the lesson card's overflow can never clip it). These rules are global,
   not scoped under .lesson-content, because the portal lives outside it. */
.lesson-term-tip { width: min(340px, calc(100vw - 16px)); max-height: min(390px, calc(100vh - 24px)); overflow-y: auto; padding: 14px; border: 0; border-radius: 14px; color: #3f3f46; background: #ffffff; box-shadow: 0 18px 52px rgba(15,23,42,0.18), 0 3px 12px rgba(15,23,42,0.08); font-size: 12.5px; line-height: 1.5; font-weight: 450; transform-origin: bottom center; animation: lesson-term-tip-in 0.17s cubic-bezier(0.2,0.72,0.3,1); }
.lesson-term-tip[data-placement="bottom"] { transform-origin: top center; }
.lesson-term-tip[data-theme="dark"] { color: #d4d4d8; background: #202024; box-shadow: 0 18px 52px rgba(0,0,0,0.55), 0 3px 12px rgba(0,0,0,0.35); }
.lesson-term-tip__head { display: flex; align-items: center; gap: 9px; margin-bottom: 9px; }
.lesson-term-tip__icon { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 29px; flex: 0 0 29px; border-radius: 9px; color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 13%, transparent); }
.lesson-term-tip[data-theme="dark"] .lesson-term-tip__icon { color: color-mix(in oklab, var(--lesson-accent-base) 68%, #fff); }
.lesson-term-tip__head > span:last-child { display: flex; min-width: 0; flex-direction: column; }
.lesson-term-tip__head strong { overflow: hidden; color: #18181b; font-size: 13px; font-weight: 760; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.lesson-term-tip[data-theme="dark"] .lesson-term-tip__head strong { color: #fafafa; }
.lesson-term-tip__head small { color: #8b8b93; font-size: 10px; line-height: 1.35; }
.lesson-term-tip p { margin: 0; }
.lesson-term-tip__example { margin-top: 10px; padding: 9px 10px; border-radius: 9px; color: #52525b; background: #f5f5f6; font-style: italic; }
.lesson-term-tip[data-theme="dark"] .lesson-term-tip__example { color: #c4c4ca; background: rgba(255,255,255,0.05); }
.lesson-term-tip__example span { display: block; margin-bottom: 2px; color: #8b8b93; font-size: 8.5px; font-style: normal; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
.lesson-term-tip a { display: inline-flex; align-items: center; gap: 5px; margin-top: 10px; color: color-mix(in oklab, var(--lesson-accent-base) 78%, #000); font-size: 10.5px; font-weight: 750; text-decoration: none; }
.lesson-term-tip[data-theme="dark"] a { color: color-mix(in oklab, var(--lesson-accent-base) 68%, #fff); }
.lesson-term-tip a:hover { text-decoration: underline; text-underline-offset: 3px; }
@keyframes lesson-term-tip-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .lesson-term-tip { animation: none; } }

.lesson-glossary-editor { padding: 13px 14px 14px; border-bottom: 1px solid rgba(0,0,0,0.07); color: #3f3f46; background: #fafafa; }
.lesson-glossary-editor.dark { border-bottom-color: rgba(255,255,255,0.07); color: #d4d4d8; background: rgba(255,255,255,0.025); }
.lesson-glossary-editor__head { display: grid; grid-template-columns: 30px minmax(0,1fr) 28px; gap: 9px; align-items: center; margin-bottom: 12px; }
.lesson-glossary-editor__icon { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: 9px; color: color-mix(in oklab, var(--lesson-accent-base) 80%, #000); background: color-mix(in oklab, var(--lesson-accent-base) 12%, transparent); }
.lesson-glossary-editor.dark .lesson-glossary-editor__icon { color: color-mix(in oklab, var(--lesson-accent-base) 68%, #fff); }
.lesson-glossary-editor__head > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; }
.lesson-glossary-editor__head strong { overflow: hidden; color: #27272a; font-size: 12px; font-weight: 750; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.lesson-glossary-editor.dark .lesson-glossary-editor__head strong { color: #f4f4f5; }
.lesson-glossary-editor__head small { color: #8b8b93; font-size: 9.5px; line-height: 1.4; }
.lesson-glossary-editor__close { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 8px; color: #8b8b93; background: transparent; cursor: pointer; }
.lesson-glossary-editor__close:hover { color: #27272a; background: rgba(0,0,0,0.05); }
.lesson-glossary-editor.dark .lesson-glossary-editor__close:hover { color: #f4f4f5; background: rgba(255,255,255,0.06); }
.lesson-glossary-editor__grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 9px; margin-top: 9px; }
.lesson-glossary-editor__field { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.lesson-glossary-editor__field--wide { grid-column: 1 / -1; }
.lesson-glossary-editor__field > span { color: #52525b; font-size: 9.5px; font-weight: 750; }
.lesson-glossary-editor.dark .lesson-glossary-editor__field > span { color: #c4c4ca; }
.lesson-glossary-editor__field em { margin-left: 4px; color: #a1a1aa; font-size: 8px; font-style: normal; font-weight: 550; }
.lesson-glossary-editor__field input, .lesson-glossary-editor__field textarea { width: 100%; padding: 7px 9px; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; outline: 0; color: #27272a; background: #fff; resize: vertical; font: inherit; font-size: 11px; line-height: 1.45; }
.lesson-glossary-editor.dark .lesson-glossary-editor__field input, .lesson-glossary-editor.dark .lesson-glossary-editor__field textarea { border-color: rgba(255,255,255,0.1); color: #e4e4e7; background: rgba(255,255,255,0.045); }
.lesson-glossary-editor__field input:focus, .lesson-glossary-editor__field textarea:focus { border-color: var(--lesson-accent-base); box-shadow: 0 0 0 3px color-mix(in oklab, var(--lesson-accent-base) 12%, transparent); }
.lesson-glossary-editor__actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 11px; }
.lesson-glossary-editor__actions button { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border: 0; border-radius: 8px; cursor: pointer; font: inherit; font-size: 10.5px; font-weight: 720; }
.lesson-glossary-editor__remove { color: #dc2626; background: transparent; }
.lesson-glossary-editor__remove:hover { background: rgba(220,38,38,0.07); }
.lesson-glossary-editor__save { color: #fff; background: color-mix(in oklab, var(--lesson-accent-base) 82%, #000); }
.lesson-glossary-editor__save:disabled { opacity: 0.42; cursor: not-allowed; }
@media (max-width: 520px) { .lesson-glossary-editor__grid { grid-template-columns: 1fr; } }

/* Timeline */
.lesson-content .lesson-timeline { position: relative; margin: 1rem 0; }
/* Layout per entry: [date column] [dot + connector] [title + body]. */
.lesson-content .lesson-timeline__entry { position: relative; display: grid; grid-template-columns: 112px 24px minmax(0,1fr); gap: 12px; padding-bottom: 24px; }
/* Connector line is on the entry (always full height) at the dot column's center
   (date col 120 + gap 12 + dot half 7 = 139px), running from below the dot to the
   entry's bottom edge -- i.e. up to the next dot. */
.lesson-content .lesson-timeline__entry::after { content: ''; position: absolute; left: 136px; top: 26px; bottom: 0; width: 2px; transform: translateX(-50%); border-radius: 999px; background: color-mix(in oklab, var(--lesson-accent-base) 28%, #e4e4e7); }
.lesson-content.dark .lesson-timeline__entry::after { background: color-mix(in oklab, var(--lesson-accent-base) 28%, rgba(255,255,255,0.1)); }
/* Last entry: no connector and no trailing space. Keyed off TipTap's per-node wrapper
   (.node-timelineEntry) so it always tracks the real DOM order -- a React-derived flag
   would go stale because adding a sibling need not re-render the previous entry. */
.lesson-content [data-node-view-content-react] > .node-timelineEntry:last-child .lesson-timeline__entry { padding-bottom: 0; }
.lesson-content [data-node-view-content-react] > .node-timelineEntry:last-child .lesson-timeline__entry::after { display: none; }
/* Wide enough for a short phrase (not just a year), right-aligned so short labels
   still hug the line; longer ones wrap within the column without shifting the dots. */
.lesson-content .lesson-timeline__date-col { min-width: 0; padding-top: 1px; text-align: right; overflow-wrap: anywhere; }
.lesson-content .lesson-timeline__dot { position: relative; min-width: 0; }
.lesson-content .lesson-timeline__dot::before { content: ''; position: absolute; left: 50%; top: 5px; z-index: 1; width: 12px; height: 12px; transform: translateX(-50%); border: 3px solid color-mix(in oklab, var(--lesson-accent) 17%, #fff); border-radius: 999px; background: var(--lesson-accent); box-shadow: 0 0 0 4px var(--lesson-accent-ring); }
.lesson-content.dark .lesson-timeline__dot::before { border-color: color-mix(in oklab, var(--lesson-accent) 18%, #18181b); }
.lesson-content .lesson-timeline__content { min-width: 0; padding-bottom: 1px; }
.lesson-content .lesson-timeline__meta { display: flex; align-items: flex-start; gap: 8px; min-height: 24px; margin-bottom: 5px; }
.lesson-content .lesson-timeline__date { display: inline-flex; max-width: 100%; padding: 3px 7px; border-radius: 7px; color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); font-size: 10.5px; font-weight: 760; letter-spacing: 0.025em; line-height: 1.35; text-align: right; }
.lesson-content .lesson-timeline__title { color: #18181b; font-size: 1.04rem; font-weight: 720; line-height: 1.45; }
.lesson-content.dark .lesson-timeline__title { color: #fafafa; }
.lesson-content .lesson-timeline__body { color: #52525b; }
.lesson-content.dark .lesson-timeline__body { color: #b4b4bc; }
.lesson-content .lesson-timeline__body > :last-child { margin-bottom: 0; }
.lesson-content .lesson-timeline__date-input { width: 100%; padding: 3px 6px; border: 0; border-radius: 7px; outline: none; color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); text-align: right; font: inherit; font-size: 10.5px; font-weight: 760; }
.lesson-content .lesson-timeline__date-input:focus { box-shadow: 0 0 0 2px color-mix(in oklab, var(--lesson-accent) 24%, transparent); }
.lesson-content .lesson-timeline__date-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-timeline__title-input { flex: 1; min-width: 0; padding: 0; border: 0; outline: none; color: #18181b; background: transparent; font: inherit; font-size: 1.04rem; font-weight: 720; line-height: 1.45; }
.lesson-content.dark .lesson-timeline__title-input { color: #fafafa; }
.lesson-content .lesson-timeline__title-input::placeholder { color: #a1a1aa; font-weight: 600; }
.lesson-content .lesson-timeline__controls { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.lesson-content .lesson-timeline__control { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 26px; padding: 0; border: 0; border-radius: 7px; color: #a1a1aa; background: transparent; cursor: pointer; }
.lesson-content .lesson-timeline__control:hover:not(:disabled) { color: var(--lesson-accent-ink); background: var(--lesson-accent-ring); }
.lesson-content .lesson-timeline__control:disabled { opacity: 0.3; cursor: default; }
.lesson-content .lesson-timeline__remove:hover:not(:disabled) { color: #ef4444; background: rgba(239,68,68,0.08); }
.lesson-content .lesson-timeline__add { display: inline-flex; align-items: center; gap: 5px; padding: 6px 9px; border: 0; border-radius: 8px; color: var(--lesson-accent-ink); background: transparent; cursor: pointer; font: inherit; font-size: 12px; font-weight: 650; }
.lesson-content .lesson-timeline__add:hover { background: var(--lesson-accent-ring); }
@media (hover: hover) {
  .lesson-content .lesson-timeline__controls { opacity: 0; transition: opacity 0.15s ease; }
  .lesson-content .lesson-timeline__entry:hover .lesson-timeline__controls, .lesson-content .lesson-timeline__entry:focus-within .lesson-timeline__controls { opacity: 1; }
}
@media (max-width: 560px) {
  .lesson-content .lesson-timeline__entry { grid-template-columns: 24px minmax(0,1fr); gap: 10px; padding-bottom: 22px; }
  .lesson-content .lesson-timeline__entry::after { left: 12px; top: 26px; }
  .lesson-content .lesson-timeline__date-col { grid-column: 2; grid-row: 1; padding: 0; text-align: left; }
  .lesson-content .lesson-timeline__dot { grid-column: 1; grid-row: 1 / span 2; }
  .lesson-content .lesson-timeline__content { grid-column: 2; grid-row: 2; }
  .lesson-content .lesson-timeline__date, .lesson-content .lesson-timeline__date-input { width: fit-content; max-width: 100%; text-align: left; }
}
`}</style>
  );
}
