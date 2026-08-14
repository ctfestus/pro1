'use client';

// Knowledge check: an inline, UNGRADED practice question with instant feedback. It lives inside the
// lesson doc, so it is entirely separate from the course's graded `questions`/score system --
// answering it never affects the score.
//
// Three formats, chosen per block via the `format` attr:
//   choice  - multiple choice against `correctIndex` (the original, and the default for old blocks)
//   fill    - the student types a short answer, matched against `acceptedAnswers`
//   written - the student writes a longer response and it is reviewed against the standard the
//             author supplied (/api/written-review, brief). `gradingMode` picks that standard:
//               'manual': the author's `expectedAnswer`, which is then revealed for comparison
//               'ai':     the author's `rubric`, graded criterion by criterion
//
// Atom node: all data lives in attrs, edited via inputs in the editor and answered in the player.
// Theming is via `.lesson-check` CSS (see LessonContentStyles).

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Check, Plus, X, CheckCircle2, XCircle, RotateCcw, Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, accentScope, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { LayeredBadgeIcon } from '@/components/lesson/LayeredBadgeIcon';

type CheckFormat = 'choice' | 'fill' | 'written';
type WrittenGrading = 'manual' | 'ai';

const FORMAT_OPTIONS: { value: CheckFormat; label: string }[] = [
  { value: 'choice',  label: 'Choice' },
  { value: 'fill',    label: 'Fill in' },
  { value: 'written', label: 'Written' },
];

// Both modes are AI-reviewed. What differs is what the author supplies as the standard: a model
// answer (which is also revealed to the student afterwards) or a list of rubric criteria.
const GRADING_OPTIONS: { value: WrittenGrading; label: string }[] = [
  { value: 'manual', label: 'Model answer' },
  { value: 'ai',     label: 'Rubric' },
];

// Mirrors MAX_ANSWER_CHARS in app/api/written-review/route.ts.
const MAX_WRITTEN_CHARS = 6000;

// A brief AI review: score out of 100, a short summary, and one verdict per rubric criterion.
interface BriefReview {
  overallScore: number;
  executiveSummary: string;
  rubricGrades?: { criterion: string; passed: boolean; comment: string }[];
}

function KnowledgeVerificationIcon() {
  return (
    <LayeredBadgeIcon>
      <path d="m6.5 12.7 1.7 1.8 3.2-3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.3 11.2h3.1M13.3 14.6h3.1" stroke="#fff" strokeWidth="1.65" strokeLinecap="round" opacity="0.92" />
    </LayeredBadgeIcon>
  );
}

/** Answer comparison for the fill-in format: case, surrounding space, and inner run-length insensitive. */
function normalizeFill(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function KnowledgeCheckView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const question = (node.attrs.question as string) || '';
  const options = (node.attrs.options as string[]) || [];
  const correctIndex = (node.attrs.correctIndex as number) ?? 0;
  const explanation = (node.attrs.explanation as string) || '';
  const format = ((node.attrs.format as CheckFormat) || 'choice');
  const acceptedAnswers = (node.attrs.acceptedAnswers as string[]) || [];
  const gradingMode = ((node.attrs.gradingMode as WrittenGrading) || 'manual');
  const expectedAnswer = (node.attrs.expectedAnswer as string) || '';
  const rubric = (node.attrs.rubric as string[]) || [];
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'none';
  const borderColor = (node.attrs.borderColor as string) || '';
  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the badge icon, the eyebrow, option hover, and the correct-answer toggle.
  const accent = accentScope(accentColor);
  const wrapperStyle: React.CSSProperties = {
    ...(borderStyle === 'none'
      ? { border: 'none' }
      : { borderStyle, borderWidth: 1, borderColor: borderColor || 'var(--check-border)' }),
    ...accent.style,
  };

  const [selected, setSelected] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [textSubmitted, setTextSubmitted] = useState(false);
  const [review, setReview] = useState<BriefReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const setOption = (i: number, value: string) =>
    updateAttributes({ options: options.map((o, j) => (j === i ? value : o)) });

  const addOption = () => updateAttributes({ options: [...options, ''] });

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, j) => j !== i);
    const nextCorrect = correctIndex === i ? 0 : correctIndex > i ? correctIndex - 1 : correctIndex;
    updateAttributes({ options: next, correctIndex: nextCorrect });
  };

  // A fresh format keeps whatever that format needs seeded, so the author never lands on an
  // empty editor with no field to fill in.
  const changeFormat = (next: CheckFormat) => {
    if (next === format) return;
    updateAttributes({
      format: next,
      ...(next === 'fill' && acceptedAnswers.length === 0 ? { acceptedAnswers: [''] } : {}),
      ...(next === 'written' && gradingMode === 'ai' && rubric.length === 0 ? { rubric: [''] } : {}),
    });
    clearAnswer();
  };

  const changeGrading = (next: WrittenGrading) => {
    if (next === gradingMode) return;
    updateAttributes({
      gradingMode: next,
      ...(next === 'ai' && rubric.length === 0 ? { rubric: [''] } : {}),
    });
    clearAnswer();
  };

  // Learner "Try again": drop the verdict but KEEP what was typed. The feedback is about that
  // answer, so the student revises it -- wiping it would make them retype from memory to act on
  // a note like "add a specific example". Matches WrittenResponsePlayer's reset.
  function retryAnswer() {
    setSelected(null);
    setTextSubmitted(false);
    setReview(null);
    setReviewing(false);
    setReviewError('');
  }

  // Editor-side switch: here the typed text belongs to a format that no longer exists, so it goes.
  function clearAnswer() {
    retryAnswer();
    setTyped('');
  }

  // -- Editor list helpers (accepted answers / rubric criteria share one shape) --
  const listEditor = (
    values: string[],
    attr: 'acceptedAnswers' | 'rubric',
    placeholder: string,
    addLabel: string,
  ) => (
    <>
      <div className="lesson-check__options">
        {values.map((value, i) => (
          <div key={i} className="lesson-check__opt-edit">
            <NodeTextInput
              className="lesson-check__opt-input"
              value={value}
              placeholder={`${placeholder} ${i + 1}`}
              onCommit={(v) => updateAttributes({ [attr]: values.map((o, j) => (j === i ? v : o)) })}
            />
            {values.length > 1 && (
              <button
                type="button"
                className="lesson-check__opt-remove"
                aria-label={`Remove ${placeholder.toLowerCase()}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => updateAttributes({ [attr]: values.filter((_, j) => j !== i) })}
              >
                <X width={12} height={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="lesson-check__add"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => updateAttributes({ [attr]: [...values, ''] })}
      >
        <Plus width={13} height={13} /> {addLabel}
      </button>
    </>
  );

  if (editable) {
    return (
      <NodeViewWrapper className={`lesson-check ${accent.className}`.trim()} data-editing="true" contentEditable={false} style={wrapperStyle}>
        <div className="lesson-check__bar">
          <div className="lesson-check__identity">
            <span className="lesson-check__identity-icon"><KnowledgeVerificationIcon /></span>
            <span><strong>Knowledge check</strong><small>Ungraded practice</small></span>
          </div>
          <span className="lesson-block-actions">
            <StyleMenu>
              <MenuRow label="Border"><Segmented<BorderStyle> value={borderStyle} onChange={(v) => updateAttributes({ borderStyle: v })} options={BORDER_STYLE_OPTIONS} /></MenuRow>
              {borderStyle !== 'none' && (
                <MenuRow label="Color"><ColorField value={borderColor} onChange={(v) => updateAttributes({ borderColor: v })} /></MenuRow>
              )}
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Check accent" /></MenuRow>
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="knowledge check" />
          </span>
        </div>

        <div className="lesson-check__config">
          <span className="lesson-check__config-label">Answer format</span>
          <Segmented<CheckFormat> value={format} onChange={changeFormat} options={FORMAT_OPTIONS} />
        </div>

        <NodeTextInput
          className="lesson-check__q-input"
          value={question}
          placeholder="Ask a clear question..."
          onCommit={(v) => updateAttributes({ question: v })}
        />

        {format === 'choice' && (
          <>
            <div className="lesson-check__options">
              {options.map((opt, i) => (
                <div key={i} className="lesson-check__opt-edit">
                  <button
                    type="button"
                    className="lesson-check__correct-toggle"
                    data-correct={i === correctIndex ? 'true' : 'false'}
                    aria-label={`Mark option ${i + 1} as correct`}
                    aria-pressed={i === correctIndex}
                    title="Mark as correct answer"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => updateAttributes({ correctIndex: i })}
                  >
                    {i === correctIndex ? <Check width={12} height={12} /> : null}
                  </button>
                  <NodeTextInput
                    className="lesson-check__opt-input"
                    value={opt}
                    placeholder={`Option ${i + 1}`}
                    onCommit={(v) => setOption(i, v)}
                  />
                  <span className="lesson-check__option-number" aria-hidden="true">{i + 1}</span>
                  {options.length > 2 && (
                    <button
                      type="button"
                      className="lesson-check__opt-remove"
                      aria-label="Remove option"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => removeOption(i)}
                    >
                      <X width={12} height={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="lesson-check__add"
              onMouseDown={(event) => event.preventDefault()}
              onClick={addOption}
            >
              <Plus width={13} height={13} /> Add option
            </button>
          </>
        )}

        {format === 'fill' && (
          <>
            <span className="lesson-check__field-label">Accepted answers <small>any one counts as correct; case and spacing are ignored</small></span>
            {listEditor(acceptedAnswers.length ? acceptedAnswers : [''], 'acceptedAnswers', 'Answer', 'Add accepted answer')}
          </>
        )}

        {format === 'written' && (
          <>
            <div className="lesson-check__config">
              <span className="lesson-check__config-label">Grade against</span>
              <Segmented<WrittenGrading> value={gradingMode} onChange={changeGrading} options={GRADING_OPTIONS} />
            </div>
            {gradingMode === 'manual' ? (
              <>
                <span className="lesson-check__field-label">Expected response <small>the answer is scored against this, then it is shown to the student</small></span>
                <NodeTextInput
                  multiline
                  className="lesson-check__explain-input"
                  value={expectedAnswer}
                  placeholder="What a strong answer covers..."
                  onCommit={(v) => updateAttributes({ expectedAnswer: v })}
                />
              </>
            ) : (
              <>
                <span className="lesson-check__field-label">Rubric criteria <small>the answer is graded criterion by criterion</small></span>
                {listEditor(rubric.length ? rubric : [''], 'rubric', 'Criterion', 'Add criterion')}
              </>
            )}
          </>
        )}

        <span className="lesson-check__field-label">
          {format === 'written' ? 'Closing note' : 'Explanation'} <small>shown to the student after they answer</small>
        </span>
        <NodeTextInput
          multiline
          className="lesson-check__explain-input"
          value={explanation}
          placeholder={format === 'written'
            ? 'Add a closing note for the student...'
            : 'Explain why the correct answer is right...'}
          onCommit={(v) => updateAttributes({ explanation: v })}
        />
      </NodeViewWrapper>
    );
  }

  // -- Learner view --

  const accepted = acceptedAnswers.filter((a) => a.trim());
  // An author can leave the accepted-answer list empty. Without a key there is nothing to be wrong
  // against, so the block degrades to a self-check instead of marking every answer incorrect.
  const fillHasKey = accepted.length > 0;
  const fillCorrect = fillHasKey && accepted.some((a) => normalizeFill(a) === normalizeFill(typed));
  // Model-answer mode reveals the expected response after the review; rubric mode lists the
  // per-criterion verdicts instead. Both are reviewed.
  const revealsModel = format === 'written' && gradingMode === 'manual';

  const answered = format === 'choice' ? selected !== null : textSubmitted;
  const state = !answered
    ? 'idle'
    : format === 'choice'
      ? (selected === correctIndex ? 'correct' : 'incorrect')
      : format === 'fill'
        ? (!fillHasKey ? 'correct' : fillCorrect ? 'correct' : 'incorrect')
        : (review ? (review.overallScore >= 60 ? 'correct' : 'incorrect') : 'idle');

  const instruction = format === 'choice'
    ? 'Choose the best answer'
    : format === 'fill'
      ? 'Type your answer'
      : 'Write your response for feedback';

  async function submitWritten() {
    const answer = typed.trim();
    if (!answer) return;
    setReviewing(true);
    setReviewError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/written-review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          depth: 'brief',
          question,
          // The author supplied one standard or the other; send whichever this block uses.
          ...(revealsModel
            ? { expectedAnswer }
            : { rubric: rubric.filter((c) => c.trim()) }),
          studentAnswer: answer.slice(0, MAX_WRITTEN_CHARS),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setReview(json);
      setTextSubmitted(true);
    } catch (err: any) {
      setReviewError(err?.message || 'Could not get feedback right now. Please try again.');
    } finally {
      setReviewing(false);
    }
  }

  const verdictLabel = format === 'written'
    ? (state === 'correct' ? 'Good answer' : 'Not quite yet')
    : format === 'fill' && !fillHasKey
      ? 'Answer recorded'
      : (state === 'correct' ? 'Correct' : 'Not quite');

  const verdictCopy = format === 'written'
    ? (review?.executiveSummary || explanation)
    : format === 'fill' && !fillHasKey
      ? explanation
      : (explanation || (state === 'correct'
        ? (format === 'fill' ? 'That matches the expected answer.' : 'You selected the best answer.')
        : (format === 'fill' ? `The expected answer is: ${accepted[0]}` : 'Review the options and try once more.')));

  return (
    <NodeViewWrapper className={`lesson-check ${accent.className}`.trim()} data-state={state} contentEditable={false} style={wrapperStyle}>
      <div className="lesson-check__learner-head">
        <span className="lesson-check__identity-icon"><KnowledgeVerificationIcon /></span>
        <div><span className="lesson-check__eyebrow">Knowledge check</span><span className="lesson-check__instruction">{instruction}</span></div>
      </div>
      {question && <p className="lesson-check__question">{question}</p>}

      {format === 'choice' && (
        <div className="lesson-check__options" role="group" aria-label={question || 'Knowledge check answers'}>
          {options.map((opt, i) => {
            const showCorrect = answered && i === correctIndex;
            const showWrong = answered && selected === i && i !== correctIndex;
            return (
              <button
                key={i}
                type="button"
                className="lesson-check__option"
                data-correct={showCorrect ? 'true' : 'false'}
                data-wrong={showWrong ? 'true' : 'false'}
                data-chosen={selected === i ? 'true' : 'false'}
                disabled={answered}
                aria-pressed={selected === i}
                onClick={() => setSelected(i)}
              >
                <span className="lesson-check__opt-text">{opt}</span>
                <span className="lesson-check__option-end" aria-hidden="true">
                  {showCorrect ? <Check width={14} height={14} /> : showWrong ? <X width={14} height={14} /> : null}
                  <span className="lesson-check__option-number">{i + 1}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {format === 'fill' && (
        <form
          className="lesson-check__answer-form"
          onSubmit={(e) => { e.preventDefault(); if (typed.trim()) setTextSubmitted(true); }}
        >
          <input
            className="lesson-check__answer-input"
            value={typed}
            disabled={answered}
            placeholder="Your answer"
            aria-label={question || 'Your answer'}
            onChange={(e) => setTyped(e.target.value)}
          />
          {!answered && (
            <button type="submit" className="lesson-check__submit" disabled={!typed.trim()}>Check answer</button>
          )}
        </form>
      )}

      {format === 'written' && (
        <div className="lesson-check__answer-form" data-multiline="true">
          <textarea
            className="lesson-check__answer-input"
            value={typed}
            rows={5}
            maxLength={MAX_WRITTEN_CHARS}
            disabled={answered}
            placeholder="Write your response..."
            aria-label={question || 'Your response'}
            onChange={(e) => setTyped(e.target.value)}
          />
          {!answered && (
            <button type="button" className="lesson-check__submit" disabled={!typed.trim() || reviewing} onClick={submitWritten}>
              {reviewing
                ? <><Loader2 width={13} height={13} className="lesson-check__spin" /> Reviewing...</>
                : <><Sparkles width={13} height={13} /> Check my answer</>}
            </button>
          )}
          {reviewError && <p className="lesson-check__error" role="status">{reviewError}</p>}
        </div>
      )}

      {answered && (
        <div className="lesson-check__feedback" data-kind={state === 'idle' ? 'correct' : state} role="status" aria-live="polite">
          <span className="lesson-check__feedback-icon" aria-hidden="true">
            {state === 'incorrect' ? <XCircle width={18} height={18} /> : <CheckCircle2 width={18} height={18} />}
          </span>
          <div className="lesson-check__feedback-copy">
            <p className="lesson-check__verdict">
              {verdictLabel}
              {format === 'written' && review && <span className="lesson-check__score">{Math.round(review.overallScore)}/100</span>}
            </p>
            {verdictCopy && <p className="lesson-check__explain">{verdictCopy}</p>}
            {revealsModel && expectedAnswer && (
              <div className="lesson-check__model">
                <span className="lesson-check__model-label">Expected response</span>
                <p>{expectedAnswer}</p>
              </div>
            )}
            {!revealsModel && review?.rubricGrades && review.rubricGrades.length > 0 && (
              <ul className="lesson-check__rubric">
                {review.rubricGrades.map((grade, i) => (
                  <li key={i} data-passed={grade.passed ? 'true' : 'false'}>
                    <span className="lesson-check__rubric-icon" aria-hidden="true">
                      {grade.passed ? <Check width={11} height={11} /> : <X width={11} height={11} />}
                    </span>
                    <span><strong>{grade.criterion}</strong>{grade.comment ? ` -- ${grade.comment}` : ''}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="lesson-check__retry" onClick={retryAnswer}>
            <RotateCcw width={13} height={13} aria-hidden="true" /> Try again
          </button>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const KnowledgeCheck = Node.create({
  name: 'knowledgeCheck',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      question: { default: '' },
      // format defaults to 'choice' so every block authored before the fill-in / written formats
      // existed keeps rendering exactly as it did.
      format: { default: 'choice' },
      options: { default: ['', ''] },
      correctIndex: { default: 0 },
      acceptedAnswers: { default: [] },
      gradingMode: { default: 'manual' },
      expectedAnswer: { default: '' },
      rubric: { default: [] },
      explanation: { default: '' },
      borderStyle: { default: 'none' },
      borderColor: { default: '' },
      // Empty = follow the tenant accent, so untouched blocks are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-knowledge-check]' }];
  },

  // Fallback HTML: the question plus whatever answer key the format carries, then the explanation.
  // All tags are sanitizer-allowed; the wrapper div is stripped but its children are kept.
  renderHTML({ node, HTMLAttributes }) {
    const format = (node.attrs.format as CheckFormat) || 'choice';
    const options = (node.attrs.options as string[]) || [];
    const correctIndex = (node.attrs.correctIndex as number) ?? 0;
    const accepted = ((node.attrs.acceptedAnswers as string[]) || []).filter(Boolean);
    const rubric = ((node.attrs.rubric as string[]) || []).filter(Boolean);
    const expectedAnswer = (node.attrs.expectedAnswer as string) || '';
    const explanation = (node.attrs.explanation as string) || '';

    const answerBlock: any[] = [];
    if (format === 'choice') {
      answerBlock.push(['ul', ...options.map((o, i) => ['li', `${i === correctIndex ? '(correct) ' : ''}${o}`])]);
    } else if (format === 'fill') {
      if (accepted.length) answerBlock.push(['ul', ...accepted.map((a) => ['li', `(accepted) ${a}`])]);
    } else if (expectedAnswer) {
      answerBlock.push(['p', ['em', `Expected response: ${expectedAnswer}`]]);
    } else if (rubric.length) {
      answerBlock.push(['ul', ...rubric.map((c) => ['li', `(criterion) ${c}`])]);
    }

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-knowledge-check': '' }),
      ['p', ['strong', (node.attrs.question as string) || '']],
      ...answerBlock,
      ...(explanation ? [['p', ['em', explanation]]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(KnowledgeCheckView);
  },
});
