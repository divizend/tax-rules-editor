"use client";

import * as React from "react";

export function JsCodeWithAiExplain(props: {
  code: string;
  title?: string;
}): React.ReactNode {
  const { code, title = "Explain JS" } = props;
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [text, setText] = React.useState("");
  const abortRef = React.useRef<AbortController | null>(null);
  const explanationRef = React.useRef<HTMLDivElement | null>(null);
  const [autoScroll, setAutoScroll] = React.useState(true);

  const preview = code.trim().length === 0 ? "—" : code;

  async function startExplain() {
    if (loading) return;
    if (code.trim().length === 0) return;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setText("");

    try {
      const res = await fetch("/api/ai/explain-js", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
        const msg = typeof j?.error === "string" ? j.error : `Request failed (${res.status})`;
        setError(msg);
        return;
      }

      const body = res.body;
      if (!body) {
        setError("No response body.");
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) setText((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if ((e as { name?: unknown } | null)?.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to fetch explanation.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    return () => {
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  function close() {
    abortRef.current?.abort();
    abortRef.current = null;
    setOpen(false);
    setLoading(false);
    setError(null);
    setText("");
    setAutoScroll(true);
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }

  function copy(textToCopy: string) {
    if (typeof navigator === "undefined") return;
    void navigator.clipboard?.writeText(textToCopy);
  }

  React.useEffect(() => {
    if (!autoScroll) return;
    const el = explanationRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [autoScroll, text, loading]);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void startExplain();
        }}
        className="w-full text-left"
        aria-label="Explain code"
      >
        <div className="whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
          {preview}
        </div>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-3xl rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">{title}</div>
              <div className="flex items-center gap-2">
                {loading ? (
                  <button
                    type="button"
                    onClick={stop}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    Stop
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">Code</div>
                <button
                  type="button"
                  onClick={() => copy(code)}
                  className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                >
                  Copy code
                </button>
              </div>
              <div className="rounded-md border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap">
                {code.trim().length === 0 ? "—" : code}
              </div>

              {error ? <div className="text-sm text-destructive">{error}</div> : null}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium text-muted-foreground">Explanation</div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={autoScroll}
                      onChange={(e) => setAutoScroll(e.target.checked)}
                    />
                    Auto-scroll
                  </label>
                  <button
                    type="button"
                    onClick={() => copy(text)}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    disabled={text.trim().length === 0}
                  >
                    Copy explanation
                  </button>
                </div>
              </div>
              <div
                ref={explanationRef}
                className="max-h-[50vh] overflow-auto rounded-md border p-3 text-sm whitespace-pre-wrap"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                  if (!nearBottom && autoScroll) setAutoScroll(false);
                }}
              >
                {text.length > 0 ? text : loading ? "Explaining…" : " "}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

