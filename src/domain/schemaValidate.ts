import type { ValidationResult } from "./errors.js";
import type { BusinessLogicWorkbook, ColumnDef, InputTypeDef, RuleDef } from "./schema.js";

type SchemaValidationError = ValidationResult<never>["errors"][number];

function sheetError(sheet: string, message: string): SchemaValidationError {
  return { severity: "error", sheet, message };
}

function isNonEmptyName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function collectDuplicateNames(items: Array<{ name: string }>): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const item of items) {
    const name = item.name.trim();
    if (seen.has(name)) dups.add(name);
    seen.add(name);
  }
  return [...dups];
}

export function schemaValidate(
  workbook: BusinessLogicWorkbook,
): ValidationResult<BusinessLogicWorkbook> {
  const errors: Array<SchemaValidationError> = [];

  // inputTypes invariants
  const inputTypeNames = new Set<string>();
  const invalidInputTypeNames: string[] = [];
  for (const it of workbook.inputTypes) {
    if (!isNonEmptyName(it.name)) invalidInputTypeNames.push(String(it.name));
    else inputTypeNames.add(it.name.trim());
  }

  if (invalidInputTypeNames.length > 0) {
    errors.push(sheetError("InputTypes", "inputTypes must have non-empty names"));
  }

  const dupInputTypeNames = collectDuplicateNames(
    workbook.inputTypes.filter((it): it is InputTypeDef & { name: string } => isNonEmptyName(it.name)),
  );
  if (dupInputTypeNames.length > 0) {
    errors.push(
      sheetError(
        "InputTypes",
        `inputTypes must have unique names (duplicates: ${dupInputTypeNames.join(", ")})`,
      ),
    );
  }

  if (!inputTypeNames.has("taxpayerId")) {
    errors.push(sheetError("InputTypes", "mandatory input type 'taxpayerId' must exist"));
  }

  // columns invariants
  const taxpayersCols = workbook.columns.filter((c) => c.sheet === "Taxpayers");
  if (taxpayersCols.length === 0) {
    errors.push(sheetError("Columns", "columns must include at least one row with sheet==='Taxpayers'"));
  } else {
    const idCol = taxpayersCols.find((c) => c.columnName === "id");
    if (!idCol) {
      errors.push(
        sheetError("Taxpayers", "Taxpayers sheet must contain columnName==='id' with typeName==='taxpayerId'"),
      );
    } else if (idCol.typeName !== "taxpayerId") {
      errors.push(
        sheetError(
          "Taxpayers",
          "Taxpayers sheet must contain columnName==='id' with typeName==='taxpayerId'",
        ),
      );
    }
  }

  // ColumnDef.typeName must reference an existing input type
  const missingTypeRefs = new Set<string>();
  for (const col of workbook.columns) {
    if (!isNonEmptyName(col.typeName) || !inputTypeNames.has(col.typeName.trim())) {
      missingTypeRefs.add(String(col.typeName));
    }
  }
  if (missingTypeRefs.size > 0) {
    errors.push(
      sheetError(
        "Columns",
        `each ColumnDef.typeName must reference an existing input type (missing: ${[
          ...missingTypeRefs,
        ].join(", ")})`,
      ),
    );
  }

  // rules invariants
  const invalidRuleNames: string[] = [];
  for (const r of workbook.rules) {
    if (!isNonEmptyName(r.name)) invalidRuleNames.push(String(r.name));
  }
  if (invalidRuleNames.length > 0) {
    errors.push(sheetError("Rules", "rules must have non-empty names"));
  }

  const dupRuleNames = collectDuplicateNames(
    workbook.rules.filter((r): r is RuleDef & { name: string } => isNonEmptyName(r.name)),
  );
  if (dupRuleNames.length > 0) {
    errors.push(
      sheetError("Rules", `rules must have unique names (duplicates: ${dupRuleNames.join(", ")})`),
    );
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: workbook, errors: [] };
}

