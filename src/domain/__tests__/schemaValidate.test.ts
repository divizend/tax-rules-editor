import test from "node:test";
import assert from "node:assert/strict";

import type { BusinessLogicWorkbook } from "../schema.js";
import { schemaValidate } from "../schemaValidate.js";

function makeValidWorkbook(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: (raw) => raw,
        formatFn: (v) => String(v),
      },
      {
        name: "string",
        parseFn: (raw) => raw,
        formatFn: (v) => String(v),
      },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayers", columnName: "name", typeName: "string" },
    ],
    rules: [{ name: "ruleA", ruleFn: (ctx) => ctx }],
  };
}

function messages(result: ReturnType<typeof schemaValidate>): string[] {
  if (result.ok) return [];
  return result.errors.map((e) => e.message);
}

test("accepts a valid workbook", () => {
  const wb = makeValidWorkbook();
  const res = schemaValidate(wb);
  assert.equal(res.ok, true);
});

test("inputTypes must have unique non-empty names", () => {
  const wb = makeValidWorkbook();
  wb.inputTypes.push({ ...wb.inputTypes[1]!, name: "string" });
  wb.inputTypes.push({ ...wb.inputTypes[1]!, name: "   " });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  const m = messages(res);
  assert.ok(m.some((x) => x.includes("non-empty names")));
  assert.ok(m.some((x) => x.includes("unique names")));
});

test("mandatory input type 'taxpayerId' exists", () => {
  const wb = makeValidWorkbook();
  wb.inputTypes = wb.inputTypes.filter((t) => t.name !== "taxpayerId");

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assert.ok(messages(res).some((x) => x.includes("mandatory input type 'taxpayerId'")));
});

test("columns include at least one Taxpayers row", () => {
  const wb = makeValidWorkbook();
  wb.columns = [{ sheet: "Other", columnName: "x", typeName: "string" }];

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assert.ok(messages(res).some((x) => x.includes("sheet==='Taxpayers'")));
});

test("Taxpayers sheet contains id column with typeName taxpayerId", () => {
  const wb = makeValidWorkbook();
  wb.columns = wb.columns.filter((c) => c.columnName !== "id");

  const res1 = schemaValidate(wb);
  assert.equal(res1.ok, false);
  assert.ok(messages(res1).some((x) => x.includes("Taxpayers sheet must contain columnName==='id'")));

  const wb2 = makeValidWorkbook();
  const idCol = wb2.columns.find((c) => c.sheet === "Taxpayers" && c.columnName === "id")!;
  idCol.typeName = "string";

  const res2 = schemaValidate(wb2);
  assert.equal(res2.ok, false);
  assert.ok(messages(res2).some((x) => x.includes("typeName==='taxpayerId'")));
});

test("each ColumnDef.typeName references an existing input type", () => {
  const wb = makeValidWorkbook();
  wb.columns.push({ sheet: "Taxpayers", columnName: "foo", typeName: "doesNotExist" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assert.ok(messages(res).some((x) => x.includes("must reference an existing input type")));
});

test("rules have unique non-empty names", () => {
  const wb = makeValidWorkbook();
  wb.rules.push({ name: "ruleA", ruleFn: (ctx) => ctx });
  wb.rules.push({ name: "", ruleFn: (ctx) => ctx });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  const m = messages(res);
  assert.ok(m.some((x) => x.includes("rules must have non-empty names")));
  assert.ok(m.some((x) => x.includes("rules must have unique names")));
});

