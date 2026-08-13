import type { BulkSubscriptionStudentRow } from '@/lib/db-subscriptions';

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      cells.push(value.trim()); value = '';
    } else value += character;
  }
  cells.push(value.trim());
  return cells;
}

const HEADER_ALIASES: Record<string, keyof BulkSubscriptionStudentRow> = {
  email: 'email', email_address: 'email',
  full_name: 'full_name', name: 'full_name',
  duration_months: 'duration_months', duration: 'duration_months',
  amount: 'amount', price: 'amount',
  currency: 'currency',
  due_date: 'due_date', deadline: 'due_date',
  payment_method: 'payment_method', method: 'payment_method',
  payment_reference: 'payment_reference', reference: 'payment_reference',
  notes: 'notes',
};

export function parseSubscriptionImportText(text: string): BulkSubscriptionStudentRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const first = parseCsvLine(lines[0]);
  const normalizedHeaders = first.map(value => value.toLowerCase().trim().replace(/[\s-]+/g, '_'));
  const hasHeader = normalizedHeaders.some(value => HEADER_ALIASES[value] === 'email');

  if (!hasHeader) {
    return lines.flatMap(line => {
      const [email, fullName] = parseCsvLine(line);
      return email ? [{ email, ...(fullName ? { full_name: fullName } : {}) }] : [];
    });
  }

  const headers = normalizedHeaders.map(value => HEADER_ALIASES[value] ?? null);
  return lines.slice(1).flatMap(line => {
    const cells = parseCsvLine(line);
    const row: Partial<Record<keyof BulkSubscriptionStudentRow, string>> = {};
    headers.forEach((header, index) => { if (header && cells[index]) row[header] = cells[index]; });
    return row.email ? [row as BulkSubscriptionStudentRow] : [];
  });
}
