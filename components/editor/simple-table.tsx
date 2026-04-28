"use client";

import * as React from "react";

type Column<Row extends object> = {
  key: keyof Row;
  label: string;
  kind?: "text" | "textarea";
  placeholder?: string;
};

export function SimpleTable<Row extends Record<string, unknown>>(props: {
  caption: string;
  rows: Row[];
  columns: Array<Column<Row>>;
  onChangeRow: (idx: number, next: Row) => void;
  onAddRow: () => void;
  onDeleteRow: (idx: number) => void;
}): React.ReactNode {
  const { caption, rows, columns, onChangeRow, onAddRow, onDeleteRow } = props;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium">{caption}</div>
        <button
          type="button"
          onClick={onAddRow}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          Add
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/50">
            <tr>
              {columns.map((c) => (
                <th key={String(c.key)} className="whitespace-nowrap px-3 py-2 font-medium">
                  {c.label}
                </th>
              ))}
              <th className="w-1 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-4 text-muted-foreground">
                  No rows yet.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => (
                <tr key={idx} className="border-t align-top">
                  {columns.map((c) => {
                    const value = (row[c.key] ?? "") as unknown;
                    const str = typeof value === "string" ? value : String(value ?? "");
                    const common = {
                      value: str,
                      placeholder: c.placeholder,
                      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                        onChangeRow(idx, { ...row, [c.key]: e.target.value } as Row);
                      },
                      className:
                        "w-full min-w-40 bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground",
                    };
                    return (
                      <td key={String(c.key)} className="p-0">
                        {c.kind === "textarea" ? (
                          <textarea rows={5} {...common} />
                        ) : (
                          <input type="text" {...common} />
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onDeleteRow(idx)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

