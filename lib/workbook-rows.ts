export type WorkbookRowsResult = {
  sheetName: string;
  rows: string[][];
};

export function workbookCellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  const record = value as Record<string, any>;
  if ('result' in record) return workbookCellText(record.result);
  if ('text' in record) return workbookCellText(record.text);
  if ('hyperlink' in record && 'text' in record) return workbookCellText(record.text);
  if (Array.isArray(record.richText)) return record.richText.map(part => part?.text ?? '').join('');
  return JSON.stringify(value);
}

async function loadWorkbook(buf: ArrayBuffer) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

export async function workbookSheetNames(buf: ArrayBuffer): Promise<string[]> {
  const wb = await loadWorkbook(buf);
  return wb.worksheets.map(sheet => sheet.name);
}

export async function workbookRows(buf: ArrayBuffer, sheetName?: string): Promise<string[][]> {
  const wb = await loadWorkbook(buf);
  const ws = (sheetName ? wb.getWorksheet(sheetName) : undefined) ?? wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex += 1) {
    const row = ws.getRow(rowIndex);
    const values: string[] = [];
    for (let colIndex = 1; colIndex <= ws.columnCount; colIndex += 1) {
      values.push(workbookCellText(row.getCell(colIndex).value));
    }
    rows.push(values);
  }
  return rows;
}

export async function firstWorkbookSheetRows(buf: ArrayBuffer): Promise<WorkbookRowsResult> {
  const wb = await loadWorkbook(buf);
  const ws = wb.worksheets[0];
  if (!ws) return { sheetName: 'Sheet 1', rows: [] };
  const rows: string[][] = [];
  for (let rowIndex = 1; rowIndex <= ws.rowCount; rowIndex += 1) {
    const row = ws.getRow(rowIndex);
    const values: string[] = [];
    for (let colIndex = 1; colIndex <= ws.columnCount; colIndex += 1) {
      values.push(workbookCellText(row.getCell(colIndex).value));
    }
    rows.push(values);
  }
  return { sheetName: ws.name, rows };
}

export function rowsToCsv(rows: string[][]): string {
  return rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(',')).join('\n');
}
