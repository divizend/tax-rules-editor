"use client";

import * as React from "react";

import type { BusinessLogicWorkbook, ColumnDef, InputTypeDef, RuleDef } from "@/src/domain/schema";
import type { SheetError, ValidationResult } from "@/src/domain/errors";
import type { RawInputWorkbook, ValidatedInputWorkbook } from "@/src/domain/inputWorkbook";
import type { Aggregate } from "@/src/domain/aggregate";
import type { RuleError } from "@/src/domain/errors";

import { Button, buttonVariants } from "@/components/ui/button";
import { SimpleTable } from "@/components/editor/simple-table";
import { downloadArrayBuffer, fileToArrayBuffer } from "@/components/editor/download";
import { createBlankBusinessLogicWorkbook, createStarterBusinessLogicWorkbook } from "@/components/editor/starter-workbook";
import { SimResults } from "@/components/sim/sim-results";

import { readBusinessLogicWorkbook } from "@/src/xlsx/readBusinessLogic";
import { writeBusinessLogicWorkbook } from "@/src/xlsx/writeBusinessLogic";
import { generateTemplate } from "@/src/xlsx/generateTemplate";
import { readInputWorkbook } from "@/src/xlsx/readInputWorkbook";

import { schemaValidate } from "@/src/domain/schemaValidate";
import { parseAndValidateInputWorkbook } from "@/src/domain/inputParseValidate";
import { buildAggregates } from "@/src/domain/aggregate";
import { simulateAll } from "@/src/domain/simulate";
import { JsRunnerClient } from "@/src/worker/client";

type AnyErr = ValidationResult<never>["errors"][number];

function fileInputAcceptXlsx(): string {
  // both are useful; some browsers ignore one or the other
  return ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function asValidationErrors(res: ValidationResult<unknown> | null): AnyErr[] {
  if (!res) return [];
  return res.ok ? [] : res.errors;
}

function trim(v: string): string {
  return v.trim();
}

async function validateSchemaWithWorkerCompile(params: {
  wb: BusinessLogicWorkbook;
  jsRunner: Pick<JsRunnerClient, "compileFunction">;
}): Promise<ValidationResult<BusinessLogicWorkbook>> {
  const base = schemaValidate(params.wb);
  if (!base.ok) return base;

  const errors: AnyErr[] = [];
  for (const it of params.wb.inputTypes) {
    if (trim(it.parseFn).length > 0) {
      const r = await params.jsRunner.compileFunction(it.parseFn);
      if (!r.ok) errors.push({ severity: "error", sheet: "InputTypes", message: `parseFn "${it.name}": ${r.error}` });
    }
    if (trim(it.formatFn).length > 0) {
      const r = await params.jsRunner.compileFunction(it.formatFn);
      if (!r.ok) errors.push({ severity: "error", sheet: "InputTypes", message: `formatFn "${it.name}": ${r.error}` });
    }
  }
  for (const r0 of params.wb.rules) {
    if (trim(r0.ruleFn).length > 0) {
      const r = await params.jsRunner.compileFunction(r0.ruleFn);
      if (!r.ok) errors.push({ severity: "error", sheet: "Rules", message: `ruleFn "${r0.name}": ${r.error}` });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return base;
}

function Section(props: { title: string; children: React.ReactNode; right?: React.ReactNode }): React.ReactNode {
  return (
    <div className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="text-sm font-medium">{props.title}</div>
        {props.right ? <div className="flex items-center gap-2">{props.right}</div> : null}
      </div>
      <div className="p-4">{props.children}</div>
    </div>
  );
}

export function WorkbookEditorApp(): React.ReactNode {
  const [wb, setWb] = React.useState<BusinessLogicWorkbook>(() => createStarterBusinessLogicWorkbook());
  const [rawInput, setRawInput] = React.useState<RawInputWorkbook | null>(null);

  const [schemaValidation, setSchemaValidation] = React.useState<ValidationResult<BusinessLogicWorkbook> | null>(null);
  const [inputValidation, setInputValidation] = React.useState<ValidationResult<ValidatedInputWorkbook> | null>(null);
  const [simErrors, setSimErrors] = React.useState<RuleError[]>([]);
  const [simResults, setSimResults] = React.useState<Record<string, Aggregate> | null>(null);

  const [jsRunner, setJsRunner] = React.useState<JsRunnerClient | null>(null);
  React.useEffect(() => {
    if (typeof Worker === "undefined") return;
    const runner = new JsRunnerClient({ timeoutMs: 2_000 });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsRunner(runner);
    return () => runner.terminate();
  }, []);

  const schemaErrors = asValidationErrors(schemaValidation);
  const inputErrors = asValidationErrors(inputValidation);

  async function onImportBusinessLogic(file: File) {
    const buf = await fileToArrayBuffer(file);
    const next = readBusinessLogicWorkbook(buf);
    setWb(next);
    setSchemaValidation(null);
    setInputValidation(null);
    setSimErrors([]);
    setSimResults(null);
  }

  async function onUploadFilledTemplate(file: File) {
    const buf = await fileToArrayBuffer(file);
    const input = readInputWorkbook(buf);
    setRawInput(input);
    setInputValidation(null);
    setSimErrors([]);
    setSimResults(null);
  }

  async function onValidateAndSimulate() {
    setSchemaValidation(null);
    setInputValidation(null);
    setSimErrors([]);
    setSimResults(null);

    if (!jsRunner) return;

    const schemaRes = await validateSchemaWithWorkerCompile({ wb, jsRunner });
    setSchemaValidation(schemaRes);
    if (!schemaRes.ok) return;

    if (!rawInput) {
      const e: SheetError = {
        severity: "error",
        sheet: "Input",
        message: "No input workbook uploaded yet.",
      };
      setInputValidation({ ok: false, errors: [e] });
      return;
    }

    const inputRes = parseAndValidateInputWorkbook({ schema: wb, input: rawInput });
    setInputValidation(inputRes);
    if (!inputRes.ok) return;

    const aggregates = buildAggregates(inputRes.value);
    const simRes = await simulateAll({ schema: wb, aggregates, jsRunner });
    setSimErrors(simRes.errors);
    setSimResults(simRes.results);
  }

  function setInputTypes(next: InputTypeDef[]) {
    setWb((prev) => ({ ...prev, inputTypes: next }));
  }
  function setColumns(next: ColumnDef[]) {
    setWb((prev) => ({ ...prev, columns: next }));
  }
  function setRules(next: RuleDef[]) {
    setWb((prev) => ({ ...prev, rules: next }));
  }

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">XLSX Tax Rules Editor</h1>
          <div className="text-sm text-muted-foreground">
            Client-side v1. Create/import business-logic, generate templates, upload filled templates, run simulation in a
            worker.
          </div>
        </div>

        <Section
          title="Workbook"
          right={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setWb(createBlankBusinessLogicWorkbook());
                  setRawInput(null);
                  setSchemaValidation(null);
                  setInputValidation(null);
                  setSimErrors([]);
                  setSimResults(null);
                }}
              >
                Blank
              </Button>

              <Button
                variant="secondary"
                onClick={() => {
                  setWb(createStarterBusinessLogicWorkbook());
                  setRawInput(null);
                  setSchemaValidation(null);
                  setInputValidation(null);
                  setSimErrors([]);
                  setSimResults(null);
                }}
              >
                Starter example
              </Button>

              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="file"
                  accept={fileInputAcceptXlsx()}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void onImportBusinessLogic(f);
                    e.currentTarget.value = "";
                  }}
                />
                <span className={buttonVariants({ variant: "default" })}>Import XLSX</span>
              </label>

              <Button
                onClick={() => {
                  const data = writeBusinessLogicWorkbook(wb);
                  downloadArrayBuffer({ data, filename: "business-logic.xlsx" });
                }}
              >
                Export XLSX
              </Button>
            </>
          }
        >
          <div className="text-sm text-muted-foreground">
            Edit the three business-logic sheets in-place. Keep it simple: text inputs + textareas.
          </div>
        </Section>

        <Section title="InputTypes">
          <SimpleTable<InputTypeDef>
            caption="InputTypes sheet"
            rows={wb.inputTypes}
            columns={[
              { key: "name", label: "name", placeholder: "e.g. taxpayerId" },
              { key: "parseFn", label: "parseFn", kind: "textarea", placeholder: "(raw) => ..." },
              { key: "formatFn", label: "formatFn", kind: "textarea", placeholder: "(value) => String(value)" },
              { key: "refSheet", label: "refSheet", placeholder: "optional FK sheet" },
              { key: "refColumn", label: "refColumn", placeholder: "optional FK column" },
            ]}
            onChangeRow={(idx, next) => setInputTypes(wb.inputTypes.map((r, i) => (i === idx ? next : r)))}
            onAddRow={() =>
              setInputTypes([
                ...wb.inputTypes,
                { name: "", parseFn: "(raw) => raw", formatFn: "(value) => String(value ?? '')" },
              ])
            }
            onDeleteRow={(idx) => setInputTypes(wb.inputTypes.filter((_, i) => i !== idx))}
          />
        </Section>

        <Section title="Columns">
          <SimpleTable<ColumnDef>
            caption="Columns sheet"
            rows={wb.columns}
            columns={[
              { key: "sheet", label: "sheet", placeholder: "e.g. Taxpayers" },
              { key: "columnName", label: "columnName", placeholder: "e.g. id" },
              { key: "typeName", label: "typeName", placeholder: "e.g. taxpayerId" },
            ]}
            onChangeRow={(idx, next) => setColumns(wb.columns.map((r, i) => (i === idx ? next : r)))}
            onAddRow={() => setColumns([...wb.columns, { sheet: "", columnName: "", typeName: "" }])}
            onDeleteRow={(idx) => setColumns(wb.columns.filter((_, i) => i !== idx))}
          />
        </Section>

        <Section title="Rules">
          <SimpleTable<RuleDef>
            caption="Rules sheet"
            rows={wb.rules}
            columns={[
              { key: "name", label: "name", placeholder: "e.g. computeTotals" },
              { key: "ruleFn", label: "ruleFn", kind: "textarea", placeholder: "(draft) => { ... }" },
            ]}
            onChangeRow={(idx, next) => setRules(wb.rules.map((r, i) => (i === idx ? next : r)))}
            onAddRow={() => setRules([...wb.rules, { name: "", ruleFn: "(draft) => {}" }])}
            onDeleteRow={(idx) => setRules(wb.rules.filter((_, i) => i !== idx))}
          />
        </Section>

        <Section
          title="Template + Simulation"
          right={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  const data = generateTemplate(wb);
                  downloadArrayBuffer({ data, filename: "template.xlsx" });
                }}
              >
                Generate template XLSX
              </Button>

              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="file"
                  accept={fileInputAcceptXlsx()}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    void onUploadFilledTemplate(f);
                    e.currentTarget.value = "";
                  }}
                />
                <span className={buttonVariants({ variant: "secondary" })}>Upload filled template</span>
              </label>

              <Button disabled={!jsRunner} onClick={() => void onValidateAndSimulate()}>
                Validate + Run sim
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <div className="text-sm text-muted-foreground">
              Uploaded input workbook:{" "}
              <span className="font-mono">{rawInput ? `${rawInput.sheetNames.length} sheet(s)` : "none"}</span>
            </div>
            <SimResults
              schemaErrors={schemaErrors}
              inputErrors={inputErrors}
              simErrors={simErrors}
              results={simResults}
            />
          </div>
        </Section>

        <div className="text-xs text-muted-foreground">
          Tip: press <kbd className="rounded border px-1">d</kbd> to toggle dark mode.
        </div>
      </div>
    </div>
  );
}

