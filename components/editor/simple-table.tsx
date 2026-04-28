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
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);

  function openEdit(idx: number) {
    const row = rows[idx];
    if (!row) return;
    const nextDraft: Record<string, string> = {};
    for (const c of columns) {
      const value = row[c.key];
      nextDraft[String(c.key)] = typeof value === "string" ? value : value == null ? "" : String(value);
    }
    setEditingIdx(idx);
    setDraft(nextDraft);
  }

  function closeEdit() {
    setEditingIdx(null);
    setDraft(null);
  }

  function saveEdit() {
    if (editingIdx == null || !draft) return;
    const base = rows[editingIdx];
    if (!base) return;
    const next = { ...base } as Record<string, unknown>;
    for (const c of columns) next[String(c.key)] = draft[String(c.key)] ?? "";
    onChangeRow(editingIdx, next as Row);
    closeEdit();
  }

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
              <th className="w-1 whitespace-nowrap px-3 py-2 text-right font-medium">Actions</th>
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
                    return (
                      <td key={String(c.key)} className="px-3 py-2">
                        {c.kind === "textarea" ? (
                          <div className="max-w-[28rem] whitespace-pre-wrap font-mono text-xs text-muted-foreground">
                            {str.length > 220 ? `${str.slice(0, 220)}…` : str || "—"}
                          </div>
                        ) : (
                          <div className="max-w-[18rem] truncate">{str || "—"}</div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(idx)}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Edit
                    </button>
                    <span className="inline-block w-2" />
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

      {editingIdx != null && draft ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeEdit();
          }}
        >
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="flex items-center justify-between gap-3 border-b p-4">
              <div className="text-sm font-medium">Edit row</div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {columns.map((c) => (
                <label key={String(c.key)} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
                  {c.kind === "textarea" ? (
                    <textarea
                      rows={8}
                      value={draft[String(c.key)] ?? ""}
                      placeholder={c.placeholder}
                      onChange={(e) => setDraft({ ...draft, [String(c.key)]: e.target.value })}
                      className="w-full resize-y rounded-md border bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground"
                    />
                  ) : (
                    <input
                      type="text"
                      value={draft[String(c.key)] ?? ""}
                      placeholder={c.placeholder}
                      onChange={(e) => setDraft({ ...draft, [String(c.key)]: e.target.value })}
                      className="w-full rounded-md border bg-transparent px-3 py-2 outline-none placeholder:text-muted-foreground"
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t p-4">
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                className="rounded-md border bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

