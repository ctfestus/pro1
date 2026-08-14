'use client';

// A reusable AI prompt card for lessons. Authors edit the title and prompt in the
// same TipTap surface students later use. Provider links only prefill a new chat;
// learners always review and submit the prompt themselves.

import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import {
  Check,
  Copy,
  ExternalLink,
} from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { ColorField, MenuRow, StyleMenu, accentScope } from '@/components/lesson/nodes/StyleControls';
import {
  buildChatGptPromptUrl,
  buildClaudePromptUrl,
  CLAUDE_PROMPT_MAX_LENGTH,
} from '@/lib/prompt-links';
import { getToolIcon } from '@/lib/tool-icons';

type CopyState = 'idle' | 'copied' | 'failed';

const CHATGPT_ICON = getToolIcon('chatgpt');
const CLAUDE_ICON = getToolIcon('claude');

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permissions and embedded-browser policies can reject the modern API;
      // continue to the selection-based fallback before reporting failure.
    }
  }

  // Clipboard API can be unavailable in older/insecure browser contexts.
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy command was rejected');
}

function ProviderLink({
  href,
  className,
  label,
  title,
  children,
  showLabel = true,
}: {
  href: string | null;
  className: string;
  label: string;
  title: string;
  children: React.ReactNode;
  showLabel?: boolean;
}) {
  if (!href) {
    return (
      <span className={`${className} is-disabled`} aria-disabled="true" title={title}>
        {children}{showLabel && <span>{label}</span>}
      </span>
    );
  }

  return (
    <a
      className={className}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      title={title}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}{showLabel && <span>{label}</span>}<ExternalLink width={12} height={12} aria-hidden="true" />
    </a>
  );
}

function PromptBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const title = (node.attrs.title as string) || '';
  const prompt = (node.attrs.prompt as string) || '';
  const showChatGpt = node.attrs.showChatGpt !== false;
  const showClaude = node.attrs.showClaude !== false;
  const chatGptUrl = buildChatGptPromptUrl(prompt);
  const claudeUrl = buildClaudePromptUrl(prompt);
  const claudeTooLong = prompt.length > CLAUDE_PROMPT_MAX_LENGTH;
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
  }, []);

  const handleCopy = async () => {
    if (!prompt.trim()) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await copyText(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    resetTimer.current = setTimeout(() => setCopyState('idle'), 2200);
  };

  const accentColor = (node.attrs.accentColor as string) || '';
  // Drives the header identity and the copy / launch buttons.
  const accent = accentScope(accentColor);

  return (
    <NodeViewWrapper
      className={`lesson-prompt ${accent.className}`.trim()}
      style={accent.style}
      data-editing={editable ? 'true' : 'false'}
      contentEditable={false}
    >
      <div className="lesson-prompt__header">
        <div className="lesson-prompt__heading">
          <span className="lesson-prompt__eyebrow">Interactive prompt</span>
          {editable ? (
            <NodeTextInput
              className="lesson-prompt__title-input"
              value={title}
              placeholder="Try this prompt"
              onCommit={(value) => updateAttributes({ title: value })}
            />
          ) : (
            <p className="lesson-prompt__title">{title || 'Try this prompt'}</p>
          )}
        </div>
        <span className="lesson-block-actions" contentEditable={false}>
          <span className="lesson-prompt__status"><span /> Ready to explore</span>
          {editable && (
            <StyleMenu width={210}>
              <MenuRow label="Accent"><ColorField value={accentColor} onChange={(v) => updateAttributes({ accentColor: v })} title="Prompt accent" /></MenuRow>
            </StyleMenu>
          )}
          {editable && <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="AI prompt" />}
        </span>
      </div>

      <div className="lesson-prompt__surface">
        <div className="lesson-prompt__surface-bar">
          <span>Prompt</span>
          <span>{prompt.length.toLocaleString()} characters</span>
        </div>
        {editable ? (
          <NodeTextInput
            multiline
            className="lesson-prompt__input"
            value={prompt}
            placeholder="Write the prompt learners will copy or open in an AI chat..."
            onCommit={(value) => updateAttributes({ prompt: value })}
          />
        ) : (
          <pre className="lesson-prompt__text"><code>{prompt || 'No prompt has been added yet.'}</code></pre>
        )}
      </div>

      {editable && (
        <div className="lesson-prompt__provider-settings">
          <div className="lesson-prompt__provider-settings-label">
            <span>Student actions</span>
            <small>Copy is always available</small>
          </div>
          <div className="lesson-prompt__provider-toggles" role="group" aria-label="AI providers shown to students">
            <button
              type="button"
              role="switch"
              aria-checked={showChatGpt}
              data-active={showChatGpt ? 'true' : 'false'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ showChatGpt: !showChatGpt })}
            >
              <img src={CHATGPT_ICON} alt="" aria-hidden="true" />
              <span>ChatGPT</span>
              <i aria-hidden="true" />
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={showClaude}
              data-active={showClaude ? 'true' : 'false'}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => updateAttributes({ showClaude: !showClaude })}
            >
              <span>Claude</span>
              <i aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div className="lesson-prompt__footer">
        <div className="lesson-prompt__guidance">
          <span>{claudeTooLong ? 'This prompt is too long for a Claude handoff. Copy it instead.' : 'Review and personalize the prompt before sending.'}</span>
        </div>
        <div className="lesson-prompt__actions">
          <button
            type="button"
            className="lesson-prompt__button lesson-prompt__button--copy"
            disabled={!prompt.trim()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={handleCopy}
          >
            {copyState === 'copied' ? <Check width={14} height={14} /> : <Copy width={14} height={14} />}
            <span>{copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy prompt'}</span>
          </button>
          {showChatGpt && (
            <ProviderLink
              href={chatGptUrl}
              className="lesson-prompt__button lesson-prompt__button--chatgpt"
              label="ChatGPT"
              title={chatGptUrl ? 'Open a new ChatGPT chat with this prompt' : 'Add a prompt to enable this action'}
            >
              <img className="lesson-prompt__brand-icon" src={CHATGPT_ICON} alt="" aria-hidden="true" />
            </ProviderLink>
          )}
          {showClaude && (
            <ProviderLink
              href={claudeUrl}
              className="lesson-prompt__button lesson-prompt__button--claude"
              label="Claude"
              showLabel={false}
              title={claudeTooLong ? `Claude prompt links support up to ${CLAUDE_PROMPT_MAX_LENGTH.toLocaleString()} characters` : claudeUrl ? 'Open a new Claude chat with this prompt' : 'Add a prompt to enable this action'}
            >
              <img className="lesson-prompt__brand-icon lesson-prompt__brand-icon--wide" src={CLAUDE_ICON} alt="" aria-hidden="true" />
            </ProviderLink>
          )}
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === 'copied' ? 'Prompt copied to clipboard.' : copyState === 'failed' ? 'Could not copy the prompt.' : ''}
      </span>
    </NodeViewWrapper>
  );
}

export const PromptBlock = Node.create({
  name: 'promptBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      // Empty = follow the tenant accent, so untouched blocks are unchanged.
      accentColor: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-accent-color') || '',
        renderHTML: (attrs) => ({ 'data-accent-color': attrs.accentColor }),
      },
      title: {
        default: 'Try this prompt',
        parseHTML: (element) => element.getAttribute('data-prompt-title') || 'Try this prompt',
        renderHTML: () => ({}),
      },
      prompt: {
        default: '',
        parseHTML: (element) => element.querySelector('code')?.textContent || '',
        renderHTML: () => ({}),
      },
      showChatGpt: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-chatgpt') !== 'false',
        renderHTML: () => ({}),
      },
      showClaude: {
        default: true,
        parseHTML: (element) => element.getAttribute('data-show-claude') !== 'false',
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'blockquote[data-prompt-block]' }];
  },

  // Sanitizer-safe legacy fallback. The canonical lesson doc retains the rich,
  // interactive card; older renderers still show a readable title and full prompt.
  renderHTML({ node, HTMLAttributes }) {
    const title = (node.attrs.title as string) || 'Try this prompt';
    const prompt = (node.attrs.prompt as string) || '';
    return [
      'blockquote',
      mergeAttributes(HTMLAttributes, {
        'data-prompt-block': '',
        'data-prompt-title': title,
      }),
      ['p', ['strong', title]],
      ['pre', ['code', prompt]],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PromptBlockView);
  },
});
