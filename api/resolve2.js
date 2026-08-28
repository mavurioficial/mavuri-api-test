const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve';
const RESOLVER_VERSION = '2026.08.28.07';

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

function cleanQueryFromProductUrl(productUrl) {
  try {
    const url = new URL(productUrl);
    const marker = url.pathname.match(/^\/([^/]+)\/p\/MLB\d+/i);
    if (!marker?.[1]) return '';
    return decodeURIComponent(marker[1]).replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function titleFromSlug(query) {
  return String(query || '')
    .split(' ')
    .filter(Boolean)
    .map(word => /^(ia|nfc|ip54|gb|mp|ram)$/i.test(word) ? word.toUpperCase() : word)
    .join(' ');
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

function pickPublicResult(results, productId, query) {
  const list = Array.isArray(results) ? results.filter(Boolean) : [];
  const id = String(productId || '').toUpperCase();

  const exactCatalog = list.find(item => String(item.catalog_product_id || '').toUpperCase() === id);
  if (exactCatalog) return exactCatalog;

  const exactPermalink = list.find(item => String(item.permalink || '').toUpperCase().includes(`/P/${id}`));
  if (exactPermalink) return exactPermalink;

  return list
    .map(item => ({ item, score: similarity(query, item.title || item.name || '') }))
    .sort((a, b) => b.score - a.score)[0]?.item || null;
}

async function readJson(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'Mavuri Affiliate Engine/0.1'
      },
      cache: 'no-store'
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function searchPublicCatalog(query, productId) {
  const words = query.split(' ').filter(Boolean);
  const variants = [
    query,
    words.slice(0, 8).join(' '),
    words.slice(0, 6).join(' '),
    words.slice(0, 4).join(' '),
    productId
  ].filter(Boolean);

  for (const term of [...new Set(variants)]) {
    const url = new URL('https://api.mercadolibre.com/sites/MLB/search');
    url.searchParams.set('q', term);
    url.searchParams.set('limit', '50');
    const search = await readJson(url.toString());
    const item = pickPublicResult(search?.results, productId, query);
    if (item) return item;
  }

  return null;
}

async function enrichFromPublicSearch(payload) {
  const product = { ...(payload.product || {}) };
  const productId = String(payload.productId || product.id || '').toUpperCase();
  const query = cleanQueryFromProductUrl(payload.productUrl || product.url || '');

  if (!query) {
    return { ...payload, product, resolverVersion: RESOLVER_VERSION, fallbackUsed: false };
  }

  const item = await searchPublicCatalog(query, productId);

  // Mesmo quando a busca pública não retornar uma oferta, a URL real já traz
  // um título confiável no slug. Preenchemos ao menos esse dado sem inventar preço.
  product.title = firstText(product.title, item?.title, item?.name, titleFromSlug(query));
  product.category = firstText(product.category, item?.category_id);
  product.image = firstText(product.image, item?.thumbnail, item?.secure_thumbnail, item?.pictures?.[0]?.url);
  product.price = firstNumber(product.price, item?.price);
  product.previousPrice = firstNumber(product.previousPrice, item?.original_price);

  const installments = item?.installments || {};
  product.installments = firstNumber(product.installments, installments.quantity, item?.installments_count);
  product.installmentAmount = firstNumber(product.installmentAmount, installments.amount);
  product.currency = firstText(product.currency, item?.currency_id, 'BRL');
  product.source = item ? 'mercadolivre-public-search' : product.title ? 'product-url-slug' : product.source || 'not-found';

  if (product.category && /^MLB\d+$/i.test(product.category)) {
    const category = await readJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(product.category)}`);
    if (category?.name) product.category = category.name;
  }

  product.discount = product.price && product.previousPrice && product.previousPrice > product.price
    ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
    : product.discount ?? null;

  return {
    ...payload,
    product: {
      ...product,
      id: productId || product.id || '',
      url: payload.productUrl || product.url || ''
    },
    resolverVersion: RESOLVER_VERSION,
    fallbackUsed: Boolean(item),
    message: product.title || product.price !== null
      ? item
        ? 'Anúncio real localizado e dados recuperados pela busca pública do Mercado Livre.'
        : 'Anúncio real localizado. Nome recuperado pela URL; outros dados não foram disponibilizados na busca pública.'
      : payload.message
  };
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

    const response = await fetch(url.toString(), {
      headers: { accept: 'application/json' },
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      return res.status(response.status || 502).json({ ...payload, resolverVersion: RESOLVER_VERSION });
    }

    const product = payload.product || {};
    const alreadyLoaded = Boolean(product.title || (product.price !== null && product.price !== undefined));
    const enriched = alreadyLoaded
      ? { ...payload, resolverVersion: RESOLVER_VERSION, fallbackUsed: false }
      : await enrichFromPublicSearch(payload);

    return res.status(200).json(enriched);
  } catch (error) {
    return res.status(502).json({
      ok: false,
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível enriquecer os dados do anúncio.',
      error: String(error?.message || error)
    });
  }
}
