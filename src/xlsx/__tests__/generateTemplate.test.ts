import test from "node:test";
import assert from "node:assert/strict";

import * as XLSX from "xlsx";

import type { BusinessLogicWorkbook } from "../../domain/schema.js";
import { generateTemplate } from "../generateTemplate.js";

function headerRow(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const header = (rows[0] ?? []) as unknown[];
  return header.map((v) => String(v ?? ""));
}

test("generateTemplate creates one sheet per distinct Columns.sheet", () => {
  const wb: BusinessLogicWorkbook = {
    inputTypes: [],
    rules: [],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayer", columnName: "name", typeName: "string" },
      { sheet: "Invoices", columnName: "invoiceId", typeName: "string" },
      { sheet: "Invoices", columnName: "amount", typeName: "string" },
    ],
  };

  const buf = generateTemplate(wb);
  const book = XLSX.read(buf, { type: "array" });

  assert.deepEqual(book.SheetNames, ["Taxpayer", "Invoices"]);
});

test("generateTemplate preserves header order per sheet as in wb.columns", () => {
  const wb: BusinessLogicWorkbook = {
    inputTypes: [],
    rules: [],
    columns: [
      { sheet: "A", columnName: "first", typeName: "string" },
      { sheet: "B", columnName: "only", typeName: "string" },
      { sheet: "A", columnName: "second", typeName: "string" },
    ],
  };

  const buf = generateTemplate(wb);
  const book = XLSX.read(buf, { type: "array" });

  assert.deepEqual(headerRow(book.Sheets.A!), ["first", "second"]);
  assert.deepEqual(headerRow(book.Sheets.B!), ["only"]);
});

