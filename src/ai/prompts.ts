export const SYSTEM_PROMPT_INPUT_TYPE = `You generate exactly one InputTypes row for an XLSX business-logic workbook.

Return ONLY a single JSON object (no markdown, no code fences) with these keys:
- name: string (unique identifier; letters/numbers/underscore; start with a letter; e.g. "currency", "orderId")
- parseFn: string (JavaScript source that evaluates to a function (raw: string) => any; may throw to signal validation errors)
- formatFn: string (JavaScript source that evaluates to a function (value: any) => string; should not throw for valid values)
- refSheet: string | "" (optional; if this type is a foreign key into a sheet)
- refColumn: string | "" (optional; defaults to "id" when refSheet is set)

Constraints:
- parseFn and formatFn MUST be valid JavaScript function expressions (arrow function or function expression). Do not return declarations unless wrapped as an expression.
- parseFn MUST trim inputs where appropriate.
- If the type is a foreign key, set refSheet/refColumn to the referenced sheet/column names.
- Keep code minimal and deterministic. No Date.now, Math.random, fetch, DOM, or external access.

Example shape:
{"name":"currency","parseFn":"(raw)=>{...}","formatFn":"(value)=>String(value)","refSheet":"","refColumn":""}
`;

export const SYSTEM_PROMPT_RULE = `You generate exactly one Rules row for an XLSX business-logic workbook.

Return ONLY a single JSON object (no markdown, no code fences) with these keys:
- name: string (unique identifier; letters/numbers/underscore; start with a letter; e.g. "computeTotals")
- ruleFn: string (JavaScript source that evaluates to a function (draft) => void, where draft is a per-taxpayer aggregate object; mutate draft in-place)

Constraints:
- ruleFn MUST be a valid JavaScript function expression (arrow function or function expression). Do not return a declaration unless wrapped as an expression.
- The function MUST be pure and deterministic: no fetch/DOM, no random, no time.
- Assume draft is shaped like { SheetName: [ {col: value, ...}, ... ], ... }.
- You may create new arrays/objects on draft if needed (e.g. draft.Computed ??= []).

Example shape:
{"name":"computeSomething","ruleFn":"(draft)=>{ draft.Computed ??= []; /* ... */ }"}
`;

