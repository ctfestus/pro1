'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { Bold, Code2, FileCode2, Table, Italic, RemoveFormatting, Underline, List, ListOrdered, Heading2, Heading3, Link as LinkIcon, Quote, Youtube, ImageIcon, Loader2, UserRound, Trash2 } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { RichTextAiMenu } from '@/components/RichTextAiMenu';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  bgOverride?: string;
  fontFamily?: string;
  onImageUpload?: (file: File) => Promise<string>;
  /** Open a custom image picker (e.g. the Cloudinary + Pexels library) from the toolbar image button
   *  and insert the chosen URL. Takes precedence over onImageUpload's file dialog when provided;
   *  resolve null if the user cancels. */
  onRequestImage?: () => Promise<string | null>;
  /** Show the inline "Ask AI" selection assistant. Instructor-authoring surfaces only --
   *  the AI route is instructor/admin, so never enable on student-facing editors. */
  enableAiAssist?: boolean;
  /** Show an "Insert name" button that drops a {{first_name}} merge tag. For VE
   *  workplace-email editors only -- the tag is resolved by the VE players at render time. */
  enableNameTag?: boolean;
}

export function RichTextEditor({ value, onChange, placeholder = 'Add a description...', className = '', bgOverride, fontFamily, onImageUpload, onRequestImage, enableAiAssist = false, enableNameTag = false }: RichTextEditorProps) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const bg        = bgOverride ?? (dark ? 'rgba(255,255,255,0.05)' : '#f4f5f7');
  const border    = dark ? 'none' : '1px solid rgba(0,0,0,0.08)';
  const toolDiv   = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const textColor = dark ? '#f0f0f0' : '#111';
  const phColor   = dark ? '#555' : '#bbb';
  const linkColor = dark ? '#ADEE66' : '#00bf63';
  const editorRef    = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Track whether the change came from inside the editor (to avoid caret reset)
  const isInternalChange = useRef(false);

  const rebuildYtPreviews = useCallback((container: HTMLElement) => {
    container.querySelectorAll<HTMLElement>('div.yt-embed[title]').forEach(el => {
      const videoId = el.getAttribute('title') ?? '';
      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;
      if (el.querySelector('img')) return; // already has preview
      el.setAttribute('contenteditable', 'false');
      el.style.cssText = 'width:100%;margin:8px 0;border-radius:8px;overflow:hidden;position:relative;cursor:default;user-select:none;';
      // Only add img -- no overlay divs (they survive DOMPurify and leak into saved content).
      // The play button is shown via CSS ::after on .yt-embed (editor stylesheet only).
      const img = document.createElement('img');
      img.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      img.alt = 'YouTube video';
      img.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;display:block;';
      el.appendChild(img);
    });
  }, []);

  // Enter must produce a PARAGRAPH, not a div.
  //
  // A contentEditable defaults to wrapping each new line in <div>, and sanitizeRichText does not
  // allow div -- so DOMPurify unwrapped them on the way out and every single line break silently
  // disappeared. An author had to press Enter three times before a stray <br> survived and any
  // gap appeared at all. Paragraphs are allowed, and .rich-preview already spaces them.
  useEffect(() => {
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* not supported: fall back to the browser default */ }
  }, []);

  // Sync external value changes into the DOM (only when not typing)
  useEffect(() => {
    if (!editorRef.current) return;
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value;
      rebuildYtPreviews(editorRef.current);
    }
  }, [value, rebuildYtPreviews]);

  const exec = useCallback((command: string, val?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, val);
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInput = useCallback(() => {
    if (!editorRef.current) return;
    isInternalChange.current = true;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const handleLink = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      alert('Select some text first, then click the link button.');
      return;
    }
    const url = prompt('Enter URL:');
    if (url) exec('createLink', url);
  }, [exec]);

  const handleHeading = useCallback((tag: 'h2' | 'h3') => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    const block = sel?.anchorNode && (sel.anchorNode as HTMLElement).closest
      ? (sel.anchorNode as HTMLElement).closest?.(tag)
      : null;
    document.execCommand('formatBlock', false, block ? 'p' : tag);
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleBlockquote = useCallback(() => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    const block = sel?.anchorNode && (sel.anchorNode as HTMLElement).closest
      ? (sel.anchorNode as HTMLElement).closest?.('blockquote')
      : null;
    document.execCommand('formatBlock', false, block ? 'p' : 'blockquote');
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleInsertVideo = useCallback(() => {
    const url = prompt('Enter YouTube URL:');
    if (!url) return;
    const match = url.match(/(?:v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    if (!match) { alert('Invalid YouTube URL. Paste a standard youtube.com or youtu.be link.'); return; }
    const videoId = match[1];

    // Use a placeholder div instead of a real iframe.
    // Browsers silently strip <iframe> from contentEditable even via DOM insertion.
    // The placeholder is converted to a real <iframe> at display time by renderAnnouncementContent.
    const wrapper = document.createElement('div');
    wrapper.className = 'yt-embed';
    wrapper.title = videoId;
    wrapper.setAttribute('contenteditable', 'false');
    wrapper.style.cssText = 'width:100%;margin:8px 0;border-radius:8px;overflow:hidden;position:relative;cursor:default;user-select:none;';

    // Only add img -- no overlay divs (they survive DOMPurify and leak into saved content).
    // Play button is shown via CSS ::after on .yt-embed (editor stylesheet only).
    const thumb = document.createElement('img');
    thumb.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
    thumb.alt = 'YouTube video';
    thumb.style.cssText = 'width:100%;aspect-ratio:16/9;object-fit:cover;display:block;';
    wrapper.appendChild(thumb);

    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();

    const sel = window.getSelection();
    let inserted = false;
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      // Only use the selection if it's actually inside the editor
      if (editor.contains(range.commonAncestorContainer)) {
        range.collapse(false);
        range.insertNode(wrapper);
        range.setStartAfter(wrapper);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        inserted = true;
      }
    }
    if (!inserted) editor.appendChild(wrapper);

    rebuildYtPreviews(editor);
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange, rebuildYtPreviews]);

  const handleInlineCode = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const selected = range.toString();
    const code = document.createElement('code');
    code.textContent = selected || 'code';
    range.deleteContents();
    range.insertNode(code);
    // Place cursor after the code tag if text was replaced, or select placeholder
    if (!selected) {
      range.selectNodeContents(code);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      range.setStartAfter(code);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  const handleCodeBlock = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const selected = range.toString();
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = selected || 'code here';
    pre.appendChild(code);
    range.deleteContents();
    range.insertNode(pre);
    // Insert a paragraph after so cursor can exit the block
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    pre.after(p);
    if (!selected) {
      range.selectNodeContents(code);
    } else {
      range.setStartAfter(pre);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  const handleInsertTable = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const cols = Math.min(8, Math.max(1, parseInt(window.prompt('Number of columns?', '3') || '0', 10) || 0));
    const rows = Math.min(20, Math.max(1, parseInt(window.prompt('Number of body rows?', '2') || '0', 10) || 0));
    if (!cols || !rows) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const headRow = Array.from({ length: cols }, (_, i) => `<th>Header ${i + 1}</th>`).join('');
    const bodyRow = `<tr>${Array.from({ length: cols }, () => '<td>&nbsp;</td>').join('')}</tr>`;
    const bodyRows = Array.from({ length: rows }, () => bodyRow).join('');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<table><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table><p><br></p>`;
    range.deleteContents();
    const frag = document.createDocumentFragment();
    while (wrapper.firstChild) frag.appendChild(wrapper.firstChild);
    range.insertNode(frag);
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  const handleClearFormat = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    // Remove inline styles (bold, italic, underline, inline code)
    document.execCommand('removeFormat');
    // Remove block-level formatting: pre, blockquote, headings -> p
    const anchor = sel.anchorNode;
    const anchorEl = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as HTMLElement;
    const blockEl = anchorEl?.closest?.('pre, blockquote, h1, h2, h3, h4');
    if (blockEl && editor.contains(blockEl)) {
      const p = document.createElement('p');
      p.innerHTML = blockEl.innerHTML;
      blockEl.replaceWith(p);
      const range = document.createRange();
      range.setStart(p, 0);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'b' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exec('bold'); }
    if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); exec('italic'); }
    if (e.key === '`' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleInlineCode(); }
    // Exit code block or inline code on Enter when cursor is at the end
    if (e.key === 'Enter' && !e.shiftKey) {
      const editor = editorRef.current;
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount || !editor) return;
      const anchor = sel.anchorNode;
      const anchorEl = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as HTMLElement;
      // Exit <pre> block: press Enter on an empty last line
      const preEl = anchorEl?.closest?.('pre');
      if (preEl && editor.contains(preEl)) {
        const codeEl = preEl.querySelector('code') ?? preEl;
        const text = codeEl.textContent ?? '';
        if (text.endsWith('\n') || text === '') {
          e.preventDefault();
          // Trim trailing newline
          if (text.endsWith('\n')) codeEl.textContent = text.slice(0, -1);
          const p = document.createElement('p');
          p.innerHTML = '<br>';
          preEl.after(p);
          const range = document.createRange();
          range.setStart(p, 0);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          isInternalChange.current = true;
          onChange(editor.innerHTML);
          return;
        }
      }
      // Exit inline <code> on Enter
      const codeEl = anchorEl?.closest?.('code:not(pre code)');
      if (codeEl && editor.contains(codeEl)) {
        e.preventDefault();
        const range = document.createRange();
        range.setStartAfter(codeEl);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertHTML', false, ' ');
      }
    }
  }, [exec, handleInlineCode, onChange]);

  const handleInsertNameTag = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    // Insert the merge tag as plain text at the caret; VE players swap in the
    // student's first name at render time.
    document.execCommand('insertText', false, '{{first_name}}');
    isInternalChange.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  // Insert an image at the caret (or append to the end if the selection is no longer inside the editor,
  // e.g. after a modal picker closes).
  const insertImageAtCaret = useCallback((url: string, alt = '') => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    const img = document.createElement('img');
    img.src = url;
    img.alt = alt;
    // Default to a contained medium width (not full-bleed); the user can resize via the image control.
    img.style.cssText = 'width:55%;max-width:100%;height:auto;border-radius:6px;margin:6px 0;display:block;';
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (editorRef.current.contains(range.commonAncestorContainer)) {
        range.collapse(false);
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        editorRef.current.appendChild(img);
      }
    } else {
      editorRef.current.appendChild(img);
    }
    isInternalChange.current = true;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);

  const handleInsertImage = useCallback(async (file: File) => {
    if (!onImageUpload) return;
    setUploadingImage(true);
    try {
      insertImageAtCaret(await onImageUpload(file), file.name.replace(/\.[^.]+$/, ''));
    } catch {
      alert('Image upload failed. Please try again.');
    } finally {
      setUploadingImage(false);
    }
  }, [onImageUpload, insertImageAtCaret]);

  // Toolbar image button when a library picker is provided: open it, insert the chosen URL.
  const handlePickImage = useCallback(async () => {
    if (!onRequestImage) return;
    setUploadingImage(true);
    try {
      const url = await onRequestImage();
      if (url) insertImageAtCaret(url);
    } catch { /* cancelled or failed -- nothing to insert */ }
    finally { setUploadingImage(false); }
  }, [onRequestImage, insertImageAtCaret]);

  // --- Inline image control: click an image to show a small floating bar for resize + delete. ---
  const [imgCtl, setImgCtl] = useState<{ img: HTMLImageElement; top: number; left: number } | null>(null);
  const imgCtlRef = useRef<HTMLDivElement>(null);
  const emitChange = useCallback(() => {
    if (!editorRef.current) return;
    isInternalChange.current = true;
    onChange(editorRef.current.innerHTML);
  }, [onChange]);
  const positionImgCtl = useCallback((img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    setImgCtl({ img, top: r.top, left: r.left });
  }, []);
  const handleEditorClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target && target.tagName === 'IMG') positionImgCtl(target as HTMLImageElement);
    else setImgCtl(null);
  }, [positionImgCtl]);
  const resizeSelectedImg = useCallback((width: string) => {
    if (!imgCtl) return;
    imgCtl.img.style.width = width;
    imgCtl.img.style.maxWidth = '100%';
    imgCtl.img.style.height = 'auto';
    emitChange();
    const r = imgCtl.img.getBoundingClientRect();
    setImgCtl({ img: imgCtl.img, top: r.top, left: r.left });
  }, [imgCtl, emitChange]);
  const deleteSelectedImg = useCallback(() => {
    if (!imgCtl) return;
    imgCtl.img.remove();
    emitChange();
    setImgCtl(null);
  }, [imgCtl, emitChange]);
  // Close the control on scroll/resize or a click outside both the image and the control.
  useEffect(() => {
    if (!imgCtl) return;
    const close = () => setImgCtl(null);
    const onDown = (ev: MouseEvent) => {
      const n = ev.target as Node;
      if (imgCtlRef.current?.contains(n) || editorRef.current?.contains(n)) return;
      setImgCtl(null);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [imgCtl]);

  return (
    <div
      className={`rounded-lg overflow-hidden transition-colors ${className}`}
      style={{ background: bg, border }}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 px-2 py-1.5" style={{ borderBottom: `1px solid ${toolDiv}` }}>
        <ToolbarButton onClick={() => handleHeading('h2')} title="Heading 2" dark={dark}>
          <Heading2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => handleHeading('h3')} title="Heading 3" dark={dark}>
          <Heading3 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 mx-1" style={{ background: toolDiv }} />
        <ToolbarButton onClick={() => exec('bold')} title="Bold (Ctrl+B)" dark={dark}>
          <Bold className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('italic')} title="Italic (Ctrl+I)" dark={dark}>
          <Italic className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('underline')} title="Underline (Ctrl+U)" dark={dark}>
          <Underline className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleInlineCode} title="Inline code (Ctrl+`)" dark={dark}>
          <Code2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleCodeBlock} title="Code block" dark={dark}>
          <FileCode2 className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleInsertTable} title="Insert table" dark={dark}>
          <Table className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 mx-1" style={{ background: toolDiv }} />
        <ToolbarButton onClick={() => exec('insertUnorderedList')} title="Bullet list" dark={dark}>
          <List className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={() => exec('insertOrderedList')} title="Numbered list" dark={dark}>
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleBlockquote} title="Blockquote" dark={dark}>
          <Quote className="w-3.5 h-3.5" />
        </ToolbarButton>
        <ToolbarButton onClick={handleLink} title="Insert link" dark={dark}>
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolbarButton>
        <div className="w-px h-4 mx-1" style={{ background: toolDiv }} />
        <ToolbarButton onClick={handleClearFormat} title="Clear formatting" dark={dark}>
          <RemoveFormatting className="w-3.5 h-3.5" />
        </ToolbarButton>
        {enableNameTag && (
          <>
            <div className="w-px h-4 mx-1" style={{ background: toolDiv }} />
            <ToolbarButton onClick={handleInsertNameTag} title="Insert student's name ({{first_name}})" dark={dark}>
              <UserRound className="w-3.5 h-3.5" />
            </ToolbarButton>
          </>
        )}
        <div className="w-px h-4 mx-1" style={{ background: toolDiv }} />
        <ToolbarButton onClick={handleInsertVideo} title="Embed YouTube video" dark={dark}>
          <Youtube className="w-3.5 h-3.5" />
        </ToolbarButton>
        {(onImageUpload || onRequestImage) && (
          <>
            <ToolbarButton
              onClick={() => (onRequestImage ? handlePickImage() : imageInputRef.current?.click())}
              title="Insert image"
              dark={dark}
            >
              {uploadingImage
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <ImageIcon className="w-3.5 h-3.5" />}
            </ToolbarButton>
            {onImageUpload && (
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleInsertImage(file);
                  e.target.value = '';
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Editable area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onClick={handleEditorClick}
        data-placeholder={placeholder}
        className={`px-3 py-2.5 outline-none min-h-[100px] max-h-[300px] overflow-y-auto rich-editor${dark ? ' dark' : ''}`}
        style={{ color: textColor, ...(fontFamily ? { fontFamily } : {}) }}
      />

      {/* Floating image control: resize (S/M/L) + delete, shown when an image is clicked. */}
      {imgCtl && (
        <div
          ref={imgCtlRef}
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed', top: Math.max(8, imgCtl.top - 42), left: imgCtl.left, zIndex: 60,
            display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 8,
            background: dark ? '#1b1d26' : '#ffffff', border: `1px solid ${toolDiv}`, boxShadow: '0 6px 20px rgba(0,0,0,0.18)',
          }}
        >
          {([['S', '30%'], ['M', '55%'], ['L', '100%']] as const).map(([label, w]) => (
            <button key={label} type="button" onClick={() => resizeSelectedImg(w)} title={`Resize ${label}`}
              className="px-2 py-1 rounded text-xs font-semibold hover:opacity-70" style={{ color: textColor }}>
              {label}
            </button>
          ))}
          <div className="w-px h-4 mx-0.5" style={{ background: toolDiv }} />
          <button type="button" onClick={deleteSelectedImg} title="Delete image" className="px-2 py-1 rounded hover:opacity-70" style={{ color: '#ef4444' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {enableAiAssist && (
        <RichTextAiMenu
          editorRef={editorRef}
          dark={dark}
          commit={() => {
            if (!editorRef.current) return;
            isInternalChange.current = true;
            onChange(editorRef.current.innerHTML);
          }}
        />
      )}

      <style>{`
        .rich-editor:empty:before {
          content: attr(data-placeholder);
          color: ${phColor};
          pointer-events: none;
        }
        .rich-editor { font-size: 1rem; line-height: 1.4; }
        .rich-editor p { margin: 0 0 0.75rem; }
        .rich-editor p:last-child { margin-bottom: 0; }
        .rich-editor ul { list-style: disc; padding-left: 1.4rem; margin: 0.4rem 0 0.75rem; }
        .rich-editor ol { list-style: decimal; padding-left: 1.4rem; margin: 0.4rem 0 0.75rem; }
        .rich-editor li { margin: 0.2rem 0; }
        .rich-editor b, .rich-editor strong { font-weight: 700; }
        .rich-editor i, .rich-editor em { font-style: italic; }
        .rich-editor u { text-decoration: underline; }
        .rich-editor a { color: ${linkColor}; text-decoration: underline; }
        .rich-editor a:hover { opacity: 0.75; }
        .rich-editor h2 { font-size: 1.75rem; font-weight: 700; margin: 1.25rem 0 0.4rem; letter-spacing: -0.02em; }
        .rich-editor h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.3rem; letter-spacing: -0.01em; }
        .rich-editor h2:first-child, .rich-editor h3:first-child { margin-top: 0; }
        .rich-editor code { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 0.85em; background: ${dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}; color: ${dark ? '#86efac' : '#166534'}; border-radius: 4px; padding: 1px 5px; }
        .rich-editor pre { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 0.85em; background: ${dark ? '#0f1120' : '#f1f3f8'}; color: ${dark ? '#c9d1d9' : '#1a1d2e'}; border-radius: 6px; padding: 12px 16px; margin: 0.75rem 0; overflow-x: auto; white-space: pre; }
        .rich-editor pre code { background: none; padding: 0; border-radius: 0; color: inherit; font-size: inherit; }
        .rich-editor blockquote { border-left: 3px solid #10b981; padding-left: 0.875rem; margin: 0.75rem 0; color: ${dark ? '#a1a1aa' : '#444444'}; font-style: normal; }
        .rich-editor table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
        .rich-editor th, .rich-editor td { border: 1px solid ${dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)'}; padding: 6px 10px; text-align: left; min-width: 40px; }
        .rich-editor th { font-weight: 700; background: ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}; }
        .rich-editor .yt-embed { width: 100%; margin: 8px 0; border-radius: 8px; overflow: hidden; position: relative; cursor: default; display: block; }
        .rich-editor .yt-embed img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
        .rich-editor .yt-embed::after { content: '▶'; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 56px; height: 40px; background: rgba(255,0,0,0.88); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 18px; padding-left: 4px; pointer-events: none; box-sizing: border-box; }
      `}</style>
    </div>
  );
}

function ToolbarButton({ onClick, title, children, dark }: { onClick: () => void; title: string; children: React.ReactNode; dark?: boolean }) {
  const hoverBg   = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const hoverText = dark ? '#f0f0f0' : '#111';
  const baseColor = dark ? '#666' : '#888';
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      className="p-1.5 rounded transition-colors"
      style={{ color: baseColor }}
      onMouseEnter={e => (e.currentTarget.style.background = hoverBg, e.currentTarget.style.color = hoverText)}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent', e.currentTarget.style.color = baseColor)}
    >
      {children}
    </button>
  );
}
