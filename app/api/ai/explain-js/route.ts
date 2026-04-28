import { NextResponse } from "next/server";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
  }

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) return NextResponse.json({ error: "Missing 'code'." }, { status: 400 });

  const result = streamText({
    model: openai("gpt-4.1-mini"),
    system:
      "Explain the following JavaScript code to a completely non-technical person. " +
      "Use plain language and short sentences. Avoid programming jargon. " +
      "If you must mention a technical term, immediately explain it in everyday words. " +
      "Describe what the code is trying to accomplish and what happens step by step. " +
      "Do not execute the code. Do not suggest changes. " +
      "Keep it concise and friendly.",
    prompt: code,
    temperature: 0.2,
  });

  return result.toTextStreamResponse();
}

