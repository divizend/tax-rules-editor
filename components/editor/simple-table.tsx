"use client";

import * as React from "react";
import { Pencil, Trash2 } from "lucide-react";
import { JsCodeWithAiExplain } from "./js-code-with-ai-explain";

type Column<Row extends object> = {
  key: keyof Row;
  label: string;
  kind?: "text" | "textarea" | "select";
  options?: string[] | (() => string[]);
  placeholder?: string;
  display?: "truncate" | "wrap";
};

export function SimpleTable<Row extends Record<string, unknown>>(props: {
  caption: string;
  rows: Row[];
  columns: Array<Column<Row>>;
  onChangeRow: (idx: number, next: Row) => void;
  createRow: () => Row;
  onAddRow: (row: Row) => void;
  onDeleteRow: (idx: number) => void;
  headerRight?: React.ReactNode;
  addLabel?: string;
  canEditRow?: (row: Row, idx: number) => boolean;
  canDeleteRow?: (row: Row, idx: number) => boolean;
  validateDraft?: (args: { mode: "add" | "edit"; draft: Record<string, string>; editingIdx: number | null }) =>
    | string
    | null;
  rowActions?: (row: Row, idx: number) => React.ReactNode;
}): React.ReactNode {
  const {
    caption,
    rows,
    columns,
    onChangeRow,
    createRow,
    onAddRow,
    onDeleteRow,
    headerRight,
    addLabel = "Add",
    canEditRow,
    canDeleteRow,
    validateDraft,
    rowActions,
  } = props;
  const [editingIdx, setEditingIdx] = React.useState<number | null>(null);
  const [isAdding, setIsAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, string> | null>(null);
  const draftError =
    draft && validateDraft
      ? validateDraft({
          mode: isAdding ? "add" : "edit",
          draft,
          editingIdx,
        })
      : null;

  function openEdit(idx: number) {
    const row = rows[idx];
    if (!row) return;
    const nextDraft: Record<string, string> = {};
    for (const c of columns) {
      const value = row[c.key];
      nextDraft[String(c.key)] = typeof value === "string" ? value : value == null ? "" : String(value);
    }
    setEditingIdx(idx);
    setIsAdding(false);
    setDraft(nextDraft);
  }

  function openAdd() {
    const row = createRow();
    const nextDraft: Record<string, string> = {};
    for (const c of columns) {
      const value = row[c.key];
      nextDraft[String(c.key)] = typeof value === "string" ? value : value == null ? "" : String(value);
    }
    setEditingIdx(null);
    setIsAdding(true);
    setDraft(nextDraft);
  }

  function closeEdit() {
    setEditingIdx(null);
    setIsAdding(false);
    setDraft(null);
  }

  function saveEdit() {
    if (!draft) return;
    if (draftError) return;

    if (isAdding) {
      const next = {} as Record<string, unknown>;
      for (const c of columns) next[String(c.key)] = draft[String(c.key)] ?? "";
      onAddRow(next as Row);
      closeEdit();
      return;
    }

    if (editingIdx == null) return;
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
        <div className="flex items-center gap-2">
          {headerRight}
          <button
            type="button"
            onClick={openAdd}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            {addLabel}
          </button>
        </div>
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
                    const display = c.display ?? "truncate";
                    return (
                      <td key={String(c.key)} className="px-3 py-2">
                        {c.kind === "textarea" ? (
                          <JsCodeWithAiExplain code={str} />
                        ) : (
                          <div
                            className={
                              display === "wrap"
                                ? "max-w-[28rem] whitespace-pre-wrap break-words"
                                : "max-w-[18rem] truncate"
                            }
                          >
                            {str || "—"}
                          </div>
                        )}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      {rowActions ? rowActions(row, idx) : null}
                      {(canEditRow ? canEditRow(row, idx) : true) ? (
                        <button
                          type="button"
                          onClick={() => openEdit(idx)}
                          className="rounded-md border p-1.5 text-xs hover:bg-muted"
                          title="Edit"
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      ) : null}
                      {(canDeleteRow ? canDeleteRow(row, idx) : true) ? (
                        <button
                          type="button"
                          onClick={() => onDeleteRow(idx)}
                          className="rounded-md border p-1.5 text-xs hover:bg-muted"
                          title="Delete"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(editingIdx != null || isAdding) && draft ? (
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
              <div className="text-sm font-medium">{isAdding ? "Add row" : "Edit row"}</div>
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
                  ) : c.kind === "select" ? (
                    <select
                      value={draft[String(c.key)] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [String(c.key)]: e.target.value })}
                      className="w-full rounded-md border bg-transparent px-3 py-2 outline-none"
                    >
                      <option value="">{c.placeholder ?? "Select…"}</option>
                      {(typeof c.options === "function" ? c.options() : c.options ?? []).map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
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
              {draftError ? <div className="text-sm text-destructive">{draftError}</div> : null}
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
                disabled={!!draftError}
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

