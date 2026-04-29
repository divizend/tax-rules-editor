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
import { compileSourceToFunction } from "@/src/worker/jsRunner.worker"
import { entityIdTypeName, nounToPascalCase } from "@/src/domain/naming"
import { makeEntityIdInputType } from "@/src/domain/entityIdInputType"
import { ArrowDown, ArrowUp } from "lucide-react"

type AnyErr = ValidationResult<never>["errors"][number]

type WorkbookTab = {
  id: string
  title: string
  dirty: boolean
  wb: BusinessLogicWorkbook
  rawInput: RawInputWorkbook | null
  schemaValidation: ValidationResult<BusinessLogicWorkbook> | null
  inputValidation: ValidationResult<ValidatedInputWorkbook> | null
  simErrors: RuleError[]
  simResults: Record<string, Aggregate> | null
}

const LOCAL_STORAGE_KEY_V1 = "tax-rules-editor:v1:tabs-state"
const LOCAL_STORAGE_KEY = "tax-rules-editor:v3:tabs-state"

type PersistedStateV3 = {
  v: 3
  activeTabId: string | null
  tabs: WorkbookTab[]
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

/** Compact workbook summary for AI routes (column samples; no rule bodies). */
function buildAiContext(wb: BusinessLogicWorkbook): unknown {
  const entities = Array.from(
    new Set(wb.columns.map((c) => trim(c.sheet)).filter(Boolean))
  )
  const columnsBySheet = Object.fromEntries(
    entities.map((sheet) => [
      sheet,
      wb.columns
        .filter((c) => trim(c.sheet) === sheet)
        .map((c) => ({
          columnName: trim(c.columnName),
          typeName: trim(c.typeName),
        })),
    ])
  )
  return {
    inputTypes: wb.inputTypes.map((it) => ({
      name: trim(it.name),
      description: it.description != null ? trim(it.description) : "",
      ref: it.ref ? trim(it.ref) : "",
    })),
    columnsBySheet,
    ruleNames: wb.rules.map((r) => trim(r.name)).filter(Boolean),
  }
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
          sheet: "InputType",
          message: `parseFn "${it.name}": ${r.error}`,
        })
    }
    if (trim(it.formatFn).length > 0) {
      const r = await params.jsRunner.compileFunction(it.formatFn)
      if (!r.ok)
        errors.push({
          severity: "error",
          sheet: "InputType",
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
          sheet: "Rule",
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

function Panel(props: { children: React.ReactNode }): React.ReactNode {
  return <div className="rounded-xl border bg-background p-4">{props.children}</div>
}

export function WorkbookEditorApp(): React.ReactNode {
  const [tabs, setTabs] = React.useState<WorkbookTab[]>([])
  const [activeTabId, setActiveTabId] = React.useState<string | null>(null)
  const [importBusinessLogicError, setImportBusinessLogicError] = React.useState<string | null>(null)
  const hasRestoredRef = React.useRef(false)

  const [jsRunner, setJsRunner] = React.useState<JsRunnerClient | null>(null)
  React.useEffect(() => {
    if (typeof Worker === "undefined") return
    const runner = new JsRunnerClient({ timeoutMs: 2_000 })
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJsRunner(runner)
    return () => runner.terminate()
  }, [])

  // Restore tabs state once on mount (client-side only).
  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (hasRestoredRef.current) return
    hasRestoredRef.current = true

    try {
      // Drop v1 storage — schema/workbook shape is not compatible.
      window.localStorage.removeItem(LOCAL_STORAGE_KEY_V1)

      const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      const st = parsed as Partial<PersistedStateV3>
      if (st?.v !== 3) {
        window.localStorage.removeItem(LOCAL_STORAGE_KEY)
        return
      }
      if (!Array.isArray(st.tabs)) return
      const restoredTabs = (st.tabs.filter(Boolean) as WorkbookTab[]).map((t) => ({
        ...t,
        dirty: !!(t as Partial<WorkbookTab>).dirty,
      }))
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTabs(restoredTabs)
      const nextActive =
        typeof st.activeTabId === "string" ? st.activeTabId : null
      setActiveTabId(
        nextActive && restoredTabs.some((t) => t.id === nextActive)
          ? nextActive
          : restoredTabs.length
            ? restoredTabs[0]!.id
            : null
      )
    } catch {
      // ignore corrupt storage
    }
  }, [])

  // Persist full state of open workbooks whenever it changes.
  React.useEffect(() => {
    if (typeof window === "undefined") return
    if (!hasRestoredRef.current) return

    const state: PersistedStateV3 = { v: 3, activeTabId, tabs }

    const write = () => {
      try {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state))
      } catch {
        // ignore quota/security errors
      }
    }

    type RequestIdleCallback = (
      cb: () => void,
      opts?: { timeout?: number }
    ) => number
    const ric = (window as unknown as { requestIdleCallback?: RequestIdleCallback })
      .requestIdleCallback

    if (typeof ric === "function") {
      ric(write, { timeout: 500 })
    } else {
      const t = window.setTimeout(write, 0)
      return () => window.clearTimeout(t)
    }
  }, [activeTabId, tabs])

  const activeTab = React.useMemo(
    () =>
      activeTabId ? (tabs.find((t) => t.id === activeTabId) ?? null) : null,
    [activeTabId, tabs]
  )

  const schemaErrors = asValidationErrors(activeTab?.schemaValidation ?? null)
  const inputErrors = asValidationErrors(activeTab?.inputValidation ?? null)

  const entitySheetOrder = React.useMemo(() => {
    const order: string[] = []
    const seen = new Set<string>()
    for (const c of activeTab?.wb.columns ?? []) {
      const s = trim(c.sheet)
      if (s.length === 0 || seen.has(s)) continue
      seen.add(s)
      order.push(s)
    }
    return order
  }, [activeTab?.wb.columns])

  const [aiDialog, setAiDialog] = React.useState<null | {
    kind: "inputType" | "rule" | "table"
    text: string
    loading: boolean
    error: string | null
  }>(null)

  const [addTableDialog, setAddTableDialog] = React.useState<null | {
    noun: string
    error: string | null
  }>(null)

  const [renameTableDialog, setRenameTableDialog] = React.useState<null | {
    fromEntity: string
    noun: string
    error: string | null
  }>(null)

  const [renameWorkbookDialog, setRenameWorkbookDialog] = React.useState<null | {
    title: string
    error: string | null
  }>(null)

  const [confirmCloseDialog, setConfirmCloseDialog] = React.useState<null | {
    tabId: string
  }>(null)

  function nextUntitledTitle(prefix: string): string {
    const used = new Set(tabs.map((t) => t.title))
    if (!used.has(prefix)) return prefix
    for (let i = 2; i < 10_000; i++) {
      const candidate = `${prefix} ${i}`
      if (!used.has(candidate)) return candidate
    }
    return `${prefix} ${Date.now()}`
  }

  function openTab(params: {
    title: string
    wb: BusinessLogicWorkbook
    dirty?: boolean
  }) {
    const id = crypto.randomUUID()
    const tab: WorkbookTab = {
      id,
      title: params.title,
      dirty: params.dirty ?? false,
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

  function clearDirty(tabId: string) {
    setTabs((prev) =>
      prev.map((t) => (t.id === tabId ? (t.dirty ? { ...t, dirty: false } : t) : t)),
    )
  }

  function requestCloseTab(id: string) {
    const tab = tabs.find((t) => t.id === id) ?? null
    if (tab?.dirty) {
      setConfirmCloseDialog({ tabId: id })
      return
    }
    closeTab(id)
  }

  function applyRenameWorkbook() {
    if (!activeTab || !renameWorkbookDialog) return
    const nextTitle = renameWorkbookDialog.title.trim()
    if (nextTitle.length === 0) {
      setRenameWorkbookDialog((prev) => (prev ? { ...prev, error: "Title is required" } : prev))
      return
    }
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, dirty: true, title: nextTitle } : t,
      ),
    )
    setRenameWorkbookDialog(null)
  }

  async function onImportBusinessLogic(file: File) {
    setImportBusinessLogicError(null)
    try {
      const buf = await fileToArrayBuffer(file)
      const next = readBusinessLogicWorkbook(buf)
      const title =
        file.name.replace(/\.xlsx$/i, "") || nextUntitledTitle("Workbook")
      openTab({ title, wb: next, dirty: false })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to import business-logic XLSX."
      setImportBusinessLogicError(msg)
    }
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
              dirty: true,
              rawInput: input,
              inputValidation: null,
              simErrors: [],
              simResults: null,
            }
          : t
      )
    )
  }

  function defaultStringInputType(name: string): InputTypeDef {
    return {
      name,
      description: "",
      parseFn: "(raw, _wb) => String(raw ?? '')",
      formatFn: "(value) => String(value ?? '')",
    }
  }

  async function generateInputTypeFromAi(description: string) {
    if (!activeTab) return
    setAiDialog({ kind: "inputType", text: description, loading: true, error: null })
    const res = await fetch("/api/ai/input-type", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        context: buildAiContext(activeTab.wb),
      }),
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        typeof (json as { error?: unknown } | null)?.error === "string"
          ? (json as { error: string }).error
          : "AI request failed."
      setAiDialog((prev) =>
        prev ? { ...prev, loading: false, error: msg } : prev
      )
      return
    }
    const row = (json as { row?: unknown } | null)?.row as Partial<InputTypeDef> | undefined
    if (
      !row ||
      typeof row.name !== "string" ||
      typeof row.parseFn !== "string" ||
      typeof row.formatFn !== "string"
    ) {
      setAiDialog((prev) => (prev ? { ...prev, loading: false, error: "AI returned an invalid row." } : prev))
      return
    }
    const desc =
      typeof row.description === "string" && row.description.trim().length > 0
        ? row.description.trim()
        : description
    const ref =
      typeof row.ref === "string" && row.ref.trim().length > 0 ? row.ref.trim() : undefined
    setInputTypes([
      ...activeTab.wb.inputTypes,
      {
        name: row.name,
        description: desc,
        parseFn: row.parseFn,
        formatFn: row.formatFn,
        ref,
      },
    ])
    setAiDialog(null)
  }

  async function generateRuleFromAi(description: string) {
    if (!activeTab) return
    setAiDialog({ kind: "rule", text: description, loading: true, error: null })
    const res = await fetch("/api/ai/rule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        context: buildAiContext(activeTab.wb),
      }),
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        typeof (json as { error?: unknown } | null)?.error === "string"
          ? (json as { error: string }).error
          : "AI request failed."
      setAiDialog((prev) =>
        prev ? { ...prev, loading: false, error: msg } : prev
      )
      return
    }
    const row = (json as { row?: unknown } | null)?.row as Partial<RuleDef> | undefined
    if (!row || typeof row.name !== "string" || typeof row.ruleFn !== "string") {
      setAiDialog((prev) => (prev ? { ...prev, loading: false, error: "AI returned an invalid row." } : prev))
      return
    }
    setRules([
      ...activeTab.wb.rules,
      { name: row.name, description, ruleFn: row.ruleFn },
    ])
    setAiDialog(null)
  }

  async function generateTableFromAi(description: string) {
    if (!activeTab) return
    setAiDialog({ kind: "table", text: description, loading: true, error: null })
    const res = await fetch("/api/ai/table", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description,
        context: buildAiContext(activeTab.wb),
      }),
    })
    const json: unknown = await res.json().catch(() => null)
    if (!res.ok) {
      const msg =
        typeof (json as { error?: unknown } | null)?.error === "string"
          ? (json as { error: string }).error
          : "AI request failed."
      setAiDialog((prev) =>
        prev ? { ...prev, loading: false, error: msg } : prev
      )
      return
    }
    const table = (json as { table?: unknown } | null)?.table as
      | { sheetName?: unknown; columns?: unknown }
      | undefined
    if (
      !table ||
      typeof table.sheetName !== "string" ||
      !Array.isArray(table.columns)
    ) {
      setAiDialog((prev) =>
        prev ? { ...prev, loading: false, error: "AI returned an invalid table." } : prev
      )
      return
    }

    const sheetName = table.sheetName.trim()
    const entities = new Set(activeTab.wb.columns.map((c) => trim(c.sheet)).filter(Boolean))
    if (entities.has(sheetName)) {
      setAiDialog((prev) =>
        prev
          ? {
              ...prev,
              loading: false,
              error: `Entity "${sheetName}" already exists. Choose a different table name/noun.`,
            }
          : prev
      )
      return
    }

    const idTypeName = entityIdTypeName(sheetName)
    const nextCols: ColumnDef[] = [
      { sheet: sheetName, columnName: "id", typeName: idTypeName },
    ]
    const seenCol = new Set<string>(["id"])
    for (const c of table.columns) {
      if (!c || typeof c !== "object") continue
      const col = c as { columnName?: unknown; typeName?: unknown; description?: unknown }
      if (
        typeof col.columnName !== "string" ||
        typeof col.typeName !== "string" ||
        typeof col.description !== "string"
      )
        continue
      const cn = col.columnName.trim()
      if (cn.length === 0 || cn === "id") continue
      if (seenCol.has(cn)) continue
      seenCol.add(cn)
      nextCols.push({
        sheet: sheetName,
        columnName: cn,
        typeName: col.typeName.trim(),
        description: col.description.trim(),
      })
    }

    const existingTypeNames = new Set(
      activeTab.wb.inputTypes.map((it) => trim(it.name)).filter(Boolean)
    )
    const nextInputTypes = [...activeTab.wb.inputTypes]

    if (!existingTypeNames.has(idTypeName)) {
      nextInputTypes.push(makeEntityIdInputType(sheetName))
      existingTypeNames.add(idTypeName)
    }

    const unknownTypes = new Set<string>()
    for (const c of nextCols) {
      const t = trim(c.typeName)
      if (!t) unknownTypes.add(t)
      else if (!existingTypeNames.has(t)) unknownTypes.add(t)
    }
    unknownTypes.delete(idTypeName)

    for (const t of [...unknownTypes].sort()) {
      if (t.length === 0) continue
      if (t.endsWith("Id")) {
        setAiDialog((prev) =>
          prev
            ? {
                ...prev,
                loading: false,
                error: `AI invented input type "${t}" ending with "Id" — refusing (would require an explicit entity ref). Regenerate or edit columns.`,
              }
            : prev
        )
        return
      }
      nextInputTypes.push(defaultStringInputType(t))
      existingTypeNames.add(t)
    }

    setColumns([...activeTab.wb.columns, ...nextCols])
    setInputTypes(nextInputTypes)
    setAiDialog(null)
  }

  function addManualTable() {
    if (!activeTab) return
    setAddTableDialog({ noun: "", error: null })
  }

  function createManualTableFromDialog() {
    if (!activeTab || !addTableDialog) return
    const noun = addTableDialog.noun.trim()
    if (!noun) {
      setAddTableDialog((prev) => (prev ? { ...prev, error: "Please enter a noun." } : prev))
      return
    }

    const sheetName = nounToPascalCase(noun)
    if (!sheetName) {
      setAddTableDialog((prev) =>
        prev ? { ...prev, error: "Could not derive a sheet name from that noun." } : prev
      )
      return
    }

    const entities = new Set(activeTab.wb.columns.map((c) => trim(c.sheet)).filter(Boolean))
    if (entities.has(sheetName)) {
      setAddTableDialog((prev) =>
        prev ? { ...prev, error: `Entity "${sheetName}" already exists.` } : prev
      )
      return
    }

    const idTypeName = entityIdTypeName(sheetName)
    const nextInputTypes = [...activeTab.wb.inputTypes]
    const existingTypeNames = new Set(
      nextInputTypes.map((it) => trim(it.name)).filter(Boolean)
    )
    if (!existingTypeNames.has(idTypeName)) {
      nextInputTypes.push(makeEntityIdInputType(sheetName))
    }
    setInputTypes(nextInputTypes)
    setColumns([
      ...activeTab.wb.columns,
      { sheet: sheetName, columnName: "id", typeName: idTypeName },
    ])
    setAddTableDialog(null)
  }

  function globalColumnIndexForEntity(entity: string, localIndex: number): number {
    if (!activeTab) return -1
    let i = 0
    for (let idx = 0; idx < activeTab.wb.columns.length; idx++) {
      if (trim(activeTab.wb.columns[idx]!.sheet) !== entity) continue
      if (i === localIndex) return idx
      i++
    }
    return -1
  }

  function deleteEntity(entity: string) {
    if (!activeTab) return
    if (trim(entity) === "Taxpayer") return
    const idType = entityIdTypeName(entity)
    if (
      !window.confirm(
        `Delete entity "${entity}"? This removes all Column rows for it and the InputType "${idType}".`
      )
    ) {
      return
    }
    setColumns(activeTab.wb.columns.filter((c) => trim(c.sheet) !== entity))
    setInputTypes(activeTab.wb.inputTypes.filter((it) => trim(it.name) !== idType))
  }

  function openRenameTable(entity: string) {
    if (!activeTab) return
    if (trim(entity) === "Taxpayer") return
    setRenameTableDialog({ fromEntity: entity, noun: "", error: null })
  }

  function applyRenameTable() {
    if (!activeTab || !renameTableDialog) return
    const fromEntity = trim(renameTableDialog.fromEntity)
    const noun = renameTableDialog.noun.trim()
    if (!noun) {
      setRenameTableDialog((prev) => (prev ? { ...prev, error: "Please enter a noun." } : prev))
      return
    }

    const toEntity = nounToPascalCase(noun)
    if (!toEntity) {
      setRenameTableDialog((prev) =>
        prev ? { ...prev, error: "Could not derive a sheet name from that noun." } : prev
      )
      return
    }
    if (toEntity === fromEntity) {
      setRenameTableDialog(null)
      return
    }

    const entities = new Set(activeTab.wb.columns.map((c) => trim(c.sheet)).filter(Boolean))
    if (entities.has(toEntity)) {
      setRenameTableDialog((prev) =>
        prev ? { ...prev, error: `Entity "${toEntity}" already exists.` } : prev
      )
      return
    }

    const fromIdType = entityIdTypeName(fromEntity)
    const toIdType = entityIdTypeName(toEntity)

    // 1) Update Column.sheet + any typeName references to the entity id type
    const nextColumns = activeTab.wb.columns.map((c) => {
      const nextSheet = trim(c.sheet) === fromEntity ? toEntity : c.sheet
      const nextTypeName = trim(c.typeName) === fromIdType ? toIdType : c.typeName
      return { ...c, sheet: nextSheet, typeName: nextTypeName }
    })

    // 2) Update the entity id InputType row (name/ref/parseFn/description), and any typeName references via columns already handled above
    const nextInputTypes = activeTab.wb.inputTypes.map((it) => {
      if (trim(it.name) !== fromIdType) return it
      return makeEntityIdInputType(toEntity)
    })

    setColumns(nextColumns)
    setInputTypes(nextInputTypes)
    setRenameTableDialog(null)
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

    const inputRes = await parseAndValidateInputWorkbook({
      schema: activeTab.wb,
      input: activeTab.rawInput,
      jsRunner,
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
        t.id === activeTab.id
          ? { ...t, dirty: true, wb: { ...t.wb, inputTypes: next } }
          : t
      )
    )
  }
  function setColumns(next: ColumnDef[]) {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, dirty: true, wb: { ...t.wb, columns: next } }
          : t
      )
    )
  }
  function setRules(next: RuleDef[]) {
    if (!activeTab) return
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id
          ? { ...t, dirty: true, wb: { ...t.wb, rules: next } }
          : t
      )
    )
  }

  return (
    <div className="min-h-svh bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-lg font-semibold">XLSX Tax Rules Editor</h1>
        </div>

        {importBusinessLogicError ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <div className="min-w-0">
              <div className="font-medium">Import failed</div>
              <div className="whitespace-pre-wrap break-words">{importBusinessLogicError}</div>
            </div>
              <Button
              type="button"
              size="sm"
                variant="secondary"
              onClick={() => setImportBusinessLogicError(null)}
            >
              Dismiss
              </Button>
          </div>
        ) : null}

        {tabs.length > 0 ? (
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
                    <span className="max-w-[10rem] truncate">
                      {t.title}
                      {t.dirty ? "*" : ""}
                    </span>
                    <span
                      className="inline-flex h-5 w-5 items-center justify-center rounded-md border text-xs hover:bg-background"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        requestCloseTab(t.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          e.stopPropagation()
                          requestCloseTab(t.id)
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
                    dirty: true,
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
                  className={buttonVariants({
                    variant: "secondary",
                    size: "sm",
                  })}
                >
                  + Open
                </span>
              </label>
            </div>
          </div>
        ) : null}

        {activeTab ? (
          <>
            <Section
              title="Workbook"
              right={
                <>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setRenameWorkbookDialog({
                        title: activeTab.title,
                        error: null,
                      })
                    }
                  >
                    Rename
                  </Button>

                  <Button
                    variant="secondary"
                onClick={() => {
                      requestCloseTab(activeTab.id)
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
                      clearDirty(activeTab.id)
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

            <Panel>
          <SimpleTable<InputTypeDef>
                caption="InputType sheet"
                rows={activeTab.wb.inputTypes}
                headerRight={
                  <button
                    type="button"
                    onClick={() =>
                      setAiDialog({
                        kind: "inputType",
                        text: "",
                        loading: false,
                        error: null,
                      })
                    }
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Add with AI
                  </button>
                }
                createRow={() => ({
                  name: "",
                  description: "",
                  parseFn: "(raw, _wb) => raw",
                  formatFn: "(value) => String(value ?? '')",
                })}
            columns={[
                  {
                    key: "name",
                    label: "name",
                    placeholder: "e.g. taxpayerId",
                  },
                  {
                    key: "description",
                    label: "description",
                    placeholder: "human description",
                    display: "wrap",
                  },
                  {
                    key: "parseFn",
                    label: "parseFn",
                    kind: "textarea",
                    placeholder: "(raw, inputWorkbook) => ...",
                    aiEdit: { kind: "parseFn", context: buildAiContext(activeTab.wb) },
                  },
                  {
                    key: "formatFn",
                    label: "formatFn",
                    kind: "textarea",
                    placeholder: "(value) => String(value)",
                    aiEdit: { kind: "formatFn", context: buildAiContext(activeTab.wb) },
                  },
                ]}
                validateDraft={({ mode, draft, editingIdx }) => {
                  const name = trim(draft.name)
                  if (name.length === 0) return "name is required"

                  const existing = activeTab.wb.inputTypes
                    .map((it, idx) => ({ name: trim(it.name), idx }))
                    .filter((x) => x.name.length > 0)
                  const nameTaken = existing.some((x) => x.name === name && (mode === "add" || x.idx !== editingIdx))
                  if (nameTaken) return `name "${name}" already exists`

                  const parseFn = draft.parseFn ?? ""
                  const formatFn = draft.formatFn ?? ""
                  const parseCheck = compileSourceToFunction(parseFn)
                  if (!parseCheck.ok) return `parseFn is not valid JS: ${parseCheck.error}`
                  const formatCheck = compileSourceToFunction(formatFn)
                  if (!formatCheck.ok) return `formatFn is not valid JS: ${formatCheck.error}`
                  return null
                }}
                canDeleteRow={(row) => {
                  const n = trim(row.name)
                  if (n === "taxpayerId") return false
                  if (n === "string" || n === "number" || n === "boolean") return false
                  if (row.ref != null && trim(row.ref).length > 0) return false
                  return true
                }}
                canEditRow={(row) => {
                  // Entity-bound id types + taxpayerId are protected (must stay consistent with Column.sheet entities).
                  const n = trim(row.name)
                  if (n === "taxpayerId") return false
                  if (n === "string" || n === "number" || n === "boolean") return false
                  if (row.ref != null && trim(row.ref).length > 0) return false
                  return true
                }}
                onChangeRow={(idx, next) =>
                  setInputTypes(
                    activeTab.wb.inputTypes.map((r, i) =>
                      i === idx ? next : r
                    )
                  )
                }
                onAddRow={(row) => setInputTypes([...activeTab.wb.inputTypes, row])}
                onDeleteRow={(idx) =>
                  setInputTypes(
                    activeTab.wb.inputTypes.filter((_, i) => i !== idx)
                  )
                }
              />
            </Panel>

            <Panel>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium">Column sheet</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setAiDialog({
                        kind: "table",
                        text: "",
                        loading: false,
                        error: null,
                      })
                    }
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Add table with AI
                  </button>
                  <button
                    type="button"
                    onClick={addManualTable}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Add table
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {entitySheetOrder.map((entity) => {
                  const rows = activeTab.wb.columns.filter((c) => trim(c.sheet) === entity)
                  return (
                    <div key={entity} className="rounded-lg border p-3">
          <SimpleTable<ColumnDef>
                        caption={entity}
                        headerRight={
                          trim(entity) === "Taxpayer" ? null : (
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openRenameTable(entity)}
                                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                              >
                                Rename table
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteEntity(entity)}
                                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                              >
                                Delete table
                              </button>
                            </div>
                          )
                        }
                        addLabel="Add column"
                        rows={rows}
                        createRow={() => ({
                          sheet: entity,
                          columnName: "",
                          typeName: "",
                          description: "",
                        })}
            columns={[
                          {
                            key: "columnName",
                            label: "columnName",
                            placeholder: "e.g. amount",
                          },
                          {
                            key: "typeName",
                            label: "typeName",
                            kind: "select",
                            placeholder: "Select an InputType…",
                            options: () =>
                              activeTab.wb.inputTypes
                                .map((it) => trim(it.name))
                                .filter(Boolean)
                                .sort((a, b) => a.localeCompare(b)),
                          },
                          {
                            key: "description",
                            label: "description",
                            placeholder: "human description",
                            display: "wrap",
                          },
                        ]}
                        validateDraft={({ mode, draft, editingIdx }) => {
                          const columnName = trim(draft.columnName)
                          if (columnName.length === 0) return "columnName is required"
                          const globalEditingIdx =
                            mode === "edit" && editingIdx != null
                              ? globalColumnIndexForEntity(entity, editingIdx)
                              : -1
                          const exists = activeTab.wb.columns.some((c, idx) => {
                            if (trim(c.sheet) !== entity) return false
                            if (trim(c.columnName) !== columnName) return false
                            if (mode === "edit" && idx === globalEditingIdx) return false
                            return true
                          })
                          if (exists) return `columnName "${columnName}" already exists`

                          const typeName = trim(draft.typeName)
                          if (typeName.length === 0) return "typeName is required"
                          const knownTypes = new Set(
                            activeTab.wb.inputTypes.map((it) => trim(it.name)).filter(Boolean)
                          )
                          if (!knownTypes.has(typeName))
                            return `typeName "${typeName}" does not exist in InputType sheet`
                          return null
                        }}
                        rowActions={(row, localIdx) => {
                          const isId = trim(row.columnName) === "id"
                          const idPinnedAbove =
                            localIdx === 1 && trim(rows[0]?.columnName) === "id"
                          return (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  if (localIdx <= 0) return
                                  const g0 = globalColumnIndexForEntity(entity, localIdx - 1)
                                  const g1 = globalColumnIndexForEntity(entity, localIdx)
                                  if (g0 < 0 || g1 < 0) return
                                  const next = [...activeTab.wb.columns]
                                  ;[next[g0], next[g1]] = [next[g1]!, next[g0]!]
                                  setColumns(next)
                                }}
                                disabled={isId || localIdx <= 0 || idPinnedAbove}
                                className="rounded-md border p-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                title="Move up"
                                aria-label="Move up"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (localIdx >= rows.length - 1) return
                                  const g0 = globalColumnIndexForEntity(entity, localIdx)
                                  const g1 = globalColumnIndexForEntity(entity, localIdx + 1)
                                  if (g0 < 0 || g1 < 0) return
                                  const next = [...activeTab.wb.columns]
                                  ;[next[g0], next[g1]] = [next[g1]!, next[g0]!]
                                  setColumns(next)
                                }}
                                disabled={isId || localIdx >= rows.length - 1}
                                className="rounded-md border p-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                title="Move down"
                                aria-label="Move down"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                            </>
                          )
                        }}
                        canDeleteRow={(row) => trim(row.columnName) !== "id"}
                        canEditRow={(row) => trim(row.columnName) !== "id"}
                        onChangeRow={(localIdx, next) => {
                          const g = globalColumnIndexForEntity(entity, localIdx)
                          if (g < 0) return
                          setColumns(
                            activeTab.wb.columns.map((r, i) => (i === g ? next : r))
                          )
                        }}
                        onAddRow={(row) =>
                          setColumns([...activeTab.wb.columns, { ...row, sheet: entity }])
                        }
                        onDeleteRow={(localIdx) => {
                          const g = globalColumnIndexForEntity(entity, localIdx)
                          if (g < 0) return
                          setColumns(activeTab.wb.columns.filter((_, i) => i !== g))
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </Panel>

            <Panel>
          <SimpleTable<RuleDef>
                caption="Rule sheet"
                rows={activeTab.wb.rules}
                headerRight={
                  <button
                    type="button"
                    onClick={() =>
                      setAiDialog({
                        kind: "rule",
                        text: "",
                        loading: false,
                        error: null,
                      })
                    }
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    Add with AI
                  </button>
                }
                createRow={() => ({ name: "", description: "", ruleFn: "(draft) => {}" })}
            columns={[
                  {
                    key: "name",
                    label: "name",
                    placeholder: "e.g. computeTotals",
                  },
                  {
                    key: "description",
                    label: "description",
                    placeholder: "human description",
                    display: "wrap",
                  },
                  {
                    key: "ruleFn",
                    label: "ruleFn",
                    kind: "textarea",
                    placeholder: "(draft) => { ... }",
                    aiEdit: { kind: "ruleFn", context: buildAiContext(activeTab.wb) },
                  },
                ]}
                validateDraft={({ mode, draft, editingIdx }) => {
                  const name = trim(draft.name)
                  if (name.length === 0) return "name is required"
                  const existing = activeTab.wb.rules
                    .map((r, idx) => ({ name: trim(r.name), idx }))
                    .filter((x) => x.name.length > 0)
                  const nameTaken = existing.some((x) => x.name === name && (mode === "add" || x.idx !== editingIdx))
                  if (nameTaken) return `name "${name}" already exists`

                  const ruleFn = draft.ruleFn ?? ""
                  const ruleCheck = compileSourceToFunction(ruleFn)
                  if (!ruleCheck.ok) return `ruleFn is not valid JS: ${ruleCheck.error}`
                  return null
                }}
                rowActions={(_row, idx) => (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        if (idx <= 0) return
                        const next = [...activeTab.wb.rules]
                        ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                        setRules(next)
                      }}
                      disabled={idx <= 0}
                      className="rounded-md border p-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      title="Move up"
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (idx >= activeTab.wb.rules.length - 1) return
                        const next = [...activeTab.wb.rules]
                        ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                        setRules(next)
                      }}
                      disabled={idx >= activeTab.wb.rules.length - 1}
                      className="rounded-md border p-1.5 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      title="Move down"
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                  </>
                )}
                onChangeRow={(idx, next) =>
                  setRules(
                    activeTab.wb.rules.map((r, i) => (i === idx ? next : r))
                  )
                }
                onAddRow={(row) => setRules([...activeTab.wb.rules, row])}
                onDeleteRow={(idx) =>
                  setRules(activeTab.wb.rules.filter((_, i) => i !== idx))
                }
              />
            </Panel>

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

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>
            Tip: press <kbd className="rounded border px-1">d</kbd> to toggle
            light/dark and <kbd className="rounded border px-1">t</kbd> to cycle
            themes.
          </div>

          <a
            href="https://github.com/divizend/tax-rules-editor"
            target="_blank"
            rel="noreferrer"
            aria-label="Open GitHub repository"
            className="inline-flex items-center rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4 fill-current"
              aria-hidden="true"
            >
              <path d="M12 2C6.477 2 2 6.611 2 12.302c0 4.555 2.865 8.42 6.839 9.782.5.098.682-.223.682-.495 0-.244-.009-.89-.014-1.746-2.782.631-3.369-1.382-3.369-1.382-.455-1.192-1.11-1.509-1.11-1.509-.907-.644.069-.631.069-.631 1.003.073 1.531 1.063 1.531 1.063.892 1.575 2.341 1.12 2.91.857.091-.667.35-1.12.636-1.377-2.22-.262-4.555-1.145-4.555-5.096 0-1.125.39-2.045 1.029-2.765-.103-.262-.446-1.318.098-2.747 0 0 .84-.277 2.75 1.056A9.152 9.152 0 0 1 12 6.896c.85.004 1.705.119 2.503.35 1.909-1.333 2.748-1.056 2.748-1.056.546 1.429.203 2.485.1 2.747.64.72 1.027 1.64 1.027 2.765 0 3.961-2.338 4.831-4.566 5.088.36.32.68.95.68 1.915 0 1.382-.012 2.496-.012 2.835 0 .274.18.597.688.494 3.97-1.365 6.833-5.226 6.833-9.78C22 6.611 17.523 2 12 2Z" />
            </svg>
          </a>
        </div>
      </div>

      {aiDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAiDialog(null)
          }}
        >
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">
                {aiDialog.kind === "inputType"
                  ? "AI-generate Input Type"
                  : aiDialog.kind === "rule"
                    ? "AI-generate Rule"
                    : "AI-generate Table"}
    </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAiDialog(null)}
              >
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Describe what you want
                </span>
                <textarea
                  rows={6}
                  value={aiDialog.text}
                  onChange={(e) =>
                    setAiDialog((prev) =>
                      prev ? { ...prev, text: e.target.value } : prev
                    )
                  }
                  className="w-full resize-y rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder={
                    aiDialog.kind === "inputType"
                      ? "Example: A type 'currency' that parses '12.34' and formats with two decimals."
                      : aiDialog.kind === "rule"
                        ? "Example: Sum all Orders.amount into draft.ComputedTotals[0].total."
                        : "Example: A new Invoices table with customerId, issueDate, and amount columns."
                  }
                />
              </label>
              {aiDialog.error ? (
                <div className="text-sm text-destructive">{aiDialog.error}</div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button
                variant="secondary"
                onClick={() => setAiDialog(null)}
                disabled={aiDialog.loading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const desc = aiDialog.text.trim()
                  if (aiDialog.kind === "inputType")
                    void generateInputTypeFromAi(desc)
                  else if (aiDialog.kind === "rule") void generateRuleFromAi(desc)
                  else void generateTableFromAi(desc)
                }}
                disabled={aiDialog.loading || aiDialog.text.trim().length === 0}
              >
                {aiDialog.loading ? "Generating…" : "Generate"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {addTableDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setAddTableDialog(null)
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">Add table</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAddTableDialog(null)}
              >
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Singular noun
                </span>
                <input
                  value={addTableDialog.noun}
                  onChange={(e) =>
                    setAddTableDialog((prev) =>
                      prev ? { ...prev, noun: e.target.value, error: null } : prev
                    )
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="e.g. invoice"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      createManualTableFromDialog()
                    }
                  }}
                />
              </label>
              <div className="text-xs text-muted-foreground">
                We will derive the entity name (PascalCase) and create the required{" "}
                <span className="font-mono">id</span> column.
              </div>
              {addTableDialog.error ? (
                <div className="text-sm text-destructive">{addTableDialog.error}</div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button variant="secondary" onClick={() => setAddTableDialog(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => createManualTableFromDialog()}
                disabled={addTableDialog.noun.trim().length === 0}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {renameTableDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameTableDialog(null)
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">Rename table</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRenameTableDialog(null)}
              >
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="text-xs text-muted-foreground">
                Renaming{" "}
                <span className="font-mono">{renameTableDialog.fromEntity}</span>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  New singular noun
                </span>
                <input
                  value={renameTableDialog.noun}
                  onChange={(e) =>
                    setRenameTableDialog((prev) =>
                      prev ? { ...prev, noun: e.target.value, error: null } : prev
                    )
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="e.g. invoice"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      applyRenameTable()
                    }
                  }}
                />
              </label>
              <div className="text-xs text-muted-foreground">
                This updates the table name and the corresponding id type (including all references).
              </div>
              {renameTableDialog.error ? (
                <div className="text-sm text-destructive">{renameTableDialog.error}</div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button variant="secondary" onClick={() => setRenameTableDialog(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => applyRenameTable()}
                disabled={renameTableDialog.noun.trim().length === 0}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {renameWorkbookDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameWorkbookDialog(null)
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">Rename workbook</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setRenameWorkbookDialog(null)}
              >
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Title
                </span>
                <input
                  value={renameWorkbookDialog.title}
                  onChange={(e) =>
                    setRenameWorkbookDialog((prev) =>
                      prev ? { ...prev, title: e.target.value, error: null } : prev,
                    )
                  }
                  className="w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
                  placeholder="e.g. 2026 filing"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      applyRenameWorkbook()
                    }
                  }}
                />
              </label>
              {renameWorkbookDialog.error ? (
                <div className="text-sm text-destructive">
                  {renameWorkbookDialog.error}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button
                variant="secondary"
                onClick={() => setRenameWorkbookDialog(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => applyRenameWorkbook()}
                disabled={renameWorkbookDialog.title.trim().length === 0}
              >
                Rename
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmCloseDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmCloseDialog(null)
          }}
        >
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">Close workbook?</div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmCloseDialog(null)}
              >
                Close
              </Button>
            </div>
            <div className="flex flex-col gap-2 p-4 text-sm">
              <div>This workbook has unsaved changes.</div>
              <div className="text-muted-foreground">
                If you close it now, you will lose those changes.
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <Button
                variant="secondary"
                onClick={() => setConfirmCloseDialog(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const id = confirmCloseDialog.tabId
                  setConfirmCloseDialog(null)
                  closeTab(id)
                }}
              >
                Close anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
