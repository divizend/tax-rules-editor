import { NextResponse } from "next/server";

import { SYSTEM_PROMPT_INPUT_TYPE } from "@/src/ai/prompts";

type InputTypeRow = {
  name: string;
  parseFn: string;
  formatFn: string;
  refSheet?: string;
  refColumn?: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function looksLikeFunctionSource(src: string): boolean {
  const s = src.trim();
  return s.startsWith("(") || s.startsWith("function") || s.includes("=>");
}

function validateRow(row: unknown): { ok: true; value: InputTypeRow } | { ok: false; error: string } {
  if (!row || typeof row !== "object") return { ok: false, error: "Model did not return an object." };
  const r = row as Record<string, unknown>;
  if (!isNonEmptyString(r.name)) return { ok: false, error: "Missing or invalid 'name'." };
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(r.name.trim())) return { ok: false, error: "Invalid 'name' format." };
  if (!isNonEmptyString(r.parseFn) || !looksLikeFunctionSource(r.parseFn)) return { ok: false, error: "Invalid 'parseFn'." };
  if (!isNonEmptyString(r.formatFn) || !looksLikeFunctionSource(r.formatFn)) return { ok: false, error: "Invalid 'formatFn'." };
  const refSheet = typeof r.refSheet === "string" ? r.refSheet : "";
  const refColumn = typeof r.refColumn === "string" ? r.refColumn : "";
  return {
    ok: true,
    value: {
      name: r.name.trim(),
      parseFn: String(r.parseFn),
      formatFn: String(r.formatFn),
      refSheet,
      refColumn,
    },
  };
}

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { description?: string } | null;
  const description = body?.description?.trim();
  if (!description) return NextResponse.json({ error: "Missing 'description'." }, { status: 400 });

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: SYSTEM_PROMPT_INPUT_TYPE },
        { role: "user", content: description },
      ],
      temperature: 0.2,
      max_output_tokens: 600,
    }),
  });

  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return NextResponse.json({ error: `OpenAI error (${r.status})`, detail: text }, { status: 502 });
  }

  const json: unknown = await r.json();
  const text: string | undefined =
    typeof (json as { output_text?: unknown } | null)?.output_text === "string"
      ? ((json as { output_text: string }).output_text as string)
      : undefined;
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "OpenAI response missing output_text" }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Model did not return valid JSON.", raw: text }, { status: 502 });
  }

  const validated = validateRow(parsed);
  if (!validated.ok) return NextResponse.json({ error: validated.error, raw: parsed }, { status: 502 });

  return NextResponse.json({ row: validated.value });
}

