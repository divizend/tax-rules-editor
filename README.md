# XLSX Tax Rules Editor

Spreadsheet-first editor to define **input schemas** (types + tables/columns) and **calculation rules** as JavaScript, then generate an end-user **XLSX template**, validate filled templates, and **simulate** results locally.

This project exists to help translate real-world tax logic (often maintained in spreadsheets) into code in an iterative, testable workflow.

## What you can do

- **Define input types**: parsing/formatting and optional entity references (FKs).
- **Define tables & columns**: model the workbook structure your end users will fill.
- **Define rules (JS)**: executed top-to-bottom to produce computed outputs.
- **Export two artifacts**:
  - **Business-logic workbook** (`.xlsx`): types + columns + rules.
  - **Template workbook** (`.template.xlsx`): end-user data entry workbook.
- **Validate + simulate**: upload a filled template, validate it, then run the rule pipeline and inspect results.
- **AI-assisted editing (optional)**: generate/edit types, tables, and rules through the UI (requires an API key).

## Intended workflow

1. Create/open a **business-logic workbook**
2. Edit:
   - `InputType` sheet (types + parse/format JS)
   - `Column` sheet (tables + columns)
   - `Rule` sheet (rule JS)
3. Click **Generate template XLSX**
4. Fill the template with test data in Excel/LibreOffice
5. Upload it via **Template + Simulation**
6. Click **Validate + Run sim** and review errors/results

## Getting started

### Prerequisites

- Node.js (recommended: current LTS)
- pnpm

### Install & run

```bash
pnpm install
pnpm dev
```

Then open the URL printed by the dev server.

## Tests

```bash
pnpm test
pnpm test:ui
```

- **`pnpm test`**: domain/unit tests (Node’s built-in test runner).
- **`pnpm test:ui`**: frontend “e2e-style” integration tests in JSDOM (no Playwright/Chrome required).

## AI configuration (optional)

Some UI actions call Next.js API routes under `app/api/ai/*`.

Set:

```bash
export OPENAI_API_KEY="..."
```

If `OPENAI_API_KEY` is missing, the AI endpoints will return an error and the rest of the app remains usable.

## License

GPL-3.0. See `LICENSE.md`.
