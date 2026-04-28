import * as XLSX from "xlsx";

import type { BusinessLogicWorkbook } from "../domain/schema.js";

const INPUT_TYPES_HEADERS = ["name", "description", "parseFn", "formatFn", "refSheet", "refColumn"] as const;
const COLUMNS_HEADERS = ["sheet", "columnName", "typeName"] as const;
const RULES_HEADERS = ["name", "ruleFn"] as const;

function toArrayBuffer(output: unknown): ArrayBuffer {
  if (output instanceof ArrayBuffer) return output;
  if (ArrayBuffer.isView(output)) {
    const sliced = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
    if (sliced instanceof ArrayBuffer) return sliced;
    // In some runtimes the underlying buffer can be a SharedArrayBuffer.
    const copy = new Uint8Array(output.byteLength);
    copy.set(new Uint8Array(output.buffer, output.byteOffset, output.byteLength));
    return copy.buffer;
  }
  throw new Error(`Unexpected XLSX write output type: ${Object.prototype.toString.call(output)}`);
}

export function writeBusinessLogicWorkbook(wb: BusinessLogicWorkbook): ArrayBuffer {
  const book = XLSX.utils.book_new();

  const inputTypesAoA: unknown[][] = [
    [...INPUT_TYPES_HEADERS],
    ...wb.inputTypes.map((it) => [
      it.name,
      it.description ?? "",
      it.parseFn,
      it.formatFn,
      it.refSheet ?? "",
      it.refColumn ?? "",
    ]),
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(inputTypesAoA), "InputType");

  const columnsAoA: unknown[][] = [
    [...COLUMNS_HEADERS],
    ...wb.columns.map((c) => [c.sheet, c.columnName, c.typeName]),
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(columnsAoA), "Column");

  const rulesAoA: unknown[][] = [
    [...RULES_HEADERS],
    ...wb.rules.map((r) => [r.name, r.ruleFn]),
  ];
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rulesAoA), "Rule");

  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  return toArrayBuffer(out);
}

