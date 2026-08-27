/**
 * CSV export.
 *
 * Every panel exports, and a raw instance-level export exists for offline
 * analysis. Row counts must match what is on screen for the same filters —
 * so the rows handed in here are always the rows the panel rendered, never a
 * second query with its own idea of the window.
 */

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  // CRLF and a UTF-8 BOM, so Excel on Windows opens it without mangling.
  return `﻿${lines.join("\r\n")}\r\n`;
}

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  // A leading =, +, - or @ is treated as a formula by Excel; prefix it so a
  // task title can never execute as one.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "cache-control": "no-store",
    },
  });
}

/** Rates go out as a plain decimal so a spreadsheet can do arithmetic on them. */
export function csvRate(value: number | null): string {
  return value === null ? "" : value.toFixed(4);
}
