'use client';

import { useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Plus, Replace, X } from 'lucide-react';
import { Segmented, StyleMenu, MenuRow } from '@/components/lesson/nodes/StyleControls';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';
import { AudioPicker } from '@/components/lesson/AudioPicker';

type Align = 'left' | 'center' | 'right';

function AudioView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const src = (node.attrs.src as string) || '';
  const title = (node.attrs.title as string) || '';
  const transcript = (node.attrs.transcript as string) || '';
  const align = (node.attrs.align as Align) || 'left';
  const [showPicker, setShowPicker] = useState(false);
  const [transcriptEditing, setTranscriptEditing] = useState(!!transcript);
  const alignItems = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';

  return (
    <NodeViewWrapper className="lesson-audio" style={{ display: 'flex', flexDirection: 'column', alignItems }}>
      <div className="lesson-audio__stage">
        <LessonAudioPlayer
          src={src}
          transcript={editable ? undefined : transcript}
          accentColor="var(--lesson-accent)"
          editorControls={editable ? (
          <div className="lesson-block-corner lesson-audio__controls" contentEditable={false}>
            <button type="button" className="lesson-audio__control" aria-label="Replace audio" title="Replace audio" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPicker(true)}><Replace width={14} height={14} /></button>
            <StyleMenu><MenuRow label="Align"><Segmented<Align> value={align} onChange={(value) => updateAttributes({ align: value })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} /></MenuRow></StyleMenu>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="audio" />
          </div>
          ) : undefined}
        />
      </div>

      {editable ? (
        <div className="lesson-audio__authoring" contentEditable={false}>
          <NodeTextInput className="lesson-audio__caption-input" value={title} placeholder="Add a caption (optional)" onCommit={(value) => updateAttributes({ title: value })} />
          {!transcriptEditing ? (
            <button type="button" className="lesson-audio__add-transcript" onClick={() => setTranscriptEditing(true)}><Plus width={12} height={12} /> Add transcript</button>
          ) : (
            <div className="lesson-audio__transcript-editor">
              <NodeTextInput multiline className="lesson-audio__transcript-input" value={transcript} placeholder="Paste or write the audio transcript..." onCommit={(value) => updateAttributes({ transcript: value })} />
              <button type="button" className="lesson-audio__remove-transcript" aria-label="Remove transcript" title="Remove transcript" onClick={() => { updateAttributes({ transcript: '' }); setTranscriptEditing(false); }}><X width={12} height={12} /></button>
            </div>
          )}
        </div>
      ) : title ? <figcaption className="lesson-audio__caption">{title}</figcaption> : null}

      {showPicker && <AudioPicker onSelect={(url) => { updateAttributes({ src: url }); setShowPicker(false); }} onClose={() => setShowPicker(false)} />}
    </NodeViewWrapper>
  );
}

export const LessonAudio = Node.create({
  name: 'lessonAudio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '', parseHTML: (element) => element.getAttribute('src') || '', renderHTML: (attrs) => (attrs.src ? { src: attrs.src } : {}) },
      title: { default: '' },
      transcript: { default: '' },
      align: { default: 'left' },
    };
  },
  parseHTML() { return [{ tag: 'audio[src]' }]; },
  renderHTML({ HTMLAttributes }) { return ['audio', mergeAttributes(HTMLAttributes, { controls: 'controls' })]; },
  addNodeView() { return ReactNodeViewRenderer(AudioView); },
});
