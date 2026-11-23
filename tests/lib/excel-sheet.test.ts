import { describe, expect, it } from 'vitest';
import { badgeCell, blankSheet, normalizeSheets, pasteInto, sheetsPlainText, EXCEL_MAX_COLS } from '@/lib/excel-sheet';

describe('normalizeSheets', () => {
  it('gives an empty workbook one blank sheet', () => {
    expect(normalizeSheets(undefined)).toEqual([blankSheet('Sheet1')]);
  });

  it('drops unknown cell ids and cells outside the grid, and keeps the limits', () => {
    const [s] = normalizeSheets([{ name: 'Data', cols: 99, rows: 3, cells: { A1: { v: 'ok' }, Z9: { v: 'bad' }, A9: { v: 'below' }, 'A1;': { v: 'x' } }, frames: [] }]);
    expect(s.cols).toBe(EXCEL_MAX_COLS);
    expect(Object.keys(s.cells)).toEqual(['A1']);
  });

  it('renumbers frames in order and drops malformed ones', () => {
    const [s] = normalizeSheets([{ ...blankSheet('S'), frames: [{ a: 'B2', b: 'B3', n: 7 }, { a: 'nope', b: 'B3' }, { a: 'C2', b: 'C2', n: 1 }] }]);
    expect(s.frames).toEqual([{ a: 'B2', b: 'B3', n: 1 }, { a: 'C2', b: 'C2', n: 2 }]);
  });

  it('keeps a highlighted cell even when it is empty, and only a true highlight', () => {
    const [s] = normalizeSheets([{ ...blankSheet('S'), cells: { A1: { v: '', h: true }, B1: { v: 'x', h: 'yes' } } }]);
    expect(s.cells.A1).toEqual({ v: '', h: true });
    expect(s.cells.B1).toEqual({ v: 'x' });
  });

  it('falls back to a sheet name when one is blank', () => {
    expect(normalizeSheets([{ name: '  ' }, { name: '' }]).map((s) => s.name)).toEqual(['Sheet1', 'Sheet2']);
  });
});

describe('pasteInto', () => {
  it('places tab-separated cells from the start cell, header first, numbers aligned right', () => {
    const s = pasteInto(blankSheet('S'), 'A1', 'Month\tActive\r\nJanuary\t44,870\nFebruary\t4.1%\n');
    expect(s.cells.A1).toEqual({ v: 'Month', s: 'hd' });
    expect(s.cells.B2).toEqual({ v: '44,870', s: 'num' });
    expect(s.cells.B3).toEqual({ v: '4.1%', s: 'num' });
    expect(s.cells.A2).toEqual({ v: 'January' });
  });

  it('grows the grid to fit, within the column limit', () => {
    const wide = Array.from({ length: 20 }, (_, i) => `c${i}`).join('\t');
    const s = pasteInto(blankSheet('S'), 'B4', wide);
    expect(s.cols).toBe(EXCEL_MAX_COLS);
    expect(s.rows).toBeGreaterThanOrEqual(4);
    expect(s.cells.B4).toEqual({ v: 'c0' });
  });
});

describe('badgeCell', () => {
  it('puts the badge in the empty cell to the right, then below, else pins it', () => {
    const sheet = { ...blankSheet('S'), cells: { E3: { v: 'busy' } } };
    expect(badgeCell(sheet, { a: 'B2', b: 'C4', n: 1 })).toBe('D3');
    expect(badgeCell(sheet, { a: 'D2', b: 'D4', n: 1 })).toBe('D5');
    const full = { ...blankSheet('S'), cols: 2, rows: 2 };
    expect(badgeCell(full, { a: 'A1', b: 'B2', n: 1 })).toBeNull();
  });
});

describe('sheetsPlainText', () => {
  it('reads values and formulas row by row for the tutor', () => {
    const s = { ...blankSheet('Churn'), cells: { A1: { v: 'Rate' }, B1: { v: '4.1%', f: '=C3/B3' } } };
    expect(sheetsPlainText('Book', [s])).toBe('Book\nChurn\nRate | 4.1% (=C3/B3)');
  });
});
