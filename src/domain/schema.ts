export type InputTypeDef = {
  name: string;
  description?: string;
  /** JS source that evaluates to a function `(raw: unknown, inputWorkbook: unknown) => unknown` */
  parseFn: string;
  /** JS source that evaluates to a function `(value: unknown) => string` */
  formatFn: string;
  /**
   * If set, this input type is tied to an entity/table defined in `Column.sheet`.
   * Foreign-key references always resolve against that entity's `id` column.
   */
  ref?: string;
};

export type ColumnDef = {
  sheet: string;
  columnName: string;
  typeName: string;
  description?: string;
};

export type RuleDef = {
  name: string;
  description?: string;
  /** JS source that evaluates to a function `(draft: unknown) => void` */
  ruleFn: string;
};

export type BusinessLogicWorkbook = {
  inputTypes: InputTypeDef[];
  columns: ColumnDef[];
  rules: RuleDef[];
};
