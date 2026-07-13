/**
 * Tiny dependency-free CSV serialiser for report exports.
 *
 * `toCsv(rows, columns)` renders an array of plain records into RFC-4180-ish CSV:
 *   • columns drive both the header (their `label`) and the per-row order (`key`),
 *   • any field containing a comma, double-quote, CR or LF is wrapped in double
 *     quotes with embedded quotes doubled (`"` → `""`),
 *   • null/undefined become empty cells,
 *   • rows are joined with CRLF (Excel-friendly),
 *   • a UTF-8 BOM is prepended so Excel detects UTF-8 and renders CJK correctly.
 *
 * It is intentionally not streaming — report payloads here are small (aggregated
 * in Node), so building one string is fine.
 */

export interface CsvColumn {
  /** Property name to read from each row. */
  key: string
  /** Human-readable header label for this column. */
  label: string
}

const BOM = "﻿"

/** Escape a single cell value per CSV quoting rules. */
function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  const s = typeof value === "string" ? value : String(value)
  // Quote when the cell contains a delimiter, quote, or newline.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: CsvColumn[]): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",")
  const body = rows.map((row) => columns.map((c) => escapeCell(row[c.key])).join(",")).join("\r\n")
  const lines = body ? `${header}\r\n${body}` : header
  return `${BOM}${lines}`
}
