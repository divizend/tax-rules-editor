import type { BusinessLogicWorkbook } from "@/src/domain/schema";
import { makeEntityIdInputType } from "@/src/domain/entityIdInputType";

export function createNewBusinessLogicWorkbook(): BusinessLogicWorkbook {
  const taxpayerId = makeEntityIdInputType("Taxpayer");

  return {
    inputTypes: [
      {
        name: "string",
        description: "Free-form text",
        parseFn: "(raw, _wb) => String(raw ?? '')",
        formatFn: "(value) => String(value ?? '')",
      },
      {
        name: "number",
        description: "A finite number parsed from a string (blank => 0).",
        parseFn:
          "(raw, _wb) => {\n  const s = String(raw ?? '').trim();\n  if (s.length === 0) return 0;\n  const n = Number(s);\n  if (!Number.isFinite(n)) throw new Error('Not a number');\n  return n;\n}",
        formatFn: "(value) => String(value ?? '')",
      },
      {
        name: "boolean",
        description: "A true/false value parsed from a string (blank => false).",
        parseFn:
          "(raw, _wb) => {\n  const s = String(raw ?? '').trim().toLowerCase();\n  if (s.length === 0) return false;\n  if (s === 'true' || s === 't' || s === 'yes' || s === 'y' || s === '1') return true;\n  if (s === 'false' || s === 'f' || s === 'no' || s === 'n' || s === '0') return false;\n  throw new Error('Not a boolean');\n}",
        formatFn: "(value) => (value ? 'true' : 'false')",
      },
      taxpayerId,
    ],
    columns: [
      { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayer", columnName: "name", typeName: "string" },
    ],
    rules: [
      {
        name: "exampleRule",
        ruleFn:
          "(draft) => {\n  // Example: create a computed sheet\n  draft.Computed ??= [];\n  draft.Computed.push({ note: 'hello' });\n}",
      },
    ],
  };
}

// Backwards-compatible alias (UI should use createNewBusinessLogicWorkbook).
export const createStarterBusinessLogicWorkbook = createNewBusinessLogicWorkbook;

