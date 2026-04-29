import * as React from "react"
import * as XLSX from "xlsx"
import { describe, expect, it, vi } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { BusinessLogicWorkbook } from "@/src/domain/schema"
import { makeEntityIdInputType } from "@/src/domain/entityIdInputType"
import { writeBusinessLogicWorkbook } from "@/src/xlsx/writeBusinessLogic"
import { WorkbookEditorApp } from "@/components/editor/workbook-editor-app"

vi.mock("@/components/editor/download", () => {
  return {
    downloadArrayBuffer: vi.fn(),
    fileToArrayBuffer: async (file: File) => await file.arrayBuffer(),
  }
})

vi.mock("@/src/worker/client", async () => {
  const worker = await import("@/src/worker/jsRunner.worker")
  type WorkerMod = typeof worker

  class JsRunnerClientMock {
    terminate() {}

    async compileFunction(source: string) {
      const res = (worker as unknown as WorkerMod).compileSourceToFunction(source)
      return res.ok ? { ok: true as const } : { ok: false as const, error: res.error }
    }

    async runParse(source: string, input: string, inputWorkbook?: unknown) {
      return (worker as unknown as WorkerMod).runParse(source, input, inputWorkbook)
    }

    async runFormat(source: string, input: unknown) {
      return (worker as unknown as WorkerMod).runFormat(source, input)
    }

    async runRule(source: string, aggregate: unknown) {
      return (worker as unknown as WorkerMod).runRule(source, aggregate)
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

async function uploadViaLabelText(user: ReturnType<typeof userEvent.setup>, labelText: string, file: File) {
  const node = screen.getByText(labelText)
  const label = node.closest("label")
  if (!label) throw new Error(`Could not locate label for "${labelText}"`)
  const input = label.querySelector("input[type=file]") as HTMLInputElement | null
  if (!input) throw new Error(`Could not locate input[type=file] for "${labelText}"`)
  await user.upload(input, file)
}

describe("WorkbookEditorApp (complex rules e2e unit test)", () => {
  it("imports a workbook and simulates a multi-sheet, FK-linked model with complex rules", async () => {
    const user = userEvent.setup()

    const tradeId = makeEntityIdInputType("Trade")
    const dividendId = makeEntityIdInputType("Dividend")

    const wb: BusinessLogicWorkbook = {
      inputTypes: [
        {
          name: "string",
          description: "Free-form text",
          parseFn: "(raw, _wb) => String(raw ?? '')",
          formatFn: "(value) => String(value ?? '')",
        },
        {
          name: "number",
          description: "A finite number parsed from a string (blank => 0).",
          parseFn:
            "(raw, _wb) => {\n  const s = String(raw ?? '').trim();\n  if (s.length === 0) return 0;\n  const n = Number(s);\n  if (!Number.isFinite(n)) throw new Error('Not a number');\n  return n;\n}",
          formatFn: "(value) => String(value ?? '')",
        },
        {
          name: "boolean",
          description: "A true/false value parsed from a string (blank => false).",
          parseFn:
            "(raw, _wb) => {\n  const s = String(raw ?? '').trim().toLowerCase();\n  if (s.length === 0) return false;\n  if (s === 'true' || s === 't' || s === 'yes' || s === 'y' || s === '1') return true;\n  if (s === 'false' || s === 'f' || s === 'no' || s === 'n' || s === '0') return false;\n  throw new Error('Not a boolean');\n}",
          formatFn: "(value) => (value ? 'true' : 'false')",
        },
        makeEntityIdInputType("Taxpayer"),
        tradeId,
        dividendId,
      ],
      columns: [
        // Taxpayer master
        { sheet: "Taxpayer", columnName: "id", typeName: "taxpayerId" },
        { sheet: "Taxpayer", columnName: "name", typeName: "string" },
        { sheet: "Taxpayer", columnName: "region", typeName: "string" },

        // Trades belong directly to a taxpayer
        { sheet: "Trade", columnName: "id", typeName: tradeId.name },
        { sheet: "Trade", columnName: "taxpayerId", typeName: "taxpayerId" },
        { sheet: "Trade", columnName: "amount", typeName: "number" },
        { sheet: "Trade", columnName: "isBelgian", typeName: "boolean" },

        // Dividends reference trades via FK (no direct taxpayerId => tests FK traversal)
        { sheet: "Dividend", columnName: "id", typeName: dividendId.name },
        { sheet: "Dividend", columnName: "tradeId", typeName: tradeId.name },
        { sheet: "Dividend", columnName: "gross", typeName: "number" },
      ],
      rules: [
        {
          name: "indexTradeById",
          description: "Build a Trade index used by later rules",
          ruleFn:
            "(draft) => {\n  draft.Computed ??= [];\n  const idx = {};\n  for (const t of (draft.Trade ?? [])) {\n    const id = String(t.id ?? '').trim();\n    if (!id) continue;\n    idx[id] = t;\n  }\n  draft._tradeIndex = idx;\n}",
        },
        {
          name: "sumDividends",
          description: "Sum dividend gross via Dividend.tradeId -> Trade",
          ruleFn:
            "(draft) => {\n  const tradeIndex = draft._tradeIndex ?? {};\n  let totalGross = 0;\n  let totalBelgianGross = 0;\n  for (const d of (draft.Dividend ?? [])) {\n    const gross = Number(String(d.gross ?? '').trim() || '0');\n    totalGross += gross;\n    const tid = String(d.tradeId ?? '').trim();\n    const trade = tradeIndex[tid];\n    const isBE = String(trade?.isBelgian ?? '').trim().toLowerCase();\n    if (isBE === 'true' || isBE === '1' || isBE === 'yes' || isBE === 'y' || isBE === 't') {\n      totalBelgianGross += gross;\n    }\n  }\n  draft.Computed ??= [];\n  draft.Computed.push({ metric: 'dividendGrossTotal', value: totalGross });\n  draft.Computed.push({ metric: 'dividendGrossBelgian', value: totalBelgianGross });\n}",
        },
        {
          name: "computeWithholdingTax",
          description: "Compute withholding tax rate based on taxpayer region",
          ruleFn:
            "(draft) => {\n  const region = String(draft.Taxpayer?.[0]?.region ?? '').trim().toUpperCase();\n  const rate = region === 'BE' ? 0.30 : 0.15;\n  const beGrossRow = (draft.Computed ?? []).find((r) => r?.metric === 'dividendGrossBelgian');\n  const beGross = Number(beGrossRow?.value ?? 0);\n  draft.Computed ??= [];\n  draft.Computed.push({ metric: 'withholdingRate', value: rate });\n  draft.Computed.push({ metric: 'withholdingTax', value: Math.round(beGross * rate * 100) / 100 });\n}",
        },
      ],
    }

    // Import the business-logic workbook via UI
    render(<WorkbookEditorApp />)

    const wbBuf = writeBusinessLogicWorkbook(wb)
    const wbFile = new File([wbBuf], "complex-business-logic.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    })

    // No tabs yet → the Start section is visible and offers "Open existing XLSX"
    await uploadViaLabelText(user, "Open existing XLSX", wbFile)
    expect(
      await screen.findByText(/Business-logic workbook loaded\./i)
    ).toBeInTheDocument()

    // Generate template once (download is mocked)
    await user.click(screen.getByRole("button", { name: "Generate template XLSX" }))

    // Upload a filled template with multiple sheets and FK links
    {
      const book = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["id", "name", "region"],
          ["TP_BE", "Belgian Alice", "BE"],
          ["TP_NL", "Dutch Bob", "NL"],
        ]),
        "Taxpayer"
      )
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["id", "taxpayerId", "amount", "isBelgian"],
          ["TR1", "TP_BE", "1000", "true"],
          ["TR2", "TP_NL", "500", "false"],
        ]),
        "Trade"
      )
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          ["id", "tradeId", "gross"],
          ["DV1", "TR1", "10"],
          ["DV2", "TR1", "5.5"],
          ["DV3", "TR2", "7"],
        ]),
        "Dividend"
      )

      const buf = xlsxToArrayBuffer(book)
      const file = new File([buf], "filled.template.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      await uploadViaLabelText(user, "Upload filled template", file)
    }

    await user.click(screen.getByRole("button", { name: "Validate + Run sim" }))

    const outcome = await Promise.race([
      screen.findByText("Results").then(() => "results" as const),
      screen
        .findByText(/Business-logic validation|Input validation|Simulation errors/)
        .then(() => "errors" as const),
    ])

    if (outcome !== "results") {
      const titles = [
        "Business-logic validation",
        "Input validation",
        "Simulation errors",
      ] as const
      const chunks: string[] = []
      for (const t of titles) {
        const title = screen.queryByText(t)
        if (!title) continue
        const box = title.parentElement
        const lines = box
          ? within(box).queryAllByRole("listitem").map((li) => li.textContent ?? "")
          : []
        chunks.push([t, ...lines].join("\n- "))
      }
      throw new Error(`Simulation did not produce results.\n\n${chunks.join("\n\n")}`)
    }

    // Assert by parsing the "Raw results (JSON)" block (more robust than text matching)
    const rawDetails = screen.getByText("Raw results (JSON)").closest("details")
    if (!rawDetails) throw new Error('Could not locate details for "Raw results (JSON)"')
    const summary = rawDetails.querySelector("summary")
    if (!summary) throw new Error('Could not locate summary for "Raw results (JSON)"')
    await user.click(summary)

    const pre = within(rawDetails).getByText((t) => t.trim().startsWith("{"), {
      selector: "pre",
    })
    const parsed = JSON.parse(pre.textContent ?? "{}") as Record<
      string,
      Record<string, Array<Record<string, unknown>>>
    >

    // TP_BE: dividends are DV1+DV2 = 15.5; belgian gross = 15.5 => tax 4.65
    const be = parsed.TP_BE
    expect(be).toBeTruthy()
    const beComputed = be!.Computed ?? []
    expect(beComputed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "dividendGrossTotal", value: 15.5 }),
        expect.objectContaining({ metric: "dividendGrossBelgian", value: 15.5 }),
        expect.objectContaining({ metric: "withholdingRate", value: 0.3 }),
        expect.objectContaining({ metric: "withholdingTax", value: 4.65 }),
      ])
    )

    // TP_NL: dividends are DV3 = 7; belgian gross = 0 => tax 0
    const nl = parsed.TP_NL
    expect(nl).toBeTruthy()
    const nlComputed = nl!.Computed ?? []
    expect(nlComputed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metric: "dividendGrossTotal", value: 7 }),
        expect.objectContaining({ metric: "dividendGrossBelgian", value: 0 }),
        expect.objectContaining({ metric: "withholdingRate", value: 0.15 }),
        expect.objectContaining({ metric: "withholdingTax", value: 0 }),
      ])
    )
  })
})

