import type { BusinessLogicWorkbook } from "./schema.js";
import type { RuleError } from "./errors.js";
import type { Aggregate } from "./aggregate.js";

export type JsRunnerLike = {
  runRule: (source: string, aggregate: unknown) => Promise<{ ok: true; aggregate: unknown } | { ok: false; error: string }>;
};

export async function simulateAll(params: {
  schema: BusinessLogicWorkbook;
  aggregates: Record<string, Aggregate>;
  jsRunner: JsRunnerLike;
}): Promise<{ ok: true; results: Record<string, Aggregate>; errors: RuleError[] }> {
  const { schema, aggregates, jsRunner } = params;

  const results: Record<string, Aggregate> = {};
  const errors: RuleError[] = [];

  const taxpayerIds = Object.keys(aggregates);
  for (const taxpayerId of taxpayerIds) {
    let current: Aggregate = aggregates[taxpayerId]!;

    for (const rule of schema.rules) {
      const res = await jsRunner.runRule(rule.ruleFn, current);
      if (res.ok) {
        current = res.aggregate as Aggregate;
      } else {
        errors.push({
          severity: "error",
          taxpayerId,
          ruleName: rule.name,
          message: res.error,
        });
        // Continue with the last good aggregate so other rules can still run.
      }
    }

    results[taxpayerId] = current;
  }

  return { ok: true, results, errors };
}

