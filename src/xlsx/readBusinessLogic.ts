import * as XLSX from "xlsx";

import type { BusinessLogicWorkbook, ColumnDef, InputTypeDef, RuleDef } from "../domain/schema.js";

type SheetName = "InputType" | "Column" | "Rule";

const INPUT_TYPES_HEADERS = ["name", "description", "parseFn", "formatFn", "refSheet", "refColumn"] as const;
const COLUMNS_HEADERS = ["sheet", "columnName", "typeName"] as const;
const RULES_HEADERS = ["name", "ruleFn"] as const;

function readHeaderRow(sheet: XLSX.WorkSheet): string[] {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
  const header = rows[0] ?? [];
  return header.map((v) => String(v ?? "").trim());
}

function assertExactHeaders(sheetName: SheetName, actual: string[], expected: readonly string[]) {
  const sameLength = actual.length === expected.length;
  const same =
    sameLength && actual.every((h, i) => h === expected[i]);
  if (same) return;
  throw new Error(
    `Invalid headers for sheet "${sheetName}". Expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
  );
}

function sheetToRecords<T extends Record<string, unknown>>(
  sheetName: SheetName,
  sheet: XLSX.WorkSheet,
  headers: readonly string[],
): T[] {
  const actualHeaders = readHeaderRow(sheet);
  assertExactHeaders(sheetName, actualHeaders, headers);

  const records = XLSX.utils.sheet_to_json<T>(sheet, {
    defval: "",
    raw: false,
  });

  return records.filter((r) => {
    // drop fully-empty rows (common in hand-edited sheets)
    return headers.some((h) => {
      const v = (r as Record<string, unknown>)[h];
      return typeof v === "string" ? v.trim().length > 0 : v != null;
    });
  });
}

function asTrimmedString(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function emptyToUndefined(v: unknown): string | undefined {
  const s = asTrimmedString(v);
  return s.length === 0 ? undefined : s;
}

function normalizeSheetName(name: string): string {
  // Singular is canonical, but accept legacy plural forms in workbook content.
  if (name === "Taxpayers") return "Taxpayer";
  return name;
}

export function readBusinessLogicWorkbook(arrayBuffer: ArrayBuffer): BusinessLogicWorkbook {
  const book = XLSX.read(arrayBuffer, { type: "array" });

  // Canonical singular sheet names, but accept legacy plurals on import.
  const inputTypesSheet = book.Sheets.InputType ?? book.Sheets.InputTypes;
  const columnsSheet = book.Sheets.Column ?? book.Sheets.Columns;
  const rulesSheet = book.Sheets.Rule ?? book.Sheets.Rules;

  const inputTypes: InputTypeDef[] = inputTypesSheet
    ? sheetToRecords<Record<(typeof INPUT_TYPES_HEADERS)[number], unknown>>(
        "InputType",
        inputTypesSheet,
        INPUT_TYPES_HEADERS,
      ).map((r) => ({
        name: asTrimmedString(r.name),
        ...(emptyToUndefined(r.description) ? { description: emptyToUndefined(r.description) } : {}),
        parseFn: asTrimmedString(r.parseFn),
        formatFn: asTrimmedString(r.formatFn),
        ...(emptyToUndefined(r.refSheet) ? { refSheet: normalizeSheetName(emptyToUndefined(r.refSheet)!) } : {}),
        ...(emptyToUndefined(r.refColumn) ? { refColumn: emptyToUndefined(r.refColumn) } : {}),
      }))
    : [];

  const columns: ColumnDef[] = columnsSheet
    ? sheetToRecords<Record<(typeof COLUMNS_HEADERS)[number], unknown>>("Column", columnsSheet, COLUMNS_HEADERS).map(
        (r) => ({
          sheet: normalizeSheetName(asTrimmedString(r.sheet)),
          columnName: asTrimmedString(r.columnName),
          typeName: asTrimmedString(r.typeName),
        }),
      )
    : [];

  const rules: RuleDef[] = rulesSheet
    ? sheetToRecords<Record<(typeof RULES_HEADERS)[number], unknown>>("Rule", rulesSheet, RULES_HEADERS).map((r) => ({
        name: asTrimmedString(r.name),
        ruleFn: asTrimmedString(r.ruleFn),
      }))
    : [];

  return { inputTypes, columns, rules };
}

