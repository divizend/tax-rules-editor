function splitWords(raw: string): string[] {
  const s = raw.trim();
  if (s.length === 0) return [];
  const parts = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-]+/g)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return parts;
}

function capitalize(word: string): string {
  if (word.length === 0) return word;
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** Turn a human noun phrase into a PascalCase entity/table name. */
export function nounToPascalCase(noun: string): string {
  const parts = splitWords(noun);
  if (parts.length === 0) return "";
  return parts.map(capitalize).join("");
}

export function pascalToCamelCase(pascal: string): string {
  const s = pascal.trim();
  if (s.length === 0) return "";
  return s[0]!.toLowerCase() + s.slice(1);
}

/** `${camelEntity}Id`, e.g. Customer -> customerId */
export function entityIdTypeName(entityPascal: string): string {
  return `${pascalToCamelCase(entityPascal)}Id`;
}
