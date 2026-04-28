export type Severity = "error" | "warning";

export type SheetError = {
  severity: Severity;
  sheet: string;
  message: string;
  /** 1-based row index */
  row?: number;
  /** column header name */
  column?: string;
};

export type CellError = {
  severity: Severity;
  sheet: string;
  /** 1-based row index */
  row: number;
  /** column header name */
  column: string;
  message: string;
};

export type RuleError = {
  severity: Severity;
  taxpayerId?: string;
  ruleName: string;
  message: string;
  stack?: string;
};

export type ValidationResult<T> =
  | { ok: true; value: T; errors: [] }
  | { ok: false; errors: Array<SheetError | CellError | RuleError> };
