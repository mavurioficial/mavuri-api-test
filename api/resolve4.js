const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve3';
const RESOLVER_VERSION = '2026.08.31.02';

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function firstText(...values) {
  for (const value of values.flat(Infinity)) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function firstNumber(...values) {
  for (const value of values.flat(Infinity)) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function titleFromUrl(productUrl) {
  try {
    const url = new URL(productUrl);
    const match = url.pathname.match(/^\/([^/]+)\/p\/MLB\d+/i);
    if (!match?.[1]) return '';
    return decodeURIComponent(match[1])
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
}

async function readJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function chooseOffer(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  const candidates = list.filter(Boolean);
  if (!candidates.length) return null;

  return candidates
    .filter(item => firstNumber(item.price, item.current_price) !== null)
    .sort((a, b) => firstNumber(a.price, a.current_price) - firstNumber(b.price, b.current_price))[0]
    || candidates[0];
}

async function categoryName(categoryId) {
  const id = String(categoryId || '').trim();
  if (!/^MLB\d+$/i.test(id)) return id;
  const category = await readJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(id)}`);
  return category?.name || id;
}

async function enrichCatalog(productId, productUrl, current) {
  const product = { ...(current || {}) };
  const id = String(productId || '').trim().toUpperCase();

  if (/^MLB\d+$/.test(id)) {
    const catalog = await readJson(`https://api.mercadolibre.com/products/${encodeURIComponent(id)}`);
    if (catalog) {
      product.title = firstText(catalog.name, catalog.title, product.title);
      product.category = firstText(catalog.category_id, product.category);
      product.image = firstText(
        catalog.pictures?.[0]?.secure_url,
        catalog.pictures?.[0]?.url,
        catalog.thumbnail,
        product.image
      );
      product.currency = firstText(catalog.currency_id, product.currency, 'BRL');

      const winner = catalog.buy_box_winner || {};
      product.itemId = firstText(winner.item_id, winner.id, product.itemId);
      product.price = firstNumber(winner.price, winner.current_price, product.price);
      product.previousPrice = firstNumber(winner.original_price, product.previousPrice);
      product.installments = firstNumber(winner.installments?.quantity, winner.installments_count, product.installments);
      product.installmentAmount = firstNumber(winner.installments?.amount, product.installmentAmount);
      product.category = firstText(winner.category_id, catalog.category_id, product.category);
    }

    const offersPayload = await readJson(`https://api.mercadolibre.com/products/${encodeURIComponent(id)}/items`);
    const offer = chooseOffer(offersPayload);
    if (offer) {
      product.itemId = firstText(offer.item_id, offer.id, product.itemId);
      product.title = firstText(offer.title, offer.name, product.title);
      product.category = firstText(offer.category_id, product.category);
      product.price = firstNumber(offer.price, offer.current_price, product.price);
      product.previousPrice = firstNumber(offer.original_price, offer.originalPrice, product.previousPrice);
      product.installments = firstNumber(offer.installments?.quantity, offer.installments_count, offer.installmentQuantity, product.installments);
      product.installmentAmount = firstNumber(offer.installments?.amount, offer.installmentAmount, product.installmentAmount);
      product.currency = firstText(offer.currency_id, product.currency, 'BRL');
    }
  }

  const itemId = String(product.itemId || '').trim().toUpperCase();
  if (/^MLB\d+$/.test(itemId)) {
    const item = await readJson(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`);
    if (item) {
      product.title = firstText(item.title, product.title);
      product.category = firstText(item.category_id, product.category);
      product.price = firstNumber(item.price, item.current_price, product.price);
      product.previousPrice = firstNumber(item.original_price, product.previousPrice);
      product.currency = firstText(item.currency_id, product.currency, 'BRL');
      product.installments = firstNumber(
        item.installments?.quantity,
        item.installments_count,
        item.installmentQuantity,
        product.installments
      );
      product.installmentAmount = firstNumber(
        item.installments?.amount,
        item.installment_amount,
        item.installmentAmount,
        product.installmentAmount
      );
    }

    const salePrice = await readJson(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`
    );
    if (salePrice) {
      product.price = firstNumber(salePrice.amount, product.price);
      product.previousPrice = firstNumber(salePrice.regular_amount, product.previousPrice);
      product.currency = firstText(salePrice.currency_id, product.currency, 'BRL');
    }
  }

  product.title = firstText(product.title, titleFromUrl(productUrl));
  product.category = await categoryName(product.category);
  product.id = id || product.id || '';
  product.url = productUrl || product.url || '';
  product.currency = firstText(product.currency, 'BRL');
  product.discount = product.price && product.previousPrice && product.previousPrice > product.price
    ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
    : null;
  product.source = 'catalog-product-api+item-sale-price';

  return product;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido.' });

  const affiliateUrl = String(req.query?.url || '').trim();
  if (!affiliateUrl) return res.status(400).json({ message: 'Informe o parâmetro url.' });

  try {
    const url = new URL(BASE_RESOLVER);
    url.searchParams.set('url', affiliateUrl);
    const response = await fetch(url.toString(), { headers: { accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      return res.status(response.status || 502).json({ ...payload, resolverVersion: RESOLVER_VERSION });
    }

    const product = await enrichCatalog(payload.productId, payload.productUrl, payload.product || {});
    const loaded = [
      product.title && 'nome',
      product.category && 'categoria',
      product.price !== null && product.price !== undefined && 'preço',
      product.previousPrice !== null && product.previousPrice !== undefined && 'preço anterior',
      product.discount !== null && product.discount !== undefined && 'desconto',
      product.installments !== null && product.installments !== undefined && 'parcelas'
    ].filter(Boolean);

    return res.status(200).json({
      ...payload,
      product,
      resolverVersion: RESOLVER_VERSION,
      catalogEnrichment: true,
      message: loaded.length
        ? `Anúncio localizado e dados preenchidos: ${loaded.join(', ')}.`
        : 'Anúncio localizado, mas os dados do produto não foram encontrados.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível enriquecer os dados do anúncio.',
      error: String(error?.message || error)
    });
  }
}
