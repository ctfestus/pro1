'use client';

// File attachment block. Before this existed the only way to hand a student a workbook
// was to type a link, which told them nothing about what they were about to open -- the
// block carries the filename, type, and size on its face instead.

import { useState } from 'react';
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Download, File as FileIcon, FileArchive, FileSpreadsheet, FileText, Replace } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { AttachmentPicker } from '@/components/lesson/AttachmentPicker';
import {
  attachmentDownloadUrl,
  attachmentExtension,
  fileNameFromUrl,
  formatAttachmentSize,
  safeAttachmentUrl,
} from '@/lib/lesson-attachment';

function AttachmentIcon({ ext }: { ext: string }) {
  if (ext === 'XLS' || ext === 'XLSX' || ext === 'CSV') return <FileSpreadsheet width={19} height={19} aria-hidden="true" />;
  if (ext === 'ZIP') return <FileArchive width={19} height={19} aria-hidden="true" />;
  if (ext) return <FileText width={19} height={19} aria-hidden="true" />;
  return <FileIcon width={19} height={19} aria-hidden="true" />;
}

function AttachmentView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const editable = editor.isEditable;
  const href = (node.attrs.href as string) || '';
  const fileName = (node.attrs.fileName as string) || '';
  const fileSize = node.attrs.fileSize as number | null;
  const caption = (node.attrs.caption as string) || '';
  const [showPicker, setShowPicker] = useState(false);

  const safeHref = safeAttachmentUrl(href);
  const displayName = fileName || fileNameFromUrl(href) || 'Attached file';
  const ext = attachmentExtension(fileName, href);
  const size = formatAttachmentSize(fileSize);
  const detail = [ext || 'FILE', size].filter(Boolean).join(' - ');

  const face = (
    <>
      <span className="lesson-attachment__tile"><AttachmentIcon ext={ext} /></span>
      <span className="lesson-attachment__meta">
        <span className="lesson-attachment__name">{displayName}</span>
        <span className="lesson-attachment__detail">{detail}</span>
      </span>
    </>
  );

  return (
    <NodeViewWrapper className="lesson-attachment">
      {editable ? (
        <div className="lesson-attachment__card" data-editing="true" contentEditable={false}>
          {face}
          <span className="lesson-block-corner lesson-attachment__controls">
            <button type="button" className="lesson-attachment__control" aria-label="Replace file" title="Replace file" onMouseDown={(event) => event.preventDefault()} onClick={() => setShowPicker(true)}><Replace width={14} height={14} /></button>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="file" />
          </span>
        </div>
      ) : safeHref ? (
        <a
          className="lesson-attachment__card"
          href={attachmentDownloadUrl(safeHref, displayName)}
          target="_blank"
          rel="noopener noreferrer"
          download={displayName}
        >
          {face}
          <span className="lesson-attachment__grab"><Download width={13} height={13} aria-hidden="true" /> Download</span>
        </a>
      ) : (
        <div className="lesson-attachment__card">{face}</div>
      )}

      {editable ? (
        <div className="lesson-attachment__authoring" contentEditable={false}>
          <NodeTextInput
            className="lesson-attachment__name-input"
            value={fileName}
            placeholder="File name shown to students"
            onCommit={(value) => updateAttributes({ fileName: value })}
          />
          <NodeTextInput
            className="lesson-attachment__caption-input"
            value={caption}
            placeholder="Add a note about this file (optional)"
            onCommit={(value) => updateAttributes({ caption: value })}
          />
        </div>
      ) : caption ? <p className="lesson-attachment__caption">{caption}</p> : null}

      {showPicker && (
        <AttachmentPicker
          onSelect={(picked) => {
            updateAttributes(picked);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
        />
      )}
    </NodeViewWrapper>
  );
}

export const LessonAttachment = Node.create({
  name: 'lessonAttachment',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      href: { default: '' },
      fileName: { default: '' },
      fileSize: { default: null },
      caption: { default: '' },
    };
  },
  parseHTML() { return [{ tag: 'a[data-lesson-file]' }]; },
  // Fallback HTML: a plain link the legacy sanitizer keeps (it drops data-* and any
  // attribute outside href/target/rel), so an older surface still reaches the file.
  // Size and note live only in the canonical doc, which is what every current surface reads.
  renderHTML({ node }) {
    const href = safeAttachmentUrl((node.attrs.href as string) || '') || '';
    const name = (node.attrs.fileName as string) || fileNameFromUrl(href) || 'Attached file';
    return ['a', { 'data-lesson-file': '', href, target: '_blank', rel: 'noopener noreferrer' }, name];
  },
  addNodeView() { return ReactNodeViewRenderer(AttachmentView); },
});
