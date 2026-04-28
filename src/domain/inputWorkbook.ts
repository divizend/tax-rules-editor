import type { ValidationResult } from "./errors.js";

export type RawInputRow = {
  /** 1-based row index in the sheet (header is row 1) */
  rowNumber: number;
  raw: Record<string, string>;
};

export type RawInputSheet = {
  sheetName: string;
  /**
   * Header names as read from row 1. Optional because tests may synthesize
   * `RawInputWorkbook` directly.
   */
  headers?: string[];
  rows: RawInputRow[];
};

export type RawInputWorkbook = {
  sheetNames: string[];
  sheets: Record<string, RawInputRow[] | RawInputSheet>;
};

export type ValidatedInputRow = {
  rowNumber: number;
  raw: Record<string, string>;
  taxpayerId: string;
};

export type GlobalRowIndexEntry = {
  sheet: string;
  rowNumber: number;
  raw: Record<string, string>;
};

export type ValidatedInputWorkbook = {
  rowsBySheet: Record<string, ValidatedInputRow[]>;
  globalRowIndex: Record<string, GlobalRowIndexEntry>;
  /**
   * Handy indices for later tasks.
   * - `idBySheet`: sheet -> (trimmed id -> row)
   */
  indices: {
    idBySheet: Record<string, Record<string, GlobalRowIndexEntry>>;
  };
};

export type InputWorkbookValidationResult = ValidationResult<ValidatedInputWorkbook>;

