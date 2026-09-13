/**
 * CSV serialisation, in one place.
 *
 * Extracted from dashboard.service.ts when the report builder (F2) needed the
 * same thing. Two copies of this would have been two copies of the injection
 * guard below, and the second copy is the one somebody writes from memory
 * without it.
 */

/**
 * Escapes one cell.
 *
 * Excel interprets a leading `=`, `+`, `-`, `@`, tab or carriage return as the
 * start of a FORMULA, so a cell reading `=HYPERLINK(...)` executes when the
 * file is opened. These files are opened in Excel by default and their content
 * comes from employee names, goal titles and free-text notes — all of which a
 * user types. Prefixing with an apostrophe is the standard defusal: Excel
 * shows the original text and evaluates nothing.
 */
export function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

/**
 * Rows to a CSV document, taking the header order from the first row's keys —
 * which is why the queries feeding this alias their columns to the human
 * heading they should carry.
 *
 * CRLF, not LF: this is a file for Excel on Windows, and RFC 4180 says CRLF.
 */
export function toCsv(rows: ReadonlyArray<Record<string, unknown>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);
  return [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
  ].join('\r\n');
}
