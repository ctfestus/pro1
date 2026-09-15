import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { firstWorkbookSheetRows, rowsToCsv, workbookCellText, workbookRows, workbookSheetNames } from '@/lib/workbook-rows';

async function workbookBuffer() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sales');
  sheet.getCell('A1').value = 'Region';
  sheet.getCell('B1').value = 'Revenue';
  sheet.getCell('A2').value = { text: 'Lagos', hyperlink: 'https://example.com/lagos' };
  sheet.getCell('B2').value = 100;
  sheet.getCell('A3').value = { richText: [{ text: 'Acc' }, { text: 'ra' }] };
  sheet.getCell('B3').value = { formula: 'SUM(B2:B2)', result: 100 };
  wb.addWorksheet('Hidden Input').addRow(['ignored']);
  return wb.xlsx.writeBuffer();
}

describe('workbook row helpers', () => {
  it('reads sheet names and first-sheet rows from an xlsx workbook', async () => {
    const buf = await workbookBuffer();

    await expect(workbookSheetNames(buf as ArrayBuffer)).resolves.toEqual(['Sales', 'Hidden Input']);
    await expect(firstWorkbookSheetRows(buf as ArrayBuffer)).resolves.toEqual({
      sheetName: 'Sales',
      rows: [
        ['Region', 'Revenue'],
        ['Lagos', '100'],
        ['Accra', '100'],
      ],
    });
  });

  it('reads a named sheet', async () => {
    const buf = await workbookBuffer();

    await expect(workbookRows(buf as ArrayBuffer, 'Hidden Input')).resolves.toEqual([['ignored']]);
  });

  it('unwraps formula results, rich text, hyperlinks and dates', () => {
    expect(workbookCellText({ formula: 'SUM(A1:A2)', result: 3 })).toBe('3');
    expect(workbookCellText({ richText: [{ text: 'Net' }, { text: ' sales' }] })).toBe('Net sales');
    expect(workbookCellText({ text: 'Source', hyperlink: 'https://example.com' })).toBe('Source');
    expect(workbookCellText(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026-01-02T03:04:05.000Z');
  });

  it('quotes CSV cells only when needed', () => {
    expect(rowsToCsv([['Region', 'Notes'], ['Lagos', 'Line 1\nLine 2'], ['Accra', 'He said "yes"']]))
      .toBe('Region,Notes\nLagos,"Line 1\nLine 2"\nAccra,"He said ""yes"""');
  });
});
