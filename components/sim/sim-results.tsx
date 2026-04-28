"use client";

import * as React from "react";

import type { RuleError, SheetError, CellError } from "@/src/domain/errors";
import type { Aggregate } from "@/src/domain/aggregate";

type AnyErr = SheetError | CellError | RuleError;

function ErrorList(props: { title: string; errors: AnyErr[] }): React.ReactNode {
  const { title, errors } = props;
  if (errors.length === 0) return null;

  return (
    <div className="rounded-lg border p-3">
      <div className="text-sm font-medium">{title}</div>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {errors.map((e, idx) => (
          <li key={idx} className="break-words">
            {"sheet" in e ? (
              <>
                <span className="font-mono">{e.sheet}</span>
                {"row" in e && typeof e.row === "number" ? `:${e.row}` : ""}
                {"column" in e && typeof e.column === "string" ? `:${e.column}` : ""} — {e.message}
              </>
            ) : (
              <>
                {e.taxpayerId ? (
                  <>
                    <span className="font-mono">{e.taxpayerId}</span> —{" "}
                  </>
                ) : null}
                <span className="font-mono">{e.ruleName}</span> — {e.message}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SimResults(props: {
  schemaErrors: AnyErr[];
  inputErrors: AnyErr[];
  simErrors: RuleError[];
  results: Record<string, Aggregate> | null;
}): React.ReactNode {
  const { schemaErrors, inputErrors, simErrors, results } = props;

  return (
    <div className="flex flex-col gap-3">
      <ErrorList title="Business-logic validation" errors={schemaErrors} />
      <ErrorList title="Input validation" errors={inputErrors} />
      <ErrorList title="Simulation errors" errors={simErrors} />

      {results ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Results (JSON)</summary>
          <pre className="mt-2 overflow-auto rounded-md bg-muted/40 p-3 text-xs">
            {JSON.stringify(results, null, 2)}
          </pre>
        </details>
      ) : (
        <div className="text-sm text-muted-foreground">No results yet.</div>
      )}
    </div>
  );
}

