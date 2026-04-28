import type { InputTypeDef } from "./schema";
import { entityIdTypeName } from "./naming";

export function parseFnForEntityId(entity: string): string {
  // Keep this in sync with the worker parseFn contract: (raw, inputWorkbook) => value
  // and our input workbook shape: wb.sheets.<Entity> as array or { rows }.
  return (
    "(raw, wb) => {\n" +
    "  const id = String(raw ?? '').trim();\n" +
    "  if (!id) throw new Error('Blank id');\n" +
    `  const sheet = wb?.sheets?.${entity};\n` +
    "  const rows = Array.isArray(sheet) ? sheet : sheet?.rows;\n" +
    "  if (!rows) throw new Error('Missing entity sheet in input workbook');\n" +
    "  const ok = rows.some((r) => String(r?.raw?.id ?? '').trim() === id);\n" +
    "  if (!ok) throw new Error(`Unknown id \\\"${id}\\\"`);\n" +
    "  return id;\n" +
    "}"
  );
}

export function makeEntityIdInputType(entity: string): InputTypeDef {
  const name = entityIdTypeName(entity);
  return {
    name,
    description: `Identifier for ${entity} rows (validated against ${entity}.id values).`,
    ref: entity,
    parseFn: parseFnForEntityId(entity),
    formatFn: "(value) => String(value ?? '')",
  };
}

