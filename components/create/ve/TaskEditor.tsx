'use client';

// The editor for one open task in the virtual experience curriculum: its type, title,
// instructions and the settings of that type (options, rubric, pass mark, email, files).

import React from 'react';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { LOCKABLE_CODE_REVIEW_LANGUAGES } from '@/lib/code-review-languages';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { uploadToGithub } from '@/lib/uploadToGithub';
import { clampLinkedInSharePoints, DEFAULT_LINKEDIN_SHARE_POINTS, MAX_LINKEDIN_SHARE_POINTS } from '@/lib/course-schema';
import { convertLegacyEmailDeliverable, htmlToPlainText, plainTextToRichHtml } from '@/lib/ve-deliverable-content';
import { Plus, X, Check, Upload, Star, Clock, Link as LinkIcon, FileText, PenLine, Table, Paperclip, Mail } from 'lucide-react';
import { RichTextEditor } from '@/components/RichTextEditor';
import { mergeRubricCriteria } from '@/lib/rubric-criteria';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { MenuSelect } from '@/components/MenuSelect';
import { TASK_TYPE_OPTIONS, type Requirement } from '@/components/create/ve/model';
import { PassMarkField, RubricBuilder } from '@/components/create/ve/parts';

export function TaskEditor({ req, C, inp, sessionToken, accent, requestRichTextImage, update }: {
  req: Requirement;
  C: ThemeColors;
  inp: React.CSSProperties;
  sessionToken: string;
  accent: string;
  requestRichTextImage: () => Promise<string | null>;
  update: (updates: Partial<Requirement> | ((requirement: Requirement) => Partial<Requirement>)) => void;
}) {
  const P = palette(C);
  const opts = req.options?.length ? req.options : ['', '', '', ''];
  // One neutral style for the notes that say what a task type does.
  const tc = { bg: C.pill, color: C.muted };
  // Shared by every task type that grades on a rubric or a pass mark, so they stay alike.
  const rubricProps = {
    criteria: req.rubric ?? [], C, inp, sessionToken,
    onChange: (rubric: string[]) => update({ rubric }),
    onImport: (incoming: string[]) => update(current => ({ rubric: mergeRubricCriteria(current.rubric ?? [], incoming) })),
  };
  const passMark = (placeholder: string, hint: string) => (
    <PassMarkField C={C} value={req.minScore} placeholder={placeholder} hint={hint}
      onChange={minScore => update({ minScore })} />
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-60">
        <MenuSelect field label="Task type" value={req.type} C={C}
          options={TASK_TYPE_OPTIONS.filter(o => o.value !== 'deliverable' || req.type === 'deliverable')}
          onChange={value => {
            const type = value as Requirement['type'];
            const wasDeliverable = req.type === 'task' || req.type === 'deliverable';
            const isDeliverable = type === 'task' || type === 'deliverable';
            update({
              type,
              description: wasDeliverable && !isDeliverable && req.descriptionFormat === 'rich'
                ? htmlToPlainText(req.description)
                : req.description,
              descriptionFormat: isDeliverable && wasDeliverable ? req.descriptionFormat : undefined,
              descriptionDoc: isDeliverable && wasDeliverable ? req.descriptionDoc : undefined,
              accentColor: undefined,
              options: type === 'mcq'
                ? ['', '', '', '']
                : type === 'decision'
                  ? ['', '', '']
                  : undefined,
              optionFeedback: type === 'decision' ? ['', '', ''] : undefined,
              correctAnswer: type === 'mcq' || type === 'decision' ? '' : undefined,
              expectedAnswer: undefined,
              aiReview: type === 'text' ? req.aiReview : undefined,
              sharePrompt: type === 'linkedin_share' ? req.sharePrompt : undefined,
              shareRequired: type === 'linkedin_share' ? (req.shareRequired ?? false) : undefined,
              // Written explicitly so NEW share requirements offer the default bonus,
              // while ones authored before VE shares paid XP keep an absent field and
              // stay at 0 until an instructor sets an amount.
              sharePoints: type === 'linkedin_share' ? (req.sharePoints ?? DEFAULT_LINKEDIN_SHARE_POINTS) : undefined,
              emailFrame: isDeliverable ? false : req.emailFrame,
              // Grading settings belong to the old type: a pass mark or rubric
              // carried over would grade the new one without showing it.
              ...(type !== req.type ? {
                rubric: undefined, context: undefined, schema: undefined, minScore: undefined,
                reviewSheetNames: undefined, documentReviewMode: undefined, reviewLanguage: undefined,
              } : {}),
            });
          }} />
        </div>
        {!['briefing','scenario_update','decision','debrief','task','deliverable'].includes(req.type) && (
          <button
            type="button"
            onClick={() => update({ emailFrame: !req.emailFrame })}
            role="switch" aria-checked={!!req.emailFrame}
            title={req.emailFrame ? 'This task arrives as an email from the manager. Click to show it as a plain card.' : 'Click to send this task as an email from the manager.'}
            className={btnSmClass} style={req.emailFrame ? { background: P.sel, color: P.onSel } : btnStyle('sec', C)}>
            <Mail className="w-3.5 h-3.5" /> {req.emailFrame ? 'Sent as email' : 'Send as email'}
          </button>
        )}
        {(req.type === 'task' || req.type === 'deliverable') && req.emailFrame && (
          <button
            type="button"
            onClick={() => {
              update(convertLegacyEmailDeliverable(req));
            }}
            title="Convert the email into the deliverable brief and checkbox presentation"
            className="flex flex-shrink-0 items-center gap-2 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all"
            style={{ background: 'rgba(245,158,11,0.12)', color: '#b45309', border: '1px solid rgba(245,158,11,0.35)' }}>
            <Mail className="h-3 w-3" /> Convert from email
          </button>
        )}
      </div>
      <div>
        <label className="text-xs font-semibold block mb-2" style={{ color: C.muted }}>
          Title <span className="font-normal" style={{ color: C.faint }}>(the heading learners see)</span>
        </label>
        <input value={req.label}
          onChange={e => update({ label: e.target.value })}
          autoFocus={!req.label.trim()}
          style={{ ...inp, fontWeight: 600, boxShadow: req.label.trim() ? 'none' : 'inset 0 0 0 1.5px #f59e0b' }}
          placeholder={['mcq', 'text', 'decision'].includes(req.type) ? 'e.g. What is the churn rate for March?' : 'e.g. Send the cleaned customer file'} />
      </div>
      {(req.type === 'briefing' || req.type === 'debrief') ? (
        <>
          <RichTextEditor
            className="ve-shell"
            value={req.description}
            onChange={html => update({ description: html })}
            placeholder={req.type === 'briefing' ? 'Write the email body - formatting, bullet points, and images are all supported...' : 'Describe what students should write in their debrief update...'}
            onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
            onRequestImage={requestRichTextImage}
            enableAiAssist
            enableNameTag
          />
          <p className="text-[11px]" style={{ color: C.faint }}>
            {'Tip: insert {{first_name}} (or type {{name}} for the full name) to greet each student by name.'}
          </p>
          {req.type === 'briefing' && (
            <div className="space-y-2">
              {(req.attachments || []).map((att, ai) => (
                <div key={ai} className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.input }}>
                  <Paperclip className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.muted }} />
                  <span className="flex-1 truncate" style={{ color: C.text }}>{att.name}</span>
                  <button onClick={() => update({ attachments: req.attachments?.filter((_, i) => i !== ai) })} style={{ color: C.faint }} className="hover:text-red-400 flex-shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] cursor-pointer hover:opacity-80 transition-opacity" style={{ background: C.card, border: `1px dashed ${C.inputBorder}`, color: C.muted }}>
                <Paperclip className="w-3.5 h-3.5" /> Attach file
                <input type="file" className="hidden" onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    const { url } = await uploadToGithub(file, 've-email-attachments');
                    update(r => ({ attachments: [...(r.attachments || []), { name: file.name, url, mimeType: file.type }] }));
                  } catch { alert('Upload failed'); }
                  e.target.value = '';
                }} />
              </label>
            </div>
          )}
        </>
      ) : (
        <>
          {req.emailFrame && (
            <div style={{ borderRadius: 8, overflow: 'hidden', border: `1px solid ${C.inputBorder}` }}>
              <div style={{ padding: '6px 12px', background: C.card, borderBottom: `1px solid ${C.inputBorder}`, fontSize: 11, fontWeight: 600, color: C.muted, letterSpacing: 0.4 }}>
                EMAIL BODY
              </div>
              <RichTextEditor
            className="ve-shell"
                value={req.emailBody || ''}
                onChange={html => update({ emailBody: html })}
                placeholder="Write the email the manager sends to the student..."
                onImageUpload={async (file) => uploadToCloudinary(file, 've-email-images')}
                onRequestImage={requestRichTextImage}
                enableAiAssist
                enableNameTag
              />
            </div>
          )}
          {req.emailFrame && (
            <p className="text-[11px]" style={{ color: C.faint }}>
              {'Tip: insert {{first_name}} (or type {{name}} for the full name) to greet each student by name.'}
            </p>
          )}
          {req.type === 'task' || req.type === 'deliverable' ? req.emailFrame ? (
            <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: 'rgba(245,158,11,0.10)', color: '#b45309' }}>
              This legacy deliverable still uses its email body and attachments. Convert it from email to edit the new deliverable brief without losing the instructions learners currently see.
            </p>
          ) : (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>
                  Deliverable instructions
                </p>
                <LessonEditor
                  key={`${req.id}-instructions`}
                  doc={req.descriptionDoc}
                  bodyFallback={req.descriptionFormat === 'rich' ? req.description : plainTextToRichHtml(req.description)}
                  onChange={({ doc, body }) => update({
                    descriptionDoc: doc,
                    description: body,
                    descriptionFormat: 'rich',
                  })}
                  placeholder="Explain the work clearly. Add interactive prompts, steps, tables, images, code, or examples..."
                  isDark={C.page === DARK_C.page}
                  accentColor={accent}
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold" style={{ color: C.muted }}>
                  Resources
                </p>
                {(req.attachments || []).map((att, ai) => (
                  <div key={`${att.url}-${ai}`} className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: C.input }}>
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0" style={{ color: C.muted }} />
                    <span className="flex-1 truncate" style={{ color: C.text }}>{att.name}</span>
                    <button
                      type="button"
                      aria-label={`Remove resource ${att.name}`}
                      title={`Remove resource ${att.name}`}
                      onClick={() => update({ attachments: req.attachments?.filter((_, i) => i !== ai) })}
                      className="flex-shrink-0 hover:text-red-400"
                      style={{ color: C.faint }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-[12px] transition-opacity hover:opacity-80" style={{ background: C.card, border: `1px dashed ${C.inputBorder}`, color: C.muted }}>
                  <Paperclip className="h-3.5 w-3.5" /> Attach resource
                  <input type="file" className="hidden" onChange={async e => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      const { url } = await uploadToGithub(file, 've-email-attachments');
                      update(r => ({ attachments: [...(r.attachments || []), { name: file.name, url, mimeType: file.type }] }));
                    } catch { alert('Upload failed'); }
                    e.target.value = '';
                  }} />
                </label>
              </div>
              <p className="text-[11px]" style={{ color: C.faint }}>
                Students see these instructions and resources, then use one checkbox to confirm the whole deliverable is complete.
              </p>
            </div>
          ) : (
            <input value={req.description}
              onChange={e => update({ description: e.target.value })}
              style={{ ...inp, background: C.input, fontSize: 12 }}
              placeholder="Instructions (shown to the learner)" aria-label="Instructions shown to the learner" />
          )}
          {req.type === 'linkedin_share' && (
            <>
              <textarea value={req.sharePrompt || ''}
                onChange={e => update({ sharePrompt: e.target.value })}
                rows={4}
                style={{ ...inp, background: C.input, fontSize: 12, resize: 'vertical' }}
                placeholder="Optional suggested post text the student can copy" />
              <button
                type="button"
                onClick={() => update({ shareRequired: req.shareRequired !== true })}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all self-start"
                style={req.shareRequired !== true
                  ? { background: C.card, border: `1px solid ${C.inputBorder}`, color: C.muted }
                  : { background: C.cta, color: 'white' }}>
                {req.shareRequired !== true ? 'Optional' : 'Required to finish the lesson'}
              </button>
              {/* Independent of the toggle: an optional share can still pay a bonus. */}
              <label className="flex items-center gap-2 text-[11px] font-semibold" style={{ color: C.muted }}>
                Bonus XP
                <input
                  type="number" min={0} max={MAX_LINKEDIN_SHARE_POINTS}
                  value={req.sharePoints ?? 0}
                  onChange={e => update({
                    sharePoints: clampLinkedInSharePoints(e.target.value),
                  })}
                  style={{ ...inp, background: C.input, fontSize: 12, width: 90, padding: '4px 8px' }} />
                <span style={{ color: C.faint, fontWeight: 500 }}>0 to {MAX_LINKEDIN_SHARE_POINTS}; 0 awards nothing</span>
              </label>
              <p className="text-[11px]" style={{ color: C.faint }}>
                The student pastes the link to their own LinkedIn post. It is checked as a real post
                written by them, and a post someone else already submitted is rejected.
                {req.shareRequired !== true
                  ? ' Optional: the lesson completes whether or not they share.'
                  : ' Required: the lesson will not complete until they share. A student with no LinkedIn account cannot finish, and there is no way to exempt one.'}
              </p>
            </>
          )}
        </>
      )}
      {req.type === 'mcq' && (
        <div className="space-y-1">
          {opts.map((opt, oi) => {
            const letter = String.fromCharCode(65 + oi);
            const isCorrect = req.correctAnswer === opt && opt !== '';
            return (
              <div key={oi} className="flex items-center gap-2">
                <button
                  onClick={() => opt && update({ correctAnswer: opt })}
                  title={opt ? `Mark "${letter}" as correct answer` : 'Fill in this option first'}
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all"
                  style={{ background: isCorrect ? C.cta : C.input, border: `1.5px solid ${isCorrect ? C.cta : 'transparent'}`, color: isCorrect ? 'white' : C.muted }}>
                  {letter}
                </button>
                <input value={opt}
                  onChange={e => {
                    const newOpts = [...opts]; newOpts[oi] = e.target.value;
                    // The answer follows its option when that option is renamed. An empty option is never
                    // the answer, so typing into one cannot pick it by accident.
                    update({ options: newOpts, correctAnswer: opt && req.correctAnswer === opt ? e.target.value : req.correctAnswer });
                  }}
                  className="flex-1 bg-transparent text-sm outline-none"
                  style={{ ...inp, background: C.input, padding: '4px 8px', fontSize: 12, borderColor: isCorrect ? C.cta : 'transparent', color: isCorrect ? C.cta : C.text, fontWeight: isCorrect ? 600 : 400 }}
                  placeholder={`Option ${letter}`} />
              </div>
            );
          })}
          <p className="text-[12px] pt-1" style={{ color: C.muted }}>{req.correctAnswer ? `Correct answer: ${req.correctAnswer}` : 'Click a letter to mark the correct answer.'}</p>
        </div>
      )}
      {req.type === 'scenario_update' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
          <Clock className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
          <span>Renders as a Slack/Teams-style project-room message. Use it for client changes, new constraints, or stakeholder requests.</span>
        </div>
      )}
      {req.type === 'decision' && (() => {
        const decisionOptions = req.options?.length ? req.options : ['', '', ''];
        const decisionFeedback = decisionOptions.map((_, i) => req.optionFeedback?.[i] ?? '');
        const updateDecisionOption = (index: number, value: string) => {
          const nextOptions = [...decisionOptions];
          nextOptions[index] = value;
          update({
            options: nextOptions,
            optionFeedback: decisionFeedback,
            correctAnswer: decisionOptions[index] && req.correctAnswer === decisionOptions[index] ? value : req.correctAnswer,
          });
        };
        const updateDecisionFeedback = (index: number, value: string) => {
          const nextFeedback = [...decisionFeedback];
          nextFeedback[index] = value;
          update({ optionFeedback: nextFeedback });
        };
        const addDecisionOption = () => {
          update({
            options: [...decisionOptions, ''],
            optionFeedback: [...decisionFeedback, ''],
          });
        };
        const removeDecisionOption = (index: number) => {
          const removed = decisionOptions[index];
          update({
            options: decisionOptions.filter((_, i) => i !== index),
            optionFeedback: decisionFeedback.filter((_, i) => i !== index),
            correctAnswer: req.correctAnswer === removed ? '' : req.correctAnswer,
          });
        };

        return (
          <div className="space-y-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
              <PenLine className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
              Renders as a team-chat thread. Students reply with one option and see scripted stakeholder feedback.
            </div>
            {decisionOptions.map((opt, oi) => {
              const letter = String.fromCharCode(65 + oi);
              const recommended = req.correctAnswer === opt && opt !== '';
              return (
                <div key={oi} className="rounded-lg p-2 space-y-2" style={{ background: C.card, border: `1px solid ${recommended ? tc.color : C.inputBorder}` }}>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => opt && update({ correctAnswer: opt })}
                      title={opt ? `Mark option ${letter} as the recommended path` : 'Fill in this option first'}
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[12px] font-bold flex-shrink-0 transition-all"
                      style={{ background: recommended ? C.cta : C.input, border: `1.5px solid ${recommended ? C.cta : 'transparent'}`, color: recommended ? 'white' : C.muted }}>
                      {letter}
                    </button>
                    <input
                      value={opt}
                      onChange={e => updateDecisionOption(oi, e.target.value)}
                      className="flex-1 bg-transparent text-sm outline-none"
                      style={{ ...inp, background: C.input, padding: '4px 8px', fontSize: 12, color: C.text }}
                      placeholder={`Decision option ${letter}...`}
                    />
                    {decisionOptions.length > 2 && (
                      <button type="button" onClick={() => removeDecisionOption(oi)} className="hover:text-red-400 flex-shrink-0" style={{ color: C.faint }}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <input
                    value={decisionFeedback[oi] || ''}
                    onChange={e => updateDecisionFeedback(oi, e.target.value)}
                    style={{ ...inp, background: C.input, fontSize: 12 }}
                    placeholder="Scripted feedback shown after this choice..."
                  />
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-2">
              {req.correctAnswer && <p className="text-[12px]" style={{ color: C.muted }}>Recommended path: {req.correctAnswer}</p>}
              {decisionOptions.length < 5 && (
                <button type="button" onClick={addDecisionOption}
                  className="ml-auto text-[12px] flex items-center gap-1 hover:opacity-70 font-medium" style={{ color: C.muted }}>
                  <Plus className="w-3 h-3" /> Add option
                </button>
              )}
            </div>
          </div>
        );
      })()}
      {req.type === 'debrief' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: tc.bg, color: C.muted }}>
          <FileText className="w-3 h-3 flex-shrink-0" style={{ color: tc.color }} />
          Renders as an email composer addressed to the manager. Students send their update or recommendation.
        </div>
      )}
      {req.type === 'upload' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.pill, color: C.muted }}>
            <LinkIcon className="w-3 h-3 flex-shrink-0" />Students will upload a file or paste a link
          </div>
          {/* Read by the AI draft of the instructor report when the student uploads an Excel workbook. */}
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Worksheets to review (optional, Excel uploads)</p>
            <textarea
              value={(req.reviewSheetNames ?? []).join('\n')}
              onChange={e => update({ reviewSheetNames: e.target.value.split('\n') })}
              rows={3}
              spellCheck={false}
              placeholder={'One worksheet per line\nRevenue Forecast\nSummary Dashboard'}
              className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
              style={{ background: C.input, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
            />
            <p className="text-[11px] mt-1" style={{ color: C.muted }}>When you draft a report with AI, only these worksheets are read. Leave blank to read the first 5.</p>
          </div>
          <RubricBuilder
            {...rubricProps}
            sheetNames={req.reviewSheetNames}
            grader="you mark each criterion as met or not met"
            note="With criteria set, your file report is graded on them: the AI draft gives each one a verdict, and the score is the share of criteria met."
          />
        </div>
      )}
      {req.type === 'text' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.pill, color: C.muted }}>
            <FileText className="w-3 h-3 flex-shrink-0" />Students will type a written response
          </div>
          {/* AI Review toggle */}
          <button
            type="button"
            onClick={() => update({ aiReview: !req.aiReview, expectedAnswer: undefined })}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[11px] font-semibold transition-all"
            style={{
              background: req.aiReview ? 'rgba(0,185,92,0.12)' : 'rgba(0,0,0,0.04)',
              color: req.aiReview ? '#00b95c' : C.muted,
              border: `1px solid ${req.aiReview ? '#00b95c40' : 'transparent'}`,
            }}>
            <span style={{ width: 26, height: 14, borderRadius: 7, background: req.aiReview ? '#00b95c' : '#ccc', display: 'inline-flex', alignItems: 'center', padding: '0 2px', transition: 'background 0.2s', flexShrink: 0 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#fff', marginLeft: req.aiReview ? 'auto' : 0, transition: 'margin 0.2s', display: 'block' }} />
            </span>
            AI Review {req.aiReview ? 'on -- AI will grade student answers' : 'off -- using exact match'}
          </button>
          {req.aiReview ? (<>
            <input value={req.context || ''} onChange={e => update({ context: e.target.value })}
              style={{ ...inp, background: C.input, fontSize: 12 }} placeholder="Rubric / grading guidance for AI (e.g. 'Award points for mentioning X and Y...')..." />
            {passMark("60", "Out of 100. Leave blank for 60.")}
            <RubricBuilder
              {...rubricProps}
              note="With criteria set, the answer is marked met or not met on each one, and the score is the share of criteria met."
            />
          </>) : (
            <input value={req.expectedAnswer || ''} onChange={e => update({ expectedAnswer: e.target.value })}
              style={{ ...inp, background: C.input, fontSize: 12 }} placeholder="Expected answer for exact match (optional -- leave blank to accept any response)..." />
          )}
        </div>
      )}
      {req.type === 'task' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
          <Check className="w-3 h-3 flex-shrink-0" />Students tick a checkbox to confirm completion
        </div>
      )}
      {req.type === 'dashboard_critique' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
            <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
            Students upload a dashboard screenshot. AI critiques every element and delivers a full audit report
          </div>
          <RubricBuilder
            {...rubricProps}
          />
        </div>
      )}
      {req.type === 'code_review' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
            <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
            Students paste their code. AI reviews correctness, quality, efficiency, and best practices with line-level feedback
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Language</p>
            <MenuSelect label="Language for this code task" C={C} value={req.reviewLanguage ?? ''} onChange={value => update({ reviewLanguage: value || undefined })}
              options={[{ value: '', label: 'Learner chooses' }, ...LOCKABLE_CODE_REVIEW_LANGUAGES.map(lang => ({ value: lang, label: lang }))]} />
            <p className="text-[11px] mt-1" style={{ color: C.muted }}>Pick a language to fix it for learners. They will not be able to switch.</p>
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Table schema or data context (optional)</p>
            <textarea
              value={req.schema ?? ''}
              onChange={e => update({ schema: e.target.value })}
              rows={4}
              spellCheck={false}
              placeholder="Paste CREATE TABLE statements or describe the DataFrame columns. The AI uses this to validate student code against the actual schema."
              className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
              style={{ background: C.input, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
            />
          </div>
          {passMark("70", "Out of 100. Leave blank for no gate.")}
          <RubricBuilder
            {...rubricProps}
          />
        </div>
      )}
      {req.type === 'excel_review' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
            <Star className="w-3 h-3 flex-shrink-0" style={{ color: C.muted }} />
            Students upload their .xlsx file. AI reviews formula correctness, formula choice, and value accuracy.
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Spreadsheet context (optional)</p>
            <textarea
              value={req.context ?? ''}
              onChange={e => update({ context: e.target.value })}
              rows={4}
              spellCheck={false}
              placeholder="Include the domain so the AI applies the right expertise. e.g. This is a financial model for a retail business. B5 should calculate total revenue using SUMIF on column D, C10 should show profit margin as a percentage. Or: This is an HR payroll sheet. Column F should calculate net pay after tax deductions. Or: This is a BI sales dashboard for a fintech company. D12 should show month-on-month growth using XLOOKUP."
              className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
              style={{ background: C.input, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
            />
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Worksheets to evaluate (optional)</p>
            <textarea
              value={(req.reviewSheetNames ?? []).join('\n')}
              onChange={e => update({ reviewSheetNames: e.target.value.split('\n') })}
              rows={3}
              spellCheck={false}
              placeholder={'One worksheet per line\nRevenue Forecast\nSummary Dashboard'}
              className="w-full resize-none outline-none text-[12px] font-mono px-3 py-3 rounded-lg"
              style={{ background: C.input, color: C.text, border: '1.5px solid transparent', lineHeight: 1.6 }}
            />
          </div>
          {passMark("70", "Out of 100. Leave blank for no gate.")}
          <RubricBuilder
            {...rubricProps}
            sheetNames={req.reviewSheetNames}
            note="With criteria set, the pass mark measures the share of criteria the workbook meets, not the general quality score."
          />
        </div>
      )}
      {req.type === 'document_review' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px]" style={{ background: C.card, color: C.muted }}>
            <FileText className="w-3 h-3 flex-shrink-0" />Students upload a PDF, Word document, or text file for rubric-based review.
          </div>
          <div>
            <p className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Document context</p>
            <textarea value={req.context ?? ''} onChange={e => update({ context: e.target.value })} rows={3}
              placeholder="Describe the intended audience, purpose, and any important requirements."
              className="w-full resize-none outline-none text-[12px] px-3 py-3 rounded-lg" style={{ background: C.input, color: C.text, border: '1.5px solid transparent' }} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <MenuSelect<NonNullable<Requirement['documentReviewMode']>> label="Review" C={C} value={req.documentReviewMode ?? 'ai_only'} onChange={mode => update({ documentReviewMode: mode })}
              options={[{ value: 'ai_only', label: 'AI review' }, { value: 'manual', label: 'Instructor review' }, { value: 'hybrid', label: 'AI + instructor review' }]} />
            {passMark("70", "Out of 100.")}
          </div>
          <RubricBuilder {...rubricProps} />
        </div>
      )}
    </>
  );
}
