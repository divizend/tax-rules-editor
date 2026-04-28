import test from "node:test";
import assert from "node:assert/strict";

import type { BusinessLogicWorkbook } from "../schema.js";
import type { Aggregate } from "../aggregate.js";
import { simulateAll } from "../simulate.js";
import { runRule } from "../../worker/jsRunner.worker.js";

function makeJsRunner() {
  return {
    runRule: async (source: string, aggregate: unknown) => runRule(source, aggregate),
  };
}

test("simulateAll runs a rule that mutates the aggregate (Immer)", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [],
    columns: [],
    rules: [
      {
        name: "addResult",
        ruleFn: `(agg) => {
          (agg.Results ??= []).push({ kind: "ok" });
        }`,
      },
    ],
  };

  const aggregates: Record<string, Aggregate> = {
    T1: { Taxpayers: [{ id: "T1" }] },
  };

  const res = await simulateAll({ schema, aggregates, jsRunner: makeJsRunner() });
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.results.T1!.Results, [{ kind: "ok" }]);
});

test("simulateAll captures rule errors", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [],
    columns: [],
    rules: [{ name: "boom", ruleFn: `() => { throw new Error("boom"); }` }],
  };

  const aggregates: Record<string, Aggregate> = { T1: { Taxpayers: [{ id: "T1" }] } };
  const res = await simulateAll({ schema, aggregates, jsRunner: makeJsRunner() });

  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0]!.taxpayerId, "T1");
  assert.equal(res.errors[0]!.ruleName, "boom");
  assert.match(res.errors[0]!.message, /boom/);
});

test("simulateAll continues other taxpayers when one fails", async () => {
  const schema: BusinessLogicWorkbook = {
    inputTypes: [],
    columns: [],
    rules: [
      {
        name: "sometimesBoom",
        ruleFn: `(agg) => {
          if (agg.Taxpayers?.[0]?.id === "T1") throw new Error("nope");
          (agg.Results ??= []).push({ ran: true });
        }`,
      },
    ],
  };

  const aggregates: Record<string, Aggregate> = {
    T1: { Taxpayers: [{ id: "T1" }] },
    T2: { Taxpayers: [{ id: "T2" }] },
  };

  const res = await simulateAll({ schema, aggregates, jsRunner: makeJsRunner() });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0]!.taxpayerId, "T1");

  assert.deepEqual(res.results.T2!.Results, [{ ran: true }]);
});

