# XLSX Tax Rules Editor (client-side) — Design

Date: 2026-04-28  
Repo: `tax-rules-editor`  
Status: Approved (ready for implementation planning)

## Goal

Replace the existing demo app with a **fully client-side**, **mobile-first** web app that:

- Lets users **create** or **import** a **business-logic** XLSX workbook (schema-driven).
- Lets users edit:
  - Input types (parsers/formatters, optional foreign key semantics)
  - Columns (sheet/column/type)
  - Rules (JS that mutates a per-taxpayer aggregate via Immer)
- Can **export** the business-logic workbook to XLSX.
- Can **generate** an input-only template XLSX (A‑Box) from the business-logic workbook.
- Can **import** a filled template XLSX, **validate**, **simulate**, and show results “beautifully”.

Non-goals (for initial version):

- Server-side processing, persistence, multi-user collaboration.
- iOS Safari support. Target is “evergreen desktop browsers”.

## High-level UX

### Primary flows

1. **Start**
   - Import business-logic XLSX
   - Create new empty business-logic workbook
2. **Define business logic**
   - Input Types tab
   - Columns tab
   - Rules tab
   - Export business-logic XLSX
3. **Run simulation**
   - Generate template XLSX (A‑Box)
   - Upload filled template XLSX
   - Validate inputs (parse errors / referential integrity / taxpayer resolution)
   - Run rules per taxpayer
   - View results & errors

### Mobile-first layout principles

- Single-column layout, stepper/tabs, sticky primary actions.
- Tables become stacked “cards” on small screens, with an “Edit row” sheet/drawer for complex rows (code editors).
- Clear empty-states and example workbooks.

## File formats and schemas

There are two distinct XLSX artifacts:

1. **Business-logic workbook** (contains *definitions*, not input data)
2. **Input workbook (template / filled)** (contains *data*, not business logic)

### 1) Business-logic workbook

The business-logic workbook must contain these **fixed** sheets:

- `InputType`
- `Column`
- `Rule`

No other sheets are required (extra sheets are ignored by the app unless specified later).

#### `InputType` sheet

Represents both parsing/formatting logic and (optionally) foreign-key semantics.

Columns (header row in row 1):

- `name` (string, unique, required)
- `parseFn` (string, required): JS source that evaluates to a function `(s: string) => any`
  - may throw → validation error
- `formatFn` (string, required): JS source that evaluates to a function `(v: any) => string`
  - may throw → validation error
- `refSheet` (string, optional): if present, declares this type as a foreign-key into `refSheet`
- `refColumn` (string, optional): the referenced column within `refSheet`
  - default: `id` if `refSheet` is present and `refColumn` empty

Mandatory built-in input type:

- `taxpayerId`
  - In addition to `parseFn` behavior, values of this type must validate that the parsed value exists in the `Taxpayer` sheet’s `id` column of the **input workbook**.

#### `Column` sheet

Defines the input workbook’s sheets and their columns.

Columns:

- `sheet` (string, required)
- `columnName` (string, required)
- `typeName` (string, required; must reference `InputType.name`)

Mandatory structural invariants:

- There must be at least one sheet named `Taxpayer`.
- The `Taxpayer` sheet must contain a column named `id` with type `taxpayerId`.

#### `Rule` sheet

Defines calculation behavior as user-authored JS.

Columns:

- `name` (string, unique, required)
- `ruleFn` (string, required): JS source evaluating to a function `(aggregate) => aggregate | void`
  - Rules should be executed using Immer: given an input `aggregate`, do `produce(aggregate, draft => ruleFn(draft))`
  - ruleFn is expected to mutate the draft; returning a value is ignored (unless we explicitly support `return draft` later)
  - may throw → simulation error (attached to rule name + taxpayer id)

Important: rules do **not** directly target a fixed `Results` sheet. The rule author decides where computed data lives inside the aggregate object; exports and UI can project that later.

### 2) Input workbook (template + filled)

Generated from `Column`:

- One sheet per distinct `Column.sheet`
- Header row in row 1 is the ordered list of `columnName` values for that sheet
- Data begins at row 2

Mandatory constraints:

- Must contain a `Taxpayer` sheet (not removable)
- Every sheet row must have a globally unique `id` (opaque string)
  - Concretely: this is achieved by requiring `Column` include an `id` column for each sheet.
  - Uniqueness is global across the entire workbook, not just per sheet.

Referential integrity:

- If an `InputType` row declares `refSheet/refColumn`, then any cell with that type references a specific row in the referenced sheet by equality of referenced column.

Taxpayer membership resolution:

- A row belongs to a taxpayer if, by following foreign-key columns (possibly multiple hops), the row can be linked to `Taxpayer.id`.
- Ambiguity or impossibility is a validation error:
  - no path to `Taxpayer.id`
  - multiple conflicting paths to different taxpayers
  - reference points to missing row

## Runtime data model (in-memory)

### Parsed workbook model

For a filled input workbook, after parsing and validation:

- `rowsBySheet`: `{ [sheetName]: Array<RowObject> }` where each RowObject uses column names as keys.
- `globalRowIndex`: `{ [globalId: string]: { sheet: string; row: RowObject } }`
- `refs`: index structures to resolve foreign keys efficiently (by `refSheet/refColumn/value`).

### Taxpayer aggregate model

For each taxpayer `t` (id from `Taxpayer.id`), build an object:

```ts
type Aggregate = Record<string, Array<Record<string, unknown>>>
// keys are sheet names
// values are arrays of rows belonging to this taxpayer
```

Example:

```ts
{
  Taxpayer: [{ id: "t1", name: "Alice" }],
  Orders: [{ id: "o1", taxpayerId: "t1", amount: 9.99 }],
  Payments: [{ id: "p1", orderId: "o1", amount: 9.99 }]
}
```

Rules can add/modify properties within these sheet arrays or add additional “computed” sheets/collections inside the same object.

## Secure JS execution model (compat-first)

Constraints:

- “Maximum browser compatibility” (excluding iOS Safari).
- JS must be “secure enough” that the app only consumes the returned/mutated data and does not allow DOM access.

Design:

- Execute all user-authored JS (`parseFn`, `formatFn`, `ruleFn`) in a dedicated **Web Worker**.
- The worker exposes a minimal RPC API:
  - compile/validate functions (syntax + “must be a function”)
  - execute parser/formatter on demand
  - run rules on a per-taxpayer aggregate with Immer
- Worker environment:
  - No DOM access by nature of workers
  - No access to main thread objects
  - Enforce timeouts by terminating and recreating the worker if execution exceeds a limit

Note: this is **not a perfect security sandbox** (e.g. it may not prevent all prototype/intrinsic tricks), but it is a pragmatic isolation boundary with high compatibility. If stronger isolation is required later, a WASM JS VM (QuickJS) can be considered.

## Validation and error reporting

Validation stages:

1. **Business-logic workbook validation**
   - Required sheets exist
   - Required columns exist
   - Unique constraints (type names, rule names)
   - Mandatory `Taxpayer` + `taxpayerId` invariants
   - JS sources parse and compile to functions
2. **Input workbook validation**
   - Required sheets + columns exist per `Column`
   - Parse each cell with its `InputTypes.parseFn` (errors recorded at cell location)
   - Check global uniqueness of row `id`
   - Foreign-key integrity (ref exists)
   - Taxpayer resolution (each row maps to exactly one taxpayer)
3. **Simulation**
   - Run each rule per taxpayer; capture runtime exceptions as taxpayer-scoped errors

UI should present:

- Inline errors for business-logic definitions (row-level)
- Inline cell errors for input workbook validation
- Taxpayer-level simulation errors per rule

## Exports

- Export business-logic workbook: `InputType`, `Column`, `Rule` sheets.
- Export template input workbook: sheets defined by `Column`, empty data rows.
- Optional future export: computed workbook that materializes computed data into XLSX sheets (out of scope for initial design unless explicitly requested).

## Technical stack constraints (from repo)

- Next.js app router (`app/`)
- React
- Tailwind + shadcn/ui present

Planned additional dependencies (implementation-phase decision):

- XLSX read/write library (e.g. `xlsx` or `exceljs`), chosen for client-side support.
- `immer`
- A lightweight code editor for JS cells (e.g. CodeMirror) or a minimal textarea-based editor for v1.

