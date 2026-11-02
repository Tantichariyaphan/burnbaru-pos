const PAGE_SIZE = 1000;

type PageResponse<Row> = {
  data: Row[] | null;
  error: unknown | null;
};

export async function fetchAllPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResponse<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];

  for (let page = 0; ; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data) throw new Error("Supabase query returned no page data");

    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
