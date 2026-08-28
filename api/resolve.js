const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

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
    if (typeof value === 'string') {
      const normalized = value
        .replace(/[^0-9,.-]/g, '')
        .replace(/\.(?=\d{3}(?:\D|$))/g, '')
        .replace(',', '.');
      const number = Number(normalized);
      if (Number.isFinite(number)) return number;
      continue;
    }
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function findProductUrl(html, baseUrl) {
  const source = String(html || '');
  const patterns = [
    /https?:\\?\/\\?\/[^\"'<>\\\s]+?\/p\/MLB\d+[^\"'<>\\\s]*/gi,
    /https?:\/\/[^\"'<>\s]+?\/p\/MLB\d+[^\"'<>\s]*/gi,
    /\"url\"\s*:\s*\"([^\"]*\/p\/MLB\d+[^\"]*)\"/gi,
    /href=[\"']([^\"']*\/p\/MLB\d+[^\"']*)[\"']/gi
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const raw = cleanUrl(match[1] || match[0]);
      try {
        const absolute = new URL(raw, baseUrl).toString();
        if (isProductUrl(absolute)) return absolute;
      } catch {}
    }
  }
  return null;
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

function parseJsonBlocks(html) {
  const values = [];
  const source = String(html || '');
  const scriptPattern = /<script[^>]*type=[\"']application\/(?:ld\+json|json)[\"'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of source.matchAll(scriptPattern)) {
    try { values.push(JSON.parse(match[1].trim())); } catch {}
  }
  const assignmentPatterns = [
    /__PRELOADED_STATE__\s*=\s*({[\s\S]*?});<\/script>/i,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?});/i,
    /__NEXT_DATA__[^>]*>([\s\S]*?)<\/script>/i
  ];
  for (const pattern of assignmentPatterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    try { values.push(JSON.parse(match[1])); } catch {}
  }
  return values;
}

function walk(value, visit, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit, seen);
  } else {
    for (const item of Object.values(value)) walk(item, visit, seen);
  }
}

function extractStructuredProduct(html, productUrl) {
  const product = {
    id: findProductId(productUrl),
    url: productUrl,
    title: firstText(getMeta(html, ['og:title', 'twitter:title']).replace(/\s*\|\s*Mercado Livre.*$/i, '')),
    image: firstText(getMeta(html, ['og:image', 'twitter:image'])),
    category: '',
    price: null,
    previousPrice: null,
    installments: null,
    installmentAmount: null,
    currency: 'BRL',
    source: 'mercadolivre-page-html'
  };

  const candidates = [];
  for (const block of parseJsonBlocks(html)) walk(block, node => candidates.push(node));

  for (const node of candidates) {
    if (!node || typeof node !== 'object') continue;
    const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : String(node['@type'] || '');
    const looksProduct = /product/i.test(type) || node.offers || node.price || node.current_price || node.title || node.name;
    if (!looksProduct) continue;
    const offers = Array.isArray(node.offers) ? node.offers[0] : (node.offers || {});
    product.title = firstText(product.title, node.name, node.title);
    product.image = firstText(product.image, Array.isArray(node.image) ? node.image[0] : node.image, node.thumbnail);
    product.category = firstText(product.category, node.category, node.category_name);
    product.price = firstNumber(product.price, offers.price, offers.current_price, node.price, node.current_price, node.sale_price);
    product.previousPrice = firstNumber(product.previousPrice, offers.original_price, offers.listPrice, node.original_price, node.originalPrice, node.list_price);
    product.currency = firstText(product.currency, offers.priceCurrency, offers.currency_id, node.currency_id, 'BRL');
    const installments = node.installments || offers.installments || {};
    product.installments = firstNumber(product.installments, installments.quantity, node.installments_count, node.installmentQuantity);
    product.installmentAmount = firstNumber(product.installmentAmount, installments.amount, node.installment_amount, node.installmentAmount);
  }

  const visibleText = String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  if (!product.price) {
    const priceMatch = visibleText.match(/(?:R\$\s*)?([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/);
    if (priceMatch) product.price = firstNumber(priceMatch[1]);
  }

  if (product.previousPrice && product.price && product.previousPrice <= product.price) product.previousPrice = null;
  product.discount = product.price && product.previousPrice
    ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
    : null;
  return product;
}

async function follow(url) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      'accept-language': 'pt-BR,pt;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });
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
    const productUrl = findProductUrl(socialUrl, socialUrl) || findProductUrl(firstHtml, socialUrl);

    if (!productUrl) {
      return res.status(200).json({ ok: false, affiliateUrl: parsed.toString(), socialUrl, productUrl: null, productId: null, resolverVersion: RESOLVER_VERSION, message: 'O link foi resolvido até a página intermediária, mas o anúncio ainda não foi localizado automaticamente.' });
    }

    const productResponse = await follow(productUrl);
    const redirectedUrl = productResponse.url || productUrl;
    const verificationTarget = unwrapAccountVerification(redirectedUrl);
    const finalProductUrl = verificationTarget || (isProductUrl(redirectedUrl) ? redirectedUrl : productUrl);
    const pageResponse = verificationTarget ? await follow(verificationTarget) : productResponse;
    const pageHtml = await pageResponse.text();
    const product = extractStructuredProduct(pageHtml, finalProductUrl);
    const hasData = Boolean(product.title || product.price !== null || product.image);

    return res.status(200).json({
      ok: true,
      affiliateUrl: parsed.toString(),
      socialUrl,
      productUrl: finalProductUrl,
      productId: product.id,
      product,
      resolverVersion: RESOLVER_VERSION,
      verificationBypassed: Boolean(verificationTarget),
      pageRead: hasData,
      message: hasData
        ? 'Anúncio específico localizado e dados extraídos diretamente do HTML da página.'
        : 'Anúncio específico localizado, mas o Mercado Livre não entregou o HTML do produto para este acesso automatizado.'
    });
  } catch (error) {
    return res.status(502).json({ ok: false, affiliateUrl: parsed.toString(), resolverVersion: RESOLVER_VERSION, message: 'Não foi possível resolver ou ler o HTML do anúncio específico.', error: String(error?.message || error) });
  }
}
