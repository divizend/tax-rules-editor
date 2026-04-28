import { NextResponse } from "next/server";
import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";

const TableGenSchema = z.object({
  sheetName: z.string().regex(/^[A-Z][A-Za-z0-9]*$/),
  columns: z
    .array(
      z.object({
        columnName: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
        typeName: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/),
        description: z.string(),
      }),
    )
    .min(1),
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
      schema: TableGenSchema,
      system:
        "Generate a new entity/table definition for an XLSX tax-rules workbook. " +
        "Return JSON with sheetName (PascalCase *singular* entity name) and columns (excluding the mandatory id column — the app will add id automatically). " +
        "The sheetName MUST be singular (e.g. \"Invoice\", not \"Invoices\"). " +
        "Every column MUST include a human-readable description string. " +
        "Each column must reference an existing InputType name from context when possible; otherwise invent new type names and the client may create additional InputTypes. " +
        "parseFn for entity id types must be two-arg (raw, wb) and deterministic; no network/time/random/DOM.\n" +
        (contextJson ? `Workbook context (JSON, partial):\n${contextJson}\n` : ""),
      prompt: description,
      temperature: 0.2,
    });

    return NextResponse.json({ table: result.object });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "AI generation failed.";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
