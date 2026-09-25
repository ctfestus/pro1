import { google } from 'googleapis';
import { getRedis } from '@/lib/redis';

export interface PaymentRow {
  email: string;
  billing_month: string;
  amount_due: number;
  amount_paid: number;
  status: 'unpaid' | 'partial' | 'paid' | 'waived' | string;
  notes: string;
  _rowIndex?: number; // 1-based sheet row index (includes header row)
}

const CACHE_KEY_SUMMARY = 'payment:summary';
const CACHE_TTL_SUMMARY = 60 * 10;  // 10 minutes

export function getGoogleSheetsClient() {
  const email      = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!email || !privateKey) throw new Error('Google service account credentials are not configured.');

  const auth = new google.auth.GoogleAuth({
    credentials: { client_email: email, private_key: privateKey },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'], // read + write
  });
  return google.sheets({ version: 'v4', auth });
}

export function getGoogleSpreadsheetId(): string {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not configured.');
  return spreadsheetId;
}

function getSheetName() {
  const range = process.env.GOOGLE_SHEETS_RANGE ?? 'Sheet1!A:F';
  return range.split('!')[0]; // e.g. "Sheet1"
}

/** Fetch all payment rows from the Google Sheet, with Redis caching. */
export async function getPaymentRows(): Promise<PaymentRow[]> {
  const redis = getRedis();

  if (redis) {
    try {
      const cached = await redis.get<PaymentRow[]>(CACHE_KEY_SUMMARY);
      if (cached) return cached;
    } catch { /* cache miss */ }
  }

  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  const range         = process.env.GOOGLE_SHEETS_RANGE ?? 'Sheet1!A:F';
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not configured.');

  const sheets  = getGoogleSheetsClient();
  const res     = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rawRows = res.data.values ?? [];

  if (rawRows.length < 2) return [];

  const headers = rawRows[0].map((h: string) => String(h).toLowerCase().trim());
  const idx     = (name: string) => headers.indexOf(name);

  const iEmail  = idx('email');
  const iMonth  = idx('billing_month');
  const iDue    = idx('amount_due');
  const iPaid   = idx('amount_paid');
  const iStatus = idx('status');
  const iNotes  = idx('notes');

  const rows: PaymentRow[] = rawRows.slice(1)
    .map((row: any[], i: number) => ({
      email:         String(row[iEmail]  ?? '').toLowerCase().trim(),
      billing_month: String(row[iMonth]  ?? ''),
      amount_due:    parseFloat(row[iDue]   ?? '0') || 0,
      amount_paid:   parseFloat(row[iPaid]  ?? '0') || 0,
      status:        String(row[iStatus] ?? 'unpaid').toLowerCase().trim(),
      notes:         String(row[iNotes]  ?? ''),
      _rowIndex:     i + 2, // +1 for header row, +1 for 1-based index
    }))
    .filter((r: PaymentRow) => r.email);

  if (redis) {
    try { await redis.set(CACHE_KEY_SUMMARY, rows, { ex: CACHE_TTL_SUMMARY }); } catch { /* ignore */ }
  }

  return rows;
}

export interface PaymentRowUpdate {
  billing_month?: string;
  amount_due?: number;
  amount_paid?: number;
  // status is intentionally excluded -- it is controlled by a formula in the sheet
  notes?: string;
}

// Convert a 0-based column index to a column letter (e.g. 0 "A", 25 "Z", 26 "AA")
function colLetter(idx: number): string {
  let letter = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/** Update only the specific cells that changed -- never touches the formula (status) column. */
export async function updatePaymentRow(email: string, updates: PaymentRowUpdate): Promise<void> {
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is not configured.');

  const range   = process.env.GOOGLE_SHEETS_RANGE ?? 'Sheet1!A:F';
  const sheets  = getGoogleSheetsClient();
  const res     = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rawRows = res.data.values ?? [];

  if (rawRows.length < 2) throw new Error('Sheet has no data rows.');

  const headers  = rawRows[0].map((h: string) => String(h).toLowerCase().trim());
  const iEmail   = headers.indexOf('email');
  const iMonth   = headers.indexOf('billing_month');
  const iDue     = headers.indexOf('amount_due');
  const iPaid    = headers.indexOf('amount_paid');
  const iNotes   = headers.indexOf('notes');
  const sheetName = getSheetName();

  const normalised = email.toLowerCase().trim();
  const rowIdx     = rawRows.slice(1).findIndex(
    (row: any[]) => String(row[iEmail] ?? '').toLowerCase().trim() === normalised
  );

  if (rowIdx === -1) throw new Error(`Student "${email}" not found in the sheet.`);

  const sheetRow = rowIdx + 2; // +1 for header row, +1 for 1-based index

  // Build a list of individual cell updates -- one per changed field.
  // This way we NEVER write to the status column, so its formula stays intact.
  const cellUpdates: { range: string; values: string[][] }[] = [];

  if (updates.billing_month !== undefined)
    cellUpdates.push({ range: `${sheetName}!${colLetter(iMonth)}${sheetRow}`, values: [[updates.billing_month]] });

  if (updates.amount_due !== undefined)
    cellUpdates.push({ range: `${sheetName}!${colLetter(iDue)}${sheetRow}`, values: [[String(updates.amount_due)]] });

  if (updates.amount_paid !== undefined)
    cellUpdates.push({ range: `${sheetName}!${colLetter(iPaid)}${sheetRow}`, values: [[String(updates.amount_paid)]] });

  if (updates.notes !== undefined)
    cellUpdates.push({ range: `${sheetName}!${colLetter(iNotes)}${sheetRow}`, values: [[updates.notes]] });

  if (cellUpdates.length === 0) return; // nothing to write

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: cellUpdates,
    },
  });

  await invalidatePaymentCache();
}

/** Returns true if the student has any unpaid or partial billing row.
 *  Derives from the summary cache -- no separate per-student cache,
 *  so clicking Refresh in the dashboard immediately unblocks/blocks students.
 */
export async function studentHasOutstandingBalance(email: string): Promise<boolean> {
  const normalised = email.toLowerCase().trim();
  const rows       = await getPaymentRows();
  return rows.some(r => r.email === normalised && (r.status === 'unpaid' || r.status === 'partial'));
}

/** Invalidates all payment-related cache entries. */
export async function invalidatePaymentCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try { await redis.del(CACHE_KEY_SUMMARY); } catch { /* ignore */ }
}

/** The Google Sheets URL for the configured spreadsheet. */
export function getSheetUrl(): string {
  const id = process.env.GOOGLE_SHEETS_SPREADSHEET_ID ?? '';
  return id ? `https://docs.google.com/spreadsheets/d/${id}/edit` : '';
}
