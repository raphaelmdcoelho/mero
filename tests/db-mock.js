// Routes db.client.execute by SQL text instead of call order, so tests keep
// working when the server adds or reorders queries.
//
//   routeSql(spy, [
//     [/FROM characters WHERE id/, { rows: [char] }],
//     [/UPDATE characters/,        args => ({ rows: [] })],   // fn gets the query args
//   ]);
//
// Routes are tried in order; the first whose regex matches the SQL wins.
// A route may be an array of results: each call consumes the next one and the
// last one repeats. Unmatched queries resolve to { rows: [] } and are recorded
// in `unmatched` so a test can assert on them if it cares.
export function routeSql(spy, routes) {
  const unmatched = [];
  const counters = routes.map(() => 0);
  spy.mockImplementation(async (q) => {
    const sql = typeof q === 'string' ? q : q.sql;
    const args = typeof q === 'string' ? [] : (q.args ?? []);
    for (let i = 0; i < routes.length; i++) {
      const [re, res] = routes[i];
      if (!re.test(sql)) continue;
      if (Array.isArray(res)) return res[Math.min(counters[i]++, res.length - 1)];
      return typeof res === 'function' ? res(args, sql) : res;
    }
    unmatched.push(sql);
    return { rows: [] };
  });
  return { unmatched };
}

/** SQL strings of every execute() call recorded by the spy. */
export function sqlCalls(spy) {
  return spy.mock.calls.map(c => (typeof c[0] === 'string' ? c[0] : c[0].sql));
}
