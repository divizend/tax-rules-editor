import { NextResponse } from "next/server"
import { generateObject } from "ai"
import { openai } from "@ai-sdk/openai"
import { z } from "zod"

const BodySchema = z.object({
  kind: z.enum(["parseFn", "formatFn", "ruleFn"]),
  instruction: z.string(),
  code: z.string(),
  context: z.unknown().optional(),
})

const ResponseSchema = z.object({
  code: z.string(),
})

function normalizeSignature(sig: string): string {
  return sig.replace(/\s+/g, "")
}

function extractParamList(source: string): string | null {
  const s = source.trim()

  // Arrow function: (a, b) => ...   or  a => ...
  const arrow = s.match(/^(?:\(\s*([^)]*)\s*\)|([a-zA-Z_$][\w$]*))\s*=>/)
  if (arrow) return (arrow[1] ?? arrow[2] ?? "").trim()

  // Function expression / declaration: function name?(a, b) { ... }
  const fn = s.match(/^function(?:\s+[a-zA-Z_$][\w$]*)?\s*\(\s*([^)]*)\s*\)/)
  if (fn) return (fn[1] ?? "").trim()

  return null
}

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 })
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 })
  }

  const { kind, instruction, code, context } = parsed.data
  if (!instruction.trim()) {
    return NextResponse.json({ error: "Missing 'instruction'." }, { status: 400 })
  }

  const originalParams = extractParamList(code)
  if (originalParams == null) {
    return NextResponse.json(
      {
        error:
          "Could not determine the current function signature. Please use an arrow function or `function(...) {}` syntax.",
      },
      { status: 400 },
    )
  }

  const contextJson =
    context === undefined ? "" : JSON.stringify(context, null, 2).slice(0, 12_000)

  try {
    const result = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: ResponseSchema,
      system:
        "You are editing a JavaScript function used in an XLSX tax-rules workbook editor.\n" +
        "You will be given:\n" +
        "- The current function source code\n" +
        "- A human instruction describing a change\n" +
        "- The required parameter list\n\n" +
        "Rules (must follow):\n" +
        `- Output ONLY JSON: { \"code\": \"...\" }\n` +
        `- The result MUST be a single JavaScript function (arrow function OR function expression/declaration).\n` +
        `- You MUST preserve the parameter list EXACTLY: (${originalParams}). Do not rename, add, remove, reorder, default, or rest parameters.\n` +
        "- Preserve the external contract and behavior as much as possible; apply the instruction with minimal changes.\n" +
        "- Do not use network, time, randomness, or DOM APIs.\n" +
        (contextJson ? `Workbook context (JSON, partial):\n${contextJson}\n` : ""),
      prompt:
        `Kind: ${kind}\n\n` +
        `Instruction:\n${instruction}\n\n` +
        `Current code:\n${code}\n`,
      temperature: 0.2,
    })

    const nextCode = result.object.code
    const nextParams = extractParamList(nextCode)
    if (nextParams == null) {
      return NextResponse.json(
        { error: "AI did not return a valid function." },
        { status: 502 },
      )
    }
    if (normalizeSignature(nextParams) !== normalizeSignature(originalParams)) {
      return NextResponse.json(
        {
          error:
            "AI attempted to change the function signature. Please try a different instruction.",
        },
        { status: 502 },
      )
    }

    return NextResponse.json({ code: nextCode })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI edit failed."
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

