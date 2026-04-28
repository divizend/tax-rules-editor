export type WorkerOperation =
  | "compileFunction"
  | "runParse"
  | "runFormat"
  | "runRule";

export type WorkerRequestId = string;

export type WorkerRequestMessage = {
  kind: "req";
  requestId: WorkerRequestId;
  op: WorkerOperation;
  payload:
    | CompileFunctionRequest
    | RunParseRequest
    | RunFormatRequest
    | RunRuleRequest;
};

export type WorkerResponseMessage = {
  kind: "res";
  requestId: WorkerRequestId;
  ok: boolean;
  result?: unknown;
  error?: string;
};

export type CompileFunctionRequest = {
  op: "compileFunction";
  source: string;
};

export type CompileFunctionResult = {
  ok: true;
  functionType?: "parse" | "format" | "rule";
};

export type CompileFunctionError = {
  ok: false;
  error: string;
};

export type RunParseRequest = {
  op: "runParse";
  source: string;
  input: string;
  /** Second argument passed to parseFns (typically the uploaded input workbook JSON). */
  inputWorkbook?: unknown;
};

export type RunParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

export type RunFormatRequest = {
  op: "runFormat";
  source: string;
  input: unknown;
};

export type RunFormatResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type RunRuleRequest = {
  op: "runRule";
  source: string;
  aggregate: unknown;
};

export type RunRuleResult =
  | { ok: true; aggregate: unknown }
  | { ok: false; error: string };

export type CompileFunctionResponsePayload =
  | CompileFunctionResult
  | CompileFunctionError;

export type WorkerResponsePayloadByOp = {
  compileFunction: CompileFunctionResponsePayload;
  runParse: RunParseResult;
  runFormat: RunFormatResult;
  runRule: RunRuleResult;
};

export type WorkerRequestPayloadByOp = {
  compileFunction: CompileFunctionRequest;
  runParse: RunParseRequest;
  runFormat: RunFormatRequest;
  runRule: RunRuleRequest;
};

export function isWorkerRequestMessage(x: unknown): x is WorkerRequestMessage {
  if (!x || typeof x !== "object") return false;
  const msg = x as Partial<WorkerRequestMessage>;
  return (
    msg.kind === "req" &&
    typeof msg.requestId === "string" &&
    (msg.op === "compileFunction" ||
      msg.op === "runParse" ||
      msg.op === "runFormat" ||
      msg.op === "runRule") &&
    !!msg.payload &&
    typeof msg.payload === "object"
  );
}

