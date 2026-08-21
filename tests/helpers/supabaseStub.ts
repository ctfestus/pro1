// Tiny, per-query Supabase stub for in-process route tests.
//
// Supabase's query builder is both chainable (.from().select().eq()...) and awaitable
// (the chain resolves to { data, error }). This stub mimics exactly that: every chain
// method returns the same builder, and awaiting the builder -- or calling a terminal like
// .single() / .maybeSingle() and awaiting that -- resolves to the result configured for
// that table. Keep the per-test config tiny: one entry per table the route touches.
//
// If a route queries the same table more than once with different results, pass an array;
// results are consumed in call order.

export type QueryResult = { data?: unknown; error?: unknown; count?: number | null };

function makeBuilder(getResult: () => QueryResult) {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const p = Promise.resolve(getResult());
        return (p as any)[prop].bind(p);
      }
      // Any query method (.select/.eq/.insert/.update/.delete/.single/.maybeSingle/.order/...)
      // returns the same chainable+awaitable builder.
      return () => builder;
    },
    apply() {
      return builder;
    },
  };
  const builder: any = new Proxy(function () {}, handler);
  return builder;
}

/**
 * `rpc` is optional and only needed by routes that call one. Supply a handler to model the
 * function's real semantics -- a claim that a second caller loses, for instance -- rather than a
 * fixed result, since that behavior is usually the point of the test.
 */
export function makeSupabaseStub(
  byTable: Record<string, QueryResult | QueryResult[]>,
  rpcHandler?: (fn: string, args: Record<string, any>) => QueryResult,
) {
  const cursors: Record<string, number> = {};
  return {
    rpc(fn: string, args?: Record<string, any>) {
      if (!rpcHandler) throw new Error(`makeSupabaseStub: unexpected rpc call "${fn}"`);
      return Promise.resolve(rpcHandler(fn, args ?? {}));
    },
    from(table: string) {
      const entry = byTable[table];
      if (entry === undefined) {
        throw new Error(`makeSupabaseStub: unexpected query on table "${table}"`);
      }
      return makeBuilder(() => {
        if (Array.isArray(entry)) {
          const i = cursors[table] ?? 0;
          cursors[table] = i + 1;
          return entry[Math.min(i, entry.length - 1)];
        }
        return entry;
      });
    },
  };
}
