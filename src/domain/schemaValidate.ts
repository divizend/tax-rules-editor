import type { ValidationResult } from "./errors.js";
import type { BusinessLogicWorkbook, InputTypeDef, RuleDef } from "./schema.js";

type SchemaValidationError = ValidationResult<never>["errors"][number];

function sheetError(sheet: "InputTypes" | "Columns" | "Rules", message: string): SchemaValidationError {
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
  return [...dups].sort();
}

type ValidationContext = {
  inputTypeNames: Set<string>;
};

function validateInputTypes(workbook: BusinessLogicWorkbook, ctx: ValidationContext): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  let hasInvalidInputTypeName = false;
  for (const it of workbook.inputTypes) {
    if (!isNonEmptyName(it.name)) hasInvalidInputTypeName = true;
    else ctx.inputTypeNames.add(it.name.trim());
  }

  if (hasInvalidInputTypeName) {
    errors.push(sheetError("InputTypes", 'Input types must have a non-empty "name".'));
  }

  const dupInputTypeNames = collectDuplicateNames(
    workbook.inputTypes.filter((it): it is InputTypeDef & { name: string } => isNonEmptyName(it.name)),
  );
  if (dupInputTypeNames.length > 0) {
    errors.push(
      sheetError(
        "InputTypes",
        `Input type names must be unique. Duplicates: ${dupInputTypeNames.join(", ")}`,
      ),
    );
  }

  if (!ctx.inputTypeNames.has("taxpayerId")) {
    errors.push(sheetError("InputTypes", 'Missing mandatory input type "taxpayerId".'));
  }

  return errors;
}

function validateColumns(workbook: BusinessLogicWorkbook, ctx: ValidationContext): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  const taxpayersCols = workbook.columns.filter((c) => c.sheet === "Taxpayers");
  if (taxpayersCols.length === 0) {
    errors.push(sheetError("Columns", 'Columns must include at least one row for sheet "Taxpayers".'));
  } else {
    const idCol = taxpayersCols.find((c) => c.columnName === "id");
    if (!idCol || idCol.typeName !== "taxpayerId") {
      errors.push(
        sheetError(
          "Columns",
          'Sheet "Taxpayers" must define column "id" with input type "taxpayerId".',
        ),
      );
    }
  }

  let hasBlankOrMissingTypeName = false;
  const unknownTypeNames = new Set<string>();
  for (const col of workbook.columns) {
    if (!isNonEmptyName(col.typeName)) {
      hasBlankOrMissingTypeName = true;
      continue;
    }
    const trimmed = col.typeName.trim();
    if (!ctx.inputTypeNames.has(trimmed)) unknownTypeNames.add(trimmed);
  }

  if (hasBlankOrMissingTypeName) {
    errors.push(sheetError("Columns", "Column typeName must be a non-empty string."));
  }

  if (unknownTypeNames.size > 0) {
    errors.push(
      sheetError(
        "Columns",
        `Columns reference unknown input type(s): ${[...unknownTypeNames].sort().join(", ")}`,
      ),
    );
  }

  return errors;
}

function validateRules(workbook: BusinessLogicWorkbook): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  let hasInvalidRuleName = false;
  for (const r of workbook.rules) {
    if (!isNonEmptyName(r.name)) hasInvalidRuleName = true;
  }
  if (hasInvalidRuleName) {
    errors.push(sheetError("Rules", 'Rules must have a non-empty "name".'));
  }

  const dupRuleNames = collectDuplicateNames(
    workbook.rules.filter((r): r is RuleDef & { name: string } => isNonEmptyName(r.name)),
  );
  if (dupRuleNames.length > 0) {
    errors.push(sheetError("Rules", `Rule names must be unique. Duplicates: ${dupRuleNames.join(", ")}`));
  }

  return errors;
}

export function schemaValidate(
  workbook: BusinessLogicWorkbook,
): ValidationResult<BusinessLogicWorkbook> {
  const ctx: ValidationContext = { inputTypeNames: new Set<string>() };

  const errors: Array<SchemaValidationError> = [
    ...validateInputTypes(workbook, ctx),
    ...validateColumns(workbook, ctx),
    ...validateRules(workbook),
  ];

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: workbook, errors: [] };
}

