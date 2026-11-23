'use client';

// Excel sheet: a small workbook drawn the way Excel draws it (green title bar, name box and
// formula bar, column letters, row numbers, sheet tabs). Learners click cells to read their
// formulas and switch sheets; orange numbered frames point at what to look at. In the editor
// the same sheet is filled in place: paste from Excel, type into cells, set formulas and
// styles, add frames and sheets. Data rules live in lib/excel-sheet.ts.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { CaretDown, CaretLeft, CaretRight, Check, ClipboardText, DotsThreeVertical, Eye, FrameCorners, HighlighterCircle, MicrosoftExcelLogo, Plus, X } from '@phosphor-icons/react';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import {
  EXCEL_MAX_COLS, EXCEL_MAX_ROWS, EXCEL_MAX_SHEETS, badgeCell, blankSheet, cellBox, cellsIn, colIndex, colLetter,
  looksNumeric, normalizeSheets, pasteInto, rowNumber, sheetsPlainText, type ExcelCellStyle, type ExcelSheetData,
} from '@/lib/excel-sheet';

const STYLE_OPTIONS: { value: ExcelCellStyle; label: string }[] = [
  { value: '', label: 'Text' }, { value: 'num', label: 'Number' }, { value: 'hd', label: 'Header' }, { value: 'tot', label: 'Total' },
];

function ExcelSheetView({ node, editor, getPos, updateAttributes }: NodeViewProps) {
  const editable = editor.isEditable;
  const title = (node.attrs.title as string) || '';
  const sheets = normalizeSheets(node.attrs.sheets);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [anchor, setAnchor] = useState('A1');
  const [focus, setFocus] = useState('A1');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  // The editing tools show only while the instructor is working on this sheet: clicking into it
  // opens them, clicking anywhere else closes them, so an unselected sheet looks as learners see it.
  const [active, setActive] = useState(false);
  const blockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!editable || !active) return;
    const close = (event: MouseEvent) => {
      if (!blockRef.current?.contains(event.target as globalThis.Node)) { setActive(false); setEditing(null); setPreview(false); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [editable, active]);
  const authoring = editable && active && !preview;

  const index = Math.min(sheetIndex, sheets.length - 1);
  const sheet = sheets[index];
  const range = cellBox(anchor, focus);
  const selected = new Set(cellsIn(range));
  const multi = selected.size > 1;
  const rangeName = multi ? `${colLetter(range.c1)}${range.r1}:${colLetter(range.c2)}${range.r2}` : focus;
  const current = sheet.cells[focus];

  const saveSheets = (next: ExcelSheetData[]) => updateAttributes({ sheets: next });
  const saveSheet = (next: ExcelSheetData) => saveSheets(sheets.map((s, i) => (i === index ? next : s)));
  const select = (id: string, extend = false) => { setFocus(id); if (!extend) setAnchor(id); };
  const showSheet = (i: number) => { setSheetIndex(i); select('A1'); setEditing(null); };

  const commitCell = (id: string, value: string) => {
    const cell = { ...(sheet.cells[id] || { v: '' }), v: value };
    if (!cell.s && looksNumeric(value)) cell.s = 'num';
    const cells = { ...sheet.cells };
    if (cell.v || cell.f || cell.s || cell.h) cells[id] = cell; else delete cells[id];
    saveSheet({ ...sheet, cells });
    setEditing(null);
  };
  const setFormula = (value: string) => {
    const cell = { ...(sheet.cells[focus] || { v: '' }) };
    if (value) cell.f = value; else delete cell.f;
    saveSheet({ ...sheet, cells: { ...sheet.cells, [focus]: cell } });
  };
  const setStyle = (style: ExcelCellStyle) => {
    const cells = { ...sheet.cells };
    for (const id of selected) {
      const cell = { ...(cells[id] || { v: '' }) };
      // A total keeps its number alignment; every other choice replaces the style.
      const next: ExcelCellStyle = style === 'tot' && (cell.s === 'num' || looksNumeric(cell.v)) ? 'num tot' : style;
      if (next) cell.s = next; else delete cell.s;
      cells[id] = cell;
    }
    saveSheet({ ...sheet, cells });
  };
  // Highlight toggles a soft yellow fill on the selection: on unless every selected cell has it.
  const allHighlighted = [...selected].every((id) => sheet.cells[id]?.h);
  const toggleHighlight = () => {
    const cells = { ...sheet.cells };
    for (const id of selected) {
      const cell = { ...(cells[id] || { v: '' }) };
      if (allHighlighted) delete cell.h; else cell.h = true;
      if (cell.v || cell.f || cell.s || cell.h) cells[id] = cell; else delete cells[id];
    }
    saveSheet({ ...sheet, cells });
  };
  // Clicking a column letter or row number selects the whole column or row, as in Excel;
  // shift-click extends from the current selection.
  const selectColumn = (c: number, extend: boolean) => {
    const startCol = extend ? colIndex(anchor) : c;
    setAnchor(`${colLetter(startCol)}1`); setFocus(`${colLetter(c)}${sheet.rows}`); setEditing(null);
  };
  const selectRow = (r: number, extend: boolean) => {
    const startRow = extend ? rowNumber(anchor) : r;
    setAnchor(`A${startRow}`); setFocus(`${colLetter(sheet.cols - 1)}${r}`); setEditing(null);
  };
  const clearSelection = () => {
    const cells = { ...sheet.cells };
    for (const id of selected) delete cells[id];
    saveSheet({ ...sheet, cells });
  };
  const addFrame = () => saveSheet({ ...sheet, frames: [...sheet.frames, { a: `${colLetter(range.c1)}${range.r1}`, b: `${colLetter(range.c2)}${range.r2}`, n: sheet.frames.length + 1 }] });
  const removeFrame = (i: number) => saveSheet({ ...sheet, frames: sheet.frames.filter((_, j) => j !== i).map((f, n) => ({ ...f, n: n + 1 })) });
  const addSheet = () => {
    if (sheets.length >= EXCEL_MAX_SHEETS) return;
    saveSheets([...sheets, blankSheet(`Sheet${sheets.length + 1}`)]);
    showSheet(sheets.length);
  };
  const removeSheet = (i: number) => {
    if (sheets.length <= 1) return;
    saveSheets(sheets.filter((_, j) => j !== i));
    showSheet(0);
  };
  const renameSheet = (i: number, name: string) => {
    if (name.trim()) saveSheets(sheets.map((s, j) => (j === i ? { ...s, name: name.trim().slice(0, 40) } : s)));
    setRenaming(null);
  };
  const applyPaste = () => {
    if (pasteText.trim()) saveSheet(pasteInto(sheet, anchor, pasteText));
    setPasteOpen(false);
    setPasteText('');
  };

  // Typing on a selected cell starts editing it, as in Excel; Delete clears the selection.
  const onGridKey = (event: React.KeyboardEvent) => {
    if (!authoring || editing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); clearSelection(); return; }
    if (event.key === 'Enter') { event.preventDefault(); setDraft(current?.v || ''); setEditing(focus); return; }
    if (event.key.length === 1) { event.preventDefault(); setDraft(event.key); setEditing(focus); }
  };

  // Frames are drawn over the grid as one outline each, measured from the cells they cover.
  const gridRef = useRef<HTMLTableElement>(null);
  const [frameBoxes, setFrameBoxes] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  const frameKey = JSON.stringify([sheet.frames, sheet.cols, sheet.rows, index]);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const measure = () => setFrameBoxes(sheet.frames.map((f) => {
      const b = cellBox(f.a, f.b);
      const a = grid.querySelector<HTMLElement>(`td[data-cell="${colLetter(b.c1)}${b.r1}"]`);
      const z = grid.querySelector<HTMLElement>(`td[data-cell="${colLetter(b.c2)}${b.r2}"]`);
      if (!a || !z) return { left: 0, top: 0, width: 0, height: 0 };
      return { left: a.offsetLeft - 1, top: a.offsetTop - 1, width: z.offsetLeft + z.offsetWidth - a.offsetLeft + 1, height: z.offsetTop + z.offsetHeight - a.offsetTop + 1 };
    }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
    // frameKey stands in for the frames and grid size it measures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  const badges = new Map<string, number>();
  sheet.frames.forEach((f) => { const at = badgeCell(sheet, f); if (at) badges.set(at, f.n); });

  return (
    <NodeViewWrapper ref={blockRef} className="lesson-xl-block" data-editing={authoring ? 'true' : 'false'} data-idle={editable && !active ? 'true' : 'false'}
      contentEditable={false} onMouseDownCapture={() => editable && setActive(true)} onFocusCapture={() => editable && setActive(true)}>
      {editable && active && (
        <div className="lesson-xl__bar">
          <span className="lesson-xl__name"><MicrosoftExcelLogo weight="duotone" width={15} height={15} aria-hidden="true" /> Excel sheet</span>
          {!preview && (
            <button type="button" className="lesson-xl__tool" onClick={() => setPasteOpen(true)}>
              <ClipboardText weight="duotone" width={15} height={15} aria-hidden="true" /> Paste from Excel
            </button>
          )}
          <button type="button" className="lesson-xl__tool" data-on={preview ? 'true' : 'false'} aria-pressed={preview} onClick={() => { setPreview((p) => !p); setEditing(null); }}>
            <Eye weight="duotone" width={15} height={15} aria-hidden="true" /> Preview as learner
          </button>
          <span className="lesson-xl__spacer" />
          <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="Excel sheet" />
        </div>
      )}
      <div className="lesson-xl__layout" data-panel={authoring ? 'true' : 'false'}>
        <div className="lesson-xl">
          <div className="lesson-xl__win">
            <span className="lesson-xl__dots" aria-hidden="true"><i /><i /><i /></span>
            {authoring
              ? <input className="lesson-xl__title lesson-xl__title-input" value={title} placeholder="Workbook name" aria-label="Workbook name" onChange={(e) => updateAttributes({ title: e.target.value.slice(0, 80) })} />
              : <span className="lesson-xl__title">{title || 'Workbook'}</span>}
            <span className="lesson-xl__app">Excel</span>
          </div>
          <div className="lesson-xl__fbar">
            <span className="lesson-xl__namebox"><span>{rangeName}</span><CaretDown weight="bold" width={11} height={11} aria-hidden="true" /></span>
            <span className="lesson-xl__more" aria-hidden="true"><DotsThreeVertical weight="bold" width={14} height={14} /></span>
            <span className="lesson-xl__ctl" aria-hidden="true"><X width={14} height={14} /><Check width={14} height={14} /><span className="lesson-xl__fx">fx</span></span>
            {authoring
              ? <input className="lesson-xl__formula" value={current?.f || ''} placeholder="Formula learners see for this cell, for example =C3/B3" aria-label={`Formula for ${focus}`} onChange={(e) => setFormula(e.target.value.slice(0, 300))} />
              : <span className="lesson-xl__formula" aria-live="polite">{current?.f || current?.v || ''}</span>}
          </div>
          <div className="lesson-xl__scroll">
            <table ref={gridRef} className="lesson-xl__grid" tabIndex={0} onKeyDown={onGridKey} aria-label={`${sheet.name} sheet`}>
              <thead>
                <tr>
                  <th className="lesson-xl__corner" aria-hidden="true" />
                  {Array.from({ length: sheet.cols }, (_, c) => <th key={c} scope="col" data-on={c >= range.c1 && c <= range.c2 ? 'true' : 'false'} data-pick={authoring ? 'true' : undefined} onMouseDown={(e) => { if (!authoring) return; e.preventDefault(); selectColumn(c, e.shiftKey); }}>{colLetter(c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: sheet.rows }, (_, r) => r + 1).map((r) => (
                  <tr key={r}>
                    <th scope="row" data-on={r >= range.r1 && r <= range.r2 ? 'true' : 'false'} data-pick={authoring ? 'true' : undefined} onMouseDown={(e) => { if (!authoring) return; e.preventDefault(); selectRow(r, e.shiftKey); }}>{r}</th>
                    {Array.from({ length: sheet.cols }, (_, c) => {
                      const id = colLetter(c) + r;
                      const cell = sheet.cells[id];
                      const badge = badges.get(id);
                      return (
                        <td
                          key={id}
                          data-cell={id}
                          data-style={cell?.s || undefined}
                          data-hl={cell?.h ? 'true' : undefined}
                          data-current={id === focus ? 'true' : undefined}
                          data-in-range={multi && selected.has(id) ? 'true' : undefined}
                          onMouseDown={(e) => { if (editing === id) return; e.preventDefault(); select(id, e.shiftKey && authoring); setEditing(null); (e.currentTarget.closest('table') as HTMLTableElement | null)?.focus(); }}
                          onDoubleClick={() => { if (!authoring) return; setDraft(cell?.v || ''); setEditing(id); }}
                        >
                          {editing === id ? (
                            <input
                              className="lesson-xl__cell-input"
                              autoFocus
                              value={draft}
                              aria-label={`Value of ${id}`}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => commitCell(id, draft.slice(0, 300))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') { e.preventDefault(); commitCell(id, draft.slice(0, 300)); if (r < sheet.rows) select(colLetter(c) + (r + 1)); }
                                if (e.key === 'Escape') { e.preventDefault(); setEditing(null); }
                              }}
                            />
                          ) : (
                            <>{cell?.v}{badge && <span className="lesson-xl__badge">{badge}</span>}</>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {sheet.frames.map((f, i) => frameBoxes[i] && frameBoxes[i].width > 0 && (
              <span key={`${f.a}-${f.b}-${f.n}`} className="lesson-xl__frame" style={frameBoxes[i]} aria-hidden="true">
                {!badgeCell(sheet, f) && <span className="lesson-xl__badge lesson-xl__badge--pin">{f.n}</span>}
              </span>
            ))}
          </div>
          {authoring && (
            <div className="lesson-xl__grow">
              <button type="button" className="lesson-xl__tool" disabled={sheet.rows >= EXCEL_MAX_ROWS} onClick={() => saveSheet({ ...sheet, rows: sheet.rows + 1 })}><Plus weight="bold" width={12} height={12} aria-hidden="true" /> Row</button>
              <button type="button" className="lesson-xl__tool" disabled={sheet.cols >= EXCEL_MAX_COLS} onClick={() => saveSheet({ ...sheet, cols: sheet.cols + 1 })}><Plus weight="bold" width={12} height={12} aria-hidden="true" /> Column</button>
            </div>
          )}
          <div className="lesson-xl__tabs" role="tablist" aria-label="Sheets">
            {/* Excel's sheet arrows: step to the previous or next sheet. */}
            <span className="lesson-xl__tab-nav">
              <button type="button" aria-label="Previous sheet" disabled={index === 0} onClick={() => showSheet(index - 1)}><CaretLeft weight="fill" width={11} height={11} /></button>
              <button type="button" aria-label="Next sheet" disabled={index >= sheets.length - 1} onClick={() => showSheet(index + 1)}><CaretRight weight="fill" width={11} height={11} /></button>
            </span>
            {sheets.map((s, i) => (
              <span key={i} className="lesson-xl__tab-wrap" data-on={i === index ? 'true' : 'false'}>
                {renaming === i ? (
                  <input className="lesson-xl__tab-input" autoFocus defaultValue={s.name} aria-label="Sheet name"
                    onBlur={(e) => renameSheet(i, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setRenaming(null); }} />
                ) : (
                  <button type="button" role="tab" aria-selected={i === index} className="lesson-xl__tab" onClick={() => showSheet(i)} onDoubleClick={() => authoring && setRenaming(i)}>{s.name}</button>
                )}
                {authoring && i === index && sheets.length > 1 && renaming !== i && (
                  <button type="button" className="lesson-xl__tab-remove" aria-label={`Remove ${s.name}`} onClick={() => removeSheet(i)}><X weight="bold" width={11} height={11} /></button>
                )}
              </span>
            ))}
            {authoring && sheets.length < EXCEL_MAX_SHEETS && (
              <button type="button" className="lesson-xl__tab-add" aria-label="Add sheet" onClick={addSheet}><Plus weight="bold" width={13} height={13} /></button>
            )}
          </div>
          {/* Excel's status bar under the sheet tabs. */}
          <div className="lesson-xl__status">
            <span>Ready</span>
            <span className="lesson-xl__hint">{authoring ? 'Double-click a tab to rename it' : 'Click a cell to see its formula'}</span>
          </div>
        </div>

        {authoring && (
          <aside className="lesson-xl__panel" aria-label="Selected cells">
            <p className="lesson-xl__panel-title">Selected <span>{rangeName}</span></p>
            <div>
              <p className="lesson-xl__label">Style</p>
              <div className="lesson-xl__seg">
                {STYLE_OPTIONS.map((o) => {
                  const st = current?.s || '';
                  const on = o.value === 'tot' ? st.includes('tot') : o.value === 'num' ? st === 'num' : st === o.value;
                  return <button key={o.label} type="button" data-on={on ? 'true' : 'false'} onClick={() => setStyle(o.value)}>{o.label}</button>;
                })}
              </div>
            </div>
            <div>
              <p className="lesson-xl__label">Highlight</p>
              <button type="button" className="lesson-xl__tool lesson-xl__tool--wide" data-on={allHighlighted ? 'true' : 'false'} aria-pressed={allHighlighted} onClick={toggleHighlight}>
                <HighlighterCircle weight="duotone" width={15} height={15} aria-hidden="true" /> {allHighlighted ? 'Remove highlight' : 'Highlight cells'}
              </button>
            </div>
            <div>
              <p className="lesson-xl__label">Numbered frames</p>
              <button type="button" className="lesson-xl__tool lesson-xl__tool--wide" onClick={addFrame} disabled={sheet.frames.length >= 9}>
                <FrameCorners weight="duotone" width={15} height={15} aria-hidden="true" /> Add numbered frame
              </button>
            </div>
            {sheet.frames.length > 0 && (
              <div className="lesson-xl__frames">
                {sheet.frames.map((f, i) => (
                  <div key={`${f.a}-${f.b}-${f.n}`} className="lesson-xl__frame-row">
                    <span className="lesson-xl__badge">{f.n}</span>
                    <span>{f.a === f.b ? f.a : `${f.a}:${f.b}`}</span>
                    <button type="button" aria-label={`Remove frame ${f.n}`} onClick={() => removeFrame(i)}><X weight="bold" width={12} height={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="lesson-xl__note">Learners can click cells to see formulas and switch sheets. They cannot change anything.</p>
          </aside>
        )}
      </div>

      {pasteOpen && (
        <div className="lesson-xl__modal" role="dialog" aria-modal="true" aria-label="Paste from Excel" onMouseDown={(e) => { if (e.target === e.currentTarget) setPasteOpen(false); }}>
          <div className="lesson-xl__modal-card">
            <p className="lesson-xl__modal-title">Paste from Excel</p>
            <p className="lesson-xl__note">Copy the cells in Excel, then paste here. They start at cell {anchor}.</p>
            <textarea autoFocus value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="Paste here" aria-label="Cells from Excel" />
            <div className="lesson-xl__modal-actions">
              <button type="button" className="lesson-xl__tool" onClick={() => setPasteOpen(false)}>Cancel</button>
              <button type="button" className="lesson-xl__tool lesson-xl__tool--primary" onClick={applyPaste}>Add to the sheet</button>
            </div>
          </div>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ExcelSheet = Node.create({
  name: 'excelSheet',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: {
        default: 'Workbook',
        parseHTML: (el) => el.getAttribute('data-title') || 'Workbook',
        renderHTML: (attrs) => ({ 'data-title': attrs.title }),
      },
      sheets: {
        default: [blankSheet('Sheet1')],
        parseHTML: (el) => { try { return normalizeSheets(JSON.parse(el.getAttribute('data-sheets') || '[]')); } catch { return [blankSheet('Sheet1')]; } },
        renderHTML: (attrs) => ({ 'data-sheets': JSON.stringify(attrs.sheets) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-excel-sheet]' }];
  },

  // Legacy fallback for surfaces that only keep sanitized HTML: the workbook as plain text, so
  // its values and formulas still read. The lesson doc keeps the full interactive sheet.
  renderHTML({ node, HTMLAttributes }) {
    const sheets = normalizeSheets(node.attrs.sheets);
    return ['div', mergeAttributes(HTMLAttributes, { 'data-excel-sheet': '' }),
      ['pre', sheetsPlainText((node.attrs.title as string) || 'Workbook', sheets)]];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ExcelSheetView);
  },
});

/** Inserted from the lesson insert menu: a starter sheet with a header row. */
export const EXCEL_SHEET_STARTER = {
  type: 'excelSheet',
  attrs: {
    title: 'Workbook',
    sheets: [{ ...blankSheet('Sheet1'), cells: { A1: { v: 'Item', s: 'hd' }, B1: { v: 'Value', s: 'hd' } } }],
  },
};
