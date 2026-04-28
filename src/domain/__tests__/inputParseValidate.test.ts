import test from "node:test";
import assert from "node:assert/strict";

import type { BusinessLogicWorkbook } from "../schema.js";
import type { RawInputWorkbook } from "../inputWorkbook.js";
import { parseAndValidateInputWorkbook } from "../inputParseValidate.js";

function makeSchema(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      { name: "taxpayerId", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "string", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "customerId", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "Customers" },
      {
        name: "orderId",
        parseFn: "(raw) => String(raw)",
        formatFn: "(v) => String(v)",
      },
      { name: "taxpayerRef", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "Taxpayers" },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayers", columnName: "name", typeName: "string" },

      { sheet: "Customers", columnName: "id", typeName: "string" },
      { sheet: "Customers", columnName: "taxpayerId", typeName: "taxpayerId" },

      { sheet: "Orders", columnName: "id", typeName: "orderId" },
      { sheet: "Orders", columnName: "customerId", typeName: "customerId" },
    ],
    rules: [],
  };
}

function makeInput(parts: Partial<RawInputWorkbook["sheets"]>): RawInputWorkbook {
  const sheets: RawInputWorkbook["sheets"] = {
    Taxpayers: [],
    Customers: [],
    Orders: [],
    ...parts,
  };
  return {
    sheetNames: Object.keys(sheets),
    sheets,
  };
}

function errors(res: ReturnType<typeof parseAndValidateInputWorkbook>) {
  assert.equal(res.ok, false);
  return res.errors;
}

test("missing required sheet is reported", () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    // Orders missing
    Orders: [],
  });

  // Simulate sheet truly missing from workbook read: delete key entirely
  delete (input.sheets as Record<string, unknown>).Orders;
  input.sheetNames = ["Taxpayers", "Customers"];

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some((e) => "sheet" in e && e.severity === "error" && e.sheet === "Orders"),
  );
});

test("missing required column is reported", () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Orders: [
      // missing customerId header/value entirely
      { rowNumber: 2, raw: { id: "O1" } },
    ],
  });

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Orders" &&
        e.row === 1 &&
        e.column === "customerId",
    ),
  );
});

test("blank id and duplicate id across sheets are errors", () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [
      { rowNumber: 2, raw: { id: "   ", taxpayerId: "T1" } }, // blank id
      { rowNumber: 3, raw: { id: "DUP", taxpayerId: "T1" } },
    ],
    Orders: [
      { rowNumber: 2, raw: { id: "DUP", customerId: "C1" } }, // duplicate across sheet
    ],
  });

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);

  assert.ok(
    errors(res).some(
      (e) => "sheet" in e && e.severity === "error" && e.sheet === "Customers" && e.row === 2 && e.column === "id",
    ),
  );
  assert.ok(
    errors(res).some(
      (e) => "sheet" in e && e.severity === "error" && e.sheet === "Orders" && e.row === 2 && e.column === "id",
    ),
  );
});

test("fk cell referencing a missing row is an error", () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Orders: [{ rowNumber: 2, raw: { id: "O1", customerId: "C_DOES_NOT_EXIST" } }],
  });

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Orders" &&
        e.row === 2 &&
        e.column === "customerId",
    ),
  );
});

test("taxpayer resolution: direct taxpayerId column wins", () => {
  const schema = makeSchema();
  schema.columns.push({ sheet: "Orders", columnName: "taxpayerId", typeName: "taxpayerId" });

  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Orders: [{ rowNumber: 2, raw: { id: "O1", customerId: "C1", taxpayerId: "T1" } }],
  });

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, true);
  assert.equal(res.value.rowsBySheet.Orders[0]!.taxpayerId, "T1");
});

test("taxpayer resolution: indirect via fk chain", () => {
  const schema = makeSchema();
  // Customers: remove direct taxpayerId; instead reference Taxpayers via FK type
  schema.columns = schema.columns.filter((c) => !(c.sheet === "Customers" && c.columnName === "taxpayerId"));
  schema.columns.push({ sheet: "Customers", columnName: "taxpayerRef", typeName: "taxpayerRef" });

  const input = makeInput({
    Taxpayers: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customers: [{ rowNumber: 2, raw: { id: "C1", taxpayerRef: "T1" } }],
    Orders: [{ rowNumber: 2, raw: { id: "O1", customerId: "C1" } }],
  });

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, true);
  assert.equal(res.value.rowsBySheet.Orders[0]!.taxpayerId, "T1");
});

test("taxpayer resolution: no path to taxpayer is an error", () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      { name: "taxpayerId", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "string", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "amount", parseFn: "(raw) => Number(raw)", formatFn: "(v) => String(v)" },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Orders", columnName: "id", typeName: "string" },
      { sheet: "Orders", columnName: "amount", typeName: "amount" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayers", "Orders"],
    sheets: {
      Taxpayers: [{ rowNumber: 2, raw: { id: "T1" } }],
      Orders: [{ rowNumber: 2, raw: { id: "O1", amount: "10" } }],
    },
  };

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Orders" &&
        e.row === 2 &&
        e.column === "id" &&
        e.message === "No path to a taxpayer could be resolved.",
    ),
  );
});

test("taxpayer resolution: ambiguous paths produce an error", () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      { name: "taxpayerId", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "string", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "refA", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "A" },
      { name: "refB", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "B" },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "A", columnName: "id", typeName: "string" },
      { sheet: "A", columnName: "taxpayerId", typeName: "taxpayerId" },
      { sheet: "B", columnName: "id", typeName: "string" },
      { sheet: "B", columnName: "taxpayerId", typeName: "taxpayerId" },
      { sheet: "X", columnName: "id", typeName: "string" },
      { sheet: "X", columnName: "aId", typeName: "refA" },
      { sheet: "X", columnName: "bId", typeName: "refB" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayers", "A", "B", "X"],
    sheets: {
      Taxpayers: [
        { rowNumber: 2, raw: { id: "T1" } },
        { rowNumber: 3, raw: { id: "T2" } },
      ],
      A: [{ rowNumber: 2, raw: { id: "A1", taxpayerId: "T1" } }],
      B: [{ rowNumber: 2, raw: { id: "B1", taxpayerId: "T2" } }],
      X: [{ rowNumber: 2, raw: { id: "X1", aId: "A1", bId: "B1" } }],
    },
  };

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "X" &&
        e.row === 2 &&
        e.column === "id" &&
        e.message.toLowerCase().includes("ambiguous"),
    ),
  );
});

test("taxpayer resolution: cycles are detected and reported", () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      { name: "taxpayerId", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "string", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)" },
      { name: "refA", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "A" },
      { name: "refB", parseFn: "(raw) => String(raw)", formatFn: "(v) => String(v)", refSheet: "B" },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "A", columnName: "id", typeName: "string" },
      { sheet: "A", columnName: "bId", typeName: "refB" },
      { sheet: "B", columnName: "id", typeName: "string" },
      { sheet: "B", columnName: "aId", typeName: "refA" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayers", "A", "B"],
    sheets: {
      Taxpayers: [{ rowNumber: 2, raw: { id: "T1" } }],
      A: [{ rowNumber: 2, raw: { id: "A1", bId: "B1" } }],
      B: [{ rowNumber: 2, raw: { id: "B1", aId: "A1" } }],
    },
  };

  const res = parseAndValidateInputWorkbook({ schema, input });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "A" &&
        e.row === 2 &&
        e.column === "id" &&
        e.message.toLowerCase().includes("cycle"),
    ),
  );
});

