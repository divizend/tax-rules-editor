import type { ValidationResult } from "./errors.js";
import type { BusinessLogicWorkbook, ColumnDef, InputTypeDef, RuleDef } from "./schema.js";
import { entityIdTypeName } from "./naming";

type SchemaValidationError = ValidationResult<never>["errors"][number];

function sheetError(sheet: "InputType" | "Column" | "Rule", message: string): SchemaValidationError {
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
  entitySheets: Set<string>;
  inputTypeByName: Map<string, InputTypeDef>;
};

function trim(v: string): string {
  return v.trim();
}

function distinctEntities(columns: ColumnDef[]): string[] {
  const set = new Set<string>();
  for (const c of columns) {
    const s = trim(c.sheet);
    if (s.length > 0) set.add(s);
  }
  return [...set].sort();
}

function validateInputTypes(workbook: BusinessLogicWorkbook): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  let hasInvalidInputTypeName = false;
  for (const it of workbook.inputTypes) {
    if (!isNonEmptyName(it.name)) hasInvalidInputTypeName = true;
  }
  if (hasInvalidInputTypeName) {
    errors.push(sheetError("InputType", 'Input types must have a non-empty "name".'));
  }

  const dupInputTypeNames = collectDuplicateNames(
    workbook.inputTypes.filter((it): it is InputTypeDef & { name: string } => isNonEmptyName(it.name)),
  );
  if (dupInputTypeNames.length > 0) {
    errors.push(
      sheetError(
        "InputType",
        `Input type names must be unique. Duplicates: ${dupInputTypeNames.join(", ")}`,
      ),
    );
  }

  if (!workbook.inputTypes.some((it) => trim(it.name) === "taxpayerId")) {
    errors.push(sheetError("InputType", 'Missing mandatory input type "taxpayerId".'));
  }

  return errors;
}

function validateColumns(workbook: BusinessLogicWorkbook, ctx: ValidationContext): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  const entities = distinctEntities(workbook.columns);
  const colsByEntity = new Map<string, ColumnDef[]>();
  for (const c of workbook.columns) {
    const s = trim(c.sheet);
    if (s.length === 0) continue;
    const arr = colsByEntity.get(s);
    if (arr) arr.push(c);
    else colsByEntity.set(s, [c]);
  }

  if (!colsByEntity.has("Taxpayer")) {
    errors.push(sheetError("Column", 'Columns must define at least one entity sheet named "Taxpayer".'));
  } else {
    const tpCols = colsByEntity.get("Taxpayer") ?? [];
    const idCol = tpCols.find((c) => trim(c.columnName) === "id");
    if (!idCol || trim(idCol.typeName) !== "taxpayerId") {
      errors.push(
        sheetError(
          "Column",
          'Entity "Taxpayer" must define column "id" with input type "taxpayerId".',
        ),
      );
    }
  }

  // Every declared entity must have mandatory id column + correct id type name.
  for (const entity of entities) {
    const idType = entityIdTypeName(entity);
    const entityCols = colsByEntity.get(entity) ?? [];
    const idCol = entityCols.find((c) => trim(c.columnName) === "id");
    if (!idCol) {
      errors.push(sheetError("Column", `Entity "${entity}" is missing required column "id".`));
      continue;
    }
    if (trim(idCol.typeName) !== idType) {
      errors.push(
        sheetError(
          "Column",
          `Entity "${entity}" id column must use type "${idType}" (got "${trim(idCol.typeName)}").`,
        ),
      );
    }
  }

  // Column typeName references
  let hasBlankOrMissingTypeName = false;
  const unknownTypeNames = new Set<string>();
  for (const col of workbook.columns) {
    if (!isNonEmptyName(col.typeName)) {
      hasBlankOrMissingTypeName = true;
      continue;
    }
    const t = trim(col.typeName);
    if (!ctx.inputTypeNames.has(t)) unknownTypeNames.add(t);
  }

  if (hasBlankOrMissingTypeName) {
    errors.push(sheetError("Column", "Column typeName must be a non-empty string."));
  }

  if (unknownTypeNames.size > 0) {
    errors.push(
      sheetError(
        "Column",
        `Columns reference unknown input type(s): ${[...unknownTypeNames].sort().join(", ")}`,
      ),
    );
  }

  return errors;
}

function validateInputTypeRefsAndEntityBinding(
  workbook: BusinessLogicWorkbook,
  ctx: ValidationContext,
): SchemaValidationError[] {
  const errors: SchemaValidationError[] = [];

  for (const it of workbook.inputTypes) {
    if (!isNonEmptyName(it.name)) continue;
    const name = trim(it.name);
    const ref = it.ref == null || trim(it.ref).length === 0 ? "" : trim(it.ref);

    if (ref.length === 0) {
      // free-standing type: must not pretend to be an entity id type
      if (name.endsWith("Id")) {
        errors.push(
          sheetError(
            "InputType",
            `Input type "${name}" looks like an entity id type but "ref" is empty.`,
          ),
        );
      }
      continue;
    }

    if (!ctx.entitySheets.has(ref)) {
      errors.push(
        sheetError(
          "InputType",
          `InputType "${name}" has ref "${ref}" but that entity is not defined in Column.sheet.`,
        ),
      );
      continue;
    }

    const expected = entityIdTypeName(ref);
    if (name !== expected) {
      errors.push(
        sheetError(
          "InputType",
          `InputType "${name}" is bound to entity "${ref}" but must be named "${expected}".`,
        ),
      );
    }
  }

  // Every entity must have a bound InputType row
  for (const entity of [...ctx.entitySheets].sort()) {
    const expectedName = entityIdTypeName(entity);
    const it = ctx.inputTypeByName.get(expectedName);
    if (!it) {
      errors.push(
        sheetError(
          "InputType",
          `Missing entity id input type "${expectedName}" for entity "${entity}".`,
        ),
      );
      continue;
    }
    const ref = it.ref == null ? "" : trim(it.ref);
    if (ref !== entity) {
      errors.push(
        sheetError(
          "InputType",
          `Input type "${expectedName}" must have ref "${entity}" (got "${ref || ""}").`,
        ),
      );
    }
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
    errors.push(sheetError("Rule", 'Rules must have a non-empty "name".'));
  }

  const dupRuleNames = collectDuplicateNames(
    workbook.rules.filter((r): r is RuleDef & { name: string } => isNonEmptyName(r.name)),
  );
  if (dupRuleNames.length > 0) {
    errors.push(sheetError("Rule", `Rule names must be unique. Duplicates: ${dupRuleNames.join(", ")}`));
  }

  return errors;
}

export function schemaValidate(workbook: BusinessLogicWorkbook): ValidationResult<BusinessLogicWorkbook> {
  const inputTypeByName = new Map<string, InputTypeDef>();
  for (const it of workbook.inputTypes) {
    if (isNonEmptyName(it.name)) inputTypeByName.set(trim(it.name), it);
  }

  const ctx: ValidationContext = {
    inputTypeNames: new Set([...inputTypeByName.keys()]),
    entitySheets: new Set(distinctEntities(workbook.columns)),
    inputTypeByName,
  };

  const errors: Array<SchemaValidationError> = [
    ...validateInputTypes(workbook),
    ...validateColumns(workbook, ctx),
    ...validateInputTypeRefsAndEntityBinding(workbook, ctx),
    ...validateRules(workbook),
  ];

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: workbook, errors: [] };
}
