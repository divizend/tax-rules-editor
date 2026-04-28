import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const RuleRowSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  ruleFn: z.string().min(1),
});

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as
    | { description?: string; context?: unknown }
    | null;

  const description = body?.description?.trim();
  if (!description) return NextResponse.json({ error: "Missing 'description'." }, { status: 400 });

  const contextJson =
    body?.context === undefined ? "" : JSON.stringify(body.context, null, 2).slice(0, 12_000);

  try {
    const result = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: RuleRowSchema,
      system:
        "Generate exactly one Rule row for an XLSX business-logic workbook. " +
        "Return an object with name and ruleFn. " +
        "ruleFn must be a JavaScript function expression (arrow or function expression) with signature (draft)=>void; mutate draft in-place using Immer semantics. " +
        "Keep deterministic; no time/random/network/DOM. " +
        "Use workbook context to align with existing entity sheet keys in aggregates.\n" +
        (contextJson ? `Workbook context (JSON, partial):\n${contextJson}\n` : ""),
      prompt: description,
      temperature: 0.2,
    });

    const row = result.object;
    return NextResponse.json({ row });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI generation failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
