import { ReportRow } from './report.service';

const HEADER = ['id', 'customer', 'status', 'total'];

/** One CSV field, quoted when it holds a comma, a quote or a line break (RFC 4180). */
export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** The report rows as CSV: a header line, then one line per row, each line ending in a newline. */
export function toCsv(rows: readonly ReportRow[]): string {
  const lines = [HEADER, ...rows.map((r) => [String(r.id), r.customer, r.status, r.total.toFixed(2)])];
  return lines.map((fields) => fields.map(csvField).join(',') + '\n').join('');
}
