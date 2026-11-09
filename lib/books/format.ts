/** Display helpers for the book store. Client-safe (no imports). */

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function fileSizeLabel(bytes: number | null | undefined): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const FORMAT_LABEL: Record<string, string> = {
  epub: 'EPUB ebook',
  pdf: 'PDF',
  html: 'Interactive HTML',
};

export function formatLabel(format: string | null | undefined): string {
  return (format && FORMAT_LABEL[format]) || (format ? format.toUpperCase() : '');
}
