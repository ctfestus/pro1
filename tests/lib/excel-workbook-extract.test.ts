import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { extractFromWorkbook } from '@/lib/excel-workbook-extract';

describe('workbook number-format evidence', () => {
  it('preserves raw numbers, formulas and saved display formats', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Country Revenue');
    sheet.getCell('A1').value = 'Revenue';
    sheet.getCell('B1').value = 11063;
    sheet.getCell('B1').numFmt = '#,##0';
    sheet.getCell('C1').value = { formula: '2389/B1', result: 0.215945 };
    sheet.getCell('C1').numFmt = '0.0%';
    sheet.getCell('D1').value = { formula: 'B1-13452', result: -2389 };
    sheet.getCell('D1').numFmt = '#,##0;(#,##0)';
    sheet.getCell('E1').value = 0.215945;
    sheet.getCell('E1').numFmt = 'General';
    sheet.getCell('F1').value = { formula: '1/0', result: { error: '#DIV/0!' } };
    const secondSheet = workbook.addWorksheet('Data');
    secondSheet.getCell('A1').value = 11063;
    const result = await extractFromWorkbook(await workbook.xlsx.writeBuffer() as ArrayBuffer, ['Country Revenue', 'Data']);

    expect(result.text).toContain('B1: 11063 [number format: "#,##0"]');
    expect(result.text).toContain('C1: =2389/B1 => 0.215945 [number format: "0.0%"]');
    expect(result.text).toContain('D1: =B1-13452 => -2389 [number format: "#,##0;(#,##0)"]');
    expect(result.text).toContain('E1: 0.215945\n');
    expect(result.text.split('\n').find(line => line.includes('F1: =1/0'))).not.toContain('[number format:');
    expect(result.text).not.toContain('[number format: "General"]');
    expect(result.text).toContain('A1: Revenue\n');
    expect(result.text).toContain('never infer missing formatting from raw values alone');
    expect(result.text).toMatch(/^Values are raw, not Excel display text\./);
    expect(result.text.match(/Values are raw/g)).toHaveLength(1);
    expect(result.text).toContain('Untagged numbers use General (no custom number format).');
    expect(result.text).toContain('Sheet: Data\n  A1: 11063');
    expect(result.truncated).toBe(false);
  });

  it('keeps empty-sheet detection and missing-sheet behavior', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Empty');
    const buffer = await workbook.xlsx.writeBuffer() as ArrayBuffer;
    expect((await extractFromWorkbook(buffer, ['Empty'])).text).toContain('(empty)');
    const missing = await extractFromWorkbook(buffer, ['Missing']);
    expect(missing.text).toBe('');
    expect(missing.missingSheetNames).toEqual(['Missing']);
  });
});
