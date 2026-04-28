import type { BusinessLogicWorkbook, ColumnDef, InputTypeDef } from "./schema.js";
import type { CellError, SheetError, ValidationResult } from "./errors.js";
import type {
  GlobalRowIndexEntry,
  RawInputRow,
  RawInputWorkbook,
  ValidatedInputRow,
  ValidatedInputWorkbook,
} from "./inputWorkbook.js";
import type { JsRunnerClient } from "../worker/client.js";

type AnyValidationError = ValidationResult<never>["errors"][number];

function sheetError(sheet: string, message: string, extras?: Partial<SheetError>): SheetError {
  return { severity: "error", sheet, message, ...extras };
}

function cellError(sheet: string, row: number, column: string, message: string): CellError {
  return { severity: "error", sheet, row, column, message };
}

function asSheetRows(input: RawInputWorkbook, sheetName: string): { headers: string[]; rows: RawInputRow[] } | null {
  const v = input.sheets[sheetName];
  if (!v) return null;
  if (Array.isArray(v)) {
    const headers = new Set<string>();
    for (const r of v) for (const k of Object.keys(r.raw ?? {})) headers.add(k);
    return { headers: [...headers], rows: v };
  }
  return { headers: v.headers ?? Object.keys(v.rows[0]?.raw ?? {}), rows: v.rows };
}

function groupColumnsBySheet(columns: ColumnDef[]): Map<string, ColumnDef[]> {
  const bySheet = new Map<string, ColumnDef[]>();
  for (const c of columns) {
    const arr = bySheet.get(c.sheet);
    if (arr) arr.push(c);
    else bySheet.set(c.sheet, [c]);
  }
  return bySheet;
}

function trim(v: string | undefined): string {
  return (v ?? "").trim();
}

type RowKey = `${string}:${string}`; // sheet:id

function rowKey(sheet: string, id: string): RowKey {
  return `${sheet}:${id}` as const;
}

type RowNode = {
  sheet: string;
  rowNumber: number;
  raw: Record<string, string>;
  id: string;
};

type WorkbookIndex = {
  bySheet: Record<string, RowNode[]>;
  idBySheet: Record<string, Record<string, RowNode>>;
  bySheetByColumnValue: Record<string, Record<string, Record<string, RowNode[]>>>;
};

function buildIndices(rowsBySheet: Record<string, RowNode[]>, columnsBySheet: Map<string, ColumnDef[]>): WorkbookIndex {
  const idBySheet: WorkbookIndex["idBySheet"] = {};
  const bySheetByColumnValue: WorkbookIndex["bySheetByColumnValue"] = {};

  for (const [sheet, rows] of Object.entries(rowsBySheet)) {
    const idMap: Record<string, RowNode> = {};
    for (const r of rows) idMap[r.id] = r;
    idBySheet[sheet] = idMap;

    const cols = columnsBySheet.get(sheet) ?? [];
    const colValueIndex: Record<string, Record<string, RowNode[]>> = {};
    for (const c of cols) colValueIndex[c.columnName] = {};
    // Always index by id as well (even if schema forgot it)
    if (!colValueIndex.id) colValueIndex.id = {};

    for (const r of rows) {
      for (const colName of Object.keys(colValueIndex)) {
        const v = trim(r.raw[colName]);
        if (v.length === 0) continue;
        const m = colValueIndex[colName]!;
        (m[v] ??= []).push(r);
      }
    }
    bySheetByColumnValue[sheet] = colValueIndex;
  }

  return { bySheet: rowsBySheet, idBySheet, bySheetByColumnValue };
}

function isFkType(it: InputTypeDef | undefined): it is InputTypeDef & { refSheet: string } {
  return !!it?.refSheet && it.refSheet.trim().length > 0;
}

function resolveFkTargets(
  idx: WorkbookIndex,
  it: InputTypeDef & { refSheet: string },
  rawValue: string,
): RowNode[] {
  const refSheet = it.refSheet;
  const refCol = trim(it.refColumn) || "id";
  const v = trim(rawValue);
  if (!idx.bySheetByColumnValue[refSheet]?.[refCol]) return [];
  return idx.bySheetByColumnValue[refSheet][refCol]![v] ?? [];
}

function resolveTaxpayerForRow(params: {
  schema: BusinessLogicWorkbook;
  inputTypesByName: Map<string, InputTypeDef>;
  columnsBySheet: Map<string, ColumnDef[]>;
  idx: WorkbookIndex;
  start: RowNode;
}): { ok: true; taxpayerId: string } | { ok: false; message: string } {
  const { schema, inputTypesByName, columnsBySheet, idx, start } = params;

  const taxpayersSheet = "Taxpayers";
  const taxpayersIdIndex = idx.bySheetByColumnValue[taxpayersSheet]?.id ?? {};

  const startCols = columnsBySheet.get(start.sheet) ?? [];
  const directTaxpayerCol = startCols.find((c) => c.columnName === "taxpayerId" && trim(c.typeName) === "taxpayerId");
  if (directTaxpayerCol) {
    const v = trim(start.raw[directTaxpayerCol.columnName]);
    if (v.length === 0) return { ok: false, message: 'Blank required "taxpayerId".' };
    const hits = taxpayersIdIndex[v] ?? [];
    if (hits.length !== 1) return { ok: false, message: `taxpayerId "${v}" does not resolve to exactly one Taxpayer.` };
    return { ok: true, taxpayerId: v };
  }

  const fkCols = startCols.filter((c) => isFkType(inputTypesByName.get(trim(c.typeName))));
  const stack: Array<{ node: RowNode; path: RowKey[] }> = [{ node: start, path: [rowKey(start.sheet, start.id)] }];
  const visited = new Set<RowKey>();

  const found = new Set<string>();
  const fkExpansionLimit = 10_000; // safety for pathological workbooks
  let expansions = 0;

  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    const k = rowKey(node.sheet, node.id);
    if (visited.has(k)) continue;
    visited.add(k);

    if (node.sheet === taxpayersSheet) {
      found.add(node.id);
      continue;
    }

    const cols = columnsBySheet.get(node.sheet) ?? [];
    const nodeDirect = cols.find((c) => c.columnName === "taxpayerId" && trim(c.typeName) === "taxpayerId");
    if (nodeDirect) {
      const v = trim(node.raw[nodeDirect.columnName]);
      if (v.length > 0) found.add(v);
    }

    const nodeFkCols = cols.filter((c) => isFkType(inputTypesByName.get(trim(c.typeName))));
    for (const c of nodeFkCols) {
      const rawValue = trim(node.raw[c.columnName]);
      if (rawValue.length === 0) continue;
      const it = inputTypesByName.get(trim(c.typeName));
      if (!it || !isFkType(it)) continue;

      const targets = resolveFkTargets(idx, it, rawValue);
      if (targets.length !== 1) continue; // FK errors are handled elsewhere; don't double-report here

      const t = targets[0]!;
      const nextKey = rowKey(t.sheet, t.id);
      if (path.includes(nextKey)) {
        return { ok: false, message: "Detected cycle while resolving taxpayer." };
      }

      expansions++;
      if (expansions > fkExpansionLimit) {
        return { ok: false, message: "Taxpayer resolution exceeded traversal limit." };
      }

      stack.push({ node: t, path: [...path, nextKey] });
    }
  }

  if (found.size === 0) return { ok: false, message: "No path to a taxpayer could be resolved." };
  if (found.size > 1) return { ok: false, message: `Ambiguous taxpayer resolution: ${[...found].sort().join(", ")}` };

  const only = [...found][0]!;
  const hits = taxpayersIdIndex[only] ?? [];
  if (hits.length !== 1) return { ok: false, message: `Resolved taxpayerId "${only}" does not match exactly one Taxpayer.` };

  return { ok: true, taxpayerId: only };
}

export function parseAndValidateInputWorkbook(params: {
  schema: BusinessLogicWorkbook;
  input: RawInputWorkbook;
}): ValidationResult<ValidatedInputWorkbook> {
  const { schema, input } = params;
  const errors: AnyValidationError[] = [];

  const inputTypesByName = new Map<string, InputTypeDef>();
  for (const it of schema.inputTypes) inputTypesByName.set(trim(it.name), it);

  const columnsBySheet = groupColumnsBySheet(schema.columns);
  const schemaSheetNames = [...columnsBySheet.keys()].sort();

  const requiredHeadersBySheet = new Map<string, Set<string>>();
  for (const [sheet, cols] of columnsBySheet) {
    const s = new Set<string>(cols.map((c) => c.columnName));
    s.add("id");
    requiredHeadersBySheet.set(sheet, s);
  }

  // 1) sheets + required headers
  for (const sheet of schemaSheetNames) {
    const sheetRows = asSheetRows(input, sheet);
    if (!sheetRows) {
      errors.push(sheetError(sheet, `Missing required sheet "${sheet}".`));
      continue;
    }

    const present = new Set<string>(sheetRows.headers);
    const required = requiredHeadersBySheet.get(sheet)!;
    for (const h of required) {
      if (!present.has(h)) {
        errors.push(sheetError(sheet, `Missing required column "${h}".`, { row: 1, column: h }));
      }
    }
  }

  const rowsBySheetNodes: Record<string, RowNode[]> = {};
  const globalRowIndex: Record<string, GlobalRowIndexEntry> = {};
  const idBySheetValidated: Record<string, Record<string, GlobalRowIndexEntry>> = {};
  const seenGlobalIds = new Map<string, { sheet: string; rowNumber: number }>();

  // 2) row shape + global id uniqueness
  for (const sheet of schemaSheetNames) {
    const sheetRows = asSheetRows(input, sheet);
    const rows = sheetRows?.rows ?? [];
    const nodes: RowNode[] = [];
    rowsBySheetNodes[sheet] = nodes;
    idBySheetValidated[sheet] = {};

    for (const r of rows) {
      const raw = r.raw ?? {};
      const id = trim(raw.id);
      if (id.length === 0) {
        errors.push(cellError(sheet, r.rowNumber, "id", 'Blank required "id".'));
        continue;
      }
      const prev = seenGlobalIds.get(id);
      if (prev) {
        errors.push(
          cellError(
            sheet,
            r.rowNumber,
            "id",
            `Duplicate global id "${id}" (already used in ${prev.sheet} row ${prev.rowNumber}).`,
          ),
        );
        continue;
      }
      seenGlobalIds.set(id, { sheet, rowNumber: r.rowNumber });

      const entry: GlobalRowIndexEntry = { sheet, rowNumber: r.rowNumber, raw };
      globalRowIndex[id] = entry;
      idBySheetValidated[sheet][id] = entry;
      nodes.push({ sheet, rowNumber: r.rowNumber, raw, id });
    }
  }

  const idx = buildIndices(rowsBySheetNodes, columnsBySheet);

  // 3) FK integrity
  for (const [sheet, cols] of columnsBySheet) {
    const rows = rowsBySheetNodes[sheet] ?? [];
    for (const c of cols) {
      const it = inputTypesByName.get(trim(c.typeName));
      if (!isFkType(it)) continue;

      for (const r of rows) {
        const rawValue = trim(r.raw[c.columnName]);
        if (rawValue.length === 0) continue;
        const targets = resolveFkTargets(idx, it, rawValue);
        if (targets.length === 1) continue;
        if (targets.length === 0) {
          errors.push(
            cellError(
              sheet,
              r.rowNumber,
              c.columnName,
              `FK reference "${rawValue}" not found in sheet "${it.refSheet}" (${trim(it.refColumn) || "id"}).`,
            ),
          );
        } else {
          errors.push(
            cellError(
              sheet,
              r.rowNumber,
              c.columnName,
              `FK reference "${rawValue}" is ambiguous in sheet "${it.refSheet}" (${trim(it.refColumn) || "id"}).`,
            ),
          );
        }
      }
    }
  }

  // 4) Taxpayer resolution
  const taxpayers = asSheetRows(input, "Taxpayers");
  if (!taxpayers) {
    errors.push(sheetError("Taxpayers", 'Missing mandatory sheet "Taxpayers".'));
  }

  const validatedRowsBySheet: Record<string, ValidatedInputRow[]> = {};
  for (const sheet of schemaSheetNames) {
    validatedRowsBySheet[sheet] = [];
    for (const r of rowsBySheetNodes[sheet] ?? []) {
      const resolved = resolveTaxpayerForRow({ schema, inputTypesByName, columnsBySheet, idx, start: r });
      if (!resolved.ok) {
        errors.push(cellError(sheet, r.rowNumber, "id", resolved.message));
        continue;
      }
      validatedRowsBySheet[sheet].push({ rowNumber: r.rowNumber, raw: r.raw, taxpayerId: resolved.taxpayerId });
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const value: ValidatedInputWorkbook = {
    rowsBySheet: validatedRowsBySheet,
    globalRowIndex,
    indices: {
      idBySheet: idBySheetValidated,
    },
  };

  return { ok: true, value, errors: [] };
}

/**
 * Future integration point: apply an InputType parse function in the worker.
 * Task 7 only requires the hook to exist; parsing still runs synchronously today.
 */
export function applyParseFnViaWorker(params: {
  jsRunner: Pick<JsRunnerClient, "runParse">;
  parseFnSource: string;
  input: string;
}) {
  return params.jsRunner.runParse(params.parseFnSource, params.input);
}

