const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve3';
const RESOLVER_VERSION = '2026.08.31.03';

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

async function categoryName(categoryId) {
  const id = String(categoryId || '').trim();
  if (!/^MLB\d+$/i.test(id)) return id;
  const category = await readJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(id)}`);
  return category?.name || id;
}

async function enrichResolvedItem(current) {
  const product = { ...(current || {}) };
  const itemId = String(product.itemId || '').trim().toUpperCase();

  // IMPORTANTE: resolve3 já localiza o anúncio correto. Aqui só enriquecemos
  // esse mesmo item. Nunca consultamos /products/{catalogId}/items e nunca
  // escolhemos o menor preço de uma família de anúncios.
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

    // Se houver preço promocional, usa o preço de venda do MESMO anúncio.
    const salePrice = await readJson(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/sale_price?context=channel_marketplace`
    );
    if (salePrice) {
      product.price = firstNumber(salePrice.amount, product.price);
      product.previousPrice = firstNumber(salePrice.regular_amount, product.previousPrice);
      product.currency = firstText(salePrice.currency_id, product.currency, 'BRL');
    }
  }

  product.category = await categoryName(product.category);
  product.discount = product.price && product.previousPrice && product.previousPrice > product.price
    ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
    : null;
  product.source = itemId ? 'resolve3+item-sale-price' : 'resolve3';

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

    // Preserva o resultado escolhido pelo resolve3 e só complementa os dados
    // do itemId que ele próprio encontrou.
    const product = await enrichResolvedItem(payload.product || {});

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
      catalogEnrichment: false,
      itemEnrichment: Boolean(/^MLB\d+$/.test(String(product.itemId || '').trim().toUpperCase())),
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
