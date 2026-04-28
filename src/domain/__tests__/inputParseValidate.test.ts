import test from "node:test";
import assert from "node:assert/strict";

import type { BusinessLogicWorkbook } from "../schema.js";
import type { RawInputWorkbook, ValidatedInputWorkbook } from "../inputWorkbook.js";
import type { ValidationResult } from "../errors.js";
import { parseAndValidateInputWorkbook } from "../inputParseValidate.js";
import { runParse } from "../../worker/jsRunner.worker.js";
import { entityIdTypeName } from "../naming";

type ParseResult = ValidationResult<ValidatedInputWorkbook>;

const jsRunner = {
  runParse: async (source: string, input: string, inputWorkbook?: unknown) =>
    Promise.resolve(runParse(source, input, inputWorkbook)),
};

function makeSchema(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        description: "Taxpayer id",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Taxpayer",
      },
      { name: "string", parseFn: "(raw, _wb) => String(raw ?? '')", formatFn: "(v) => String(v ?? '')" },
      {
        name: entityIdTypeName("Customer"),
        description: "Customer id",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Customer",
      },
      {
        name: entityIdTypeName("Order"),
        description: "Order id",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Order",
      },
      {
        name: "customerId",
        description: "FK to Customer.id",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Customer",
      },
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayer", columnName: "name", typeName: "string" },

      { sheet: "Customer", columnName: "id", typeName: entityIdTypeName("Customer") },
      { sheet: "Customer", columnName: "taxpayerId", typeName: "taxpayerId" },

      { sheet: "Order", columnName: "id", typeName: entityIdTypeName("Order") },
      { sheet: "Order", columnName: "customerId", typeName: "customerId" },
    ],
    rules: [],
  };
}

function makeInput(parts: Partial<RawInputWorkbook["sheets"]>): RawInputWorkbook {
  const sheets: RawInputWorkbook["sheets"] = {
    Taxpayer: [],
    Customer: [],
    Order: [],
    ...parts,
  };
  return {
    sheetNames: Object.keys(sheets),
    sheets,
  };
}

function errors(res: ParseResult) {
  assert.equal(res.ok, false);
  return res.errors;
}

test("missing required sheet is reported", async () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
  });

  delete (input.sheets as Record<string, unknown>).Order;
  input.sheetNames = ["Taxpayer", "Customer"];

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some((e) => "sheet" in e && e.severity === "error" && e.sheet === "Order"),
  );
});

test("missing required column is reported", async () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    // Order exists, but the required `customerId` column is absent from the sheet.
    Order: [
      {
        rowNumber: 2,
        raw: {
          id: "O1",
          // customerId intentionally omitted
        },
      },
    ],
  });

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Order" &&
        e.row === 1 &&
        e.column === "customerId",
    ),
  );
});

test("blank id and duplicate id across sheets are errors", async () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [
      { rowNumber: 2, raw: { id: "   ", taxpayerId: "T1" } },
      { rowNumber: 3, raw: { id: "DUP", taxpayerId: "T1" } },
    ],
    Order: [{ rowNumber: 2, raw: { id: "DUP", customerId: "C1" } }],
  });

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);

  assert.ok(
    errors(res).some(
      (e) => "sheet" in e && e.severity === "error" && e.sheet === "Customer" && e.row === 2 && e.column === "id",
    ),
  );
  assert.ok(
    errors(res).some(
      (e) => "sheet" in e && e.severity === "error" && e.sheet === "Order" && e.row === 2 && e.column === "id",
    ),
  );
});

test("fk cell referencing a missing row is an error", async () => {
  const schema = makeSchema();
  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Order: [{ rowNumber: 2, raw: { id: "O1", customerId: "C_DOES_NOT_EXIST" } }],
  });

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Order" &&
        e.row === 2 &&
        e.column === "customerId",
    ),
  );
});

test("taxpayer resolution: direct taxpayerId column wins", async () => {
  const schema = makeSchema();
  schema.columns.push({ sheet: "Order", columnName: "taxpayerId", typeName: "taxpayerId" });

  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Order: [{ rowNumber: 2, raw: { id: "O1", customerId: "C1", taxpayerId: "T1" } }],
  });

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, true);
  assert.equal(res.value.rowsBySheet.Order[0]!.taxpayerId, "T1");
});

test("taxpayer resolution: indirect via fk chain", async () => {
  const schema = makeSchema();
  schema.columns = schema.columns.filter((c) => !(c.sheet === "Order" && c.columnName === "taxpayerId"));

  const input = makeInput({
    Taxpayer: [{ rowNumber: 2, raw: { id: "T1", name: "Alice" } }],
    Customer: [{ rowNumber: 2, raw: { id: "C1", taxpayerId: "T1" } }],
    Order: [{ rowNumber: 2, raw: { id: "O1", customerId: "C1" } }],
  });

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, true);
  assert.equal(res.value.rowsBySheet.Order[0]!.taxpayerId, "T1");
});

test("taxpayer resolution: no path to taxpayer is an error", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Taxpayer",
      },
      { name: "string", parseFn: "(raw, _wb) => String(raw ?? '')", formatFn: "(v) => String(v ?? '')" },
      {
        name: "amount",
        parseFn: "(raw, _wb) => Number(raw)",
        formatFn: "(v) => String(v ?? '')",
      },
      {
        name: entityIdTypeName("Order"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Order",
      },
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Order", columnName: "id", typeName: entityIdTypeName("Order") },
      { sheet: "Order", columnName: "amount", typeName: "amount" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayer", "Order"],
    sheets: {
      Taxpayer: [{ rowNumber: 2, raw: { id: "T1" } }],
      Order: [{ rowNumber: 2, raw: { id: "O1", amount: "10" } }],
    },
  };

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "Order" &&
        e.row === 2 &&
        e.column === "id" &&
        e.message === "No path to a taxpayer could be resolved.",
    ),
  );
});

test("taxpayer resolution: ambiguous paths produce an error", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Taxpayer",
      },
      { name: "string", parseFn: "(raw, _wb) => String(raw ?? '')", formatFn: "(v) => String(v ?? '')" },
      {
        name: entityIdTypeName("A"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "A",
      },
      {
        name: entityIdTypeName("B"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "B",
      },
      {
        name: "bId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "B",
      },
      {
        name: "aId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "A",
      },
      {
        name: entityIdTypeName("X"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "X",
      },
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "A", columnName: "id", typeName: entityIdTypeName("A") },
      { sheet: "A", columnName: "taxpayerId", typeName: "taxpayerId" },
      { sheet: "B", columnName: "id", typeName: entityIdTypeName("B") },
      { sheet: "B", columnName: "taxpayerId", typeName: "taxpayerId" },
      { sheet: "X", columnName: "id", typeName: entityIdTypeName("X") },
      { sheet: "X", columnName: "aId", typeName: "aId" },
      { sheet: "X", columnName: "bId", typeName: "bId" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayer", "A", "B", "X"],
    sheets: {
      Taxpayer: [
        { rowNumber: 2, raw: { id: "T1" } },
        { rowNumber: 3, raw: { id: "T2" } },
      ],
      A: [{ rowNumber: 2, raw: { id: "A1", taxpayerId: "T1" } }],
      B: [{ rowNumber: 2, raw: { id: "B1", taxpayerId: "T2" } }],
      X: [{ rowNumber: 2, raw: { id: "X1", aId: "A1", bId: "B1" } }],
    },
  };

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        "sheet" in e &&
        e.severity === "error" &&
        e.sheet === "X" &&
        e.row === 2 &&
        e.column === "id" &&
        (e.message.toLowerCase().includes("ambiguous") ||
          e.message.toLowerCase().includes("cycle")),
    ),
  );
});

test("taxpayer resolution: cycles are detected and reported", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Taxpayer",
      },
      { name: "string", parseFn: "(raw, _wb) => String(raw ?? '')", formatFn: "(v) => String(v ?? '')" },
      {
        name: entityIdTypeName("A"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "A",
      },
      {
        name: entityIdTypeName("B"),
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "B",
      },
      {
        name: "bId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "B",
      },
      {
        name: "aId",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "A",
      },
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "A", columnName: "id", typeName: entityIdTypeName("A") },
      { sheet: "A", columnName: "bId", typeName: "bId" },
      { sheet: "B", columnName: "id", typeName: entityIdTypeName("B") },
      { sheet: "B", columnName: "aId", typeName: "aId" },
    ],
    rules: [],
  };

  const input: RawInputWorkbook = {
    sheetNames: ["Taxpayer", "A", "B"],
    sheets: {
      Taxpayer: [{ rowNumber: 2, raw: { id: "T1" } }],
      A: [{ rowNumber: 2, raw: { id: "A1", bId: "B1" } }],
      B: [{ rowNumber: 2, raw: { id: "B1", aId: "A1" } }],
    },
  };

  const res = await parseAndValidateInputWorkbook({ schema, input, jsRunner });
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
