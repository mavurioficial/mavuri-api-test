const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const RESOLVER_VERSION = '2026.08.28.04';

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function cleanUrl(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function isMercadoLivreHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br') || host === 'meli.la';
  } catch {
    return false;
  }
}

function isProductUrl(value) {
  return isMercadoLivreHost(value) && /\/p\/MLB\d+/i.test(String(value || ''));
}

function findProductId(value) {
  const match = String(value || '').match(/\/p\/(MLB\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function unwrapAccountVerification(value) {
  try {
    const parsed = new URL(value);
    if (!/\/gz\/account-verification/i.test(parsed.pathname)) return null;
    const go = parsed.searchParams.get('go');
    if (!go) return null;
    const target = cleanUrl(go);
    if (!isProductUrl(target)) return null;
    return target;
  } catch {
    return null;
  }
}

function findProductUrl(html, baseUrl) {
  const candidates = [];
  const source = String(html || '');
  const patterns = [
    /https?:\\?\/\\?\/[^\"'<>\\\s]+?\/p\/MLB\d+[^\"'<>\\\s]*/gi,
    /https?:\/\/[^\"'<>\s]+?\/p\/MLB\d+[^\"'<>\s]*/gi,
    /\"permalink\"\s*:\s*\"([^\"]+)\"/gi,
    /\"url\"\s*:\s*\"([^\"]*\/p\/MLB\d+[^\"]*)\"/gi,
    /href=[\"']([^\"']*\/p\/MLB\d+[^\"']*)[\"']/gi
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const raw = cleanUrl(match[1] || match[0]);
      if (!raw) continue;
      try {
        const absolute = new URL(raw, baseUrl).toString();
        if (isProductUrl(absolute)) candidates.push(absolute);
      } catch {
        // ignora candidato inválido
      }
    }
  }

  return unique(candidates)[0] || null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function getMeta(html, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=[\"']${escaped}[\"'][^>]+content=[\"']([^\"']*)[\"'][^>]*>`, 'i'),
      new RegExp(`<meta[^>]+content=[\"']([^\"']*)[\"'][^>]+(?:property|name)=[\"']${escaped}[\"'][^>]*>`, 'i')
    ];
    for (const pattern of patterns) {
      const match = String(html || '').match(pattern);
      if (match?.[1]) return decodeHtml(match[1]);
    }
  }
  return '';
}

function asNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value)
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function firstString(...values) {
  for (const value of values.flat(Infinity)) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractStateNumber(html, keys) {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = String(html || '').match(new RegExp(`[\"']${escaped}[\"']\\s*:\\s*[\"']?([0-9]+(?:[.,][0-9]+)?)[\"']?`, 'i'));
    const value = asNumber(match?.[1]);
    if (value !== null) return value;
  }
  return null;
}

function extractProductData(html, productUrl, productId) {
  const title = getMeta(html, ['og:title', 'twitter:title'])
    .replace(/\s*\|\s*Mercado Livre.*$/i, '')
    .trim();
  const image = getMeta(html, ['og:image', 'twitter:image']);
  const price = asNumber(getMeta(html, ['product:price:amount', 'og:price:amount']))
    ?? extractStateNumber(html, ['price', 'current_price', 'price_amount']);
  const previousPrice = extractStateNumber(html, ['original_price', 'previous_price', 'old_price', 'list_price']);
  const installmentAmount = extractStateNumber(html, ['installment_amount', 'installments_amount']);
  const installments = extractStateNumber(html, ['installments', 'installments_number', 'installment_quantity']);

  return {
    id: productId || '',
    url: productUrl || '',
    title,
    category: '',
    image,
    price,
    previousPrice: previousPrice && (!price || previousPrice > price) ? previousPrice : null,
    discount: price && previousPrice && previousPrice > price
      ? Math.round(((previousPrice - price) / previousPrice) * 100)
      : null,
    installments: installments || null,
    installmentAmount: installmentAmount || null,
    currency: getMeta(html, ['product:price:currency', 'og:price:currency']) || 'BRL',
    source: 'mercadolivre-page'
  };
}

function mergeProductData(base, extra) {
  const price = base.price ?? extra.price ?? null;
  const previousPrice = base.previousPrice ?? extra.previousPrice ?? null;
  return {
    ...base,
    ...extra,
    id: base.id || extra.id || '',
    url: base.url || extra.url || '',
    title: base.title || extra.title || '',
    category: base.category || extra.category || '',
    image: base.image || extra.image || '',
    price,
    previousPrice: previousPrice && (!price || previousPrice > price) ? previousPrice : null,
    installments: base.installments ?? extra.installments ?? null,
    installmentAmount: base.installmentAmount ?? extra.installmentAmount ?? null,
    discount: base.discount ?? extra.discount ?? (price && previousPrice && previousPrice > price ? Math.round(((previousPrice - price) / previousPrice) * 100) : null),
    currency: base.currency || extra.currency || 'BRL',
    source: extra.source || base.source
  };
}

async function follow(url) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; MavuriResolver/1.0)',
      'accept-language': 'pt-BR,pt;q=0.9'
    }
  });
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (compatible; MavuriResolver/1.0)'
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function extractApiProduct(productId, productApi, itemsApi) {
  const items = Array.isArray(itemsApi?.results) ? itemsApi.results : Array.isArray(itemsApi) ? itemsApi : [];
  const normalizedItems = items
    .map(item => item?.body || item)
    .filter(item => item && Number.isFinite(Number(item.price)) && Number(item.price) > 0)
    .sort((a, b) => Number(a.price) - Number(b.price));
  const best = normalizedItems[0] || null;
  const productPicture = Array.isArray(productApi?.pictures)
    ? (productApi.pictures[0]?.secure_url || productApi.pictures[0]?.url || '')
    : '';
  const price = asNumber(best?.price);
  const previousPrice = asNumber(best?.original_price ?? best?.regular_price ?? null);
  return {
    id: productId || '',
    title: firstString(productApi?.name, productApi?.title, best?.title),
    category: firstString(productApi?.category_id, productApi?.domain_id, best?.category_id, best?.domain_id),
    image: productPicture || best?.thumbnail || best?.secure_thumbnail || '',
    price,
    previousPrice: previousPrice && (!price || previousPrice > price) ? previousPrice : null,
    discount: price && previousPrice && previousPrice > price ? Math.round(((previousPrice - price) / previousPrice) * 100) : null,
    installments: asNumber(best?.installments ?? best?.installments_number ?? null),
    installmentAmount: asNumber(best?.installment_amount ?? null),
    currency: firstString(best?.currency_id, productApi?.currency_id, 'BRL'),
    source: normalizedItems.length ? 'mercadolivre-catalog-api' : 'mercadolivre-product-api'
  };
}

async function enrichFromMercadoLivreApi(productId) {
  if (!productId) return {};
  const base = 'https://api.mercadolibre.com';
  const [productApi, itemsApi] = await Promise.all([
    fetchJson(`${base}/products/${encodeURIComponent(productId)}`),
    fetchJson(`${base}/products/${encodeURIComponent(productId)}/items`)
  ]);
  return extractApiProduct(productId, productApi, itemsApi);
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido.' });

  const affiliateUrl = cleanUrl(req.query?.url);
  if (!affiliateUrl) return res.status(400).json({ message: 'Informe o parâmetro url.' });

  let parsed;
  try { parsed = new URL(affiliateUrl); }
  catch { return res.status(400).json({ message: 'URL inválida.' }); }

  if (!isMercadoLivreHost(parsed.toString())) {
    return res.status(400).json({ message: 'Por segurança, somente links do Mercado Livre e meli.la são aceitos.' });
  }

  try {
    const first = await follow(parsed.toString());
    const socialUrl = first.url || parsed.toString();
    const html = await first.text();

    let productUrl = findProductUrl(socialUrl, socialUrl);
    if (!productUrl) productUrl = findProductUrl(html, socialUrl);

    if (!productUrl) {
      return res.status(200).json({
        ok: false,
        affiliateUrl: parsed.toString(),
        socialUrl,
        productUrl: null,
        productId: null,
        resolverVersion: RESOLVER_VERSION,
        message: 'O link foi resolvido até a página intermediária, mas o anúncio ainda não foi localizado automaticamente.'
      });
    }

    const locatedProductUrl = productUrl;
    const productResponse = await follow(productUrl);
    const redirectedUrl = productResponse.url || productUrl;
    const verificationTarget = unwrapAccountVerification(redirectedUrl);
    const finalProductUrl = verificationTarget || (isProductUrl(redirectedUrl) ? redirectedUrl : locatedProductUrl);
    const productHtml = verificationTarget ? '' : await productResponse.text();
    const resolvedId = findProductId(finalProductUrl) || findProductId(locatedProductUrl);

    const pageProduct = extractProductData(productHtml, finalProductUrl, resolvedId);
    const apiProduct = await enrichFromMercadoLivreApi(resolvedId);
    const product = mergeProductData(pageProduct, apiProduct);
    product.url = finalProductUrl;
    product.id = resolvedId || product.id || '';

    return res.status(200).json({
      ok: true,
      affiliateUrl: parsed.toString(),
      socialUrl,
      productUrl: finalProductUrl,
      productId: product.id,
      product,
      resolverVersion: RESOLVER_VERSION,
      verificationBypassed: Boolean(verificationTarget),
      message: product.title || product.price !== null
        ? 'Anúncio real localizado e dados principais encontrados.'
        : 'Anúncio real localizado. O Mercado Livre redirecionou por verificação, então a URL real foi extraída do parâmetro go.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      affiliateUrl: parsed.toString(),
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível resolver ou ler o anúncio do Mercado Livre.',
      error: String(error?.message || error)
    });
  }
}
