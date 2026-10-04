// Workbook-to-text extraction shared by the AI Excel reviewer and the instructor report drafter.
// Moved verbatim from app/api/excel-review/route.ts.

import ExcelJS from 'exceljs';

const MAX_FORMULAS = 200;
const MAX_SHEETS = 5;
const MAX_ROWS_PER_SHEET = 5_000;
const MAX_TOTAL_CELLS = 50_000;
const MAX_TEXT_BYTES = 300_000;
export const EXTRACTION_TIMEOUT_MS = 20_000;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error('Workbook extraction timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(handle!));
}

export interface WorkbookExtraction {
  text: string;
  reviewedSheetNames: string[];
  partiallyReviewedSheetNames: string[];
  missingSheetNames: string[];
  availableSheetNames: string[];
  truncated: boolean;
}

export async function extractFromWorkbook(buffer: ArrayBuffer, requestedSheetNames: string[]): Promise<WorkbookExtraction> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const availableSheetNames = wb.worksheets.map(ws => ws.name);
  const sheetsByName = new Map(wb.worksheets.map(ws => [ws.name.trim().toLowerCase(), ws]));
  const missingSheetNames = requestedSheetNames.filter(name => !sheetsByName.has(name.toLowerCase()));
  const selectedSheets = requestedSheetNames.length > 0
    ? requestedSheetNames.flatMap(name => {
        const worksheet = sheetsByName.get(name.toLowerCase());
        return worksheet ? [worksheet] : [];
      })
    : wb.worksheets.slice(0, MAX_SHEETS);

  const sections: string[] = [];
  const reviewedSheetNames: string[] = [];
  const partiallyReviewedSheetNames: string[] = [];
  let totalCells = 0;
  let totalChars = 0;

  // The cell and character budgets belong to the workbook, not to one worksheet, so each selected
  // sheet takes only its share of whatever is left. Recomputed per sheet, so a sheet that uses less
  // than its share hands the rest to the ones after it. A single shared pot let an oversized first
  // worksheet spend all of it and leave a later required worksheet unopened, which is the one case
  // a student cannot do anything about: the instructor chose both sheets.
  selectedSheets.forEach((ws, index) => {
    const sheetsLeft = selectedSheets.length - index;
    const cellCeiling = totalCells + Math.ceil((MAX_TOTAL_CELLS - totalCells) / sheetsLeft);
    const charCeiling = totalChars + Math.ceil((MAX_TEXT_BYTES - totalChars) / sheetsLeft);

    const lines: string[] = [`Sheet: ${ws.name}`];
    let formulaCount = 0;
    let formulaLimitNoted = false;
    let rowCount = 0;
    let sheetTruncated = false;

    ws.eachRow((row) => {
      if (rowCount >= MAX_ROWS_PER_SHEET) { sheetTruncated = true; return; }
      rowCount++;
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (totalCells >= cellCeiling) { sheetTruncated = true; return; }
        totalCells++;
        const addr = cell.address;
        if (cell.formula) {
          // A listing cap, not an extraction limit: the sheet was read, the prompt just stops
          // enumerating. It must not mark the sheet as partially extracted.
          if (formulaCount >= MAX_FORMULAS) {
            if (!formulaLimitNoted) {
              lines.push(`  ... (formula listing capped at ${MAX_FORMULAS} formulas)`);
              formulaLimitNoted = true;
            }
            return;
          }
          const raw = cell.value;
          const result = raw !== null && typeof raw === 'object' && 'result' in raw
            ? (raw as any).result
            : undefined;
          const val = result !== undefined ? ` => ${result}` : '';
          const line = `  ${addr}: =${cell.formula}${val}`;
          if (totalChars + line.length > charCeiling) { sheetTruncated = true; return; }
          totalChars += line.length;
          lines.push(line);
          formulaCount++;
        } else if (cell.value !== null && cell.value !== undefined && cell.value !== '') {
          const line = `  ${addr}: ${cell.value}`;
          if (totalChars + line.length > charCeiling) { sheetTruncated = true; return; }
          totalChars += line.length;
          lines.push(line);
        }
      });
    });

    if (lines.length === 1) lines.push('(empty)');
    if (sheetTruncated) {
      lines.push('  ... (worksheet partially extracted: review limit reached)');
      partiallyReviewedSheetNames.push(ws.name);
    } else {
      reviewedSheetNames.push(ws.name);
    }
    sections.push(lines.join('\n'));
  });

  return {
    text: sections.join('\n\n'),
    reviewedSheetNames,
    partiallyReviewedSheetNames,
    missingSheetNames,
    availableSheetNames,
    truncated: partiallyReviewedSheetNames.length > 0,
  };
}
