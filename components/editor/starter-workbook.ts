import type { BusinessLogicWorkbook } from "@/src/domain/schema";

export function createNewBusinessLogicWorkbook(): BusinessLogicWorkbook {
  return {
    inputTypes: [
      {
        name: "taxpayerId",
        parseFn: "(raw) => String(raw ?? '').trim()",
        formatFn: "(value) => String(value ?? '')",
      },
      {
        name: "string",
        parseFn: "(raw) => String(raw ?? '')",
        formatFn: "(value) => String(value ?? '')",
      },
      {
        name: "number",
        parseFn: "(raw) => {\n  const s = String(raw ?? '').trim();\n  if (s.length === 0) return 0;\n  const n = Number(s);\n  if (!Number.isFinite(n)) throw new Error('Not a number');\n  return n;\n}",
        formatFn: "(value) => String(value ?? '')",
      },
    ],
    columns: [
      { sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" },
      { sheet: "Taxpayers", columnName: "name", typeName: "string" },
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

