const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve3';
const RESOLVER_VERSION = '2026.08.31.04';

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

async function enrichExactCatalogProduct(product) {
  const current = { ...(product || {}) };
  const productId = String(current.id || current.productId || '').trim().toUpperCase();
  if (!/^MLB\d+$/.test(productId)) return current;

  const catalog = await readJson(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}`);
  if (!catalog) return current;

  const winner = catalog.buy_box_winner || {};

  // O ID recebido do link é a página de produto exata. Quando o HTML estiver
  // bloqueado por account-verification, usamos somente o vencedor dessa mesma
  // página de catálogo. Nunca procuramos o menor preço de uma família diferente.
  current.title = firstText(current.title, catalog.name, catalog.family_name);
  current.category = firstText(current.category, catalog.category_id, catalog.domain_id);
  current.image = firstText(current.image, catalog.pictures?.[0]?.secure_url, catalog.pictures?.[0]?.url, catalog.thumbnail);
  current.price = firstNumber(current.price, winner.price, catalog.price);
  current.previousPrice = firstNumber(current.previousPrice, winner.original_price);
  current.currency = firstText(current.currency, winner.currency_id, catalog.currency_id, 'BRL');
  current.itemId = firstText(current.itemId, winner.item_id);
  current.catalogProductId = productId;
  current.catalogFallback = true;

  if (current.price !== null && current.previousPrice !== null && current.previousPrice <= current.price) {
    current.previousPrice = null;
  }

  current.discount = current.price && current.previousPrice && current.previousPrice > current.price
    ? Math.round(((current.previousPrice - current.price) / current.previousPrice) * 100)
    : null;

  return current;
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
      return res.status(response.status || 502).json({
        ...payload,
        resolverVersion: RESOLVER_VERSION
      });
    }

    let product = { ...(payload.product || {}) };

    // REGRA CRÍTICA:
    // preço extraído de uma página bloqueada/account-verification NÃO é confiável.
    // Nunca aceitamos o primeiro número encontrado no HTML de uma página de bloqueio.
    const pageBlocked = payload.directPageRead === false || payload.directPageDiagnostics?.blocked === true;
    if (pageBlocked) {
      product.price = null;
      product.previousPrice = null;
      product.installments = null;
      product.installmentAmount = null;
    }

    product = await enrichExactCatalogProduct({
      ...product,
      id: firstText(product.id, payload.productId)
    });

    const loaded = [
      product.title && 'nome',
      product.category && 'categoria',
      product.price !== null && product.price !== undefined && 'preço',
      product.previousPrice !== null && product.previousPrice !== undefined && 'preço anterior',
      product.installments !== null && product.installments !== undefined && 'parcelas'
    ].filter(Boolean);

    return res.status(200).json({
      ...payload,
      product,
      resolverVersion: RESOLVER_VERSION,
      catalogFallback: Boolean(product.catalogFallback),
      message: loaded.length
        ? `Anúncio localizado e dados preenchidos: ${loaded.join(', ')}.`
        : 'Anúncio localizado, mas os dados do produto não foram encontrados.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível localizar e preencher os dados do anúncio.',
      error: String(error?.message || error)
    });
  }
}
