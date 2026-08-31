const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const RESOLVER_VERSION = '2026.08.28.05';

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

function unwrapAccountVerification(value) {
  try {
    const parsed = new URL(value);
    if (!/\/gz\/account-verification/i.test(parsed.pathname)) return null;
    const go = cleanUrl(parsed.searchParams.get('go'));
    return isProductUrl(go) ? go : null;
  } catch {
    return null;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function findProductUrl(html, baseUrl) {
  const source = String(html || '');
  const candidates = [];
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
      try {
        const absolute = new URL(raw, baseUrl).toString();
        if (isProductUrl(absolute)) candidates.push(absolute);
      } catch {}
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

function parseJsonLd(html) {
  const objects = [];
  const scripts = String(html || '').matchAll(/<script[^>]+type=[\"']application\/ld\+json[\"'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const value = JSON.parse(match[1].trim());
      const list = Array.isArray(value) ? value : Array.isArray(value?.['@graph']) ? value['@graph'] : [value];
      objects.push(...list.filter(Boolean));
    } catch {}
  }
  return objects;
}

function extractProductData(html, productUrl, productId) {
  const jsonLd = parseJsonLd(html);
  const productJson = jsonLd.find(item => {
    const type = item?.['@type'];
    return type === 'Product' || (Array.isArray(type) && type.includes('Product'));
  }) || {};
  const offers = Array.isArray(productJson.offers) ? productJson.offers[0] : (productJson.offers || {});
  const title = firstString(
    productJson.name,
    getMeta(html, ['og:title', 'twitter:title']).replace(/\s*\|\s*Mercado Livre.*$/i, '')
  );
  const image = firstString(
    Array.isArray(productJson.image) ? productJson.image[0] : productJson.image,
    getMeta(html, ['og:image', 'twitter:image'])
  );
  const price = asNumber(offers.price)
    ?? asNumber(getMeta(html, ['product:price:amount', 'og:price:amount']))
    ?? extractStateNumber(html, ['current_price', 'sale_price', 'price_amount', 'price']);
  const previousPrice = extractStateNumber(html, ['original_price', 'previous_price', 'old_price', 'list_price']);
  const installments = extractStateNumber(html, ['installments_number', 'installment_quantity', 'installments']);
  const installmentAmount = extractStateNumber(html, ['installment_amount', 'installments_amount']);
  return {
    id: productId || '',
    url: productUrl || '',
    title,
    category: '',
    image,
    price,
    previousPrice: previousPrice && (!price || previousPrice > price) ? previousPrice : null,
    installments: installments || null,
    installmentAmount: installmentAmount || null,
    currency: firstString(offers.priceCurrency, getMeta(html, ['product:price:currency', 'og:price:currency']), 'BRL'),
    source: title || price !== null ? 'mercadolivre-page' : 'not-found'
  };
}

async function follow(url) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept-language': 'pt-BR,pt;q=0.9',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
}

async function fetchJson(url) {
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

async function enrichCatalog(productId) {
  if (!productId) return {};
  const product = await fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}`);
  if (!product) return {};
  return {
    title: firstString(product.name, product.title),
    category: firstString(product.category_id, product.domain_id),
    image: firstString(product.pictures?.[0]?.secure_url, product.pictures?.[0]?.url, product.thumbnail)
  };
}

function mergeProduct(pageProduct, catalogProduct) {
  return {
    ...pageProduct,
    title: pageProduct.title || catalogProduct.title || '',
    category: pageProduct.category || catalogProduct.category || '',
    image: pageProduct.image || catalogProduct.image || ''
  };
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
    const firstHtml = await first.text();
    let productUrl = findProductUrl(socialUrl, socialUrl) || findProductUrl(firstHtml, socialUrl);

    if (!productUrl) {
      return res.status(200).json({ ok: false, affiliateUrl: parsed.toString(), socialUrl, productUrl: null, productId: null, resolverVersion: RESOLVER_VERSION, message: 'O link foi resolvido até a página intermediária, mas o anúncio ainda não foi localizado automaticamente.' });
    }

    const locatedProductUrl = productUrl;
    const productResponse = await follow(productUrl);
    const redirectedUrl = productResponse.url || productUrl;
    const verificationTarget = unwrapAccountVerification(redirectedUrl);
    const finalProductUrl = verificationTarget || (isProductUrl(redirectedUrl) ? redirectedUrl : locatedProductUrl);

    let productHtml = '';
    try {
      if (verificationTarget) {
        const cleanProductResponse = await follow(verificationTarget);
        const cleanRedirect = cleanProductResponse.url || verificationTarget;
        productHtml = await cleanProductResponse.text();
        if (isProductUrl(cleanRedirect)) productUrl = cleanRedirect;
      } else {
        productHtml = await productResponse.text();
      }
    } catch {}

    const resolvedId = findProductId(finalProductUrl) || findProductId(locatedProductUrl);
    const pageProduct = extractProductData(productHtml, finalProductUrl, resolvedId);
    const catalogProduct = await enrichCatalog(resolvedId);
    const product = mergeProduct(pageProduct, catalogProduct);
    product.id = resolvedId || product.id || '';
    product.url = finalProductUrl;
    product.discount = product.price && product.previousPrice && product.previousPrice > product.price
      ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
      : null;

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
        : 'Anúncio real localizado, mas os dados ainda não foram encontrados na página.'
    });
  } catch (error) {
    return res.status(502).json({ ok: false, affiliateUrl: parsed.toString(), resolverVersion: RESOLVER_VERSION, message: 'Não foi possível resolver ou ler o anúncio do Mercado Livre.', error: String(error?.message || error) });
  }
}
