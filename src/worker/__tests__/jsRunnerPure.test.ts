import test from "node:test";
import assert from "node:assert/strict";
import { runParse, compileSourceToFunction } from "../jsRunner.worker";

test("runParse executes and returns value", () => {
  const res = runParse("(s) => s.trim()", "  hello  ");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value, "hello");
});

test("compilation rejects non-function source", () => {
  const res = compileSourceToFunction("123");
  assert.equal(res.ok, false);
  if (!res.ok) assert.match(res.error, /function/i);
});

test("compilation accepts function declaration (wrapped as statement)", () => {
  const res = compileSourceToFunction("function fn(s){ return s.toUpperCase(); }");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.fn("yo"), "YO");
});

