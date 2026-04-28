import test from "node:test";
import assert from "node:assert/strict";

import type { CellError, RuleError, SheetError } from "../errors.js";
import type { BusinessLogicWorkbook } from "../schema.js";
import { schemaValidate } from "../schemaValidate.js";
import { entityIdTypeName } from "../naming";

function makeValidWorkbook(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        description: "Taxpayer primary key",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
        ref: "Taxpayer",
      },
      {
        name: "string",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(v) => String(v ?? '')",
      },
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayer", columnName: "name", typeName: "string" },
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
  assertHasError(res, { sheet: "InputType", severity: "error", message: 'Input types must have a non-empty "name".' });
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "InputType" &&
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
  assertHasError(res, { sheet: "InputType", severity: "error", message: 'Missing mandatory input type "taxpayerId".' });
});

test("columns must declare the Taxpayer entity", () => {
  const wb = makeValidWorkbook();
  wb.columns = [{ sheet: "Other", columnName: "id", typeName: "string" }];

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assertHasError(res, {
    sheet: "Column",
    severity: "error",
    message: 'Columns must define at least one entity sheet named "Taxpayer".',
  });
});

test('Taxpayer entity must define column "id" typed as taxpayerId', () => {
  const wb = makeValidWorkbook();
  wb.columns = wb.columns.filter((c) => c.columnName !== "id");

  const res1 = schemaValidate(wb);
  assert.equal(res1.ok, false);
  assertHasError(res1, {
    sheet: "Column",
    severity: "error",
    message: 'Entity "Taxpayer" must define column "id" with input type "taxpayerId".',
  });

  const wb2 = makeValidWorkbook();
  const idCol = wb2.columns.find((c) => c.sheet === "Taxpayer" && c.columnName === "id")!;
  idCol.typeName = "string";

  const res2 = schemaValidate(wb2);
  assert.equal(res2.ok, false);
  assertHasError(res2, {
    sheet: "Column",
    severity: "error",
    message: 'Entity "Taxpayer" must define column "id" with input type "taxpayerId".',
  });
});

test("each ColumnDef.typeName references an existing input type", () => {
  const wb = makeValidWorkbook();
  wb.columns.push({ sheet: "Taxpayer", columnName: "foo", typeName: "doesNotExist" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Column" &&
        e.severity === "error" &&
        e.message.startsWith("Columns reference unknown input type(s): "),
    ),
  );
});

test("columns: blank/missing typeName vs unknown typeName are reported separately", () => {
  const wb = makeValidWorkbook();
  wb.columns.push({ sheet: "Taxpayer", columnName: "blank", typeName: "   " });
  wb.columns.push({ sheet: "Taxpayer", columnName: "unknown", typeName: "doesNotExist" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);

  assertHasError(res, { sheet: "Column", severity: "error", message: "Column typeName must be a non-empty string." });

  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Column" &&
        e.severity === "error" &&
        e.message === "Columns reference unknown input type(s): doesNotExist",
    ),
  );
});

test("entity id input types must exist and match ref binding", () => {
  const wb = makeValidWorkbook();
  wb.columns.push({ sheet: "Orders", columnName: "id", typeName: entityIdTypeName("Orders") });

  const missingIdType = schemaValidate(wb);
  assert.equal(missingIdType.ok, false);
  assert.ok(
    errors(missingIdType).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "InputType" &&
        e.message.includes(entityIdTypeName("Orders")) &&
        e.message.includes("Orders"),
    ),
  );

  const fixed: BusinessLogicWorkbook = structuredClone(wb);
  fixed.inputTypes.push({
    name: entityIdTypeName("Orders"),
    parseFn: "(raw, _wb) => String(raw ?? '')",
    formatFn: "(v) => String(v ?? '')",
    ref: "Orders",
  });

  const wrongRef = schemaValidate({ ...fixed, inputTypes: [...fixed.inputTypes.map((it) => (it.name === entityIdTypeName("Orders") ? { ...it, ref: "Nope" } : it))] });
  assert.equal(wrongRef.ok, false);
  assert.ok(
    errors(wrongRef).some(
      (e) => hasSheet(e) && e.sheet === "InputType" && e.message.includes('must have ref "Orders"'),
    ),
  );
});

test("rules have unique non-empty names", () => {
  const wb = makeValidWorkbook();
  wb.rules.push({ name: "ruleA", ruleFn: "(draft) => draft" });
  wb.rules.push({ name: "", ruleFn: "(draft) => draft" });

  const res = schemaValidate(wb);
  assert.equal(res.ok, false);
  assertHasError(res, { sheet: "Rule", severity: "error", message: 'Rules must have a non-empty "name".' });
  assert.ok(
    errors(res).some(
      (e) =>
        hasSheet(e) &&
        e.sheet === "Rule" &&
        e.severity === "error" &&
        e.message.startsWith("Rule names must be unique. Duplicates:"),
    ),
  );
});
