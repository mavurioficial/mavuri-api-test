const MeliApi = "https://api.mercadolibre.com";
const APP_LOGIC = "2026.08.27.07";

function cors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set(["https://mavurioficial.github.io", "https://mavuri-api-test.vercel.app"]);
  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

async function read(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { message: text || `Resposta HTTP ${response.status}` }; }
}

async function call(req, url, authenticated = false, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (authenticated && req.headers.authorization) headers.Authorization = req.headers.authorization;
  const response = await fetch(url, { headers, cache: "no-store" });
  const data = await read(response);
  return { response, data };
}

function count(data) {
  return Array.isArray(data?.results) ? data.results.length : null;
}

function itemSummary(data) {
  return data && typeof data === "object" ? {
    id: data.id || null,
    title: data.title || null,
    price: data.price ?? null,
    original_price: data.original_price ?? null,
    currency_id: data.currency_id || null,
    permalink: data.permalink || null,
    catalog_product_id: data.catalog_product_id || null
  } : null;
}

function productSummary(product) {
  return {
    id: product?.id || null,
    name: product?.name || product?.title || null,
    domain_id: product?.domain_id || null,
    buy_box_winner: product?.buy_box_winner || null
  };
}

async function probeRealItem(req, itemId) {
  const base = `${MeliApi}/items/${encodeURIComponent(itemId)}`;
  const [item, multiget, salePrice, prices] = await Promise.all([
    call(req, base, false),
    call(req, `${MeliApi}/items?ids=${encodeURIComponent(itemId)}&attributes=id,title,price,original_price,currency_id,permalink,catalog_product_id`, false),
    call(req, `${base}/sale_price?context=channel_marketplace&quantity=1`, true),
    call(req, `${base}/prices`, true, { "show-all-prices": "true" })
  ]);
  return {
    item_id: itemId,
    item: { status: item.response.status, ok: item.response.ok, sample: item.response.ok ? itemSummary(item.data) : null, error: item.response.ok ? null : item.data },
    multiget: { status: multiget.response.status, ok: multiget.response.ok, sample: multiget.response.ok ? multiget.data?.[0]?.body || null : null, error: multiget.response.ok ? null : multiget.data },
    sale_price: { status: salePrice.response.status, ok: salePrice.response.ok, sample: salePrice.response.ok ? salePrice.data : null, error: salePrice.response.ok ? null : salePrice.data },
    prices: { status: prices.response.status, ok: prices.response.ok, sample: prices.response.ok ? prices.data?.prices || prices.data : null, error: prices.response.ok ? null : prices.data }
  };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const q = String(req.query?.q || "tv").trim() || "tv";
    const hasAuthorization = Boolean(req.headers.authorization);
    const results = [];

    if (hasAuthorization) {
      const me = await call(req, `${MeliApi}/users/me`, true);
      results.push({ name: "users_me", status: me.response.status, ok: me.response.ok, error: me.response.ok ? null : me.data });
    }

    const publicSearch = await call(req, `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=2`, false);
    results.push({ name: "search_public", status: publicSearch.response.status, ok: publicSearch.response.ok, result_count: count(publicSearch.data), error: publicSearch.response.ok ? null : publicSearch.data });

    if (hasAuthorization) {
      const authSearch = await call(req, `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=2`, true);
      results.push({ name: "search_authenticated", status: authSearch.response.status, ok: authSearch.response.ok, result_count: count(authSearch.data), error: authSearch.response.ok ? null : authSearch.data });

      const products = await call(req, `${MeliApi}/products/search?status=active&site_id=MLB&q=${encodeURIComponent(q)}&limit=5`, true);
      results.push({ name: "products_search_authenticated", status: products.response.status, ok: products.response.ok, result_count: count(products.data), error: products.response.ok ? null : products.data });

      if (products.response.ok && Array.isArray(products.data?.results)) {
        for (const product of products.data.results.slice(0, 5)) {
          const productId = product?.id;
          if (!productId) continue;
          const detail = await call(req, `${MeliApi}/products/${encodeURIComponent(productId)}`, true);
          const offers = await call(req, `${MeliApi}/products/${encodeURIComponent(productId)}/items`, true);
          const offerResults = Array.isArray(offers.data?.results) ? offers.data.results : [];
          const sampleOffer = offerResults.find(x => typeof x?.item_id === "string" && /^MLB\d+$/.test(x.item_id)) || null;
          const entry = {
            name: "catalog_product_probe",
            product: productSummary(product),
            detail: { status: detail.response.status, ok: detail.response.ok, buy_box_winner: detail.response.ok ? detail.data?.buy_box_winner || null : null, error: detail.response.ok ? null : detail.data },
            product_items: { status: offers.response.status, ok: offers.response.ok, result_count: offerResults.length, sample_offer: sampleOffer ? { item_id: sampleOffer.item_id, price: sampleOffer.price ?? null, original_price: sampleOffer.original_price ?? sampleOffer.regular_amount ?? null, currency_id: sampleOffer.currency_id || null } : null, error: offers.response.ok ? null : offers.data }
          };
          if (sampleOffer?.item_id) entry.real_item_probe = await probeRealItem(req, sampleOffer.item_id);
          results.push(entry);
        }
      }

      // ID real documentado pelo Mercado Livre para validar o pipeline de /items.
      results.push({ name: "documented_real_item_probe", ...(await probeRealItem(req, "MLB1828680414")) });
    }

    return res.status(200).json({ app_logic: APP_LOGIC, query: q, has_authorization: hasAuthorization, results });
  } catch (error) {
    return res.status(500).json({ app_logic: APP_LOGIC, message: "Erro no diagnóstico.", error: error instanceof Error ? error.message : String(error) });
  }
}
