# XLSX Tax Rules Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo Next.js app with a fully client-side, mobile-first XLSX business-logic editor + template generator + simulator as defined in `docs/superpowers/specs/2026-04-28-xlsx-tax-rules-editor-design.md`.

**Architecture:** A Next.js App Router UI manages an in-memory “business logic workbook” model and (separately) imported “input workbook” model. XLSX import/export is handled client-side. User-authored JS (parsers/formatters/rules) runs in a dedicated Web Worker with timeouts and a tiny API surface (Immer `produce`), returning only data and errors.

**Tech Stack:** Next.js (app router), React, Tailwind + shadcn/ui, `xlsx` (SheetJS) for XLSX I/O, `immer`, Web Workers, TypeScript.

---

## Scope check / decomposition

This plan is one cohesive feature (schema editor + XLSX I/O + simulation). We’ll still implement it in vertical slices:

- Workbook model + validation
- XLSX import/export for business logic
- Template generation
- Input workbook import + parsing/validation
- Taxpayer aggregation + rule execution in worker
- Mobile-first UI for editing + simulation results

## Proposed file structure (locked-in boundaries)

**New core domain (pure TS, testable):**

- Create: `src/domain/schema.ts` — types for business-logic workbook (“definitions”).
- Create: `src/domain/schemaValidate.ts` — validate business-logic workbook invariants; return structured errors.
- Create: `src/domain/inputWorkbook.ts` — types for input workbook + parsed row objects.
- Create: `src/domain/inputParseValidate.ts` — parse filled input workbook using schema + input types; FK integrity; taxpayer resolution; error model.
- Create: `src/domain/aggregate.ts` — build per-taxpayer aggregates from validated input.
- Create: `src/domain/simulate.ts` — orchestration to run rules per taxpayer aggregate via worker RPC.
- Create: `src/domain/errors.ts` — shared error types (cell errors, sheet errors, rule errors).

**XLSX I/O (pure functions):**

- Create: `src/xlsx/readBusinessLogic.ts`
- Create: `src/xlsx/writeBusinessLogic.ts`
- Create: `src/xlsx/generateTemplate.ts`
- Create: `src/xlsx/readInputWorkbook.ts`

**Worker sandbox:**

- Create: `src/worker/jsRunner.worker.ts` — worker entry (compile/run).
- Create: `src/worker/rpc.ts` — typed message protocol shared with main thread.
- Create: `src/worker/client.ts` — main-thread wrapper with timeout + restart.

**UI (Next app router):**

- Modify: `app/page.tsx` — replace demo with the app shell.
- Create: `app/(app)/layout.tsx` — app layout (mobile-first).
- Create: `app/(app)/page.tsx` — main flow (import/create/edit/simulate).
- Create: `components/editor/*` — table editors, row editor drawer, code editor.
- Create: `components/sim/*` — upload template, run simulation, results view.

**Utilities:**

- Create: `src/lib/download.ts` — download blob helpers.
- Create: `src/lib/file.ts` — file pickers, read as ArrayBuffer.

**Tests (node):**

- Create: `src/domain/__tests__/schemaValidate.test.ts`
- Create: `src/domain/__tests__/inputParseValidate.test.ts`
- Create: `src/domain/__tests__/aggregate.test.ts`

Notes:
- Repo currently uses root-level folders (`app/`, `components/`, `lib/`). This plan introduces `src/` for domain/worker/xlsx code. If we prefer to stay consistent, we can put these under `lib/` instead (decide in Task 1).

## Dependencies to add (once, early)

- `xlsx`
- `immer`

Optionally later for better UX:

- A code editor component (e.g. CodeMirror). For v1, use `<textarea>` + monospace + validation/preview.

---

### Task 1: Establish domain types + error model

**Files:**
- Create: `src/domain/errors.ts`
- Create: `src/domain/schema.ts`

- [ ] **Step 1: Create error type definitions**

Create `src/domain/errors.ts`:

```ts
export type Severity = "error" | "warning";

export type SheetError = {
  severity: Severity;
  sheet: string;
  message: string;
  row?: number; // 1-based, as in XLSX
  column?: string; // header name
};

export type CellError = {
  severity: Severity;
  sheet: string;
  row: number; // 1-based
  column: string; // header name
  message: string;
};

export type RuleError = {
  severity: Severity;
  taxpayerId?: string;
  ruleName: string;
  message: string;
  stack?: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; errors: Array<SheetError | CellError | RuleError> };
```

- [ ] **Step 2: Create schema types**

Create `src/domain/schema.ts`:

```ts
export type InputTypeDef = {
  name: string;
  parseFn: string;
  formatFn: string;
  refSheet?: string;
  refColumn?: string;
};

export type ColumnDef = {
  sheet: string;
  columnName: string;
  typeName: string;
};

export type RuleDef = {
  name: string;
  ruleFn: string;
};

export type BusinessLogicWorkbook = {
  inputTypes: InputTypeDef[];
  columns: ColumnDef[];
  rules: RuleDef[];
};
```

- [ ] **Step 3: Commit**

```bash
git add src/domain/errors.ts src/domain/schema.ts
git commit -m "feat: add domain schema types and errors"
```

---

### Task 2: Business-logic schema validation (invariants)

**Files:**
- Create: `src/domain/schemaValidate.ts`
- Test: `src/domain/__tests__/schemaValidate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/domain/__tests__/schemaValidate.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { validateBusinessLogicWorkbook } from "../schemaValidate";

const base = () => ({
  inputTypes: [
    { name: "taxpayerId", parseFn: "(s)=>s", formatFn: "(v)=>String(v)", refSheet: "Taxpayers", refColumn: "id" },
  ],
  columns: [{ sheet: "Taxpayers", columnName: "id", typeName: "taxpayerId" }],
  rules: [],
});

describe("validateBusinessLogicWorkbook", () => {
  test("accepts minimal valid workbook", () => {
    const res = validateBusinessLogicWorkbook(base());
    expect(res.ok).toBe(true);
  });

  test("rejects missing Taxpayers sheet", () => {
    const w = base();
    w.columns = [{ sheet: "People", columnName: "id", typeName: "taxpayerId" }];
    const res = validateBusinessLogicWorkbook(w);
    expect(res.ok).toBe(false);
  });
});
```

Note: This introduces `vitest`; if repo doesn’t have it, switch to node’s `test` runner or add vitest (decide while implementing).

- [ ] **Step 2: Implement validator**

Create `src/domain/schemaValidate.ts`:

```ts
import type { BusinessLogicWorkbook } from "./schema";
import type { ValidationResult, SheetError } from "./errors";

export function validateBusinessLogicWorkbook(
  wb: BusinessLogicWorkbook,
): ValidationResult<BusinessLogicWorkbook> {
  const errors: SheetError[] = [];

  const typeNames = new Set<string>();
  for (const t of wb.inputTypes) {
    if (!t.name?.trim()) errors.push({ severity: "error", sheet: "InputTypes", message: "Input type name is required" });
    if (typeNames.has(t.name)) errors.push({ severity: "error", sheet: "InputTypes", message: `Duplicate input type: ${t.name}` });
    typeNames.add(t.name);
  }

  if (!typeNames.has("taxpayerId")) {
    errors.push({ severity: "error", sheet: "InputTypes", message: "Missing mandatory input type: taxpayerId" });
  }

  const hasTaxpayers = wb.columns.some((c) => c.sheet === "Taxpayers");
  if (!hasTaxpayers) errors.push({ severity: "error", sheet: "Columns", message: "Missing mandatory sheet: Taxpayers" });

  const taxpayersId = wb.columns.some((c) => c.sheet === "Taxpayers" && c.columnName === "id" && c.typeName === "taxpayerId");
  if (!taxpayersId) {
    errors.push({
      severity: "error",
      sheet: "Columns",
      message: "Taxpayers sheet must contain column id with type taxpayerId",
    });
  }

  for (const c of wb.columns) {
    if (!typeNames.has(c.typeName)) {
      errors.push({
        severity: "error",
        sheet: "Columns",
        message: `Column ${c.sheet}.${c.columnName} references unknown type: ${c.typeName}`,
      });
    }
  }

  const ruleNames = new Set<string>();
  for (const r of wb.rules) {
    if (ruleNames.has(r.name)) errors.push({ severity: "error", sheet: "Rules", message: `Duplicate rule: ${r.name}` });
    ruleNames.add(r.name);
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: wb, errors: [] };
}
```

- [ ] **Step 3: Run tests**

Run (depending on runner chosen):

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domain/schemaValidate.ts src/domain/__tests__/schemaValidate.test.ts
git commit -m "feat: validate business-logic workbook invariants"
```

---

### Task 3: Add XLSX read/write for business-logic workbook

**Files:**
- Create: `src/xlsx/readBusinessLogic.ts`
- Create: `src/xlsx/writeBusinessLogic.ts`
- Modify: `package.json`

- [ ] **Step 1: Add deps**

```bash
pnpm add xlsx immer
```

- [ ] **Step 2: Implement reader**

Create `src/xlsx/readBusinessLogic.ts` with a function:

- `readBusinessLogicWorkbook(arrayBuffer: ArrayBuffer): BusinessLogicWorkbook`
  - reads sheets `InputTypes`, `Columns`, `Rules` (missing sheet → empty list but validator will catch required invariants)
  - expects row 1 headers as specified in the spec

- [ ] **Step 3: Implement writer**

Create `src/xlsx/writeBusinessLogic.ts` with:

- `writeBusinessLogicWorkbook(wb: BusinessLogicWorkbook): ArrayBuffer`

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/xlsx/readBusinessLogic.ts src/xlsx/writeBusinessLogic.ts
git commit -m "feat: import/export business-logic workbook as xlsx"
```

---

### Task 4: Generate template input workbook (A‑Box)

**Files:**
- Create: `src/xlsx/generateTemplate.ts`

- [ ] **Step 1: Implement generator**

`generateTemplate(wb: BusinessLogicWorkbook): ArrayBuffer`:
- create sheets for each distinct `Columns.sheet`
- headers in row 1 in the order they appear in `Columns` for that sheet
- no data rows

- [ ] **Step 2: Commit**

```bash
git add src/xlsx/generateTemplate.ts
git commit -m "feat: generate input template workbook from columns"
```

---

### Task 5: Input workbook read + parse/validate (no worker yet)

**Files:**
- Create: `src/xlsx/readInputWorkbook.ts`
- Create: `src/domain/inputWorkbook.ts`
- Create: `src/domain/inputParseValidate.ts`
- Test: `src/domain/__tests__/inputParseValidate.test.ts`

- [ ] **Step 1: Define input workbook types**
- [ ] **Step 2: Read input workbook into raw tables**
- [ ] **Step 3: Parse cell strings (defer actual JS parsing to worker later; for now accept string passthrough)**
- [ ] **Step 4: Enforce global unique `id`**
- [ ] **Step 5: Build FK indices using `InputTypes.refSheet/refColumn`**
- [ ] **Step 6: Resolve taxpayer membership (graph walk)**
- [ ] **Step 7: Commit**

---

### Task 6: Worker JS runner + RPC + timeouts

**Files:**
- Create: `src/worker/rpc.ts`
- Create: `src/worker/jsRunner.worker.ts`
- Create: `src/worker/client.ts`

- [ ] **Step 1: Define RPC message protocol types**
- [ ] **Step 2: Implement worker compile (ensure source evaluates to a function; reject otherwise)**
- [ ] **Step 3: Implement parse/format calls**
- [ ] **Step 4: Implement rule execution via Immer `produce`**
- [ ] **Step 5: Implement main-thread client with timeout + worker restart**
- [ ] **Step 6: Commit**

---

### Task 7: Integrate worker into parsing + simulation

**Files:**
- Modify: `src/domain/inputParseValidate.ts`
- Create: `src/domain/aggregate.ts`
- Create: `src/domain/simulate.ts`

- [ ] **Step 1: Replace placeholder parsing with worker-driven parsing**
- [ ] **Step 2: Build per-taxpayer aggregates**
- [ ] **Step 3: Run rules per taxpayer via worker**
- [ ] **Step 4: Commit**

---

### Task 8: Mobile-first UI skeleton and state management

**Files:**
- Modify: `app/page.tsx`
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/page.tsx`
- Create: `components/editor/*`
- Create: `components/sim/*`

- [ ] **Step 1: App shell with start screen (import/create)**
- [ ] **Step 2: Add in-memory workbook state (React state + reducer)**
- [ ] **Step 3: Editor tabs (InputTypes/Columns/Rules) with basic table editing**
- [ ] **Step 4: Export business-logic XLSX**
- [ ] **Step 5: Generate template XLSX**
- [ ] **Step 6: Upload filled template + show validation errors**
- [ ] **Step 7: Run simulation + show per-taxpayer results**
- [ ] **Step 8: Commit**

---

### Task 9: UX polish + accessibility + performance

**Files:**
- Modify: UI components

- [ ] **Step 1: Make tables responsive (card layout on mobile)**
- [ ] **Step 2: Improve error presentation and navigation**
- [ ] **Step 3: Add sample “starter workbook” generator**
- [ ] **Step 4: Commit**

---

## Verification checklist (run at checkpoints)

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- Manual:
  - create new workbook → edit → export → re-import
  - generate template → fill minimal data → import → validate → simulate

