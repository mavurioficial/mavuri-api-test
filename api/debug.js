const MeliApi = "https://api.mercadolibre.com";

export default async function handler(req, res) {
  const q = String(req.query?.q || "asics").trim() || "asics";
  const url = new URL(`${MeliApi}/sites/MLB/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "2");

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store"
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
      diagnostic_version: "2026.08.27.05",
      upstream_url: url.toString(),
      upstream_status: response.status,
      upstream_status_text: response.statusText,
      upstream_ok: response.ok,
      result_count: results.length,
      upstream_error: response.ok ? null : data,
      upstream_headers: {
        content_type: response.headers.get("content-type"),
        x_request_id: response.headers.get("x-request-id"),
        x_meli_request_id: response.headers.get("x-meli-request-id"),
        date: response.headers.get("date")
      },
      sample
    });
  } catch (error) {
    return res.status(500).json({
      diagnostic_version: "2026.08.27.05",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
