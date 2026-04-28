export type InputTypeDef<TParsed = unknown> = {
  name: string;
  parseFn: (raw: unknown) => TParsed;
  formatFn: (value: TParsed) => string;
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
  ruleFn: (ctx: unknown) => unknown;
};

export type BusinessLogicWorkbook = {
  inputTypes: InputTypeDef[];
  columns: ColumnDef[];
  rules: RuleDef[];
};
