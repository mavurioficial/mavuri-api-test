const MeliApi = "https://api.mercadolibre.com";

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

function send(res, status, data) {
  return res.status(status).json(data);
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { message: text || `HTTP ${response.status}` }; }
}

function headers(req, authenticated = true, extra = {}) {
  const h = { Accept: "application/json", ...extra };
  if (authenticated && req.headers.authorization) h.Authorization = req.headers.authorization;
  return h;
}

async function meli(req, url, authenticated = true, extraHeaders = {}) {
  let response = await fetch(url, {
    headers: headers(req, authenticated, extraHeaders),
    cache: "no-store"
  });
  let data = await readJson(response);

  if (!response.ok && authenticated && req.headers.authorization && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, {
      headers: headers(req, false, extraHeaders),
      cache: "no-store"
    });
    data = await readJson(response);
  }
  return { response, data };
}

function choosePrice(prices) {
  if (!Array.isArray(prices)) return null;
  return prices.find(p => p?.type === "promotion" && Number.isFinite(Number(p?.amount)))
    || prices.find(p => p?.type === "standard" && Number.isFinite(Number(p?.amount)))
    || prices.find(p => Number.isFinite(Number(p?.amount)))
    || null;
}

async function resolveItemPrice(req, itemId, fallbackOffer = null) {
  if (!itemId) return fallbackOffer?.price != null ? {
    price: Number(fallbackOffer.price),
    original_price: fallbackOffer.original_price != null ? Number(fallbackOffer.original_price) : null,
    currency_id: fallbackOffer.currency_id || "BRL",
    source: "catalog_offer"
  } : null;

  if (req.headers.authorization) {
    const sale = await meli(req, `${MeliApi}/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace&quantity=1`, true);
    if (sale.response.ok && Number.isFinite(Number(sale.data?.amount))) {
      return {
        price: Number(sale.data.amount),
        original_price: Number.isFinite(Number(sale.data?.regular_amount)) ? Number(sale.data.regular_amount) : null,
        currency_id: sale.data?.currency_id || "BRL",
        source: "sale_price"
      };
    }

    const prices = await meli(req, `${MeliApi}/items/${encodeURIComponent(itemId)}/prices`, true, { "show-all-prices": "true" });
    if (prices.response.ok) {
      const selected = choosePrice(prices.data?.prices);
      if (selected) return {
        price: Number(selected.amount),
        original_price: Number.isFinite(Number(selected.regular_amount)) ? Number(selected.regular_amount) : null,
        currency_id: selected.currency_id || "BRL",
        source: "prices"
      };
    }
  }

  if (fallbackOffer?.price != null) return {
    price: Number(fallbackOffer.price),
    original_price: fallbackOffer.original_price != null ? Number(fallbackOffer.original_price) : null,
    currency_id: fallbackOffer.currency_id || "BRL",
    source: "catalog_offer"
  };

  return null;
}

function normalize(item, product, offer, priceInfo, description = "") {
  const itemId = item?.id || offer?.item_id || offer?.id || null;
  const picture = item?.thumbnail || item?.secure_thumbnail || product?.pictures?.[0]?.secure_url || product?.pictures?.[0]?.url || null;
  const title = item?.title || product?.name || product?.title || offer?.title || itemId || "Produto sem nome";
  const price = priceInfo?.price ?? item?.price ?? offer?.price ?? null;
  const original = priceInfo?.original_price ?? item?.original_price ?? offer?.original_price ?? null;
  const desc = String(description || item?.subtitle || product?.short_description?.content || product?.short_description || "").replace(/\s+/g, " ").trim();

  return {
    id: itemId || product?.id || null,
    catalog_product_id: product?.id || product?.catalog_product_id || null,
    title,
    description: desc.slice(0, 320),
    price,
    currency_id: priceInfo?.currency_id || item?.currency_id || offer?.currency_id || "BRL",
    original_price: original,
    permalink: item?.permalink || (itemId ? `https://produto.mercadolivre.com.br/${itemId}` : null),
    thumbnail: picture,
    shipping: item?.shipping || offer?.shipping || {},
    seller_id: item?.seller_id || offer?.seller_id || null,
    category_id: item?.category_id || offer?.category_id || null,
    price_source: priceInfo?.source || null,
    offer_count: offer?.offer_count || null
  };
}

async function enrichCatalogProduct(req, product) {
  const productId = product?.id || product?.catalog_product_id;
  if (!productId) return normalize(null, product, null, null);

  // Um produto de catálogo não é um anúncio. Primeiro buscamos os anúncios/ofertas ligados à PDP.
  const offersResult = await meli(req, `${MeliApi}/products/${encodeURIComponent(productId)}/items`, true);
  const offers = offersResult.response.ok && Array.isArray(offersResult.data?.results) ? offersResult.data.results : [];

  const priced = offers
    .filter(o => o?.item_id && Number.isFinite(Number(o?.price)) && Number(o.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price));
  const offer = priced[0] || offers.find(o => o?.item_id) || null;
  if (!offer) return normalize(null, product, null, null);
  offer.offer_count = offers.length;

  const itemId = offer.item_id;
  const [itemResult, descriptionResult, priceInfo] = await Promise.all([
    meli(req, `${MeliApi}/items/${encodeURIComponent(itemId)}`, true),
    meli(req, `${MeliApi}/items/${encodeURIComponent(itemId)}/description`, true),
    resolveItemPrice(req, itemId, offer)
  ]);

  const item = itemResult.response.ok ? itemResult.data : null;
  const description = descriptionResult.response.ok && typeof descriptionResult.data === "object"
    ? (descriptionResult.data.plain_text || descriptionResult.data.text || "")
    : "";

  return normalize(item, product, offer, priceInfo, description);
}

async function catalogSearch(req, q, limit) {
  if (!req.headers.authorization) {
    return { ok: false, status: 401, data: { message: "Access Token não informado." } };
  }

  const url = new URL(`${MeliApi}/products/search`);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", "MLB");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 20)));

  const result = await meli(req, url.toString(), true);
  if (!result.response.ok) return { ok: false, status: result.response.status, data: result.data };

  const products = Array.isArray(result.data?.results) ? result.data.results : [];
  const settled = await Promise.allSettled(products.map(product => enrichCatalogProduct(req, product)));
  const enriched = settled.map((r, i) => r.status === "fulfilled" ? r.value : normalize(null, products[i], null, null));

  return {
    ok: true,
    status: 200,
    data: {
      paging: result.data?.paging || { total: products.length, offset: 0, limit },
      results: enriched,
      search_source: "catalog_product_to_marketplace_offer"
    }
  };
}

async function publicSearch(req, q, limit) {
  const url = new URL(`${MeliApi}/sites/MLB/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  return meli(req, url.toString(), true);
}

async function search(req, q, limit) {
  const direct = await publicSearch(req, q, limit);
  if (direct.response.ok && Array.isArray(direct.data?.results) && direct.data.results.length) {
    return {
      ok: true,
      data: {
        paging: direct.data.paging,
        results: direct.data.results,
        search_source: "marketplace_search"
      }
    };
  }
  return catalogSearch(req, q, limit);
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const action = String(req.query?.action || "").toLowerCase();

    if (action === "me") {
      if (!req.headers.authorization) return send(res, 401, { message: "Access Token não informado." });
      const result = await meli(req, `${MeliApi}/users/me`, true);
      return send(res, result.response.status, result.data);
    }

    if (action === "categories") {
      const result = await meli(req, `${MeliApi}/sites/MLB/categories`, false);
      return send(res, result.response.status, result.data);
    }

    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      if (!q) return send(res, 400, { message: "Informe q para pesquisar." });
      const requested = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 20);
      const result = await search(req, q, limit);
      return send(res, result.status || 200, result.data);
    }

    return send(res, 400, { message: "Ação inválida.", actions: ["me", "search", "categories"] });
  } catch (error) {
    console.error("Erro Meli2:", error);
    return send(res, 500, {
      message: "Erro interno ao consultar a API do Mercado Livre.",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
