import * as supabase from '../supabase';

export type Result = { data?: unknown; error?: unknown; count?: number };
export type Call = { table: string; method: string; args: unknown[] };
export type Results = Record<string, Result | Result[]>;

/**
 * Constructor encadenable que reemplaza a Supabase en las pruebas: `from(tabla)`
 * resuelve a `results[tabla]` y anota cada llamada de la cadena. Si el valor es
 * un arreglo, entrega un resultado distinto por cada `from(tabla)`, en orden (el
 * último se repite).
 */
export function fakeFrom(results: Results, calls: Call[]) {
  return (table: string) => {
    const entry = results[table];
    const picked = Array.isArray(entry)
      ? entry.length > 1
        ? entry.shift()
        : entry[0]
      : entry;
    const result = { data: null, error: null, ...picked };

    const proxy: any = new Proxy(function () {}, {
      get: (_target, prop: string) => {
        if (prop === 'then') {
          return (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(result).then(resolve, reject);
        }
        return (...args: unknown[]) => {
          calls.push({ table, method: prop, args });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return proxy;
        };
      },
    });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return proxy;
  };
}

/** La service role (lecturas y escrituras del backend). */
export function fakeAdmin(results: Results) {
  const calls: Call[] = [];
  jest
    .spyOn(supabase.supabaseAdmin, 'from')
    .mockImplementation(fakeFrom(results, calls) as never);
  return calls;
}

/** El cliente que actúa con el token de la persona (el que aplica RLS y triggers). */
export function fakeUser(results: Results) {
  const calls: Call[] = [];
  const spy = jest
    .spyOn(supabase, 'createSupabaseUserClient')
    .mockReturnValue({ from: fakeFrom(results, calls) } as never);
  return { calls, spy };
}
