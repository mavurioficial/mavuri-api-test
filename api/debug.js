const MeliApi = "https://api.mercadolibre.com";

async function probe(url, headers = {}) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", ...headers },
      cache: "no-store"
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return {
      url,
      status: response.status,
      status_text: response.statusText,
      ok: response.ok,
      body,
      headers: {
        content_type: response.headers.get("content-type"),
        x_request_id: response.headers.get("x-request-id"),
        x_meli_request_id: response.headers.get("x-meli-request-id"),
        date: response.headers.get("date")
      }
    };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async function handler(req, res) {
  const q = String(req.query?.q || "tv").trim() || "tv";
  const limit = "2";
  const searchUrl = new URL(`${MeliApi}/sites/MLB/search`);
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("limit", limit);

  const catalogUrl = new URL(`${MeliApi}/products/search`);
  catalogUrl.searchParams.set("status", "active");
  catalogUrl.searchParams.set("site_id", "MLB");
  catalogUrl.searchParams.set("q", q);
  catalogUrl.searchParams.set("limit", limit);

  const authorization = req.headers.authorization || "";
  const authenticatedHeaders = authorization ? { Authorization: authorization } : {};

  const publicSearch = await probe(searchUrl.toString());
  const authenticatedSearch = authorization ? await probe(searchUrl.toString(), authenticatedHeaders) : null;
  const authenticatedCatalog = authorization ? await probe(catalogUrl.toString(), authenticatedHeaders) : null;

  const resultCount = Array.isArray(publicSearch.body?.results) ? publicSearch.body.results.length : 0;

  return res.status(200).json({
    diagnostic_version: "2026.08.27.06",
    query: q,
    token_received: Boolean(authorization),
    tests: {
      public_search: publicSearch,
      authenticated_search: authenticatedSearch,
      authenticated_catalog: authenticatedCatalog
    },
    summary: {
      public_search_status: publicSearch.status || null,
      authenticated_search_status: authenticatedSearch?.status || null,
      authenticated_catalog_status: authenticatedCatalog?.status || null,
      public_result_count: resultCount
    }
  });
}
