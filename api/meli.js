const MeliApi = "https://api.mercadolibre.com";

function aplicarCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = new Set(["https://mavurioficial.github.io", "https://mavuri-api-test.vercel.app"]);
  if (allowed.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

function send(res, status, data) { return res.status(status).json(data); }

async function lerResposta(response) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch { return { message: text || `Resposta HTTP ${response.status}` }; }
}

function authHeaders(req, useAuth = true, extra = {}) {
  const headers = { Accept: "application/json", ...extra };
  if (useAuth && req.headers.authorization) headers.Authorization = req.headers.authorization;
  return headers;
}

async function meliFetch(req, url, { useAuth = true, publicFallback = true, headers = {} } = {}) {
  let response = await fetch(url, { headers: authHeaders(req, useAuth, headers), cache: "no-store" });
  let data = await lerResposta(response);

  if (publicFallback && !response.ok && useAuth && req.headers.authorization && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, { headers: authHeaders(req, false, headers), cache: "no-store" });
    data = await lerResposta(response);
  }
  return { response, data };
}

function itemIdOf(item) {
  return item?.id || item?.item_id || item?.buy_box_winner?.item_id || null;
}

function permalinkOf(id) {
  return id ? `https://produto.mercadolivre.com.br/${id}` : null;
}

function shortDescription(text, max = 320) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max).trim()}…`;
}

function firstUsefulPrice(prices) {
  if (!Array.isArray(prices)) return null;
  return prices.find(p => p?.type === "promotion" && Number.isFinite(Number(p?.amount)))
    || prices.find(p => p?.type === "standard" && Number.isFinite(Number(p?.amount)))
    || prices.find(p => Number.isFinite(Number(p?.amount)))
    || null;
}

async function resolvePrice(req, id) {
  if (!id || !req.headers.authorization) return null;

  const saleUrl = `${MeliApi}/items/${encodeURIComponent(id)}/sale_price?context=channel_marketplace&quantity=1`;
  const sale = await meliFetch(req, saleUrl, { publicFallback: false });
  if (sale.response.ok && Number.isFinite(Number(sale.data?.amount))) {
    return {
      price: Number(sale.data.amount),
      original_price: Number.isFinite(Number(sale.data?.regular_amount)) ? Number(sale.data.regular_amount) : null,
      currency_id: sale.data?.currency_id || "BRL",
      source: "sale_price"
    };
  }

  const pricesUrl = `${MeliApi}/items/${encodeURIComponent(id)}/prices`;
  const prices = await meliFetch(req, pricesUrl, {
    publicFallback: false,
    headers: { "show-all-prices": "true" }
  });
  if (prices.response.ok) {
    const selected = firstUsefulPrice(prices.data?.prices);
    if (selected) {
      return {
        price: Number(selected.amount),
        original_price: Number.isFinite(Number(selected?.regular_amount)) ? Number(selected.regular_amount) : null,
        currency_id: selected?.currency_id || "BRL",
        source: "prices"
      };
    }
  }

  return null;
}

function normalize(item, fallback = {}, description = "", priceInfo = null) {
  const id = itemIdOf(item) || itemIdOf(fallback);
  const winner = item?.buy_box_winner || fallback?.buy_box_winner || {};
  const installments = item?.installments || fallback?.installments || winner?.installments || {};
  const pictures = item?.pictures || fallback?.pictures || [];
  const title = item?.title || item?.name || fallback?.title || fallback?.name || fallback?.product_name || id || "Produto sem nome";
  const price = priceInfo?.price ?? item?.price ?? fallback?.price ?? fallback?.current_price ?? fallback?.sale_price ?? winner?.price ?? winner?.sale_price ?? null;
  const originalPrice = priceInfo?.original_price ?? item?.original_price ?? fallback?.original_price ?? fallback?.previous_price ?? fallback?.list_price ?? winner?.original_price ?? winner?.regular_amount ?? null;

  return {
    id,
    title,
    description: shortDescription(description) || item?.subtitle || item?.short_description || fallback?.description || "",
    price,
    currency_id: priceInfo?.currency_id || item?.currency_id || fallback?.currency_id || winner?.currency_id || "BRL",
    original_price: originalPrice,
    permalink: item?.permalink || fallback?.permalink || winner?.permalink || permalinkOf(id),
    thumbnail: item?.thumbnail || item?.secure_thumbnail || pictures?.[0]?.secure_url || pictures?.[0]?.url || fallback?.thumbnail || fallback?.secure_thumbnail || winner?.thumbnail || null,
    installments: {
      quantity: installments?.quantity ?? 0,
      amount: installments?.amount ?? 0,
      rate: installments?.rate ?? 0
    },
    seller_id: item?.seller_id || fallback?.seller_id || winner?.seller_id || null,
    category_id: item?.category_id || fallback?.category_id || winner?.category_id || null,
    shipping: item?.shipping || fallback?.shipping || winner?.shipping || {},
    raw_source: item ? "item" : "fallback",
    price_source: priceInfo?.source || (winner?.price != null ? "catalog_buy_box_winner" : (price != null ? "item_legacy" : null))
  };
}

async function enrichOne(req, fallback) {
  const id = itemIdOf(fallback);
  if (!id) return normalize(null, fallback);

  const [itemResult, descResult, priceInfo] = await Promise.all([
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}`),
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}/description`),
    resolvePrice(req, id)
  ]);

  const item = itemResult.response.ok ? itemResult.data : null;
  const description = descResult.response.ok && descResult.data && typeof descResult.data === "object"
    ? (descResult.data.plain_text || descResult.data.text || descResult.data.description || "")
    : "";

  return normalize(item, fallback, description, priceInfo);
}

async function enrich(req, results) {
  const settled = await Promise.allSettled(results.map(item => enrichOne(req, item)));
  return settled.map((result, index) => result.status === "fulfilled" ? result.value : normalize(null, results[index]));
}

function chooseCatalogOffer(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const withPrice = results.filter(offer => Number.isFinite(Number(offer?.price)) && itemIdOf(offer));
  if (withPrice.length > 0) {
    return [...withPrice].sort((a, b) => Number(a.price) - Number(b.price))[0];
  }
  return results.find(offer => itemIdOf(offer)) || null;
}

async function resolveCatalogOffer(req, product) {
  const productId = product?.id;
  if (!productId || !req.headers.authorization) return null;

  const url = new URL(`${MeliApi}/products/${encodeURIComponent(productId)}/items`);
  url.searchParams.set("limit", "20");
  const { response, data } = await meliFetch(req, url.toString(), { useAuth: true, publicFallback: false });
  if (!response.ok) return null;

  const offer = chooseCatalogOffer(data?.results);
  if (!offer) return null;
  return { offer, total: data?.paging?.total ?? data?.results?.length ?? 0 };
}

async function enrichCatalogOne(req, product) {
  const resolved = await resolveCatalogOffer(req, product);
  if (!resolved?.offer) {
    return {
      ...normalize(null, product),
      catalog_product_id: product?.id || null,
      catalog_offer_found: false,
      raw_source: "catalog_product_without_offer"
    };
  }

  const offer = resolved.offer;
  const itemId = itemIdOf(offer);
  const fallback = {
    ...product,
    ...offer,
    id: itemId,
    item_id: itemId,
    catalog_product_id: product?.id || null,
    title: product?.name || product?.title || offer?.title,
    thumbnail: product?.thumbnail || product?.secure_thumbnail || offer?.thumbnail || null,
    pictures: product?.pictures || offer?.pictures || [],
    price: offer?.price ?? null,
    original_price: offer?.original_price ?? offer?.regular_amount ?? null,
    currency_id: offer?.currency_id || product?.currency_id || "BRL"
  };

  const enriched = await enrichOne(req, fallback);
  return {
    ...enriched,
    catalog_product_id: product?.id || null,
    catalog_offer_found: true,
    catalog_offer_count: resolved.total,
    catalog_offer_price: Number.isFinite(Number(offer?.price)) ? Number(offer.price) : null,
    raw_source: enriched.raw_source === "item" ? "catalog_product_to_item" : "catalog_offer"
  };
}

async function enrichCatalog(req, results) {
  const settled = await Promise.allSettled(results.map(product => enrichCatalogOne(req, product)));
  return settled.map((result, index) => result.status === "fulfilled"
    ? result.value
    : { ...normalize(null, results[index]), catalog_product_id: results[index]?.id || null, catalog_offer_found: false, raw_source: "catalog_enrichment_failed" });
}

async function publicSearch(req, q, limit) {
  const url = new URL(`${MeliApi}/sites/MLB/search`);
  if (q) url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  return meliFetch(req, url.toString(), { publicFallback: true });
}

async function catalogSearch(req, q, limit) {
  if (!q || !req.headers.authorization) return { response: { ok: false, status: 401 }, data: null };
  const url = new URL(`${MeliApi}/products/search`);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", "MLB");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 20)));
  return meliFetch(req, url.toString(), { publicFallback: false });
}

async function diagnostic(req, q) {
  const term = q || "tv";
  const tests = [
    { name: "users_me", url: `${MeliApi}/users/me`, useAuth: true, requiresAuth: true },
    { name: "categories", url: `${MeliApi}/sites/MLB/categories`, useAuth: false },
    { name: "search_public", url: `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(term)}&limit=2`, useAuth: false },
    { name: "search_authenticated", url: `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(term)}&limit=2`, useAuth: true, requiresAuth: true },
    { name: "products_search_authenticated", url: `${MeliApi}/products/search?status=active&site_id=MLB&q=${encodeURIComponent(term)}&limit=2`, useAuth: true, requiresAuth: true }
  ];
  const results = [];
  let firstCatalogProduct = null;
  for (const test of tests) {
    if (test.requiresAuth && !req.headers.authorization) {
      results.push({ name: test.name, skipped: true, reason: "Authorization não informado", url: test.url });
      continue;
    }
    const { response, data } = await meliFetch(req, test.url, { useAuth: test.useAuth, publicFallback: false });
    if (test.name === "products_search_authenticated" && response.ok && Array.isArray(data?.results)) firstCatalogProduct = data.results[0] || null;
    results.push({ name: test.name, url: test.url, authenticated: test.useAuth && Boolean(req.headers.authorization), status: response.status, ok: response.ok, result_count: Array.isArray(data?.results) ? data.results.length : null, error: response.ok ? null : data });
  }

  if (firstCatalogProduct?.id && req.headers.authorization) {
    const url = `${MeliApi}/products/${encodeURIComponent(firstCatalogProduct.id)}/items?limit=2`;
    const { response, data } = await meliFetch(req, url, { useAuth: true, publicFallback: false });
    const offer = chooseCatalogOffer(data?.results);
    results.push({
      name: "catalog_product_items_authenticated",
      url,
      authenticated: true,
      product_id: firstCatalogProduct.id,
      status: response.status,
      ok: response.ok,
      result_count: Array.isArray(data?.results) ? data.results.length : null,
      sample_offer: offer ? { item_id: itemIdOf(offer), price: offer.price ?? null, currency_id: offer.currency_id || null } : null,
      error: response.ok ? null : data
    });
  }

  return { query: term, has_authorization: Boolean(req.headers.authorization), results };
}

async function searchWithFallback(req, q, limit) {
  const first = await publicSearch(req, q, limit);
  const publicResults = first.response.ok && Array.isArray(first.data?.results) ? first.data.results : [];
  if (publicResults.length > 0) return { ok: true, data: { ...first.data, results: await enrich(req, publicResults), search_source: "public_search_with_item_and_price_enrichment" } };

  const fallback = await catalogSearch(req, q, limit);
  const catalogResults = fallback.response.ok && Array.isArray(fallback.data?.results) ? fallback.data.results : [];
  if (catalogResults.length > 0) {
    return {
      ok: true,
      data: {
        paging: fallback.data?.paging || { total: catalogResults.length, offset: 0, limit },
        results: await enrichCatalog(req, catalogResults),
        search_source: "catalog_search_product_to_real_item_offer_enrichment"
      }
    };
  }

  if (first.response.ok) return { ok: true, data: { ...first.data, results: [], search_source: "public_empty_and_catalog_empty" } };
  return { ok: false, status: first.response.status, data: { ...first.data, catalog_fallback: fallback.data || null, diagnostic: { public_status: first.response.status, catalog_status: fallback.response.status || null } } };
}

async function generalSearch(req, limit) {
  const terms = ["oferta", "promoção", "desconto", "mais vendidos"];
  const unique = new Map();
  const each = Math.max(1, Math.ceil(limit / terms.length));
  for (const term of terms) {
    const result = await searchWithFallback(req, term, each);
    if (result.ok) for (const item of Array.isArray(result.data?.results) ? result.data.results : []) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
    if (unique.size >= limit) break;
  }
  const results = Array.from(unique.values()).slice(0, limit);
  return { results, paging: { total: results.length, offset: 0, limit }, search_source: "general_search_with_catalog_product_to_item_fallback" };
}

export default async function handler(req, res) {
  aplicarCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const action = String(req.query?.action || "").toLowerCase();
    if (action === "me") {
      if (!req.headers.authorization) return send(res, 401, { message: "Access Token não informado." });
      const { response, data } = await meliFetch(req, `${MeliApi}/users/me`, { publicFallback: false });
      return send(res, response.status, data);
    }
    if (action === "categories") {
      const { response, data } = await meliFetch(req, `${MeliApi}/sites/MLB/categories`);
      return send(res, response.status, data);
    }
    if (action === "diagnostic") return send(res, 200, await diagnostic(req, String(req.query?.q || "tv").trim()));
    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      const requested = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 50);
      if (!q) return send(res, 200, await generalSearch(req, limit));
      const result = await searchWithFallback(req, q, limit);
      if (result.ok) return send(res, 200, result.data);
      return send(res, result.status || 502, result.data);
    }
    return send(res, 400, { message: "Ação inválida.", actions: ["me", "search", "categories", "diagnostic"] });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);
    return send(res, 500, { message: "Erro interno ao consultar a API do Mercado Livre.", error: error instanceof Error ? error.message : String(error) });
  }
}
