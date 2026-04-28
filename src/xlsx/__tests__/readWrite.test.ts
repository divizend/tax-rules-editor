import test from "node:test";
import assert from "node:assert/strict";

import * as XLSX from "xlsx";

import type { BusinessLogicWorkbook } from "../../domain/schema.js";
import { readBusinessLogicWorkbook } from "../readBusinessLogic.js";
import { writeBusinessLogicWorkbook } from "../writeBusinessLogic.js";

function makeWorkbook(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw) => String(raw)",
        formatFn: "(v) => String(v)",
      },
      {
        name: "string",
        parseFn: "(raw) => String(raw)",
        formatFn: "(v) => String(v)",
        refSheet: "Taxpayers",
        refColumn: "id",
      },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayers", columnName: "name", typeName: "string" },
    ],
    rules: [{ name: "ruleA", ruleFn: "(draft) => { draft.x = 1 }" }],
  };
}

test("write -> read roundtrip preserves values", () => {
  const wb = makeWorkbook();
  const buf = writeBusinessLogicWorkbook(wb);
  const read = readBusinessLogicWorkbook(buf);
  assert.deepEqual(read, wb);
});

test("missing sheets produce empty lists", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["name"], ["x"]]), "SomeOtherSheet");
  const out = XLSX.write(book, { bookType: "xlsx", type: "array" });
  const buf =
    out instanceof ArrayBuffer
      ? out
      : ArrayBuffer.isView(out)
        ? (() => {
            const sliced = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
            if (sliced instanceof ArrayBuffer) return sliced;
            const copy = new Uint8Array(out.byteLength);
            copy.set(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
            return copy.buffer;
          })()
        : (() => {
            throw new Error("Unexpected XLSX output type");
          })();
  const wb = readBusinessLogicWorkbook(buf);
  assert.deepEqual(wb, { inputTypes: [], columns: [], rules: [] });
});

