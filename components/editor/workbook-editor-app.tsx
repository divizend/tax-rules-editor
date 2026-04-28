"use client"

import * as React from "react"

import type {
  BusinessLogicWorkbook,
  ColumnDef,
  InputTypeDef,
  RuleDef,
} from "@/src/domain/schema"
import type { SheetError, ValidationResult } from "@/src/domain/errors"
import type {
  RawInputWorkbook,
  ValidatedInputWorkbook,
} from "@/src/domain/inputWorkbook"
import type { Aggregate } from "@/src/domain/aggregate"
import type { RuleError } from "@/src/domain/errors"

import { Button, buttonVariants } from "@/components/ui/button"
import { SimpleTable } from "@/components/editor/simple-table"
import {
  downloadArrayBuffer,
  fileToArrayBuffer,
} from "@/components/editor/download"
import {
  createNewBusinessLogicWorkbook,
} from "@/components/editor/starter-workbook"
import { SimResults } from "@/components/sim/sim-results"

import { readBusinessLogicWorkbook } from "@/src/xlsx/readBusinessLogic"
import { writeBusinessLogicWorkbook } from "@/src/xlsx/writeBusinessLogic"
import { generateTemplate } from "@/src/xlsx/generateTemplate"
import { readInputWorkbook } from "@/src/xlsx/readInputWorkbook"

import { schemaValidate } from "@/src/domain/schemaValidate"
import { parseAndValidateInputWorkbook } from "@/src/domain/inputParseValidate"
import { buildAggregates } from "@/src/domain/aggregate"
import { simulateAll } from "@/src/domain/simulate"
import { JsRunnerClient } from "@/src/worker/client"

type AnyErr = ValidationResult<never>["errors"][number]

type WorkbookTab = {
  id: string
  title: string
  wb: BusinessLogicWorkbook
  rawInput: RawInputWorkbook | null
  schemaValidation: ValidationResult<BusinessLogicWorkbook> | null
  inputValidation: ValidationResult<ValidatedInputWorkbook> | null
  simErrors: RuleError[]
  simResults: Record<string, Aggregate> | null
}

function fileInputAcceptXlsx(): string {
  // both are useful; some browsers ignore one or the other
  return ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
}

function asValidationErrors(res: ValidationResult<unknown> | null): AnyErr[] {
  if (!res) return []
  return res.ok ? [] : res.errors
}

function trim(v: string): string {
  return v.trim()
}

async function validateSchemaWithWorkerCompile(params: {
  wb: BusinessLogicWorkbook
  jsRunner: Pick<JsRunnerClient, "compileFunction">
}): Promise<ValidationResult<BusinessLogicWorkbook>> {
  const base = schemaValidate(params.wb)
  if (!base.ok) return base

  const errors: AnyErr[] = []
  for (const it of params.wb.inputTypes) {
    if (trim(it.parseFn).length > 0) {
      const r = await params.jsRunner.compileFunction(it.parseFn)
      if (!r.ok)
        errors.push({
          severity: "error",
          sheet: "InputTypes",
          message: `parseFn "${it.name}": ${r.error}`,
        })
    }
    if (trim(it.formatFn).length > 0) {
      const r = await params.jsRunner.compileFunction(it.formatFn)
      if (!r.ok)
        errors.push({
          severity: "error",
          sheet: "InputTypes",
          message: `formatFn "${it.name}": ${r.error}`,
        })
    }
  }
  for (const r0 of params.wb.rules) {
    if (trim(r0.ruleFn).length > 0) {
      const r = await params.jsRunner.compileFunction(r0.ruleFn)
      if (!r.ok)
        errors.push({
          severity: "error",
          sheet: "Rules",
          message: `ruleFn "${r0.name}": ${r.error}`,
        })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return base
}

function Section(props: {
  title: string
  children: React.ReactNode
  right?: React.ReactNode
}): React.ReactNode {
  return (
    <div className="rounded-xl border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
        <div className="text-sm font-medium">{props.title}</div>
        {props.right ? (
          <div className="flex items-center gap-2">{props.right}</div>
        ) : null}
      </div>
      <div className="p-4">{props.children}</div>
    </div>
  )
}

export function WorkbookEditorApp(): React.ReactNode {
  const [tabs, setTabs] = React.useState<WorkbookTab[]>([])
  const [activeTabId, setActiveTabId] = React.useState<string | null>(null)

  const [jsRunner, setJsRunner] = React.useState<JsRunnerClient | null>(null)
  React.useEffect(() => {
    if (typeof Worker === "undefined") return
    const runner = new JsRunnerClient({ timeoutMs: 2_000 })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsRunner(runner)
    return () => runner.terminate()
  }, [])

  const activeTab = React.useMemo(
    () =>
      activeTabId ? (tabs.find((t) => t.id === activeTabId) ?? null) : null,
    [activeTabId, tabs]
  )

  const schemaErrors = asValidationErrors(activeTab?.schemaValidation ?? null)
  const inputErrors = asValidationErrors(activeTab?.inputValidation ?? null)

  function nextUntitledTitle(prefix: string): string {
    const used = new Set(tabs.map((t) => t.title))
    if (!used.has(prefix)) return prefix
    for (let i = 2; i < 10_000; i++) {
      const candidate = `${prefix} ${i}`
      if (!used.has(candidate)) return candidate
    }
    return `${prefix} ${Date.now()}`
  }

  function openTab(params: { title: string; wb: BusinessLogicWorkbook }) {
    const id = crypto.randomUUID()
    const tab: WorkbookTab = {
      id,
      title: params.title,
      wb: params.wb,
      rawInput: null,
      schemaValidation: null,
      inputValidation: null,
      simErrors: [],
      simResults: null,
    }
    setTabs((prev) => [...prev, tab])
    setActiveTabId(id)
  }

  function closeTab(id: string) {
    setTabs((prev) => {
      const remaining = prev.filter((t) => t.id !== id)
      setActiveTabId((prevActive) => {
        if (prevActive !== id) return prevActive
        return remaining.length ? remaining[remaining.length - 1]!.id : null
      })
      return remaining
    })
  }

  async function onImportBusinessLogic(file: File) {
    const buf = await fileToArrayBuffer(file)
    const next = readBusinessLogicWorkbook(buf)
    const title =
      file.name.replace(/\.xlsx$/i, "") || nextUntitledTitle("Workbook")
    openTab({ title, wb: next })
  }

  async function onUploadFilledTemplate(file: File) {
    if (!activeTab) return
    const buf = await fileToArrayBuffer(file)
    const input = readInputWorkbook(buf)
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              rawInput: input,
              inputValidation: null,
              simErrors: [],
              simResults: null,
            }
          : t
      )
    )
  }

  async function onValidateAndSimulate() {
    if (!jsRunner || !activeTab) return

    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? {
              ...t,
              schemaValidation: null,
              inputValidation: null,
              simErrors: [],
              simResults: null,
            }
          : t
      )
    )

    const schemaRes = await validateSchemaWithWorkerCompile({
      wb: activeTab.wb,
      jsRunner,
    })
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, schemaValidation: schemaRes } : t
      )
    )
    if (!schemaRes.ok) return

    if (!activeTab.rawInput) {
      const e: SheetError = {
        severity: "error",
        sheet: "Input",
        message: "No input workbook uploaded yet.",
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, inputValidation: { ok: false, errors: [e] } }
            : t
        )
      )
      return
    }

    const inputRes = parseAndValidateInputWorkbook({
      schema: activeTab.wb,
      input: activeTab.rawInput,
    })
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, inputValidation: inputRes } : t
      )
    )
    if (!inputRes.ok) return

    const aggregates = buildAggregates(inputRes.value)
    const simRes = await simulateAll({
      schema: activeTab.wb,
      aggregates,
      jsRunner,
    })
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, simErrors: simRes.errors, simResults: simRes.results }
          : t
      )
    )
  }

  function setInputTypes(next: InputTypeDef[]) {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, wb: { ...t.wb, inputTypes: next } } : t
      )
    )
  }
  function setColumns(next: ColumnDef[]) {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, wb: { ...t.wb, columns: next } } : t
      )
    )
  }
  function setRules(next: RuleDef[]) {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, wb: { ...t.wb, rules: next } } : t
      )
    )
  }

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">XLSX Tax Rules Editor</h1>
          <div className="text-sm text-muted-foreground">
            Client-side v1. Create/import business-logic, generate templates,
            upload filled templates, run simulation in a worker.
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto rounded-xl border bg-background p-2">
          <div className="flex items-center gap-2">
            {tabs.map((t) => {
              const active = t.id === activeTabId
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTabId(t.id)}
                  className={[
                    "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
                    active ? "bg-muted" : "hover:bg-muted/50",
                  ].join(" ")}
                >
                  <span className="max-w-[10rem] truncate">{t.title}</span>
                  <span
                    className="inline-flex h-5 w-5 items-center justify-center rounded-md border text-xs hover:bg-background"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      closeTab(t.id)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        e.stopPropagation()
                        closeTab(t.id)
                      }
                    }}
                    aria-label={`Close ${t.title}`}
                  >
                    ×
                  </span>
                </button>
              )
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                openTab({
                  title: nextUntitledTitle("Untitled"),
                  wb: createNewBusinessLogicWorkbook(),
                })
              }
            >
              + New
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="file"
                accept={fileInputAcceptXlsx()}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  void onImportBusinessLogic(f)
                  e.currentTarget.value = ""
                }}
              />
              <span
                className={buttonVariants({ variant: "secondary", size: "sm" })}
              >
                + Open
              </span>
            </label>
          </div>
        </div>

        {activeTab ? (
          <>
            <Section
              title="Workbook"
              right={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      closeTab(activeTab.id)
                    }}
                  >
                    Close
                  </Button>

                  <Button
                    onClick={() => {
                      const data = writeBusinessLogicWorkbook(activeTab.wb)
                      downloadArrayBuffer({
                        data,
                        filename: `${activeTab.title || "business-logic"}.xlsx`,
                      })
                    }}
                  >
                    Export XLSX
                  </Button>
                </>
              }
            >
              <div className="text-sm text-muted-foreground">
                Business-logic workbook loaded. Edit the three sheets in-place,
                then export, generate template, and run the simulation.
              </div>
            </Section>

            <Section title="InputTypes">
              <SimpleTable<InputTypeDef>
                caption="InputTypes sheet"
                rows={activeTab.wb.inputTypes}
                columns={[
                  {
                    key: "name",
                    label: "name",
                    placeholder: "e.g. taxpayerId",
                  },
                  {
                    key: "parseFn",
                    label: "parseFn",
                    kind: "textarea",
                    placeholder: "(raw) => ...",
                  },
                  {
                    key: "formatFn",
                    label: "formatFn",
                    kind: "textarea",
                    placeholder: "(value) => String(value)",
                  },
                  {
                    key: "refSheet",
                    label: "refSheet",
                    placeholder: "optional FK sheet",
                  },
                  {
                    key: "refColumn",
                    label: "refColumn",
                    placeholder: "optional FK column",
                  },
                ]}
                onChangeRow={(idx, next) =>
                  setInputTypes(
                    activeTab.wb.inputTypes.map((r, i) =>
                      i === idx ? next : r
                    )
                  )
                }
                onAddRow={() =>
                  setInputTypes([
                    ...activeTab.wb.inputTypes,
                    {
                      name: "",
                      parseFn: "(raw) => raw",
                      formatFn: "(value) => String(value ?? '')",
                    },
                  ])
                }
                onDeleteRow={(idx) =>
                  setInputTypes(
                    activeTab.wb.inputTypes.filter((_, i) => i !== idx)
                  )
                }
              />
            </Section>

            <Section title="Columns">
              <SimpleTable<ColumnDef>
                caption="Columns sheet"
                rows={activeTab.wb.columns}
                columns={[
                  {
                    key: "sheet",
                    label: "sheet",
                    placeholder: "e.g. Taxpayers",
                  },
                  {
                    key: "columnName",
                    label: "columnName",
                    placeholder: "e.g. id",
                  },
                  {
                    key: "typeName",
                    label: "typeName",
                    placeholder: "e.g. taxpayerId",
                  },
                ]}
                onChangeRow={(idx, next) =>
                  setColumns(
                    activeTab.wb.columns.map((r, i) => (i === idx ? next : r))
                  )
                }
                onAddRow={() =>
                  setColumns([
                    ...activeTab.wb.columns,
                    { sheet: "", columnName: "", typeName: "" },
                  ])
                }
                onDeleteRow={(idx) =>
                  setColumns(activeTab.wb.columns.filter((_, i) => i !== idx))
                }
              />
            </Section>

            <Section title="Rules">
              <SimpleTable<RuleDef>
                caption="Rules sheet"
                rows={activeTab.wb.rules}
                columns={[
                  {
                    key: "name",
                    label: "name",
                    placeholder: "e.g. computeTotals",
                  },
                  {
                    key: "ruleFn",
                    label: "ruleFn",
                    kind: "textarea",
                    placeholder: "(draft) => { ... }",
                  },
                ]}
                onChangeRow={(idx, next) =>
                  setRules(
                    activeTab.wb.rules.map((r, i) => (i === idx ? next : r))
                  )
                }
                onAddRow={() =>
                  setRules([
                    ...activeTab.wb.rules,
                    { name: "", ruleFn: "(draft) => {}" },
                  ])
                }
                onDeleteRow={(idx) =>
                  setRules(activeTab.wb.rules.filter((_, i) => i !== idx))
                }
              />
            </Section>

            <Section
              title="Template + Simulation"
              right={
                <>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const data = generateTemplate(activeTab.wb)
                      downloadArrayBuffer({
                        data,
                        filename: `${activeTab.title || "template"}.template.xlsx`,
                      })
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
                        const f = e.target.files?.[0]
                        if (!f) return
                        void onUploadFilledTemplate(f)
                        e.currentTarget.value = ""
                      }}
                    />
                    <span className={buttonVariants({ variant: "secondary" })}>
                      Upload filled template
                    </span>
                  </label>

                  <Button
                    disabled={!jsRunner}
                    onClick={() => void onValidateAndSimulate()}
                  >
                    Validate + Run sim
                  </Button>
                </>
              }
            >
              <div className="flex flex-col gap-3">
                <div className="text-sm text-muted-foreground">
                  Uploaded input workbook:{" "}
                  <span className="font-mono">
                    {activeTab.rawInput
                      ? `${activeTab.rawInput.sheetNames.length} sheet(s)`
                      : "none"}
                  </span>
                </div>
                <SimResults
                  schemaErrors={schemaErrors}
                  inputErrors={inputErrors}
                  simErrors={activeTab.simErrors}
                  results={activeTab.simResults}
                />
              </div>
            </Section>
          </>
        ) : (
          <Section title="Start">
            <div className="flex min-h-56 flex-col items-center justify-center gap-3">
              <Button
                size="lg"
                onClick={() => {
                  openTab({
                    title: nextUntitledTitle("Untitled"),
                    wb: createNewBusinessLogicWorkbook(),
                  })
                }}
              >
                Create new XLSX
              </Button>

              <label className="inline-flex cursor-pointer items-center gap-2">
                <input
                  type="file"
                  accept={fileInputAcceptXlsx()}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (!f) return
                    void onImportBusinessLogic(f)
                    e.currentTarget.value = ""
                  }}
                />
                <span className={buttonVariants({ variant: "secondary", size: "lg" })}>
                  Open existing XLSX
                </span>
              </label>
            </div>
          </Section>
        )}

        <div className="text-xs text-muted-foreground">
          Tip: press <kbd className="rounded border px-1">d</kbd> to toggle dark
          mode.
        </div>
      </div>
    </div>
  )
}
