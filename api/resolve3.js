const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve';
const RESOLVER_VERSION = '2026.08.28.13';

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
    const normalized = String(value)
      .replace(/[^0-9,.-]/g, '')
      .replace(/\.(?=\d{3}(?:\D|$))/g, '')
      .replace(',', '.');
    const number = Number(normalized);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function unwrapProductUrl(input) {
  let current = String(input || '').trim();
  for (let i = 0; i < 5 && current; i += 1) {
    try {
      const url = new URL(current);
      const nested = url.searchParams.get('go') || url.searchParams.get('url') || '';
      if (/mercadolivre\.com\.br/i.test(nested) && nested !== current) {
        current = nested;
        continue;
      }
      return current;
    } catch {
      return current;
    }
  }
  return current;
}

function cleanProductUrl(input) {
  const productUrl = unwrapProductUrl(input);
  try {
    const url = new URL(productUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return productUrl;
  }
}

function productIdFromUrl(productUrl) {
  const match = String(productUrl || '').match(/\/p\/(MLB\d+)/i);
  return match?.[1]?.toUpperCase() || '';
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

function getMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const pattern of [
      new RegExp(`<meta[^>]+(?:property|name)=[\"']${escaped}[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']${escaped}[\"'][^>]*>`, 'i')
    ]) {
      const match = String(html || '').match(pattern);
      if (match?.[1]) return match[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
    }
  }
  return '';
}

function extractJsonLd(html) {
  const list = [];
  for (const match of String(html || '').matchAll(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const values = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed];
      list.push(...values.filter(Boolean));
    } catch {}
  }
  return list;
}

function extractPageProduct(html) {
  const objects = extractJsonLd(html);
  const item = objects.find(value => value?.['@type'] === 'Product' || (Array.isArray(value?.['@type']) && value['@type'].includes('Product'))) || {};
  const offers = Array.isArray(item.offers) ? item.offers[0] : (item.offers || {});
  return {
    title: firstText(item.name, getMeta(html, ['og:title', 'twitter:title']).replace(/\s*\|\s*Mercado Livre.*$/i, '')),
    price: firstNumber(offers.price, getMeta(html, ['product:price:amount', 'og:price:amount'])),
    image: firstText(Array.isArray(item.image) ? item.image[0] : item.image, getMeta(html, ['og:image', 'twitter:image'])),
    currency: firstText(offers.priceCurrency, getMeta(html, ['product:price:currency', 'og:price:currency']), 'BRL')
  };
}

async function readDirectProductPage(productUrl) {
  const diagnostics = { attempted: Boolean(productUrl), status: null, finalUrl: '', readable: false, blocked: false };
  if (!productUrl) return { product: {}, diagnostics };
  try {
    const response = await fetch(productUrl, {
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        'accept-language': 'pt-BR,pt;q=0.9',
        accept: 'text/html,application/xhtml+xml',
        referer: 'https://www.google.com/'
      }
    });
    diagnostics.status = response.status;
    diagnostics.finalUrl = response.url || productUrl;
    diagnostics.blocked = response.status === 401 || response.status === 403 || /account-verification/i.test(diagnostics.finalUrl);
    const product = extractPageProduct(await response.text());
    diagnostics.readable = Boolean(product.title || product.price !== null);
    return { product, diagnostics };
  } catch (error) {
    diagnostics.error = String(error?.message || error);
    return { product: {}, diagnostics };
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
  const words = String(query || '').split(' ').filter(Boolean);
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
    const resolver = new URL(BASE_RESOLVER);
    resolver.searchParams.set('url', affiliateUrl);
    const response = await fetch(resolver.toString(), { headers: { accept: 'application/json' }, cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      return res.status(response.status || 502).json({ ...payload, resolverVersion: RESOLVER_VERSION });
    }

    const product = { ...(payload.product || {}) };
    const resolvedUrl = unwrapProductUrl(payload.productUrl || product.url || '');
    const productUrl = cleanProductUrl(resolvedUrl);
    const productId = productIdFromUrl(productUrl) || String(payload.productId || product.id || '').toUpperCase();
    const query = queryFromUrl(productUrl);

    const direct = await readDirectProductPage(productUrl);
    const page = direct.product || {};
    product.title = firstText(page.title, product.title);
    product.price = firstNumber(page.price, product.price);
    product.image = firstText(page.image, product.image);
    product.currency = firstText(page.currency, product.currency, 'BRL');

    // Sempre complementa via API pública quando a página não trouxe todos os campos.
    const needsOfferData = !product.title || product.price === null || product.price === undefined || !product.category || !product.installments;
    const offer = needsOfferData && query ? await searchOffer(query, productId) : null;
    if (offer) {
      product.title = firstText(product.title, offer.title, offer.name);
      product.price = firstNumber(product.price, offer.price);
      product.previousPrice = firstNumber(product.previousPrice, offer.original_price);
      product.installments = firstNumber(product.installments, offer.installments?.quantity, offer.installments_count);
      product.installmentAmount = firstNumber(product.installmentAmount, offer.installments?.amount);
      product.category = await categoryName(firstText(product.category, offer.category_id));
      product.image = firstText(product.image, offer.secure_thumbnail, offer.thumbnail);
      product.currency = firstText(product.currency, offer.currency_id, 'BRL');
      product.source = direct.diagnostics?.readable ? 'direct-page+mercadolibre-search' : 'mercadolibre-public-search';
    }

    product.id = productId || product.id || '';
    product.url = productUrl || payload.productUrl || product.url || '';
    product.discount = product.price && product.previousPrice && product.previousPrice > product.price
      ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
      : null;

    const loaded = [product.title && 'nome', product.category && 'categoria', product.price !== null && product.price !== undefined && 'preço', product.previousPrice !== null && product.previousPrice !== undefined && 'preço anterior', product.installments !== null && product.installments !== undefined && 'parcelas'].filter(Boolean);

    return res.status(200).json({
      ...payload,
      productUrl,
      productId,
      product,
      resolverVersion: RESOLVER_VERSION,
      directPageAttempted: Boolean(direct.diagnostics?.attempted),
      directPageRead: Boolean(direct.diagnostics?.readable),
      directPageDiagnostics: direct.diagnostics,
      offerSearchUsed: Boolean(needsOfferData),
      offerFound: Boolean(offer),
      message: loaded.length ? `Anúncio localizado e dados preenchidos: ${loaded.join(', ')}.` : 'Anúncio localizado, mas os dados do produto não foram encontrados.'
    });
  } catch (error) {
    return res.status(502).json({ ok: false, resolverVersion: RESOLVER_VERSION, message: 'Não foi possível enriquecer os dados do anúncio.', error: String(error?.message || error) });
  }
}
