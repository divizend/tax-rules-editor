import {
  type RunFormatResult,
  type RunParseResult,
  type RunRuleResult,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
} from "./rpc";

export type WorkerFactory = () => Worker;

function randomId(): string {
  // Plenty for correlation ids; not security sensitive.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errToString(e: unknown): string {
  if (e instanceof Error) return e.message || String(e);
  return typeof e === "string" ? e : JSON.stringify(e);
}

export class JsRunnerClient {
  private worker: Worker;
  private readonly createWorker: WorkerFactory;
  private readonly timeoutMs: number;
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: number }
  >();

  constructor(opts?: { timeoutMs?: number; createWorker?: WorkerFactory }) {
    this.timeoutMs = opts?.timeoutMs ?? 2_000;
    this.createWorker =
      opts?.createWorker ??
      (() =>
        new Worker(new URL("./jsRunner.worker.ts", import.meta.url), {
          type: "module",
        }));

    this.worker = this.createWorker();
    this.worker.onmessage = (ev: MessageEvent<unknown>) =>
      this.onWorkerMessage(ev.data);
  }

  terminate(): void {
    this.worker.terminate();
    for (const [requestId, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Worker terminated"));
      this.pending.delete(requestId);
    }
  }

  private restart(reason: string): void {
    const old = this.worker;
    try {
      old.terminate();
    } catch {
      // ignore
    }
    this.worker = this.createWorker();
    this.worker.onmessage = (ev: MessageEvent<unknown>) =>
      this.onWorkerMessage(ev.data);

    for (const [requestId, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`Worker restarted: ${reason}`));
      this.pending.delete(requestId);
    }
  }

  private onWorkerMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const msg = data as Partial<WorkerResponseMessage>;
    if (msg.kind !== "res" || typeof msg.requestId !== "string") return;

    const pending = this.pending.get(msg.requestId);
    if (!pending) return;
    this.pending.delete(msg.requestId);
    clearTimeout(pending.timer);

    if (msg.ok) pending.resolve(msg.result);
    else pending.reject(new Error(msg.error ?? "Worker error"));
  }

  private request<T>(op: WorkerRequestMessage["op"], payload: object): Promise<T> {
    const requestId = randomId();
    const msg: WorkerRequestMessage = {
      kind: "req",
      requestId,
      op,
      payload: { op, ...(payload as object) } as never,
    };

    return new Promise<T>((resolve, reject) => {
      const resolveUnknown = (v: unknown) => resolve(v as T);
      const timer = setTimeout(() => {
        // Treat as hung (likely infinite loop). Restart worker.
        this.pending.delete(requestId);
        this.restart(`timeout after ${this.timeoutMs}ms`);
        reject(new Error(`Timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs) as unknown as number;

      this.pending.set(requestId, { resolve: resolveUnknown, reject, timer });

      try {
        this.worker.postMessage(msg);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(new Error(errToString(e)));
      }
    });
  }

  async compileFunction(source: string): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      await this.request("compileFunction", { source });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errToString(e) };
    }
  }

  runParse(source: string, input: string, inputWorkbook?: unknown): Promise<RunParseResult> {
    return this.request("runParse", { source, input, inputWorkbook });
  }

  runFormat(source: string, input: unknown): Promise<RunFormatResult> {
    return this.request("runFormat", { source, input });
  }

  runRule(source: string, aggregate: unknown): Promise<RunRuleResult> {
    return this.request("runRule", { source, aggregate });
  }
}

