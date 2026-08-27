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

function send(res, status, data) {
  return res.status(status).json(data);
}

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
  if (publicFallback && useAuth && req.headers.authorization && !response.ok && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, { headers: authHeaders(req, false, headers), cache: "no-store" });
    data = await lerResposta(response);
  }
  return { response, data };
}

function isNumber(value) {
  return Number.isFinite(Number(value));
}

function publicItemId(value) {
  const id = value?.id || value?.item_id || null;
  return typeof id === "string" && /^MLB\d+$/.test(id) ? id : null;
}

function catalogOfferItemId(offer) {
  // Neste endpoint a referência oficial da publicação é item_id.
  const id = offer?.item_id || offer?.id || null;
  return typeof id === "string" && /^MLB\d+$/.test(id) ? id : null;
}

function permalinkOf(id) {
  return id ? `https://produto.mercadolivre.com.br/${id}` : null;
}

function shortDescription(text, max = 320) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length <= max ? value : `${value.slice(0, max).trim()}…`;
}

function firstUsefulPrice(prices) {
  if (!Array.isArray(prices)) return null;
  return prices.find(p => p?.type === "promotion" && isNumber(p?.amount))
    || prices.find(p => p?.type === "standard" && isNumber(p?.amount))
    || prices.find(p => isNumber(p?.amount))
    || null;
}

async function resolvePrice(req, itemId, fallbackOffer = null) {
  if (req.headers.authorization && itemId) {
    const sale = await meliFetch(req, `${MeliApi}/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace&quantity=1`, { publicFallback: false });
    if (sale.response.ok && isNumber(sale.data?.amount)) {
      return {
        price: Number(sale.data.amount),
        original_price: isNumber(sale.data?.regular_amount) ? Number(sale.data.regular_amount) : null,
        currency_id: sale.data?.currency_id || "BRL",
        source: "sale_price"
      };
    }

    const prices = await meliFetch(req, `${MeliApi}/items/${encodeURIComponent(itemId)}/prices`, {
      publicFallback: false,
      headers: { "show-all-prices": "true" }
    });
    if (prices.response.ok) {
      const selected = firstUsefulPrice(prices.data?.prices);
      if (selected) {
        return {
          price: Number(selected.amount),
          original_price: isNumber(selected.regular_amount) ? Number(selected.regular_amount) : null,
          currency_id: selected.currency_id || "BRL",
          source: "prices"
        };
      }
    }
  }

  if (isNumber(fallbackOffer?.price)) {
    return {
      price: Number(fallbackOffer.price),
      original_price: isNumber(fallbackOffer?.original_price) ? Number(fallbackOffer.original_price) : null,
      currency_id: fallbackOffer?.currency_id || "BRL",
      source: "catalog_offer"
    };
  }
  return null;
}

function normalizeItem(item, fallback = {}, description = "", priceInfo = null) {
  const id = publicItemId(item) || publicItemId(fallback);
  const pictures = item?.pictures || fallback?.pictures || [];
  const winner = item?.buy_box_winner || fallback?.buy_box_winner || {};
  const price = priceInfo?.price ?? item?.price ?? fallback?.price ?? winner?.price ?? null;
  const original = priceInfo?.original_price ?? item?.original_price ?? fallback?.original_price ?? winner?.regular_amount ?? null;
  return {
    id,
    title: item?.title || fallback?.title || fallback?.name || id || "Produto sem nome",
    description: shortDescription(description) || item?.subtitle || fallback?.description || "",
    price: isNumber(price) ? Number(price) : null,
    currency_id: priceInfo?.currency_id || item?.currency_id || fallback?.currency_id || "BRL",
    original_price: isNumber(original) ? Number(original) : null,
    permalink: item?.permalink || fallback?.permalink || permalinkOf(id),
    thumbnail: item?.thumbnail || item?.secure_thumbnail || pictures?.[0]?.secure_url || pictures?.[0]?.url || fallback?.thumbnail || fallback?.secure_thumbnail || null,
    shipping: item?.shipping || fallback?.shipping || {},
    seller_id: item?.seller_id || fallback?.seller_id || null,
    category_id: item?.category_id || fallback?.category_id || null,
    raw_source: item ? "item" : "fallback",
    price_source: priceInfo?.source || (isNumber(item?.price) ? "item" : (isNumber(fallback?.price) ? "fallback" : null))
  };
}

async function enrichMarketplaceItem(req, fallback) {
  const id = publicItemId(fallback);
  if (!id) return normalizeItem(null, fallback);
  const [itemResult, descriptionResult, priceInfo] = await Promise.all([
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}`),
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}/description`),
    resolvePrice(req, id, fallback)
  ]);
  const item = itemResult.response.ok ? itemResult.data : null;
  const description = descriptionResult.response.ok && typeof descriptionResult.data === "object"
    ? (descriptionResult.data.plain_text || descriptionResult.data.text || "")
    : "";
  return normalizeItem(item, fallback, description, priceInfo);
}

function chooseCatalogOffer(results) {
  if (!Array.isArray(results)) return null;
  const valid = results.filter(offer => catalogOfferItemId(offer));
  if (!valid.length) return null;
  const priced = valid.filter(offer => isNumber(offer?.price) && Number(offer.price) > 0);
  return (priced.length ? priced : valid).sort((a, b) => Number(a?.price || Infinity) - Number(b?.price || Infinity))[0];
}

async function resolveCatalogOffer(req, productId) {
  const url = `${MeliApi}/products/${encodeURIComponent(productId)}/items?limit=50`;
  const { response, data } = await meliFetch(req, url, { useAuth: true, publicFallback: false });
  const offer = response.ok ? chooseCatalogOffer(data?.results) : null;
  return {
    ok: response.ok,
    status: response.status,
    error: response.ok ? null : data,
    offer,
    total: data?.paging?.total ?? (Array.isArray(data?.results) ? data.results.length : 0)
  };
}

async function enrichCatalogProduct(req, product) {
  const productId = product?.id || product?.catalog_product_id;
  if (!productId) return null;

  const resolved = await resolveCatalogOffer(req, productId);
  if (!resolved.offer) return null;

  const itemId = catalogOfferItemId(resolved.offer);
  if (!itemId) return null;

  const fallback = {
    ...product,
    ...resolved.offer,
    id: itemId,
    item_id: itemId,
    title: resolved.offer?.title || product?.name || product?.title || itemId,
    price: resolved.offer?.price ?? null,
    original_price: resolved.offer?.original_price ?? resolved.offer?.regular_amount ?? null,
    currency_id: resolved.offer?.currency_id || "BRL"
  };

  const enriched = await enrichMarketplaceItem(req, fallback);
  if (!enriched?.id || !isNumber(enriched.price) || Number(enriched.price) <= 0) return null;

  return {
    ...enriched,
    catalog_product_id: productId,
    catalog_offer_found: true,
    catalog_offer_count: resolved.total,
    catalog_offer_price: isNumber(resolved.offer?.price) ? Number(resolved.offer.price) : null,
    raw_source: enriched.raw_source === "item" ? "catalog_product_to_real_item" : "catalog_offer"
  };
}

async function publicSearch(req, q, limit) {
  const url = new URL(`${MeliApi}/sites/MLB/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 50)));
  return meliFetch(req, url.toString(), { publicFallback: true });
}

async function catalogSearch(req, q, requestedLimit) {
  if (!req.headers.authorization) return { response: { ok: false, status: 401 }, data: { message: "Access Token não informado." } };
  const fetchLimit = Math.min(Math.max(requestedLimit * 3, 20), 50);
  const url = new URL(`${MeliApi}/products/search`);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", "MLB");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(fetchLimit));
  return meliFetch(req, url.toString(), { useAuth: true, publicFallback: false });
}

async function searchWithFallback(req, q, limit) {
  const direct = await publicSearch(req, q, limit);
  const directResults = direct.response.ok && Array.isArray(direct.data?.results) ? direct.data.results : [];
  if (directResults.length) {
    const settled = await Promise.allSettled(directResults.map(item => enrichMarketplaceItem(req, item)));
    const results = settled.map((r, i) => r.status === "fulfilled" ? r.value : null).filter(item => item?.id && isNumber(item.price));
    if (results.length) return { ok: true, data: { paging: direct.data?.paging || { total: results.length, offset: 0, limit }, results, search_source: "marketplace_search_with_real_item_price" } };
  }

  const catalog = await catalogSearch(req, q, limit);
  const products = catalog.response.ok && Array.isArray(catalog.data?.results) ? catalog.data.results : [];
  if (products.length) {
    const settled = await Promise.allSettled(products.map(product => enrichCatalogProduct(req, product)));
    const results = settled.map(r => r.status === "fulfilled" ? r.value : null).filter(Boolean).slice(0, limit);
    return {
      ok: true,
      data: {
        paging: { total: catalog.data?.paging?.total ?? results.length, offset: catalog.data?.paging?.offset ?? 0, limit },
        results,
        search_source: results.length ? "catalog_products_to_verified_marketplace_items" : "catalog_found_but_no_verified_marketplace_offer"
      }
    };
  }

  if (direct.response.ok) return { ok: true, data: { paging: direct.data?.paging || { total: 0, offset: 0, limit }, results: [], search_source: "public_empty_and_catalog_empty" } };
  return { ok: false, status: direct.response.status, data: { ...direct.data, catalog_fallback: catalog.data } };
}

async function diagnostic(req, q) {
  const term = q || "tv";
  const results = [];
  const tests = [
    { name: "users_me", url: `${MeliApi}/users/me`, auth: true },
    { name: "categories", url: `${MeliApi}/sites/MLB/categories`, auth: false },
    { name: "search_public", url: `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(term)}&limit=2`, auth: false },
    { name: "search_authenticated", url: `${MeliApi}/sites/MLB/search?q=${encodeURIComponent(term)}&limit=2`, auth: true },
    { name: "products_search_authenticated", url: `${MeliApi}/products/search?status=active&site_id=MLB&q=${encodeURIComponent(term)}&limit=2`, auth: true }
  ];
  let firstProduct = null;
  for (const test of tests) {
    if (test.auth && !req.headers.authorization) {
      results.push({ name: test.name, skipped: true, reason: "Authorization não informado" });
      continue;
    }
    const { response, data } = await meliFetch(req, test.url, { useAuth: test.auth, publicFallback: false });
    if (test.name === "products_search_authenticated" && response.ok) firstProduct = data?.results?.[0] || null;
    results.push({ name: test.name, url: test.url, authenticated: test.auth, status: response.status, ok: response.ok, result_count: Array.isArray(data?.results) ? data.results.length : null, error: response.ok ? null : data });
  }

  if (firstProduct?.id && req.headers.authorization) {
    const detailUrl = `${MeliApi}/products/${encodeURIComponent(firstProduct.id)}`;
    const detail = await meliFetch(req, detailUrl, { useAuth: true, publicFallback: false });
    results.push({ name: "catalog_product_detail", url: detailUrl, product_id: firstProduct.id, status: detail.response.status, ok: detail.response.ok, error: detail.response.ok ? null : detail.data });

    const resolved = await resolveCatalogOffer(req, firstProduct.id);
    results.push({
      name: "catalog_product_items_authenticated",
      url: `${MeliApi}/products/${encodeURIComponent(firstProduct.id)}/items?limit=50`,
      product_id: firstProduct.id,
      status: resolved.status,
      ok: resolved.ok,
      result_count: resolved.total,
      sample_offer: resolved.offer ? { item_id: catalogOfferItemId(resolved.offer), price: resolved.offer.price ?? null, currency_id: resolved.offer.currency_id || null } : null,
      error: resolved.error
    });
  }
  return { app_logic: "2026.08.27.06", query: term, has_authorization: Boolean(req.headers.authorization), results };
}

async function generalSearch(req, limit) {
  const terms = ["oferta", "promoção", "desconto", "mais vendidos"];
  const unique = new Map();
  for (const term of terms) {
    const result = await searchWithFallback(req, term, Math.max(1, Math.ceil(limit / terms.length)));
    if (result.ok) for (const item of result.data?.results || []) if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
    if (unique.size >= limit) break;
  }
  const results = Array.from(unique.values()).slice(0, limit);
  return { results, paging: { total: results.length, offset: 0, limit }, search_source: "general_search_verified_items_only" };
}

export default async function handler(req, res) {
  aplicarCors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const action = String(req.query?.action || "").toLowerCase();
    if (action === "me") {
      if (!req.headers.authorization) return send(res, 401, { message: "Access Token não informado." });
      const { response, data } = await meliFetch(req, `${MeliApi}/users/me`, { useAuth: true, publicFallback: false });
      return send(res, response.status, data);
    }
    if (action === "categories") {
      const { response, data } = await meliFetch(req, `${MeliApi}/sites/MLB/categories`, { useAuth: false, publicFallback: false });
      return send(res, response.status, data);
    }
    if (action === "diagnostic") return send(res, 200, await diagnostic(req, String(req.query?.q || "tv").trim()));
    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      const requested = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 50);
      if (!q) return send(res, 200, await generalSearch(req, limit));
      const result = await searchWithFallback(req, q, limit);
      return send(res, result.ok ? 200 : (result.status || 502), result.data);
    }
    return send(res, 400, { message: "Ação inválida.", actions: ["me", "search", "categories", "diagnostic"] });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);
    return send(res, 500, { message: "Erro interno ao consultar a API do Mercado Livre.", error: error instanceof Error ? error.message : String(error) });
  }
}
