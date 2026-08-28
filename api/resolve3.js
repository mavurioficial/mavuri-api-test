const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve';
const RESOLVER_VERSION = '2026.08.28.11';

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

function queryFromUrl(productUrl) {
  try {
    const url = new URL(productUrl);
    const match = url.pathname.match(/^\/([^/]+)\/p\/MLB\d+/i);
    return match?.[1]
      ? decodeURIComponent(match[1]).replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
      : '';
  } catch {
    return '';
  }
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function similarity(a, b) {
  const left = new Set(normalize(a).split(' ').filter(Boolean));
  const right = new Set(normalize(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const word of left) if (right.has(word)) hits += 1;
  return hits / Math.max(left.size, right.size);
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

function pickResult(results, productId, query) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const id = String(productId || '').toUpperCase();
  return list.find(item => String(item.catalog_product_id || '').toUpperCase() === id) ||
    list.find(item => String(item.permalink || '').toUpperCase().includes(`/P/${id}`)) ||
    list.map(item => ({ item, score: similarity(query, item.title || item.name || '') }))
      .sort((a, b) => b.score - a.score)[0]?.item || null;
}

async function searchOffer(query, productId) {
  const words = query.split(' ').filter(Boolean);
  const terms = [...new Set([
    query,
    words.slice(0, 8).join(' '),
    words.slice(0, 6).join(' '),
    words.slice(0, 4).join(' ')
  ].filter(Boolean))];

  for (const term of terms) {
    const url = new URL('https://api.mercadolibre.com/sites/MLB/search');
    url.searchParams.set('q', term);
    url.searchParams.set('limit', '50');
    const payload = await readJson(url.toString());
    const item = pickResult(payload?.results, productId, query);
    if (item) return item;
  }
  return null;
}

async function categoryName(categoryId) {
  if (!/^MLB\d+$/i.test(String(categoryId || ''))) return categoryId || '';
  const category = await readJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`);
  return category?.name || categoryId;
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido.' });

  const affiliateUrl = String(req.query?.url || '').trim();
  if (!affiliateUrl) return res.status(400).json({ message: 'Informe o parâmetro url.' });

  try {
    const baseUrl = new URL(BASE_RESOLVER);
    baseUrl.searchParams.set('url', affiliateUrl);
    const response = await fetch(baseUrl.toString(), { headers: { accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      return res.status(response.status || 502).json({ ...payload, resolverVersion: RESOLVER_VERSION });
    }

    const product = { ...(payload.product || {}) };
    const productId = String(payload.productId || product.id || '').toUpperCase();
    const query = queryFromUrl(payload.productUrl || product.url || '');

    // IMPORTANTE: não usamos mais "tem título" como sinal de sucesso.
    // O resolver base normalmente consegue o nome pelo catálogo, mas preço e
    // categoria continuam vazios. A busca deve rodar sempre que faltar preço.
    const needsOfferData = product.price === null || product.price === undefined || !product.category || !product.installments;
    const offer = needsOfferData && query ? await searchOffer(query, productId) : null;

    if (offer) {
      product.title = firstText(product.title, offer.title, offer.name);
      const categoryId = firstText(product.category, offer.category_id);
      product.category = await categoryName(categoryId);
      product.image = firstText(product.image, offer.secure_thumbnail, offer.thumbnail);
      product.price = firstNumber(product.price, offer.price);
      product.previousPrice = firstNumber(product.previousPrice, offer.original_price);
      const installments = offer.installments || {};
      product.installments = firstNumber(product.installments, installments.quantity, offer.installments_count);
      product.installmentAmount = firstNumber(product.installmentAmount, installments.amount);
      product.currency = firstText(product.currency, offer.currency_id, 'BRL');
      product.source = 'mercadolivre-public-search';
    }

    product.id = productId || product.id || '';
    product.url = payload.productUrl || product.url || '';
    product.discount = product.price && product.previousPrice && product.previousPrice > product.price
      ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
      : null;

    const loaded = [
      product.title ? 'nome' : '',
      product.category ? 'categoria' : '',
      product.price !== null && product.price !== undefined ? 'preço' : '',
      product.previousPrice !== null && product.previousPrice !== undefined ? 'preço anterior' : '',
      product.installments !== null && product.installments !== undefined ? 'parcelas' : ''
    ].filter(Boolean);

    return res.status(200).json({
      ...payload,
      product,
      resolverVersion: RESOLVER_VERSION,
      offerSearchUsed: Boolean(needsOfferData),
      offerFound: Boolean(offer),
      message: loaded.length
        ? `Anúncio localizado e dados preenchidos: ${loaded.join(', ')}.`
        : 'Anúncio localizado, mas a busca pública não encontrou uma oferta correspondente.'
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
