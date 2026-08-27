const MeliApi = "https://api.mercadolibre.com";

function aplicarCors(req, res) {
  const origin = req.headers.origin || "";
  const allowedOrigins = new Set([
    "https://mavurioficial.github.io",
    "https://mavuri-api-test.vercel.app"
  ]);

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type");
}

function send(res, status, data) {
  res.status(status).json(data);
}

async function lerResposta(response) {
  const texto = await response.text();
  try {
    return JSON.parse(texto);
  } catch {
    return {
      message: texto || `Resposta HTTP ${response.status}`,
      raw_response: texto
    };
  }
}

function montarHeaders(req, incluirToken = false) {
  const headers = { Accept: "application/json" };

  if (incluirToken && req.headers.authorization) {
    headers.Authorization = req.headers.authorization;
  }

  return headers;
}

function montarPermalink(itemId) {
  return itemId
    ? `https://produto.mercadolivre.com.br/${itemId}`
    : null;
}

async function buscarItem(itemId) {
  if (!itemId) return null;

  try {
    const response = await fetch(
      `${MeliApi}/items/${encodeURIComponent(itemId)}`,
      { headers: { Accept: "application/json" } }
    );

    const data = await lerResposta(response);
    return response.ok ? data : null;
  } catch {
    return null;
  }
}

function normalizarItem(item, fallback = {}) {
  const installments = item?.installments || fallback?.installments || {};
  const pictures = item?.pictures || fallback?.pictures || [];

  return {
    id: item?.id || fallback?.id || null,
    title:
      item?.title ||
      item?.name ||
      fallback?.title ||
      fallback?.name ||
      fallback?.id ||
      "Produto sem nome",
    description:
      item?.subtitle ||
      item?.short_description ||
      fallback?.description ||
      "",
    price: item?.price ?? fallback?.price ?? null,
    currency_id: item?.currency_id || fallback?.currency_id || "BRL",
    original_price:
      item?.original_price ??
      fallback?.original_price ??
      null,
    permalink:
      item?.permalink ||
      fallback?.permalink ||
      montarPermalink(item?.id || fallback?.id),
    thumbnail:
      item?.thumbnail ||
      pictures?.[0]?.url ||
      fallback?.thumbnail ||
      null,
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

async function enriquecerResultados(results) {
  const enriquecidos = await Promise.all(
    results.map(async resultado => {
      const itemId =
        resultado.id ||
        resultado.item_id ||
        resultado.buy_box_winner?.item_id;

      const item = await buscarItem(itemId);
      return normalizarItem(item, resultado);
    })
  );

  return enriquecidos;
}

async function buscarCatalogo(req, q, limit) {
  if (!req.headers.authorization || !q) {
    return null;
  }

  const url = new URL(`${MeliApi}/products/search`);
  url.searchParams.set("status", "active");
  url.searchParams.set("site_id", "MLB");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.min(limit, 20)));

  const response = await fetch(url, {
    headers: montarHeaders(req, true)
  });
  const data = await lerResposta(response);

  if (!response.ok) {
    return { response, data };
  }

  const produtos = Array.isArray(data.results) ? data.results : [];

  const detalhados = await Promise.all(
    produtos.slice(0, limit).map(async produto => {
      try {
        const detalheResponse = await fetch(
          `${MeliApi}/products/${encodeURIComponent(produto.id)}`,
          { headers: montarHeaders(req, true) }
        );
        const detalhe = await lerResposta(detalheResponse);
        return detalheResponse.ok ? detalhe : produto;
      } catch {
        return produto;
      }
    })
  );

  const resultadosBase = detalhados.map(produto => {
    const winner = produto.buy_box_winner || {};
    const itemId = winner.item_id || produto.id;

    return {
      id: itemId,
      catalog_product_id: produto.id,
      title: produto.name || produto.title || produto.id,
      description: produto.description || "",
      price: winner.price ?? produto.price ?? null,
      currency_id: winner.currency_id || produto.currency_id || "BRL",
      original_price: winner.original_price ?? produto.original_price ?? null,
      permalink:
        produto.permalink ||
        winner.permalink ||
        montarPermalink(winner.item_id),
      thumbnail:
        produto.pictures?.[0]?.url ||
        produto.thumbnail ||
        null,
      installments: winner.installments || produto.installments || {},
      shipping: winner.shipping || produto.shipping || {},
      category_id: winner.category_id || produto.category_id || null,
      seller_id: winner.seller_id || produto.seller_id || null
    };
  });

  const results = await enriquecerResultados(resultadosBase);

  return {
    response,
    data: {
      ...data,
      results,
      search_source: "catalog_fallback"
    }
  };
}

async function buscarGeral(req, limit) {
  const termos = ["oferta", "promoção", "desconto", "mais vendidos"];
  const porTermo = Math.max(1, Math.ceil(limit / termos.length));
  const unicos = new Map();

  for (const termo of termos) {
    const url = new URL(`${MeliApi}/sites/MLB/search`);
    url.searchParams.set("q", termo);
    url.searchParams.set("limit", String(Math.min(porTermo, 20)));

    const response = await fetch(url, {
      headers: montarHeaders(req, false)
    });
    const data = await lerResposta(response);

    if (response.ok) {
      for (const item of Array.isArray(data.results) ? data.results : []) {
        if (item?.id && !unicos.has(item.id)) unicos.set(item.id, item);
      }
      continue;
    }

    if (response.status === 403) {
      const fallback = await buscarCatalogo(req, termo, porTermo);
      if (fallback?.response?.ok) {
        for (const item of fallback.data.results || []) {
          if (item?.id && !unicos.has(item.id)) unicos.set(item.id, item);
        }
      }
    }

    if (unicos.size >= limit) break;
  }

  const base = Array.from(unicos.values()).slice(0, limit);
  const results = await enriquecerResultados(base);

  return {
    results,
    paging: { total: results.length, offset: 0, limit },
    search_source: "general_search"
  };
}

export default async function handler(req, res) {
  aplicarCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  try {
    const action = String(req.query?.action || "").toLowerCase();

    if (action === "me") {
      if (!req.headers.authorization) {
        return send(res, 401, { message: "Access Token não informado." });
      }

      const response = await fetch(`${MeliApi}/users/me`, {
        headers: montarHeaders(req, true)
      });
      const data = await lerResposta(response);
      return send(res, response.status, data);
    }

    if (action === "search") {
      const q = String(req.query?.q || "").trim();
      const requestedLimit = Number.parseInt(req.query?.limit || "20", 10);
      const limit = Math.min(
        Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 20, 1),
        50
      );

      if (!q) {
        const geral = await buscarGeral(req, limit);
        return send(res, 200, geral);
      }

      const url = new URL(`${MeliApi}/sites/MLB/search`);
      url.searchParams.set("q", q);
      url.searchParams.set("limit", String(limit));

      const response = await fetch(url, {
        headers: montarHeaders(req, false)
      });
      const data = await lerResposta(response);

      if (response.ok) {
        const results = await enriquecerResultados(
          Array.isArray(data.results) ? data.results : []
        );
        return send(res, response.status, { ...data, results });
      }

      if (response.status !== 403) {
        return send(res, response.status, data);
      }

      const fallback = await buscarCatalogo(req, q, limit);

      if (fallback?.response?.ok) {
        return send(res, 200, fallback.data);
      }

      return send(res, response.status, {
        ...data,
        catalog_fallback: fallback?.data || null
      });
    }

    if (action === "categories") {
      if (!req.headers.authorization) {
        return send(res, 401, { message: "Access Token não informado." });
      }

      const response = await fetch(`${MeliApi}/sites/MLB/categories`, {
        headers: montarHeaders(req, true)
      });

      const data = await lerResposta(response);
      return send(res, response.status, data);
    }

    return send(res, 400, {
      message: "Ação inválida.",
      actions: ["me", "search", "categories"]
    });
  } catch (error) {
    console.error("Erro no proxy Mercado Livre:", error);

    return send(res, 500, {
      message: "Erro interno ao consultar a API do Mercado Livre.",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
