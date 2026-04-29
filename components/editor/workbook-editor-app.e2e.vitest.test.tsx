import * as React from "react"
import * as XLSX from "xlsx"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { WorkbookEditorApp } from "@/components/editor/workbook-editor-app"

vi.mock("@/components/editor/download", () => {
  return {
    downloadArrayBuffer: vi.fn(),
    fileToArrayBuffer: async (file: File) => await file.arrayBuffer(),
  }
})

vi.mock("@/src/worker/client", async () => {
  const worker = await import("@/src/worker/jsRunner.worker")
  type JsRunnerFunction = typeof worker

  class JsRunnerClientMock {
    terminate() {}

    async compileFunction(source: string) {
      const res = (worker as unknown as JsRunnerFunction).compileSourceToFunction(source)
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.error }
    }

    async runParse(source: string, input: string, inputWorkbook?: unknown) {
      return (worker as unknown as JsRunnerFunction).runParse(source, input, inputWorkbook)
    }

    async runFormat(source: string, input: unknown) {
      return (worker as unknown as JsRunnerFunction).runFormat(source, input)
    }

    async runRule(source: string, aggregate: unknown) {
      return (worker as unknown as JsRunnerFunction).runRule(source, aggregate)
    }
  }

  return { JsRunnerClient: JsRunnerClientMock }
})

function xlsxToArrayBuffer(book: XLSX.WorkBook): ArrayBuffer {
  const out = XLSX.write(book, { bookType: "xlsx", type: "array" })
  if (out instanceof ArrayBuffer) return out
  if (ArrayBuffer.isView(out)) {
    const sliced = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    if (sliced instanceof ArrayBuffer) return sliced
    const copy = new Uint8Array(out.byteLength)
    copy.set(new Uint8Array(out.buffer, out.byteOffset, out.byteLength))
    return copy.buffer
  }
  throw new Error("Unexpected XLSX write output type")
}

describe("WorkbookEditorApp (frontend e2e unit test)", () => {
  it("covers the intended workflow once (schema → template → upload → validate + simulate)", async () => {
    const user = userEvent.setup()

    render(<WorkbookEditorApp />)

    // Start → create a new business-logic workbook
    await user.click(screen.getByRole("button", { name: "Create new XLSX" }))
    expect(
      screen.getByText(/Business-logic workbook loaded\./i)
    ).toBeInTheDocument()

    // Input types → add one custom type (exercises the editor flow once)
    {
      const caption = screen.getByText("InputType sheet")
      const headerRow = caption.parentElement?.parentElement
      if (!headerRow) throw new Error("Could not locate InputType sheet header row")
      await user.click(within(headerRow).getByRole("button", { name: "Add" }))

      await user.type(screen.getByLabelText("name"), "amount")
      await user.type(screen.getByLabelText("description"), "A numeric amount")
      const parseFnEl = screen.getByLabelText("parseFn")
      fireEvent.change(parseFnEl, {
        target: {
          value:
            "(raw, _wb) => { const s = String(raw ?? '').trim(); return s ? Number(s) : 0 }",
        },
      })
      await user.clear(screen.getByLabelText("formatFn"))
      await user.type(screen.getByLabelText("formatFn"), "(value) => String(value ?? '')")
      await user.click(screen.getByRole("button", { name: "Save" }))

      expect(screen.getByText("amount")).toBeInTheDocument()
    }

    // Columns → add one column to the default Taxpayer table using the new type
    {
      const taxpayerCaption = screen.getByText("Taxpayer")
      const headerRow = taxpayerCaption.parentElement?.parentElement
      if (!headerRow) throw new Error("Could not locate Taxpayer table header row")
      await user.click(within(headerRow).getByRole("button", { name: "Add column" }))

      await user.type(screen.getByLabelText("columnName"), "amount")
      await user.selectOptions(screen.getByLabelText("typeName"), "amount")
      await user.type(screen.getByLabelText("description"), "Test amount")
      await user.click(screen.getByRole("button", { name: "Save" }))

      expect(screen.getAllByText("amount").length).toBeGreaterThan(0)
    }

    // Rules → add a tiny rule that mutates the aggregate (verifies sim output changed)
    {
      const caption = screen.getByText("Rule sheet")
      const headerRow = caption.parentElement?.parentElement
      if (!headerRow) throw new Error("Could not locate Rule sheet header row")
      await user.click(within(headerRow).getByRole("button", { name: "Add" }))

      await user.type(screen.getByLabelText("name"), "tagTaxpayer")
      await user.type(screen.getByLabelText("description"), "Tag taxpayer rows (test)")
      const ruleFnEl = screen.getByLabelText("ruleFn")
      fireEvent.change(ruleFnEl, {
        target: {
          value:
            "(draft) => { draft.Taxpayer ??= []; if (draft.Taxpayer[0]) draft.Taxpayer[0].tag = 'ok' }",
        },
      })
      await user.click(screen.getByRole("button", { name: "Save" }))

      expect(screen.getByText("tagTaxpayer")).toBeInTheDocument()
    }

    // Generate template (download is mocked, but we still click it once)
    await user.click(screen.getByRole("button", { name: "Generate template XLSX" }))

    // Upload filled template (create an in-memory XLSX matching schema)
    {
      const book = XLSX.utils.book_new()
      const sheet = XLSX.utils.aoa_to_sheet([
        ["id", "name", "amount"],
        ["TP1", "Alice", "123"],
      ])
      XLSX.utils.book_append_sheet(book, sheet, "Taxpayer")

      const buf = xlsxToArrayBuffer(book)
      const file = new File([buf], "filled.template.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })

      const uploadText = screen.getByText("Upload filled template")
      const label = uploadText.closest("label")
      if (!label) throw new Error("Could not locate upload label")
      const input = label.querySelector("input[type=file]") as HTMLInputElement | null
      if (!input) throw new Error("Could not locate upload input[type=file]")
      await user.upload(input, file)
    }

    // Run validation + simulation and assert results show the rule mutation.
    await user.click(screen.getByRole("button", { name: "Validate + Run sim" }))

    expect(await screen.findByText("Results")).toBeInTheDocument()
    expect(screen.getAllByText(/"tag": "ok"/).length).toBeGreaterThan(0)
  })
})

