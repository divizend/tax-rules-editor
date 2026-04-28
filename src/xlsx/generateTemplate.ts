import * as XLSX from "xlsx";

import type { BusinessLogicWorkbook } from "../domain/schema.js";

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

export function generateTemplate(wb: BusinessLogicWorkbook): ArrayBuffer {
  const book = XLSX.utils.book_new();

  const bySheet = new Map<string, string[]>();
  for (const col of wb.columns) {
    const sheet = col.sheet;
    const headers = bySheet.get(sheet);
    if (headers) headers.push(col.columnName);
    else bySheet.set(sheet, [col.columnName]);
  }

  for (const [sheetName, headers] of bySheet) {
    const aoa: unknown[][] = [headers];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }

  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  return toArrayBuffer(out);
}

