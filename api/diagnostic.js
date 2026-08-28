const MeliApi = "https://api.mercadolibre.com";
const APP_LOGIC = "2026.08.28.03";

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

function winnerSummary(winner) {
  return winner && typeof winner === "object" ? {
    item_id: winner.item_id || null,
    price: winner.price ?? null,
    currency_id: winner.currency_id || null,
    category_id: winner.category_id || null,
    seller_id: winner.seller_id || null,
    shipping: winner.shipping || null
  } : null;
}

function productSummary(product) {
  return {
    id: product?.id || null,
    name: product?.name || product?.title || null,
    status: product?.status || null,
    domain_id: product?.domain_id || null,
    parent_id: product?.parent_id || null,
    children_ids: Array.isArray(product?.children_ids) ? product.children_ids : [],
    buy_box_winner: winnerSummary(product?.buy_box_winner)
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

async function probeCatalogProduct(req, product) {
  const productId = product?.id;
  if (!productId) return null;

  const detail = await call(req, `${MeliApi}/products/${encodeURIComponent(productId)}`, true);
  const detailData = detail.response.ok ? detail.data : null;
  const childIds = Array.isArray(detailData?.children_ids) ? detailData.children_ids.slice(0, 5) : [];

  const children = [];
  for (const childId of childIds) {
    const child = await call(req, `${MeliApi}/products/${encodeURIComponent(childId)}`, true);
    const childData = child.response.ok ? child.data : null;
    const winner = childData?.buy_box_winner;
    const entry = {
      id: childId,
      status: child.response.status,
      ok: child.response.ok,
      product: childData ? productSummary(childData) : null,
      error: child.response.ok ? null : child.data
    };
    if (winner?.item_id) entry.real_item_probe = await probeRealItem(req, winner.item_id);
    children.push(entry);
  }

  const offers = await call(req, `${MeliApi}/products/${encodeURIComponent(productId)}/items`, true);
  const offerResults = Array.isArray(offers.data?.results) ? offers.data.results : [];
  const sampleOffer = offerResults.find(x => typeof x?.item_id === "string" && /^MLB\d+$/.test(x.item_id)) || null;

  const result = {
    name: "catalog_product_probe",
    product: productSummary(product),
    detail: {
      status: detail.response.status,
      ok: detail.response.ok,
      summary: detailData ? productSummary(detailData) : null,
      error: detail.response.ok ? null : detail.data
    },
    children_probed: children,
    product_items: {
      status: offers.response.status,
      ok: offers.response.ok,
      result_count: offerResults.length,
      sample_offer: sampleOffer ? {
        item_id: sampleOffer.item_id,
        price: sampleOffer.price ?? null,
        original_price: sampleOffer.original_price ?? sampleOffer.regular_amount ?? null,
        currency_id: sampleOffer.currency_id || null
      } : null,
      error: offers.response.ok ? null : offers.data
    }
  };

  if (detailData?.buy_box_winner?.item_id) result.detail_winner_probe = await probeRealItem(req, detailData.buy_box_winner.item_id);
  if (sampleOffer?.item_id) result.real_item_probe = await probeRealItem(req, sampleOffer.item_id);
  return result;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  try {
    const q = String(req.query?.q || "tv").trim() || "tv";
    const hasAuthorization = Boolean(req.headers.authorization);
    const results = [];
    let authenticatedProductsSample = [];

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
      authenticatedProductsSample = products.response.ok && Array.isArray(products.data?.results)
        ? products.data.results.slice(0, 5)
        : [];
      results.push({
        name: "products_search_authenticated",
        status: products.response.status,
        ok: products.response.ok,
        result_count: count(products.data),
        paging: products.response.ok ? products.data?.paging || null : null,
        error: products.response.ok ? null : products.data
      });

      if (products.response.ok && Array.isArray(products.data?.results)) {
        for (const product of products.data.results.slice(0, 5)) {
          const probe = await probeCatalogProduct(req, product);
          if (probe) results.push(probe);
        }
      }

      results.push({ name: "documented_real_item_probe", ...(await probeRealItem(req, "MLB1828680414")) });
    }

    return res.status(200).json({
      app_logic: APP_LOGIC,
      query: q,
      has_authorization: hasAuthorization,
      authenticated_products_sample: authenticatedProductsSample,
      results
    });
  } catch (error) {
    return res.status(500).json({ app_logic: APP_LOGIC, message: "Erro no diagnóstico.", error: error instanceof Error ? error.message : String(error) });
  }
}
