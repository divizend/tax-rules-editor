import test from "node:test";
import assert from "node:assert/strict";

import type { ValidatedInputWorkbook } from "../inputWorkbook.js";
import { buildAggregates } from "../aggregate.js";

test("buildAggregates groups rows by taxpayer and by sheet (including Taxpayer row)", () => {
  const input: ValidatedInputWorkbook = {
    rowsBySheet: {
      Taxpayer: [
        { rowNumber: 2, taxpayerId: "T1", raw: { id: "T1", name: "Alice" } },
        { rowNumber: 3, taxpayerId: "T2", raw: { id: "T2", name: "Bob" } },
      ],
      Orders: [
        { rowNumber: 2, taxpayerId: "T1", raw: { id: "O1", amount: "10" } },
        { rowNumber: 3, taxpayerId: "T2", raw: { id: "O2", amount: "20" } },
        { rowNumber: 4, taxpayerId: "T1", raw: { id: "O3", amount: "30" } },
      ],
    },
    globalRowIndex: {},
    indices: { idBySheet: { Taxpayer: {}, Orders: {} } },
  };

  const aggs = buildAggregates(input);
  assert.deepEqual(Object.keys(aggs).sort(), ["T1", "T2"]);

  assert.deepEqual(aggs.T1!.Taxpayer, [{ id: "T1", name: "Alice" }]);
  assert.deepEqual(aggs.T1!.Orders, [
    { id: "O1", amount: "10" },
    { id: "O3", amount: "30" },
  ]);

  assert.deepEqual(aggs.T2!.Taxpayer, [{ id: "T2", name: "Bob" }]);
  assert.deepEqual(aggs.T2!.Orders, [{ id: "O2", amount: "20" }]);
});

