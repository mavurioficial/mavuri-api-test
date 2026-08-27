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

function authHeaders(req) {
  const headers = { Accept: "application/json" };
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  return headers;
}

async function meliFetch(req, url, { publicFallback = true } = {}) {
  let response = await fetch(url, { headers: authHeaders(req), cache: "no-store" });
  let data = await lerResposta(response);

  if (publicFallback && !response.ok && req.headers.authorization && (response.status === 401 || response.status === 403)) {
    response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
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
    ? (descResult.data.plain_text || descResult.data.text || descResult.data.description || "")
    : "";

  return normalize(item, fallback, description);
}

async function enrich(req, results) {
  const settled = await Promise.allSettled(results.map(item => enrichOne(req, item)));
  return settled.map((result, index) =>
    result.status === "fulfilled" ? result.value : normalize(null, results[index])
  );
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

  const { response, data } = await meliFetch(req, url.toString(), { publicFallback: false });
  if (!response.ok) return { response, data };

  const products = Array.isArray(data?.results) ? data.results : [];

  // A busca de catálogo pode devolver somente o ID do produto de catálogo.
  // Consultamos cada produto para obter o buy_box_winner e o item MLB real.
  const detailed = await Promise.allSettled(products.slice(0, limit).map(async product => {
    if (!product?.id) return product;
    const detail = await meliFetch(
      req,
      `${MeliApi}/products/${encodeURIComponent(product.id)}`,
      { publicFallback: false }
    );
    return detail.response.ok && detail.data && typeof detail.data === "object" ? detail.data : product;
  }));

  const base = detailed.map((entry, index) =>
    entry.status === "fulfilled" ? entry.value : products[index]
  ).map(product => {
    const winner = product?.buy_box_winner || {};
    const id = winner.item_id || product?.item_id || null;
    return {
      id,
      catalog_product_id: product?.id || null,
      title: product?.name || product?.title || id || product?.id,
      description: product?.description || "",
      price: winner.price ?? product?.price ?? null,
      original_price: winner.original_price ?? product?.original_price ?? null,
      permalink: winner.permalink || product?.permalink || permalinkOf(id),
      thumbnail: product?.pictures?.[0]?.secure_url || product?.pictures?.[0]?.url || product?.thumbnail || null,
      installments: winner.installments || product?.installments || {},
      shipping: winner.shipping || product?.shipping || {},
      category_id: winner.category_id || product?.category_id || null,
      seller_id: winner.seller_id || product?.seller_id || null
    };
  }).filter(item => item.id);

  const results = await enrich(req, base);
  return {
    response: { ok: true, status: 200 },
    data: { ...data, results, paging: { total: results.length, offset: 0, limit }, search_source: "catalog_fallback" }
  };
}

async function searchWithFallback(req, q, limit) {
  const first = await publicSearch(req, q, limit);
  const publicResults = first.response.ok && Array.isArray(first.data?.results) ? first.data.results : [];

  // Não tratamos HTTP 200 vazio como sucesso definitivo: esse foi exatamente
  // o cenário que fez a interface voltar a mostrar "Nenhuma oferta encontrada".
  if (publicResults.length > 0) {
    const results = await enrich(req, publicResults);
    return { ok: true, data: { ...first.data, results, search_source: "search_with_item_enrichment" } };
  }

  const fallback = await catalogSearch(req, q, limit);
  if (fallback.response.ok && Array.isArray(fallback.data?.results) && fallback.data.results.length > 0) {
    return { ok: true, data: fallback.data };
  }

  if (first.response.ok) {
    return { ok: true, data: { ...first.data, results: [], search_source: "public_empty_and_catalog_empty" } };
  }

  return {
    ok: false,
    status: first.response.status,
    data: {
      ...first.data,
      catalog_fallback: fallback.data || null,
      diagnostic: { public_status: first.response.status, catalog_status: fallback.response.status || null }
    }
  };
}

async function generalSearch(req, limit) {
  const terms = ["oferta", "promoção", "desconto", "mais vendidos"];
  const unique = new Map();
  const each = Math.max(1, Math.ceil(limit / terms.length));

  for (const term of terms) {
    const result = await searchWithFallback(req, term, each);
    if (result.ok) {
      for (const item of Array.isArray(result.data?.results) ? result.data.results : []) {
        if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
      }
    }
    if (unique.size >= limit) break;
  }

  const results = Array.from(unique.values()).slice(0, limit);
  return {
    results,
    paging: { total: results.length, offset: 0, limit },
    search_source: "general_search_with_catalog_fallback"
  };
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

    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      const requested = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 20, 1), 50);

      if (!q) return send(res, 200, await generalSearch(req, limit));

      const result = await searchWithFallback(req, q, limit);
      if (result.ok) return send(res, 200, result.data);
      return send(res, result.status || 502, result.data);
    }

    return send(res, 400, { message: "Ação inválida.", actions: ["me", "search", "categories"] });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);
    return send(res, 500, { message: "Erro interno ao consultar a API do Mercado Livre.", error: error instanceof Error ? error.message : String(error) });
  }
}
