'use client';

// Knowledge check: an inline, UNGRADED multiple-choice question with instant
// feedback. It lives inside the lesson doc, so it is entirely separate from the
// course's graded `questions`/score system -- answering it never affects the score.
//
// Atom node: all data lives in attrs (question / options / correctIndex /
// explanation), edited via inputs in the editor and answered in the player. Theming
// is via `.lesson-check` CSS (see LessonContentStyles).

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Check, Plus, X, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { ColorField, Segmented, StyleMenu, MenuRow, BORDER_STYLE_OPTIONS, type BorderStyle } from '@/components/lesson/nodes/StyleControls';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { LayeredBadgeIcon } from '@/components/lesson/LayeredBadgeIcon';

function KnowledgeVerificationIcon() {
  return (
    <LayeredBadgeIcon>
      <path d="m6.5 12.7 1.7 1.8 3.2-3.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M13.3 11.2h3.1M13.3 14.6h3.1" stroke="#fff" strokeWidth="1.65" strokeLinecap="round" opacity="0.92" />
    </LayeredBadgeIcon>
  );
}

function KnowledgeCheckView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const question = (node.attrs.question as string) || '';
  const options = (node.attrs.options as string[]) || [];
  const correctIndex = (node.attrs.correctIndex as number) ?? 0;
  const explanation = (node.attrs.explanation as string) || '';
  const borderStyle = (node.attrs.borderStyle as BorderStyle) || 'none';
  const borderColor = (node.attrs.borderColor as string) || '';
  const wrapperStyle: React.CSSProperties = borderStyle === 'none'
    ? { border: 'none' }
    : { borderStyle, borderWidth: 1, borderColor: borderColor || 'var(--check-border)' };

  const [selected, setSelected] = useState<number | null>(null);
  const submitted = selected !== null;

  const onSelect = (i: number) => setSelected(i);

  const setOption = (i: number, value: string) =>
    updateAttributes({ options: options.map((o, j) => (j === i ? value : o)) });

  const addOption = () => updateAttributes({ options: [...options, ''] });

  const removeOption = (i: number) => {
    if (options.length <= 2) return;
    const next = options.filter((_, j) => j !== i);
    const nextCorrect = correctIndex === i ? 0 : correctIndex > i ? correctIndex - 1 : correctIndex;
    updateAttributes({ options: next, correctIndex: nextCorrect });
  };

  if (editable) {
    return (
      <NodeViewWrapper className="lesson-check" data-editing="true" contentEditable={false} style={wrapperStyle}>
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
            </StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="knowledge check" />
          </span>
        </div>
        <NodeTextInput
          className="lesson-check__q-input"
          value={question}
          placeholder="Ask a clear question..."
          onCommit={(v) => updateAttributes({ question: v })}
        />
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
        <NodeTextInput
          multiline
          className="lesson-check__explain-input"
          value={explanation}
          placeholder="Explain why the correct answer is right (shown after answering)..."
          onCommit={(v) => updateAttributes({ explanation: v })}
        />
      </NodeViewWrapper>
    );
  }

  const state = submitted ? (selected === correctIndex ? 'correct' : 'incorrect') : 'idle';

  return (
    <NodeViewWrapper className="lesson-check" data-state={state} contentEditable={false} style={wrapperStyle}>
      <div className="lesson-check__learner-head">
        <span className="lesson-check__identity-icon"><KnowledgeVerificationIcon /></span>
        <div><span className="lesson-check__eyebrow">Knowledge check</span><span className="lesson-check__instruction">Choose the best answer</span></div>
      </div>
      {question && <p className="lesson-check__question">{question}</p>}
      <div className="lesson-check__options" role="group" aria-label={question || 'Knowledge check answers'}>
        {options.map((opt, i) => {
          const showCorrect = submitted && i === correctIndex;
          const showWrong = submitted && selected === i && i !== correctIndex;
          return (
            <button
              key={i}
              type="button"
              className="lesson-check__option"
              data-correct={showCorrect ? 'true' : 'false'}
              data-wrong={showWrong ? 'true' : 'false'}
              data-chosen={selected === i ? 'true' : 'false'}
              disabled={submitted}
              aria-pressed={selected === i}
              onClick={() => onSelect(i)}
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
      {submitted && (
        <div className="lesson-check__feedback" data-kind={state} role="status" aria-live="polite">
          <span className="lesson-check__feedback-icon" aria-hidden="true">
            {selected === correctIndex ? <CheckCircle2 width={18} height={18} /> : <XCircle width={18} height={18} />}
          </span>
          <div className="lesson-check__feedback-copy">
            <p className="lesson-check__verdict">{selected === correctIndex ? 'Correct' : 'Not quite'}</p>
            <p className="lesson-check__explain">{explanation || (selected === correctIndex ? 'You selected the best answer.' : 'Review the options and try once more.')}</p>
          </div>
          <button type="button" className="lesson-check__retry" onClick={() => setSelected(null)}>
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
      options: { default: ['', ''] },
      correctIndex: { default: 0 },
      explanation: { default: '' },
      borderStyle: { default: 'none' },
      borderColor: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-knowledge-check]' }];
  },

  // Fallback HTML: question + options (correct one marked) + explanation. All tags
  // are sanitizer-allowed; the wrapper div is stripped but its children are kept.
  renderHTML({ node, HTMLAttributes }) {
    const options = (node.attrs.options as string[]) || [];
    const correctIndex = (node.attrs.correctIndex as number) ?? 0;
    const explanation = (node.attrs.explanation as string) || '';
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-knowledge-check': '' }),
      ['p', ['strong', (node.attrs.question as string) || '']],
      ['ul', ...options.map((o, i) => ['li', `${i === correctIndex ? '(correct) ' : ''}${o}`])],
      ...(explanation ? [['p', ['em', explanation]]] : []),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(KnowledgeCheckView);
  },
});
