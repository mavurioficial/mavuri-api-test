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

function authHeaders(req, useAuth = true) {
  const headers = { Accept: "application/json" };
  if (useAuth && req.headers.authorization) headers.Authorization = req.headers.authorization;
  return headers;
}

async function meliFetch(req, url, { useAuth = true, publicFallback = true } = {}) {
  let response = await fetch(url, { headers: authHeaders(req, useAuth), cache: "no-store" });
  let data = await lerResposta(response);

  if (publicFallback && !response.ok && useAuth && req.headers.authorization && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, { headers: authHeaders(req, false), cache: "no-store" });
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

function normalize(item, fallback = {}, description = "") {
  const id = itemIdOf(item) || itemIdOf(fallback);
  const installments = item?.installments || fallback?.installments || {};
  const pictures = item?.pictures || fallback?.pictures || [];
  return {
    id,
    title: item?.title || item?.name || fallback?.title || fallback?.name || id || "Produto sem nome",
    description: shortDescription(description) || item?.subtitle || item?.short_description || fallback?.description || "",
    price: item?.price ?? fallback?.price ?? fallback?.current_price ?? fallback?.sale_price ?? null,
    currency_id: item?.currency_id || fallback?.currency_id || "BRL",
    original_price: item?.original_price ?? fallback?.original_price ?? fallback?.previous_price ?? fallback?.list_price ?? null,
    permalink: item?.permalink || fallback?.permalink || permalinkOf(id),
    thumbnail: item?.thumbnail || pictures?.[0]?.secure_url || pictures?.[0]?.url || fallback?.thumbnail || null,
    installments: {
      quantity: installments?.quantity ?? 0,
      amount: installments?.amount ?? 0,
      rate: installments?.rate ?? 0
    },
    seller_id: item?.seller_id || fallback?.seller_id || null,
    category_id: item?.category_id || fallback?.category_id || null,
    shipping: item?.shipping || fallback?.shipping || {}
  };
}

async function enrichOne(req, fallback) {
  const id = itemIdOf(fallback);
  if (!id) return normalize(null, fallback);
  const [itemResult, descResult] = await Promise.all([
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}`),
    meliFetch(req, `${MeliApi}/items/${encodeURIComponent(id)}/description`)
  ]);
  const item = itemResult.response.ok ? itemResult.data : null;
  const description = descResult.response.ok && descResult.data && typeof descResult.data === "object"
    ? (descResult.data.plain_text || descResult.data.text || descResult.data.description || "") : "";
  return normalize(item, fallback, description);
}

async function enrich(req, results) {
  const settled = await Promise.allSettled(results.map(item => enrichOne(req, item)));
  return settled.map((result, index) => result.status === "fulfilled" ? result.value : normalize(null, results[index]));
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
  for (const test of tests) {
    if (test.requiresAuth && !req.headers.authorization) {
      results.push({ name: test.name, skipped: true, reason: "Authorization não informado", url: test.url });
      continue;
    }
    const { response, data } = await meliFetch(req, test.url, { useAuth: test.useAuth, publicFallback: false });
    results.push({
      name: test.name,
      url: test.url,
      authenticated: test.useAuth && Boolean(req.headers.authorization),
      status: response.status,
      ok: response.ok,
      result_count: Array.isArray(data?.results) ? data.results.length : null,
      error: response.ok ? null : data
    });
  }
  return { query: term, has_authorization: Boolean(req.headers.authorization), results };
}

async function searchWithFallback(req, q, limit) {
  const first = await publicSearch(req, q, limit);
  const publicResults = first.response.ok && Array.isArray(first.data?.results) ? first.data.results : [];
  if (publicResults.length > 0) return { ok: true, data: { ...first.data, results: await enrich(req, publicResults), search_source: "search_with_item_enrichment" } };
  const fallback = await catalogSearch(req, q, limit);
  if (fallback.response.ok && Array.isArray(fallback.data?.results) && fallback.data.results.length > 0) return { ok: true, data: fallback.data };
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
  return { results, paging: { total: results.length, offset: 0, limit }, search_source: "general_search_with_catalog_fallback" };
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
