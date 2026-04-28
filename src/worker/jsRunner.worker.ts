import { produce } from "immer";
import {
  isWorkerRequestMessage,
  type CompileFunctionResult,
  type RunFormatResult,
  type RunParseResult,
  type RunRuleResult,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
} from "./rpc";

export type JsRunnerFunction = (...args: unknown[]) => unknown;

export type CompileOk = { ok: true; fn: JsRunnerFunction };
export type CompileErr = { ok: false; error: string };
export type CompileResult = CompileOk | CompileErr;

const compiledCache = new Map<string, JsRunnerFunction>();

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message || String(e);
  return typeof e === "string" ? e : JSON.stringify(e);
}

/**
 * Compiles user JS source into a function.
 *
 * Supported styles:
 * - Arrow / function expressions: `(s) => s.trim()`, `function(s){ return s }`
 * - Function declarations (statement form), provided they bind a name:
 *   `function parse(s){...}` (we return `parse`), or `function fn(){...}` (we return `fn`)
 */
export function compileSourceToFunction(source: string): CompileResult {
  const cached = compiledCache.get(source);
  if (cached) return { ok: true, fn: cached };

  const trimmed = source.trim();
  if (trimmed.length === 0) return { ok: false, error: "Empty source" };

  // 1) Expression form (covers arrow functions + function expressions)
  try {
    // Wrap in parens so arrow functions parse correctly.
    // eslint-disable-next-line no-new-func
    const value = new Function(`"use strict"; return (${source});`)() as unknown;
    if (typeof value === "function") {
      compiledCache.set(source, value as JsRunnerFunction);
      return { ok: true, fn: value as JsRunnerFunction };
    }
  } catch {
    // fall through to statement wrapper
  }

  // 2) Statement form (covers function declarations)
  try {
    // Attempt to return the first known binding name that users are likely to choose.
    // eslint-disable-next-line no-new-func
    const value = new Function(
      `"use strict";
${source}
return (typeof parseFn === "function" ? parseFn
  : typeof formatFn === "function" ? formatFn
  : typeof ruleFn === "function" ? ruleFn
  : typeof parse === "function" ? parse
  : typeof format === "function" ? format
  : typeof rule === "function" ? rule
  : typeof fn === "function" ? fn
  : undefined);`,
    )() as unknown;

    if (typeof value === "function") {
      compiledCache.set(source, value as JsRunnerFunction);
      return { ok: true, fn: value as JsRunnerFunction };
    }
    return { ok: false, error: "Source did not evaluate to a function" };
  } catch (e) {
    return { ok: false, error: errToString(e) };
  }
}

export function runParse(source: string, input: string): RunParseResult {
  const compiled = compileSourceToFunction(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  try {
    return { ok: true, value: compiled.fn(input) };
  } catch (e) {
    return { ok: false, error: errToString(e) };
  }
}

export function runFormat(source: string, input: unknown): RunFormatResult {
  const compiled = compileSourceToFunction(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  try {
    const value = compiled.fn(input);
    if (typeof value !== "string") {
      return {
        ok: false,
        error: `formatFn must return string (got ${typeof value})`,
      };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: errToString(e) };
  }
}

export function runRule(source: string, aggregate: unknown): RunRuleResult {
  const compiled = compileSourceToFunction(source);
  if (!compiled.ok) return { ok: false, error: compiled.error };
  try {
    const next = produce(aggregate, (draft) => {
      compiled.fn(draft);
    });
    return { ok: true, aggregate: next };
  } catch (e) {
    return { ok: false, error: errToString(e) };
  }
}

function handleRequest(msg: WorkerRequestMessage): WorkerResponseMessage {
  const { requestId, op } = msg;

  switch (op) {
    case "compileFunction": {
      const { source } = msg.payload as { source: string };
      const compiled = compileSourceToFunction(source);
      if (!compiled.ok) {
        return { kind: "res", requestId, ok: false, error: compiled.error };
      }
      const result: CompileFunctionResult = { ok: true };
      return { kind: "res", requestId, ok: true, result };
    }
    case "runParse": {
      const { source, input } = msg.payload as { source: string; input: string };
      const result = runParse(source, input);
      return {
        kind: "res",
        requestId,
        ok: result.ok,
        result: result.ok ? result : undefined,
        error: result.ok ? undefined : result.error,
      };
    }
    case "runFormat": {
      const { source, input } = msg.payload as { source: string; input: unknown };
      const result = runFormat(source, input);
      return {
        kind: "res",
        requestId,
        ok: result.ok,
        result: result.ok ? result : undefined,
        error: result.ok ? undefined : result.error,
      };
    }
    case "runRule": {
      const { source, aggregate } = msg.payload as {
        source: string;
        aggregate: unknown;
      };
      const result = runRule(source, aggregate);
      return {
        kind: "res",
        requestId,
        ok: result.ok,
        result: result.ok ? result : undefined,
        error: result.ok ? undefined : result.error,
      };
    }
  }
}

// Worker entrypoint (guarded so node:test can import this file).
if (typeof self !== "undefined") {
  const ctx = self as any;
  ctx.onmessage = (ev: MessageEvent<unknown>) => {
    if (!isWorkerRequestMessage(ev.data)) return;
    const res = handleRequest(ev.data);
    ctx.postMessage(res);
  };
}

