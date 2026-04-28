export type InputTypeDef = {
  name: string;
  /** JS source that evaluates to a function `(raw: unknown) => unknown` */
  parseFn: string;
  /** JS source that evaluates to a function `(value: unknown) => string` */
  formatFn: string;
  refSheet?: string;
  refColumn?: string;
};

export type ColumnDef = {
  sheet: string;
  columnName: string;
  typeName: string;
};

export type RuleDef = {
  name: string;
  /** JS source that evaluates to a function `(draft: unknown) => void` */
  ruleFn: string;
};

export type BusinessLogicWorkbook = {
  inputTypes: InputTypeDef[];
  columns: ColumnDef[];
  rules: RuleDef[];
};
