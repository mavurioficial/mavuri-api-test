const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve3';
const RESOLVER_VERSION = '2026.08.31.05';

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

async function enrichFromCatalogSearch(product) {
  const current = { ...(product || {}) };
  const productId = String(current.id || current.productId || '').trim().toUpperCase();
  if (!/^MLB\d+$/.test(productId)) return current;

  // Quando o HTML da PDP é bloqueado, não usamos números da página de bloqueio.
  // Consultamos somente itens associados ao MESMO catalog_product_id.
  // A busca mantém a ordenação de relevância do Mercado Livre; não usamos
  // price_asc e nunca escolhemos artificialmente o menor preço.
  const search = await readJson(
    `https://api.mercadolibre.com/sites/MLB/search?catalog_product_id=${encodeURIComponent(productId)}&limit=10`
  );

  const results = Array.isArray(search?.results) ? search.results : [];
  const exact = results.filter(item => String(item?.catalog_product_id || '').toUpperCase() === productId);
  const winner = exact[0] || results[0];
  if (!winner) return current;

  current.title = firstText(current.title, winner.title);
  current.category = firstText(current.category, winner.category_id);
  current.image = firstText(current.image, winner.thumbnail, winner.pictures?.[0]?.url);
  current.price = firstNumber(winner.price, current.price);
  current.previousPrice = firstNumber(winner.original_price, current.previousPrice);
  current.currency = firstText(winner.currency_id, current.currency, 'BRL');
  current.installments = firstNumber(winner.installments?.quantity, winner.installments_quantity);
  current.installmentAmount = firstNumber(winner.installments?.amount, winner.installment_amount);
  current.itemId = firstText(winner.id, current.itemId);
  current.catalogProductId = productId;
  current.catalogFallback = true;
  current.catalogFallbackSource = 'catalog_product_search_relevance';

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
    const pageBlocked = payload.directPageRead === false || payload.directPageDiagnostics?.blocked === true;

    // Números encontrados na página de account-verification são lixo para nós.
    // Se a leitura real da página não aconteceu, zera os campos antes do fallback.
    if (pageBlocked) {
      product.price = null;
      product.previousPrice = null;
      product.installments = null;
      product.installmentAmount = null;
    }

    if (pageBlocked || product.price === null || product.price === undefined) {
      product = await enrichFromCatalogSearch({
        ...product,
        id: firstText(product.id, payload.productId)
      });
    }

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
