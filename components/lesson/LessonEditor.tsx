'use client';

// Authoring editor for interactive lessons.
//
// Initializes from the canonical `doc` when present, otherwise migrates from the
// legacy HTML `body`. On every change it emits BOTH the canonical ProseMirror JSON
// (`doc`) and a sanitized HTML fallback (`body`) so legacy renderers and exports
// never go blank. Uses the shared `lessonExtensions` so what is authored renders
// identically in LessonRenderer.
//
// Callers MUST give this component a stable `key` per lesson (e.g. key={q.id}) so
// switching between lessons remounts the editor with the new content -- the editor
// is intentionally uncontrolled after mount to avoid caret resets on every keystroke.

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { generateHTML, type JSONContent } from '@tiptap/core';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code2, FileCode2,
  List, ListOrdered, Heading2, Heading3, Link as LinkIcon, Quote,
  Image as ImageIcon, Table as TableIcon, BookMarked, AudioLines, Paperclip,
  Eye, Monitor, Pencil, Smartphone, Tablet,
} from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { StyleMenu, MenuRow, Segmented, ColorField } from '@/components/lesson/nodes/StyleControls';
import { LessonAiMenu } from '@/components/lesson/LessonAiMenu';
import { lessonExtensions } from '@/components/lesson/extensions';
import { LessonContentStyles } from '@/components/lesson/LessonContentStyles';
import { GlossaryEditorPanel, type GlossaryDetails } from '@/components/lesson/GlossaryEditorPanel';
import { GlossaryTooltip } from '@/components/lesson/GlossaryTooltip';
import { LinkEditorPanel, type LinkDetails } from '@/components/lesson/LinkEditorPanel';
import { LessonRuntimeProvider } from '@/components/lesson/LessonRuntimeContext';
import { useTenant } from '@/components/TenantProvider';
import { ImageLibrary } from '@/components/ImageLibrary';
import { AudioPicker } from '@/components/lesson/AudioPicker';
import { AttachmentPicker } from '@/components/lesson/AttachmentPicker';
import { InteractiveInsertMenu } from '@/components/lesson/InteractiveInsertMenu';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { sanitizeRichText } from '@/lib/sanitize';
import { collectRunnableSetup, inlineGlossaryDefinitions, sameContent, type LessonDoc } from '@/lib/lesson-doc';

interface LessonEditorProps {
  doc?: LessonDoc;
  bodyFallback?: string;
  onChange: (value: { doc: LessonDoc; body: string }) => void;
  placeholder?: string;
  isDark?: boolean;
  accentColor?: string;
}

interface GlossaryEditorState {
  from: number;
  to: number;
  term: string;
  active: boolean;
  details: GlossaryDetails;
}

interface LinkEditorState {
  from: number;
  to: number;
  active: boolean;
  initialText: string;
  details: LinkDetails;
}

export function LessonEditor({ doc, bodyFallback, onChange, placeholder = 'Write the lesson...', isDark, accentColor }: LessonEditorProps) {
  const { theme } = useTheme();
  const { primaryColor } = useTenant();
  const lessonAccent = accentColor || primaryColor;
  const dark = isDark ?? theme === 'dark';
  const [showLibrary, setShowLibrary] = useState(false);
  const [showAudioPicker, setShowAudioPicker] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [glossaryEditor, setGlossaryEditor] = useState<GlossaryEditorState | null>(null);
  const [linkEditor, setLinkEditor] = useState<LinkEditorState | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [previewSize, setPreviewSize] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  // Set on edits made inside the editor so the external-sync effect below skips them
  // (reloading on every keystroke would reset the caret).
  const skipNextSync = useRef(false);
  // useEditor already initializes with `content`, so the first sync-effect run would call
  // setContent redundantly -- and that mid-commit flushSync triggers a React warning. Skip it.
  const syncedOnce = useRef(false);

  const editor = useEditor({
    extensions: [...lessonExtensions, Placeholder.configure({ placeholder })],
    content: (doc ?? bodyFallback ?? '') as Record<string, unknown> | string,
    immediatelyRender: false, // required under Next SSR
    onUpdate: ({ editor }) => {
      skipNextSync.current = true;
      // Canonical doc keeps the glossary marks; the lossy body fallback would drop the
      // definitions (the sanitizer strips data-* attrs), so inline them as readable
      // text first. inlineGlossaryDefinitions returns the same doc when there is no
      // glossary, so the common path stays on the cheap editor.getHTML().
      const doc = editor.getJSON() as LessonDoc;
      const inlined = inlineGlossaryDefinitions(doc);
      const html = inlined === doc
        ? editor.getHTML()
        : generateHTML(inlined as unknown as JSONContent, lessonExtensions);
      onChangeRef.current({ doc, body: sanitizeRichText(html) });
    },
  });

  // Re-render the toolbar when selection / formatting state changes.
  useEffect(() => {
    if (!editor) return;
    const update = () => forceUpdate();
    editor.on('transaction', update);
    return () => { editor.off('transaction', update); };
  }, [editor]);

  // The last content handed in from outside, so a re-render that rebuilds an IDENTICAL doc object
  // is not mistaken for an external edit (see the effect below).
  const lastExternal = useRef<Record<string, unknown> | string | null>(null);

  // Reload when content changes from OUTSIDE the editor (e.g. AI "Generate lesson"
  // replaces the lesson). Internal edits set skipNextSync so typing is not clobbered.
  //
  // Two guards, both needed:
  //  * `doc` is an object, so a parent re-render hands us a NEW reference with the SAME content
  //    (state updates rebuild the objects around it). Syncing then is pointless work, and in a list
  //    of editors it reset the caret in every sibling on each keystroke elsewhere -- so compare the
  //    content and bail when it has not actually changed.
  //  * setContent re-renders the React node views synchronously (flushSync), which React forbids
  //    while it is already rendering. Run it on a task after this commit instead of inline.
  useEffect(() => {
    if (!editor) return;
    const next = (doc ?? bodyFallback ?? '') as Record<string, unknown> | string;
    if (!syncedOnce.current) { syncedOnce.current = true; lastExternal.current = next; return; } // content already set at init
    if (skipNextSync.current) { skipNextSync.current = false; lastExternal.current = next; return; }
    if (sameContent(lastExternal.current, next)) return;
    lastExternal.current = next;
    const id = setTimeout(() => {
      if (editor.isDestroyed) return;
      editor.commands.setContent(next, { emitUpdate: false });
    }, 0);
    return () => clearTimeout(id);
  }, [editor, doc, bodyFallback]);

  const handleLink = useCallback(() => {
    if (!editor) return;
    const active = editor.isActive('link');
    if (!active && editor.state.selection.empty) return;
    if (active) editor.chain().focus().extendMarkRange('link').run();
    const { from, to } = editor.state.selection;
    const attrs = active ? editor.getAttributes('link') : {};
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    setLinkEditor({
      from,
      to,
      active,
      initialText: text,
      details: {
        text,
        href: (attrs.href as string) || '',
        newTab: attrs.target === '_blank',
      },
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!previewMode, false);
  }, [editor, previewMode]);

  // Glossary term: preserve the selected range while the compact details panel is
  // open, then restore that range before applying or removing the mark.
  const handleGlossary = useCallback(() => {
    if (!editor) return;
    const active = editor.isActive('glossaryTerm');
    if (!active && editor.state.selection.empty) return; // need a selection to define
    if (active) editor.chain().focus().extendMarkRange('glossaryTerm').run();
    const { from, to } = editor.state.selection;
    const attrs = active ? editor.getAttributes('glossaryTerm') : {};
    setGlossaryEditor({
      from,
      to,
      term: editor.state.doc.textBetween(from, to, ' ').trim(),
      active,
      details: {
        definition: (attrs.definition as string) || '',
        pronunciation: (attrs.pronunciation as string) || '',
        example: (attrs.example as string) || '',
        learnMoreUrl: (attrs.learnMoreUrl as string) || '',
      },
    });
  }, [editor]);

  if (!editor) return null;

  // Combined shared setup, recomputed each render (the toolbar already re-renders on
  // every transaction) so a block's "Runnable" hint reflects the lesson's shared data.
  const { setupSql: sharedSetupSql, setupPython: sharedSetupPython } = collectRunnableSetup(editor.getJSON() as LessonDoc);

  return (
    <div
      className="lesson-editor-shell rounded-lg overflow-hidden"
      style={{
        background: dark ? 'rgba(255,255,255,0.05)' : '#ffffff',
        border: dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)',
      }}
    >
      <LessonContentStyles />
      <div className="lesson-editor-viewbar" data-theme={dark ? 'dark' : 'light'} style={{ '--lesson-accent-base': lessonAccent } as React.CSSProperties}>
        <div className="lesson-editor-viewbar__switch" role="group" aria-label="Lesson view">
          <button type="button" data-active={!previewMode ? 'true' : 'false'} onClick={() => setPreviewMode(false)}><Pencil width={13} height={13} /> Edit</button>
          <button type="button" data-active={previewMode ? 'true' : 'false'} onClick={() => { setGlossaryEditor(null); setLinkEditor(null); setPreviewMode(true); }}><Eye width={14} height={14} /> Preview</button>
        </div>
        {previewMode ? (
          <div className="lesson-editor-viewbar__devices" role="group" aria-label="Preview width">
            <button type="button" title="Desktop preview" aria-label="Desktop preview" data-active={previewSize === 'desktop' ? 'true' : 'false'} onClick={() => setPreviewSize('desktop')}><Monitor width={14} height={14} /></button>
            <button type="button" title="Tablet preview" aria-label="Tablet preview" data-active={previewSize === 'tablet' ? 'true' : 'false'} onClick={() => setPreviewSize('tablet')}><Tablet width={14} height={14} /></button>
            <button type="button" title="Mobile preview" aria-label="Mobile preview" data-active={previewSize === 'mobile' ? 'true' : 'false'} onClick={() => setPreviewSize('mobile')}><Smartphone width={14} height={14} /></button>
          </div>
        ) : null}
      </div>

      {!previewMode ? <Toolbar dark={dark} accentColor={lessonAccent}>
        <div className="lesson-editor-toolbar__group" aria-label="Text formatting">
          <Btn dark={dark} title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 /></Btn>
          <Btn dark={dark} title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 /></Btn>
          <Btn dark={dark} title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></Btn>
          <Btn dark={dark} title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></Btn>
          <Btn dark={dark} title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List /></Btn>
          <Btn dark={dark} title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered /></Btn>
          <Btn dark={dark} title="Link" optionalCore active={editor.isActive('link')} onClick={handleLink}><LinkIcon /></Btn>
          <Btn dark={dark} title="Define glossary term" optionalCore active={editor.isActive('glossaryTerm')} onClick={handleGlossary}><BookMarked /></Btn>
        </div>
        <div className="lesson-editor-toolbar__group lesson-editor-toolbar__secondary" aria-label="More formatting">
          <Btn dark={dark} title="Underline" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /></Btn>
          <Btn dark={dark} title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /></Btn>
          <Btn dark={dark} title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 /></Btn>
          <Btn dark={dark} title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><FileCode2 /></Btn>
          <Btn dark={dark} title="Blockquote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /></Btn>
        </div>
        <div className="lesson-editor-toolbar__group lesson-editor-toolbar__interactive"><InteractiveInsertMenu editor={editor} dark={dark} accentColor={lessonAccent} /></div>
        <div className="lesson-editor-toolbar__group lesson-editor-toolbar__media" aria-label="Insert media">
          <Btn dark={dark} title="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon /></Btn>
          <Btn dark={dark} title="Insert image" onClick={() => setShowLibrary(true)}><ImageIcon /></Btn>
          <Btn dark={dark} title="Insert audio" onClick={() => setShowAudioPicker(true)}><AudioLines /></Btn>
          <Btn dark={dark} title="Insert file" onClick={() => setShowAttachmentPicker(true)}><Paperclip /></Btn>
        </div>
        <div className="lesson-editor-toolbar__more">
          <StyleMenu width={244} triggerLabel="More" accentColor={lessonAccent}>
            <MenuRow label="Format">
              <ToolbarMenuBtn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon /> Underline</ToolbarMenuBtn>
              <ToolbarMenuBtn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough /> Strike</ToolbarMenuBtn>
              <ToolbarMenuBtn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote /> Quote</ToolbarMenuBtn>
            </MenuRow>
            <MenuRow label="Code">
              <ToolbarMenuBtn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}><Code2 /> Inline</ToolbarMenuBtn>
              <ToolbarMenuBtn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}><FileCode2 /> Block</ToolbarMenuBtn>
            </MenuRow>
            <MenuRow label="Insert">
              <ToolbarMenuBtn onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon /> Table</ToolbarMenuBtn>
              <ToolbarMenuBtn onClick={() => setShowLibrary(true)}><ImageIcon /> Image</ToolbarMenuBtn>
              <ToolbarMenuBtn onClick={() => setShowAudioPicker(true)}><AudioLines /> Audio</ToolbarMenuBtn>
              <ToolbarMenuBtn onClick={() => setShowAttachmentPicker(true)}><Paperclip /> File</ToolbarMenuBtn>
            </MenuRow>
          </StyleMenu>
        </div>
      </Toolbar> : null}

      {!previewMode && glossaryEditor ? (
        <GlossaryEditorPanel
          key={`${glossaryEditor.from}-${glossaryEditor.to}`}
          term={glossaryEditor.term}
          initial={glossaryEditor.details}
          dark={dark}
          accentColor={lessonAccent}
          canRemove={glossaryEditor.active}
          onClose={() => setGlossaryEditor(null)}
          onRemove={() => {
            editor.chain().focus().setTextSelection({ from: glossaryEditor.from, to: glossaryEditor.to }).unsetGlossaryTerm().run();
            setGlossaryEditor(null);
          }}
          onSave={(details) => {
            editor.chain().focus().setTextSelection({ from: glossaryEditor.from, to: glossaryEditor.to }).setGlossaryTerm(details).run();
            setGlossaryEditor(null);
          }}
        />
      ) : null}

      {!previewMode && linkEditor ? (
        <LinkEditorPanel
          key={`${linkEditor.from}-${linkEditor.to}`}
          initial={linkEditor.details}
          dark={dark}
          accentColor={lessonAccent}
          canRemove={linkEditor.active}
          onClose={() => setLinkEditor(null)}
          onRemove={() => {
            editor.chain().focus().setTextSelection({ from: linkEditor.from, to: linkEditor.to }).unsetLink().run();
            setLinkEditor(null);
          }}
          onSave={(details) => {
            const attrs = { href: details.href, target: details.newTab ? '_blank' : null, rel: details.newTab ? 'noopener noreferrer' : null };
            const selection = editor.chain().focus().setTextSelection({ from: linkEditor.from, to: linkEditor.to });
            if (details.text === linkEditor.initialText) selection.setLink(attrs).run();
            else selection.insertContent({ type: 'text', text: details.text, marks: [{ type: 'link', attrs }] }).run();
            setLinkEditor(null);
          }}
        />
      ) : null}

      {!previewMode && editor.isActive('table') && (() => {
        const cell = editor.getAttributes('tableCell');
        const header = editor.getAttributes('tableHeader');
        const mode = (cell.cellBorder || header.cellBorder || 'all') as string;
        const color = (cell.cellBorderColor || header.cellBorderColor || '') as string;
        const cellAlign = (cell.cellAlign || header.cellAlign || 'left') as string;
        const cellBackground = (cell.cellBackground || header.cellBackground || '') as string;
        const tableAttrs = editor.getAttributes('table');
        const caption = (tableAttrs.caption || '') as string;
        const radius = (tableAttrs.radius || 'square') as string;
        return (
          <div className="lesson-table-toolbar" data-theme={dark ? 'dark' : 'light'} style={{ '--lesson-accent-base': lessonAccent } as React.CSSProperties}>
            <span className="lesson-table-toolbar__identity" title="Table tools"><TableIcon width={14} height={14} /></span>
            <TableBtn dark={dark} onClick={() => editor.chain().focus().addRowAfter().run()}>+ Row</TableBtn>
            <TableBtn dark={dark} onClick={() => editor.chain().focus().addColumnAfter().run()}>+ Column</TableBtn>
            <StyleMenu width={420} accentColor={lessonAccent}>
              <div className="lesson-table-format-grid">
                <section>
                  <span className="lesson-table-format-grid__heading">Structure</span>
                  <MenuRow label="Rows">
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().addRowBefore().run()}>Above</TableBtn>
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().addRowAfter().run()}>Below</TableBtn>
                    <TableBtn dark={dark} danger onClick={() => editor.chain().focus().deleteRow().run()}>Delete</TableBtn>
                  </MenuRow>
                  <MenuRow label="Columns">
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().addColumnBefore().run()}>Left</TableBtn>
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().addColumnAfter().run()}>Right</TableBtn>
                    <TableBtn dark={dark} danger onClick={() => editor.chain().focus().deleteColumn().run()}>Delete</TableBtn>
                  </MenuRow>
                  <MenuRow label="Headers">
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().toggleHeaderRow().run()}>Row</TableBtn>
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().toggleHeaderColumn().run()}>Column</TableBtn>
                  </MenuRow>
                  <MenuRow label="Cells">
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().mergeCells().run()}>Merge</TableBtn>
                    <TableBtn dark={dark} onClick={() => editor.chain().focus().splitCell().run()}>Split</TableBtn>
                  </MenuRow>
                </section>
                <section>
                  <span className="lesson-table-format-grid__heading">Appearance</span>
                  <MenuRow label="Alignment">
                    <Segmented<string> value={cellAlign} onChange={(value) => editor.chain().focus().setCellAttribute('cellAlign', value).run()} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
                  </MenuRow>
                  <MenuRow label="Corners">
                    <Segmented<string> value={radius} onChange={(value) => editor.chain().focus().updateAttributes('table', { radius: value }).run()} options={[{ value: 'square', label: 'Square' }, { value: 'soft', label: 'Soft' }, { value: 'rounded', label: 'Round' }]} />
                  </MenuRow>
                  <MenuRow label="Cell color">
                    <ColorField value={cellBackground} onChange={(value) => editor.chain().focus().setCellAttribute('cellBackground', value || null).run()} title="Cell background" />
                  </MenuRow>
                  <MenuRow label="Borders">
                    <Segmented<string> value={mode} onChange={(value) => setTableCellsAttr(editor, { cellBorder: value })} options={[{ value: 'all', label: 'All' }, { value: 'horizontal', label: 'Horiz' }, { value: 'vertical', label: 'Vert' }, { value: 'none', label: 'None' }]} />
                    <ColorField value={color} onChange={(value) => setTableCellsAttr(editor, { cellBorderColor: value || null })} />
                  </MenuRow>
                  <MenuRow label="Caption">
                    <NodeTextInput className="lesson-table-caption-input" value={caption} placeholder="Describe this table" onCommit={(value) => editor.chain().focus().updateAttributes('table', { caption: value }).run()} />
                  </MenuRow>
                  <TableBtn dark={dark} danger onClick={() => editor.chain().focus().deleteTable().run()}>Delete table</TableBtn>
                </section>
              </div>
            </StyleMenu>
          </div>
        );
      })()}

      <div className={previewMode ? 'lesson-editor-preview-stage' : undefined} data-theme={dark ? 'dark' : 'light'}>
        <div
          className={`lesson-content ${dark ? 'dark' : ''} px-3 py-2.5 min-h-[140px] overflow-y-auto${previewMode ? ' lesson-editor-preview-canvas max-h-[620px]' : ' max-h-[460px]'}`}
          data-preview-size={previewMode ? previewSize : undefined}
          style={lessonAccent ? ({ '--lesson-accent-base': lessonAccent } as React.CSSProperties) : undefined}
        >
          <LessonRuntimeProvider setupSql={sharedSetupSql} setupPython={sharedSetupPython} dark={dark}>
            <EditorContent editor={editor} />
          </LessonRuntimeProvider>
        </div>
      </div>
      {!previewMode ? <LessonAiMenu editor={editor} dark={dark} /> : null}
      <GlossaryTooltip />
      {showLibrary && (
        <ImageLibrary
          uploadFolder="lesson-images"
          initialFolder="lesson-images"
          onSelect={url => editor.chain().focus().setImage({ src: url }).run()}
          onClose={() => setShowLibrary(false)}
        />
      )}
      {showAudioPicker && (
        <AudioPicker
          onSelect={url => editor.chain().focus().insertContent({ type: 'lessonAudio', attrs: { src: url } }).run()}
          onClose={() => setShowAudioPicker(false)}
        />
      )}
      {showAttachmentPicker && (
        <AttachmentPicker
          onSelect={picked => editor.chain().focus().insertContent({ type: 'lessonAttachment', attrs: picked }).run()}
          onClose={() => setShowAttachmentPicker(false)}
        />
      )}
    </div>
  );
}

function Toolbar({ dark, accentColor, children }: { dark: boolean; accentColor: string; children: React.ReactNode }) {
  return (
    <div className="lesson-editor-toolbar" data-theme={dark ? 'dark' : 'light'} style={{ '--lesson-accent-base': accentColor } as React.CSSProperties}>
      {children}
    </div>
  );
}

// Apply border attrs to EVERY cell in the table containing the current selection.
// Border styling lives on cells (the resizable table's node view ignores table-level
// attrs), so a table-wide change walks the table and sets each cell.
function setTableCellsAttr(editor: Editor, attrs: Record<string, unknown>) {
  editor.chain().focus().command(({ tr, state }) => {
    const { $from } = state.selection;
    let tablePos = -1;
    let tableNode: any = null;
    for (let d = $from.depth; d > 0; d -= 1) {
      const n = $from.node(d);
      if (n.type.spec.tableRole === 'table') { tableNode = n; tablePos = $from.before(d); break; }
    }
    if (!tableNode) return false;
    tableNode.descendants((node: any, pos: number) => {
      const role = node.type.spec.tableRole;
      if (role === 'cell' || role === 'header_cell') {
        Object.entries(attrs).forEach(([k, v]) => tr.setNodeAttribute(tablePos + 1 + pos, k, v));
      }
      return true;
    });
    return true;
  }).run();
}

function TableBtn({ dark, danger, active, onClick, children }: { dark: boolean; danger?: boolean; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  const txt = active ? '#fff' : danger ? '#e5484d' : (dark ? '#aaa' : '#555');
  const bg = active ? '#10b981' : (dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)');
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className="lesson-table-tool text-[11px] font-semibold px-2 py-1 rounded transition-colors"
      style={{ color: txt, background: bg }}
    >
      {children}
    </button>
  );
}

function Btn({ dark, title, active, optionalCore, onClick, children }: { dark: boolean; title: string; active?: boolean; optionalCore?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-active={active ? 'true' : 'false'}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`lesson-editor-toolbar__button${optionalCore ? ' lesson-editor-toolbar__optional-core' : ''}`}
      data-theme={dark ? 'dark' : 'light'}
    >
      {children}
    </button>
  );
}

function ToolbarMenuBtn({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className="lesson-editor-toolbar__menu-button" data-active={active ? 'true' : 'false'} onMouseDown={(event) => { event.preventDefault(); onClick(); }}>{children}</button>;
}
