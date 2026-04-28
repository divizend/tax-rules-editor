import type { ValidatedInputWorkbook } from "./inputWorkbook.js";

export type Aggregate = Record<string, Array<Record<string, unknown>>>;

export function buildAggregates(input: ValidatedInputWorkbook): Record<string, Aggregate> {
  const sheetNames = Object.keys(input.rowsBySheet);

  const taxpayerIds = new Set<string>();
  for (const r of input.rowsBySheet.Taxpayers ?? []) taxpayerIds.add(r.taxpayerId);
  // Fallback: in case Taxpayers sheet isn't present in the object shape (shouldn't happen after validation)
  if (taxpayerIds.size === 0) {
    for (const rows of Object.values(input.rowsBySheet)) {
      for (const r of rows) taxpayerIds.add(r.taxpayerId);
    }
  }

  const aggregates: Record<string, Aggregate> = {};
  for (const taxpayerId of taxpayerIds) {
    const agg: Aggregate = {};
    for (const sheet of sheetNames) agg[sheet] = [];
    aggregates[taxpayerId] = agg;
  }

  for (const [sheet, rows] of Object.entries(input.rowsBySheet)) {
    for (const r of rows) {
      const agg = aggregates[r.taxpayerId];
      if (!agg) continue;
      (agg[sheet] ??= []).push(r.raw);
    }
  }

  return aggregates;
}

