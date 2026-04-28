import test from "node:test";
import assert from "node:assert/strict";

import type { CellError, RuleError, SheetError } from "../errors.js";
import type { BusinessLogicWorkbook } from "../schema.js";
import { schemaValidate } from "../schemaValidate.js";

function makeValidWorkbook(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw) => raw",
        formatFn: "(v) => String(v)",
      },
      {
        name: "string",
        parseFn: "(raw) => raw",
        formatFn: "(v) => String(v)",
      },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayers", columnName: "name", typeName: "string" },
    ],
    rules: [{ name: "ruleA", ruleFn: "(draft) => draft" }],
  };
}

function errors(result: ReturnType<typeof schemaValidate>) {
  assert.equal(result.ok, false);
  return result.errors;
}

type ValidationError = SheetError | CellError | RuleError;

function hasSheet(e: ValidationError): e is SheetError | CellError {
  return "sheet" in e;
}

function assertHasError(
  result: ReturnType<typeof schemaValidate>,
  expected: { sheet: string; severity: "error" | "warning"; message?: string },
) {
  const es = errors(result);
  assert.ok(
    es.some(
      (e) =>
        hasSheet(e) &&
        e.sheet === expected.sheet &&
        e.severity === expected.severity &&
        (expected.message ? e.message === expected.message : true),
    ),
    `Expected error not found: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(es, null, 2)}`,
  );
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
  assertHasError(res, { sheet: "InputTypes", severity: "error", message: 'Input types must have a non-empty "name".' });
  // duplicates message includes the duplicated names, so keep this assertion tolerant
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "InputTypes" &&
        e.severity === "error" &&
        e.message.startsWith("Input type names must be unique. Duplicates:"),
    ),
  );
});

test("mandatory input type 'taxpayerId' exists", () => {
  const wb = makeValidWorkbook();
  wb.inputTypes = wb.inputTypes.filter((t) => t.name !== "taxpayerId");

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assertHasError(res, { sheet: "InputTypes", severity: "error", message: 'Missing mandatory input type "taxpayerId".' });
});

test("columns include at least one Taxpayers row", () => {
  const wb = makeValidWorkbook();
  wb.columns = [{ sheet: "Other", columnName: "x", typeName: "string" }];

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assertHasError(res, { sheet: "Columns", severity: "error", message: 'Columns must include at least one row for sheet "Taxpayers".' });
});

test("Taxpayers sheet contains id column with typeName taxpayerId", () => {
  const wb = makeValidWorkbook();
  wb.columns = wb.columns.filter((c) => c.columnName !== "id");

  const res1 = schemaValidate(wb);
  assert.equal(res1.ok, false);
  assertHasError(res1, {
    sheet: "Columns",
    severity: "error",
    message: 'Sheet "Taxpayers" must define column "id" with input type "taxpayerId".',
  });

  const wb2 = makeValidWorkbook();
  const idCol = wb2.columns.find((c) => c.sheet === "Taxpayers" && c.columnName === "id")!;
  idCol.typeName = "string";

  const res2 = schemaValidate(wb2);
  assert.equal(res2.ok, false);
  assertHasError(res2, {
    sheet: "Columns",
    severity: "error",
    message: 'Sheet "Taxpayers" must define column "id" with input type "taxpayerId".',
  });
});

test("each ColumnDef.typeName references an existing input type", () => {
  const wb = makeValidWorkbook();
  wb.columns.push({ sheet: "Taxpayers", columnName: "foo", typeName: "doesNotExist" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Columns" &&
        e.severity === "error" &&
        e.message.startsWith("Columns reference unknown input type(s): "),
    ),
  );
});

test("columns: blank/missing typeName vs unknown typeName are reported separately", () => {
  const wb = makeValidWorkbook();
  // blank / missing should trigger the dedicated message
  wb.columns.push({ sheet: "Taxpayers", columnName: "blank", typeName: "   " });
  // unknown non-empty should be listed in the unknown-types error
  wb.columns.push({ sheet: "Taxpayers", columnName: "unknown", typeName: "doesNotExist" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);

  assertHasError(res, { sheet: "Columns", severity: "error", message: "Column typeName must be a non-empty string." });

  // unknown types should list only non-empty unknown values (no blanks)
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Columns" &&
        e.severity === "error" &&
        e.message === "Columns reference unknown input type(s): doesNotExist",
    ),
  );
});

test("rules have unique non-empty names", () => {
  const wb = makeValidWorkbook();
  wb.rules.push({ name: "ruleA", ruleFn: "(draft) => draft" });
  wb.rules.push({ name: "", ruleFn: "(draft) => draft" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assertHasError(res, { sheet: "Rules", severity: "error", message: 'Rules must have a non-empty "name".' });
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Rules" &&
        e.severity === "error" &&
        e.message.startsWith("Rule names must be unique. Duplicates:"),
    ),
  );
});

