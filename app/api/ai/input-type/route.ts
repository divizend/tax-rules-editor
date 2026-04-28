import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const InputTypeRowSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  parseFn: z.string().min(1),
  formatFn: z.string().min(1),
  // Keep these required for OpenAI JSON schema strictness; empty string means "not a foreign key".
  refSheet: z.string(),
  refColumn: z.string(),
});

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as { description?: string } | null;
  const description = body?.description?.trim();
  if (!description) return NextResponse.json({ error: "Missing 'description'." }, { status: 400 });

  try {
    const result = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: InputTypeRowSchema,
      system:
        "Generate exactly one InputTypes row for an XLSX business-logic workbook. " +
        "Return an object with name, parseFn, formatFn, optional refSheet/refColumn. " +
        "parseFn and formatFn must be JavaScript function expressions (arrow or function expression). " +
        "Keep deterministic; no time/random/network/DOM. parseFn should trim where appropriate.",
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

