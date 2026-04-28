import * as XLSX from "xlsx";

import type { RawInputRow, RawInputSheet, RawInputWorkbook } from "../domain/inputWorkbook.js";

function asStringCell(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function isRowFullyEmpty(raw: Record<string, string>, headers: string[]): boolean {
  return headers.every((h) => (raw[h] ?? "").trim().length === 0);
}

export function readInputWorkbook(arrayBuffer: ArrayBuffer): RawInputWorkbook {
  const book = XLSX.read(arrayBuffer, { type: "array" });
  const sheets: Record<string, RawInputSheet> = {};

  for (const sheetName of book.SheetNames) {
    const sheet = book.Sheets[sheetName];
    if (!sheet) continue;

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const headerRow = (aoa[0] ?? []) as unknown[];
    const headers = headerRow.map((h) => asStringCell(h).trim()).filter((h) => h.length > 0);

    const rows: RawInputRow[] = [];
    for (let i = 1; i < aoa.length; i++) {
      const row = (aoa[i] ?? []) as unknown[];
      const raw: Record<string, string> = {};
      for (let c = 0; c < headers.length; c++) {
        const h = headers[c]!;
        raw[h] = asStringCell(row[c]).trim();
      }
      if (headers.length > 0 && isRowFullyEmpty(raw, headers)) continue;
      rows.push({ rowNumber: i + 1, raw });
    }

    sheets[sheetName] = { sheetName, headers, rows };
  }

  const out: RawInputWorkbook = {
    sheetNames: [...book.SheetNames],
    sheets,
  };

  return out;
}

