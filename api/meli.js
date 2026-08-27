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

  // Alguns recursos públicos do Mercado Livre respondem 403 para o token
  // utilizado na aplicação. Nessa situação tentamos a mesma consulta sem token.
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
  // Evita que uma falha em um produto derrube todos os demais.
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
  if (!q) return { response: { ok: false, status: 400 }, data: null };
  const url = new URL(`${MeliApi}/products/search`);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", "MLB");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 20)));

  const { response, data } = await meliFetch(req, url.toString(), { publicFallback: false });
  if (!response.ok) return { response, data };

  const products = Array.isArray(data?.results) ? data.results : [];
  const base = products.slice(0, limit).map(product => {
    const winner = product?.buy_box_winner || {};
    const id = winner.item_id || product.item_id || null;
    return {
      id,
      title: product.name || product.title || id || product.id,
      price: winner.price ?? product.price ?? null,
      original_price: winner.original_price ?? product.original_price ?? null,
      permalink: winner.permalink || product.permalink || permalinkOf(id),
      thumbnail: product?.pictures?.[0]?.url || product.thumbnail || null,
      installments: winner.installments || product.installments || {}
    };
  }).filter(item => item.id);

  return { response: { ok: true, status: 200 }, data: { results: await enrich(req, base), search_source: "catalog_fallback" } };
}

async function generalSearch(req, limit) {
  const terms = ["oferta", "promoção", "desconto", "mais vendidos"];
  const unique = new Map();
  const each = Math.max(1, Math.ceil(limit / terms.length));

  for (const term of terms) {
    const { response, data } = await publicSearch(req, term, each);
    if (response.ok) {
      for (const item of Array.isArray(data?.results) ? data.results : []) {
        if (item?.id && !unique.has(item.id)) unique.set(item.id, item);
      }
    }
    if (unique.size >= limit) break;
  }

  const base = Array.from(unique.values()).slice(0, limit);
  return {
    results: await enrich(req, base),
    paging: { total: base.length, offset: 0, limit },
    search_source: "general_search"
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

      // Primeiro usa a busca pública. Se a infraestrutura do Meli bloquear,
      // tenta o catálogo autenticado e depois enriquece cada item real.
      const first = await publicSearch(req, q, limit);
      if (first.response.ok) {
        const base = Array.isArray(first.data?.results) ? first.data.results : [];
        const results = await enrich(req, base);
        return send(res, 200, { ...first.data, results, search_source: "search_with_item_enrichment" });
      }

      const fallback = await catalogSearch(req, q, limit);
      if (fallback.response.ok) return send(res, 200, fallback.data);

      return send(res, first.response.status, {
        ...first.data,
        catalog_fallback: fallback.data || null,
        diagnostic: { public_status: first.response.status, catalog_status: fallback.response.status || null }
      });
    }

    return send(res, 400, { message: "Ação inválida.", actions: ["me", "search", "categories"] });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);
    return send(res, 500, { message: "Erro interno ao consultar a API do Mercado Livre.", error: error instanceof Error ? error.message : String(error) });
  }
}
