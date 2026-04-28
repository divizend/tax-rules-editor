# Client-side mobile-first spreadsheet application
_Exported on 28.4.2026 at 19:00:49 MESZ from Cursor (3.0.16)_

---

**User**

replace the demo app by a fully client-side, mobile-first app where first you can upload an XLSX spreadsheet (in the exported format) or create a new empty spreadsheet which is then edited in memory, define input types, then columns, and then derived calculation rules, and where you can export the state to an XLSX too.

So the input types should be one of the sheets in the spreadsheet, and it should always have a name for the type and two columns, one for the literal JS source code (i.e. must be an actual function) which converts a string into this value and one which can convert such a parsed value into a string.

The columns sheet should have these columns: in which sheet the column should be, the name of the column, the type of the column (the type must reference the input types sheet).

And finally the calculation rules sheet should have three columns: the name of the column that's calculated through this row's definition, the type of what's being calculated and the source code of the function which can take any columns and perform arbitrary operations on them and which returns a value.

For the input types and the calculation rules, the JS should always be run securely, so that really only the output object is taken.

And finally it should be possible to generate and download the actual template XLSX (i.e. not the T-Box but where you'd enter the A-Box, i.e. the spreadsheet which contains only the input data but NOT the business logic), and to upload filled versions of it, and for such uploads, it should calculate the results of all from the active calculation rules and show them beautifully.

---

**Cursor**

Got it. I’ll first pull in the project’s “superpowers” workflow guidance, then I’ll inspect the current repo/demo app, and finally I’ll replace it with the client-side mobile-first XLSX-based editor + template generator + calculator flow you described.

I’m going to (1) inspect what the current demo app is (framework, routing, XLSX deps), then (2) design the in-memory workbook data model + secure JS execution model, then (3) implement the new mobile-first UI flow: import/create → edit types/columns/rules → generate template → upload filled template → compute + render → export workbook.

Some of what we’re working on might be easier to explain if I can show it to you in a web browser. I can put together mockups, diagrams, comparisons, and other visuals as we go. This feature is still new and can be token-intensive. Want to try it? (Requires opening a local URL)

---

**User**

yes

---

**Cursor**

I’m going to start the visual companion server inside this repo, grab the local URL it prints, and then I’ll ask the first single clarifying question (in terminal) to lock down the workbook “exported format” details.

I tried to start the visual companion server, but this repo doesn’t have the companion server scripts/config it expects, so I can’t reliably show clickable mockups right now without first adding that tooling (which would be “implementation work” we should only do after the design is approved).

### Clarifying question (1/…)
Do you have a **sample “exported format” XLSX** you can drop into the repo (or paste the **exact sheet names + header rows**), so we can lock the canonical workbook structure (names, required columns, and any metadata like frozen header rows)?

---

**User**

no, you should create it from scratch

---

**Cursor**

Cool — we’ll define the “exported format” ourselves and bake it into the app as the canonical workbook schema.

### Clarifying question (2/…)
Do you want the **business-logic workbook** to use these **fixed sheet names** (so imports can be validated strictly), or should sheet names be configurable?

Proposed fixed names:
- `InputTypes` (name, parseFn, formatFn)
- `Columns` (sheet, columnName, typeName)
- `Rules` (targetColumnName, resultTypeName, ruleFn)
- `Data` (input rows; the actual user-entered A-Box)

Answer: **fixed** or **configurable**.

---

**User**

The first three are good, but "Data" would not be part of the business-logic workbook. But generally using fixed sheet names is good

---

**Cursor**

Great — we’ll make the **business-logic workbook** contain only fixed sheets `InputTypes`, `Columns`, `Rules`. The **template (A‑Box) workbook** will be generated separately from `Columns` + `Rules`.

### Clarifying question (3/…)
When generating the **template XLSX**, should it include:

- **A)** only **input columns** (i.e. columns *not* targeted by any row in `Rules`)
- **B)** **all columns** (including calculated ones, left blank in the upload)
- **C)** input columns + a separate **Results** sheet with calculated outputs

Pick **A / B / C**.

---

**User**

The template XLSX can also contain multiple sheets, but generally C, i.e. all the input sheets and then a separate Results sheet with calculated outputs

---

**Cursor**

Nice — we’ll generate a template with **all input sheets** (as defined by `Columns.sheet`) and a separate fixed `Results` sheet for calculated outputs.

### Clarifying question (4/…)
How should rows be **matched** between the uploaded input sheets and the `Results` sheet?

Options:
- **A)** add a required `id` column (string) to every input sheet and use that as the join key
- **B)** use row number (row 2 = first data row) as the implicit key
- **C)** let `Columns` mark a “key column” per sheet (more complex)

Pick **A / B / C**.

---

**User**

In the business-logic workbook, the column names are all in one column, while in the input sheets, the column names should simply be in the first row

---

**Cursor**

Yes — in the **business-logic workbook** we’ll keep `Columns` as a 3-column table (sheet/name/type), and in the **generated input sheets** the **first row will be headers** (the `columnName`s for that sheet).

### Clarifying question (4/… retry)
Given headers are in row 1, how do we match each “record” across sheets when computing results?

- **A)** Add a required `id` column to **every** input sheet (as one of the columns in `Columns`). `Results` uses `id` too.
- **B)** Use **row number** as the key (row 2 = record 1, row 3 = record 2, etc.), and `Results` mirrors that order.
- **C)** Something else (describe the key idea in one sentence)

Pick **A / B / C**.

---

**User**

I don't understand the issue? In the input workbook, the sheet + column name always defines which column is meant

---

**Cursor**

The sheet+column name uniquely identifies a **field**, but calculations still need to know **which row/record** to use when there are multiple data rows.

Example: if `Customers` has 100 rows and `Orders` has 500 rows, and a rule references `Customers.age` and `Orders.amount`, which *customer row* and which *order row* should be used together to produce **one** result row?

### Clarifying question (5/…)
What’s the intended **row model** for calculations?

- **A)** **Single “main” sheet** drives row count (e.g. `Main`); rules compute per row of that sheet, and can look up other sheets by an `id` column
- **B)** **Each sheet is independent**; results are computed per sheet separately (so `Rules` must also specify the target sheet)
- **C)** **Row-number alignment** across all input sheets (row 2 aligns with row 2 everywhere)

Pick **A / B / C**.

---

**User**

Ah yes, each row in each sheet should have a unique ID, but no constaints should be made on the format of that ID, except for that it needs to be globally unique across the entire workbook

---

**Cursor**

Perfect — we’ll require an `id` column on every input sheet, and enforce **global uniqueness across the whole input workbook** (but treat it as an opaque string; no format constraints).

### Clarifying question (6/…)
For `Rules.ruleFn`, what should the function signature be?

- **A)** `(row, ctx) => value`, where `row` lets you access by `get(sheetName, id, columnName)` and `ctx` provides helpers (e.g. `parse`, `format`, maybe `now`)
- **B)** `(cells) => value`, where `cells` is a plain object like `{ "Customers.age": 42, "Orders.amount": 9.99 }` for the *current* row only
- **C)** you have a preferred signature; describe it

Pick **A / B / C**.

---

**User**

Actually it should be different, i.e. the Results sheet should work in a way where, after the tax simulation has successfully run, it contains one row per taxpayer, and the columns should be what's defined by the "Rules" sheet in the business-logic workbook. And then the input to ruleFn should receive a single parameter, which should simply be all entries linked to that taxpayer like {Orders:[{id:"ord1",amount:9.99},{id:"ord2",amount:25},..], ...}, and then the calculation rules in the business-logic workbook should instead work in a way where the JS source edits this object (using immer) directly, so that actually there should be no mention of any "Results" spreadsheet at all, because it should be up to the definer of the calculation rules in which sheet they would want to store what

---

**Cursor**

Understood — that’s a materially different (and better-defined) model:

- We compute **one “taxpayer aggregate object” per taxpayer**
- `ruleFn(aggregate)` runs and **mutates `aggregate`** (via Immer), rather than returning a single cell value
- Where outputs “live” is defined by the rules (so a fixed `Results` sheet is unnecessary)

### Clarifying question (next)
How do we determine **which input rows belong to which taxpayer**?

Concretely: do you want a required column like `taxpayerId` (or similar) on *every* input sheet (e.g. `Orders.taxpayerId`, `Income.taxpayerId`), and one canonical `Taxpayers` sheet where each taxpayer row has `id` = taxpayerId?

---

**User**

Make it so that it's MANDATORY (and the default) to have at least this one taxpayer sheet, i.e. it should not be removable and inputs without it are invalid. Then also have one mandatory input type called "taxpayerId" and it should validate (of course the input type parser functions should also be able to throw, which should cause a validation error) that the input string when parsing is actually present in the "Taxpayers" sheet. And then any row in any other sheet directly or indirectly referencing a taxpayer's ID should belong to that taxpayer

---

**Cursor**

Great — we’ll make this **structural invariant**:

- A non-removable input sheet named **`Taxpayers`**
- A mandatory input type **`taxpayerId`**
- `taxpayerId.parseFn` may throw; and additionally we validate that parsed IDs exist in `Taxpayers`
- Other sheets can link (directly or indirectly) to a taxpayer via ID references

### Clarifying question (one detail that affects the whole data model)
How should “**indirectly referencing a taxpayer’s ID**” be resolved?

Example: `Payments` references an `orderId`, and `Orders` references `taxpayerId`. Should we support this by declaring **foreign-key relationships** somewhere (e.g. an extra `Columns.refSheet`/`refColumn`), or do you want to infer it purely by **input type names** (e.g. a column of type `orderId` implies it points to `Orders.id`)?

---

**User**

Yes, the foreign-key relationships should be declared, but instead in the input types sheet as additional "refSheet" and "refColumn" columns

---

**Cursor**

Perfect — we’ll extend `InputTypes` to include optional `refSheet` + `refColumn` (making a type a *foreign-key type*), and use that graph to resolve “belongs to taxpayer” via chains ending at `Taxpayers.id` (type `taxpayerId`).

### 2–3 approaches (trade-offs) for “secure JS” + XLSX editing

#### Approach 1 (recommended): **Sandboxed Web Worker + SES-style hardening**
- **How**: run user JS in a dedicated Worker; freeze intrinsics; provide only a tiny API surface (`produce` from Immer, maybe `Math`, `Date` optionally); no DOM access; no network; execution timeouts.
- **Pros**: best security you can realistically get in-browser; keeps UI responsive; easier to enforce time limits.
- **Cons**: more engineering; needs careful packaging/hardening.

#### Approach 2: **Worker + minimal `new Function` without hardening**
- **How**: still isolate in a Worker and pass only data, but don’t attempt full intrinsic lockdown.
- **Pros**: simpler; still avoids DOM access and keeps UI responsive.
- **Cons**: weaker security model (prototype pollution / escaping via built-ins is more plausible).

#### Approach 3: **No JS execution; switch to expression DSL**
- **How**: abandon arbitrary JS; implement a safe expression language.
- **Pros**: safest.
- **Cons**: does not meet your “literal JS source code (actual function)” requirement.

**Recommendation**: **Approach 1**.

### Design (high-level) — does this match your intent so far?
- **Business-logic workbook (XLSX)**: fixed sheets
  - `InputTypes`: `name`, `parseFn`, `formatFn`, `refSheet?`, `refColumn?`
  - `Columns`: `sheet`, `columnName`, `typeName`
  - `Rules`: `name`, `ruleFn` (mutates taxpayer aggregate via Immer; may write outputs anywhere in aggregate)
- **Template input workbook (XLSX)**:
  - Always includes `Taxpayers` sheet with required `id` column (type `taxpayerId`)
  - Any other sheets as declared by `Columns.sheet`, with header row = column names
- **Import filled template**:
  - Parse + validate values using `InputTypes.parseFn` (throws → validation error)
  - Build a graph via FK types (`refSheet/refColumn`) and assign rows to taxpayers by chasing references until `Taxpayers`
  - Run rule worker per taxpayer aggregate; render results beautifully in the app; optionally export a “computed workbook” too

If that looks right, I’ll write the full spec and we’ll proceed.

---

**User**

Something with maximum browser compatibility

---

**Cursor**

“Maximum browser compatibility” pushes us away from heavy hardening (SES/Realms) and toward a **best‑effort sandbox** that still works on **iOS Safari + Chrome/Edge/Firefox**.

### Updated approach options (compat-first)

- **Approach A (recommended for compatibility)**: **Web Worker + strict API + timeouts**
  - Run user JS in a dedicated Worker (no DOM), provide only `produce` (Immer) + a tiny helper API, block/omit `fetch`/`XMLHttpRequest`, and kill the worker on timeout.
  - **Compatibility**: excellent across modern browsers incl. iOS Safari.

- **Approach B (stronger isolation, heavier)**: **JS engine in WASM (e.g. QuickJS)**
  - Execute user code inside a WASM VM; very strong sandbox.
  - **Compatibility**: still good in modern browsers, but larger bundle + more complexity/perf cost.

### One question (to lock “maximum”)
What’s your **minimum target**: do we need to support **iOS Safari** (and if yes, what minimum iOS version), or is “latest evergreen browsers” sufficient?

---

**User**

no, iOS Safari is not needed

---

**Cursor**

### Proposed design (compat-first) — please approve

#### **1) Workbooks and fixed sheet schemas**
- **Business-logic XLSX** (editable in-app, import/export):
  - **`InputTypes`** columns:
    - `name` (string, unique; mandatory builtin: `taxpayerId`)
    - `parseFn` (JS source string; must evaluate to a function `(s: string) => any`, may throw)
    - `formatFn` (JS source string; must evaluate to a function `(v: any) => string`, may throw)
    - `refSheet` (optional; if set, this type is a foreign key into that sheet)
    - `refColumn` (optional; default `id` if `refSheet` set; otherwise required alongside `refSheet`)
  - **`Columns`** columns:
    - `sheet` (string; **mandatory builtin sheet**: `Taxpayers`)
    - `columnName` (string; per-sheet unique; mandatory builtin column on `Taxpayers`: `id` with type `taxpayerId`)
    - `typeName` (string; must reference `InputTypes.name`)
  - **`Rules`** columns:
    - `name` (string; unique)
    - `ruleFn` (JS source string; must evaluate to a function `(aggregate) => void` that mutates via Immer)
- **Input (A‑Box) template XLSX** (generated & downloadable from the business-logic workbook):
  - One sheet per distinct `Columns.sheet` (including mandatory `Taxpayers`)
  - Row 1 = headers = `columnName`s for that sheet
  - Rows 2+ = data

#### **2) Row ownership / taxpayer aggregation**
- Every sheet’s rows may contain FK-typed columns (as declared by `InputTypes.refSheet/refColumn`).
- A row “belongs to” a taxpayer if, by following FK chains, it can be linked to **`Taxpayers.id`**.
- The simulator builds one **aggregate object per taxpayer** like:

```ts
{
  Taxpayers: [{ id: "t1", ... }],
  Orders: [{ id: "o1", taxpayerId: "t1", amount: 9.99 }, ...],
  // ...
  // plus rule-produced outputs anywhere the rules decide to write
}
```

#### **3) Secure(ish) JS execution with broad browser compatibility**
- Execute `parseFn`, `formatFn`, and `ruleFn` in a **Web Worker** (no DOM).
- Provide a tiny API surface only:
  - `produce` (Immer) for rule mutations
  - optionally `Math` + `Date` (we can decide, default: `Math` only)
- Enforce **timeouts** by terminating and recreating the worker.
- Treat thrown errors as **validation/simulation errors** shown in the UI (per cell / per taxpayer / per rule).

#### **4) Mobile-first client-side UX (no server)**
- Home: **Import business-logic XLSX** or **Create new**
- Editor flow tabs/steps:
  - **Input Types** (table editor with code editor cells)
  - **Columns** (table editor)
  - **Rules** (table editor with code editor cells)
- Actions:
  - **Export business-logic XLSX**
  - **Generate template XLSX**
  - **Upload filled template XLSX** → validate → simulate → show results (taxpayer list + detail view, errors inline)

### Approval
Reply **“approved”** or tell me what to change (one or two bullets).

---

**User**

approved

---

**Cursor**

### Spec written (ready for your review)

I wrote the design spec to:

- `docs/superpowers/specs/2026-04-28-xlsx-tax-rules-editor-design.md`

Please review it and tell me if you want any changes before we start writing the implementation plan.

Also: I **haven’t committed** the spec yet (I only commit when you ask). If you want, tell me **“commit the spec”** and I’ll create a commit.

---

**User**

commit the spec

---

**Cursor**

I’ll check the current git state/diff/log, then I’ll stage only the new design spec file (not the unrelated `LICENSE.md`, `default-README.md`, or `eslint.config.mjs`) and create a commit with a message matching your repo’s style.

### Done
- **Committed** `docs/superpowers/specs/2026-04-28-xlsx-tax-rules-editor-design.md` as **`82fc1ea`** with message **“docs: add XLSX tax rules editor design spec”**.
- **Left untouched** (still uncommitted): `eslint.config.mjs`, `LICENSE.md`, `default-README.md`.

If you’re ready, I’ll move on to writing the implementation plan next.

---

**User**

commit the others as well

---

**Cursor**

I’ll inspect the remaining changes (`LICENSE.md`, `default-README.md`, `eslint.config.mjs`) and then commit them together with a clear message.

### Done
- Committed the remaining changes as **`4ad386e`** with message **“chore: add license and adjust eslint config”**.
- Repo is now **clean** (`git status` shows no pending changes).

---

**User**

now build it as we defined!

---

**Cursor**

I’m going to turn the approved spec into a concrete, step-by-step implementation plan (milestones, files, dependencies, verification), then I’ll start implementing feature-by-feature in small, testable slices until the demo app is fully replaced.

### Implementation plan written
I created the implementation plan at:

- `docs/superpowers/plans/2026-04-28-xlsx-tax-rules-editor.md`

It’s currently **uncommitted**. Tell me **“commit the plan”** if you want it in git.

### Execution choice (per the plan)
Pick one:

1) **Subagent-driven (recommended)**: I run one focused implementation chunk at a time with review checkpoints.  
2) **Inline execution**: I implement everything in this session with checkpoints.

Which approach do you want?

---

**User**

1

---

**Cursor**

I’m using the **using-git-worktrees** workflow to set up an isolated workspace before we start implementing.

No worktree directory exists yet in this repo. Where should I create the worktree?

1. **`.worktrees/`** (project-local, hidden)  
2. **`~/.config/superpowers/worktrees/tax-rules-editor/`** (global location)

Reply with **1** or **2**.

---

**User**

1

---

**Cursor**

I’ll create a `.worktrees/` worktree on a fresh feature branch, make sure it’s gitignored, install dependencies in the new worktree, and run a quick clean baseline (lint/typecheck/build) before we start Task 1.

