const MeliApi = "https://api.mercadolibre.com";

export default async function handler(req, res) {
  const q = String(req.query?.q || "asics").trim() || "asics";
  const url = new URL(`${MeliApi}/sites/MLB/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "2");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    const results = Array.isArray(data?.results) ? data.results : [];
    const sample = results.map(item => ({
      id: item?.id || null,
      title: item?.title || null,
      price: item?.price ?? null,
      original_price: item?.original_price ?? null,
      currency_id: item?.currency_id || null,
      installments: item?.installments || null,
      thumbnail: item?.thumbnail || null,
      permalink: item?.permalink || null
    }));

    return res.status(response.status).json({
      diagnostic_version: "2026.08.27.04",
      query: q,
      upstream_status: response.status,
      upstream_ok: response.ok,
      result_count: results.length,
      sample
    });
  } catch (error) {
    return res.status(500).json({
      diagnostic_version: "2026.08.27.04",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
