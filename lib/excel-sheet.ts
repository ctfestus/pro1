// The Excel sheet lesson block: a small workbook an instructor fills in (by typing or pasting
// from Excel) to show a spreadsheet the way Excel draws it. Values are shown as typed; a
// formula is text learners read when they click the cell. Nothing is calculated.
//
// Pure data rules only: the block's view is components/lesson/nodes/ExcelSheet.tsx.

export type ExcelCellStyle = '' | 'num' | 'hd' | 'tot' | 'num tot';

export interface ExcelCell {
  /** The value the cell shows. */
  v: string;
  /** The formula learners see in the formula bar, for example =C3/B3. */
  f?: string;
  s?: ExcelCellStyle;
  /** A soft yellow fill, as in Excel, to mark cells without numbering them. */
  h?: true;
}

/** An orange outline round a range, with its number badge. a and b are corner cells, like D2 and D4. */
export interface ExcelFrame { a: string; b: string; n: number }

export interface ExcelSheetData {
  name: string;
  cols: number;
  rows: number;
  cells: Record<string, ExcelCell>;
  frames: ExcelFrame[];
}

export const EXCEL_MAX_COLS = 12;
export const EXCEL_MAX_ROWS = 60;
export const EXCEL_MAX_SHEETS = 8;
const MAX_TEXT = 300;

const STYLES = new Set<ExcelCellStyle>(['', 'num', 'hd', 'tot', 'num tot']);
const CELL_ID = /^([A-L])([1-9]\d?)$/;

export const colLetter = (c: number) => String.fromCharCode(65 + c);
export const colIndex = (id: string) => id.charCodeAt(0) - 65;
export const rowNumber = (id: string) => Number(id.slice(1));

/** A cell range as column and row bounds, whichever corner comes first. */
export function cellBox(a: string, b: string) {
  return {
    c1: Math.min(colIndex(a), colIndex(b)), c2: Math.max(colIndex(a), colIndex(b)),
    r1: Math.min(rowNumber(a), rowNumber(b)), r2: Math.max(rowNumber(a), rowNumber(b)),
  };
}

export function cellsIn(box: ReturnType<typeof cellBox>): string[] {
  const out: string[] = [];
  for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) out.push(colLetter(c) + r);
  return out;
}

/** True for text that reads as a number, a currency amount or a percentage, so it aligns right. */
export const looksNumeric = (text: string) => /^[-+]?[$£€₵]?\s?[\d,]*\.?\d+%?$/.test(text.trim());

export function blankSheet(name: string): ExcelSheetData {
  return { name, cols: 5, rows: 6, cells: {}, frames: [] };
}

const clip = (value: unknown) => String(value ?? '').slice(0, MAX_TEXT);
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Brings stored or pasted data into shape: known cell ids only, limits enforced, frames renumbered. */
export function normalizeSheets(input: unknown): ExcelSheetData[] {
  const list = Array.isArray(input) ? input.slice(0, EXCEL_MAX_SHEETS) : [];
  const sheets = list.map((raw, i): ExcelSheetData => {
    const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const cols = clamp(s.cols, 1, EXCEL_MAX_COLS, 5);
    const rows = clamp(s.rows, 1, EXCEL_MAX_ROWS, 6);
    const cells: Record<string, ExcelCell> = {};
    for (const [id, value] of Object.entries((s.cells && typeof s.cells === 'object' ? s.cells : {}) as Record<string, unknown>)) {
      const m = CELL_ID.exec(id);
      if (!m || colIndex(id) >= cols || rowNumber(id) > rows || !value || typeof value !== 'object') continue;
      const c = value as Record<string, unknown>;
      const cell: ExcelCell = { v: clip(c.v) };
      if (c.f) cell.f = clip(c.f);
      if (STYLES.has(c.s as ExcelCellStyle) && c.s) cell.s = c.s as ExcelCellStyle;
      if (c.h === true) cell.h = true;
      if (cell.v || cell.f || cell.s || cell.h) cells[id] = cell;
    }
    const frames = (Array.isArray(s.frames) ? s.frames : [])
      .filter((f): f is { a: string; b: string } => !!f && CELL_ID.test(String((f as ExcelFrame).a)) && CELL_ID.test(String((f as ExcelFrame).b)))
      .slice(0, 9)
      .map((f, n) => ({ a: f.a, b: f.b, n: n + 1 }));
    return { name: clip(s.name).trim() || `Sheet${i + 1}`, cols, rows, cells, frames };
  });
  return sheets.length ? sheets : [blankSheet('Sheet1')];
}

/**
 * Cells copied from Excel arrive as tab-separated lines. Places them from `start`, growing the
 * sheet within the limits; the first pasted row becomes the header when it lands on row 1.
 */
export function pasteInto(sheet: ExcelSheetData, start: string, text: string): ExcelSheetData {
  const lines = text.replace(/\r/g, '').split('\n').filter((line) => line.length);
  const c0 = colIndex(start), r0 = rowNumber(start);
  const next: ExcelSheetData = { ...sheet, cells: { ...sheet.cells } };
  lines.forEach((line, i) => line.split('\t').forEach((value, j) => {
    const c = c0 + j, r = r0 + i;
    if (c >= EXCEL_MAX_COLS || r > EXCEL_MAX_ROWS) return;
    next.cols = Math.max(next.cols, c + 1);
    next.rows = Math.max(next.rows, r + 1 > EXCEL_MAX_ROWS ? r : r + 1);
    const v = clip(value);
    next.cells[colLetter(c) + r] = { v, ...(i === 0 && r0 === 1 ? { s: 'hd' as const } : looksNumeric(v) ? { s: 'num' as const } : {}) };
  }));
  return next;
}

/** Where a frame's number badge sits: the first empty cell to its right, then below; null pins it to the frame's corner. */
export function badgeCell(sheet: ExcelSheetData, frame: ExcelFrame): string | null {
  const b = cellBox(frame.a, frame.b);
  const framed = new Set(sheet.frames.filter((f) => f !== frame).flatMap((f) => cellsIn(cellBox(f.a, f.b))));
  const empty = (id: string) => !sheet.cells[id]?.v && !framed.has(id);
  const right = colLetter(b.c2 + 1) + Math.round((b.r1 + b.r2) / 2);
  const below = colLetter(b.c1) + (b.r2 + 1);
  if (b.c2 + 1 < sheet.cols && empty(right)) return right;
  if (b.r2 + 1 <= sheet.rows && empty(below)) return below;
  return null;
}

/** The workbook as plain text, row by row, for the lesson tutor and search. */
export function sheetsPlainText(title: string, sheets: ExcelSheetData[]): string {
  const parts = [title];
  for (const s of sheets) {
    parts.push(s.name);
    for (let r = 1; r <= s.rows; r++) {
      const row = Array.from({ length: s.cols }, (_, c) => {
        const cell = s.cells[colLetter(c) + r];
        return cell ? cell.v + (cell.f ? ` (${cell.f})` : '') : '';
      }).filter(Boolean);
      if (row.length) parts.push(row.join(' | '));
    }
  }
  return parts.filter(Boolean).join('\n');
}
