import "@testing-library/jest-dom/vitest"

// `WorkbookEditorApp` enables simulation only when `Worker` exists.
// In unit tests we mock the runner implementation, so this can be a stub.
if (typeof globalThis.Worker === "undefined") {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class WorkerStub {}
  // @ts-expect-error - minimal stub to satisfy `typeof Worker !== "undefined"`
  globalThis.Worker = WorkerStub
}

