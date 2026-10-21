export type One<T> = T | T[] | null | undefined;

/** PostgREST devuelve una relación como objeto o como lista de un elemento. */
export function first<T>(value: One<T>): T | undefined {
  return Array.isArray(value) ? value[0] : (value ?? undefined);
}
