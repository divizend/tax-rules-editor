import test from "node:test";
import assert from "node:assert/strict";
import { JsRunnerClient } from "../client";
import type { WorkerRequestMessage, WorkerResponseMessage } from "../rpc";

class MockWorker {
  public onmessage: ((ev: MessageEvent<unknown>) => void) | null = null;
  private terminated = false;

  constructor(
    private readonly responder: (msg: WorkerRequestMessage) => WorkerResponseMessage | null,
  ) {}

  postMessage(data: unknown): void {
    if (this.terminated) throw new Error("terminated");
    const msg = data as WorkerRequestMessage;
    const res = this.responder(msg);
    if (!res) return; // simulate hang
    queueMicrotask(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: res } as MessageEvent<unknown>);
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}

function okRes(requestId: string, result: unknown): WorkerResponseMessage {
  return { kind: "res", requestId, ok: true, result };
}

test("timeout causes worker restart; next call works", async () => {
  let workerCount = 0;

  const createWorker = () => {
    workerCount += 1;
    const instance = workerCount;

    // First worker simulates an infinite loop by never responding to runParse.
    if (instance === 1) {
      return new MockWorker(() => null) as unknown as Worker;
    }

    // Second worker responds normally.
    return new MockWorker((msg) => {
      if (msg.kind !== "req") throw new Error("bad msg");
      if (msg.op === "runParse") {
        const { input } = msg.payload as { input: string; inputWorkbook?: unknown };
        return okRes(msg.requestId, { ok: true, value: input.trim() });
      }
      return okRes(msg.requestId, { ok: true });
    }) as unknown as Worker;
  };

  const client = new JsRunnerClient({ timeoutMs: 50, createWorker });

  await assert.rejects(() => client.runParse("(s)=>s", "x"), /Timed out/i);
  assert.equal(workerCount >= 2, true);

  const res = await client.runParse("(s)=>s.trim()", "  ok  ");
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value, "ok");

  client.terminate();
});

