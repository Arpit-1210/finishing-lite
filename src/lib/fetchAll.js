/** Supabase returns at most 1000 rows per request, silently. This pages through everything. make() must build a fresh, ordered query each call. */
export async function fetchAll(make, page = 1000) {
  const out = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await make().range(from, from + page - 1);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return { data: out, error: null };
}
