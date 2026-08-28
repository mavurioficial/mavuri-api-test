const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const RESOLVER_VERSION = '2026.08.28.06';

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

async function follow(url) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept-language': 'pt-BR,pt;q=0.9',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

async function categoryName(categoryId) {
  if (!categoryId) return '';
  const category = await fetchJson(`https://api.mercadolibre.com/categories/${encodeURIComponent(categoryId)}`);
  return firstText(category?.name, categoryId);
}

function pickCatalogOffer(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : [];

  // O endpoint de catálogo retorna as ofertas vinculadas ao produto.
  // Mantemos a ordem do Mercado Livre, que é a melhor aproximação da oferta
  // principal exibida na PDP, e exigimos item_id + preço válido.
  return list.find(item => firstText(item?.item_id, item?.id) && firstNumber(item?.price, item?.current_price) !== null) || list[0] || null;
}

async function loadCatalogOffer(productId) {
  const catalog = await fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}`);
  const offersPayload = await fetchJson(`https://api.mercadolibre.com/products/${encodeURIComponent(productId)}/items`);
  const offer = pickCatalogOffer(offersPayload);
  const itemId = firstText(offer?.item_id, offer?.id);
  const item = itemId ? await fetchJson(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`) : null;

  const categoryId = firstText(item?.category_id, offer?.category_id, catalog?.category_id);
  const category = await categoryName(categoryId);
  const installments = item?.installments || offer?.installments || {};

  return {
    itemId,
    title: firstText(item?.title, offer?.title, catalog?.name, catalog?.title),
    category,
    image: firstText(
      item?.pictures?.[0]?.secure_url,
      item?.pictures?.[0]?.url,
      item?.thumbnail,
      catalog?.pictures?.[0]?.secure_url,
      catalog?.pictures?.[0]?.url,
      catalog?.thumbnail
    ),
    price: firstNumber(item?.price, item?.current_price, offer?.price, offer?.current_price),
    previousPrice: firstNumber(item?.original_price, item?.originalPrice, offer?.original_price, offer?.originalPrice),
    installments: firstNumber(installments?.quantity, item?.installments_count, offer?.installments_count),
    installmentAmount: firstNumber(installments?.amount, item?.installment_amount, offer?.installment_amount),
    currency: firstText(item?.currency_id, offer?.currency_id, 'BRL')
  };
}

function extractPageFallback(html, productUrl) {
  return {
    title: firstText(getMeta(html, ['og:title', 'twitter:title']).replace(/\s*\|\s*Mercado Livre.*$/i, '')),
    image: firstText(getMeta(html, ['og:image', 'twitter:image'])),
    url: productUrl
  };
}

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido.' });

  const affiliateUrl = cleanUrl(req.query?.url);
  if (!affiliateUrl) return res.status(400).json({ message: 'Informe o parâmetro url.' });

  let parsed;
  try {
    parsed = new URL(affiliateUrl);
  } catch {
    return res.status(400).json({ message: 'URL inválida.' });
  }

  if (!isMercadoLivreHost(parsed.toString())) {
    return res.status(400).json({ message: 'Por segurança, somente links do Mercado Livre e meli.la são aceitos.' });
  }

  try {
    const first = await follow(parsed.toString());
    const socialUrl = first.url || parsed.toString();
    const firstHtml = await first.text();
    let productUrl = findProductUrl(socialUrl, socialUrl) || findProductUrl(firstHtml, socialUrl);

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

    let pageHtml = '';
    try {
      const pageResponse = verificationTarget ? await follow(verificationTarget) : productResponse;
      pageHtml = await pageResponse.text();
    } catch {}

    const productId = findProductId(finalProductUrl) || findProductId(locatedProductUrl);
    if (!productId) {
      return res.status(200).json({
        ok: false,
        affiliateUrl: parsed.toString(),
        socialUrl,
        productUrl: finalProductUrl,
        productId: null,
        resolverVersion: RESOLVER_VERSION,
        message: 'O anúncio foi localizado, mas não foi possível identificar o produto do catálogo.'
      });
    }

    // Fluxo B: a página /p/MLB... é uma PDP de catálogo. Em vez de depender
    // somente do HTML, buscamos as ofertas reais vinculadas ao catálogo e então
    // carregamos o item vencedor para obter preço, preço anterior e parcelas.
    const offerData = await loadCatalogOffer(productId);
    const pageFallback = extractPageFallback(pageHtml, finalProductUrl);
    const product = {
      id: productId,
      itemId: offerData.itemId,
      url: finalProductUrl,
      title: firstText(offerData.title, pageFallback.title),
      category: offerData.category,
      image: firstText(offerData.image, pageFallback.image),
      price: offerData.price,
      previousPrice: offerData.previousPrice && offerData.price && offerData.previousPrice > offerData.price ? offerData.previousPrice : null,
      installments: offerData.installments,
      installmentAmount: offerData.installmentAmount,
      currency: offerData.currency,
      source: 'mercadolivre-catalog-offer'
    };

    product.discount = product.price && product.previousPrice
      ? Math.round(((product.previousPrice - product.price) / product.previousPrice) * 100)
      : null;

    return res.status(200).json({
      ok: true,
      affiliateUrl: parsed.toString(),
      socialUrl,
      productUrl: finalProductUrl,
      productId,
      product,
      resolverVersion: RESOLVER_VERSION,
      verificationBypassed: Boolean(verificationTarget),
      message: product.price !== null || product.title
        ? 'Anúncio localizado e oferta do catálogo consultada com sucesso.'
        : 'Anúncio localizado, mas nenhuma oferta ativa foi retornada para o produto.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      affiliateUrl: parsed.toString(),
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível resolver ou consultar o anúncio do Mercado Livre.',
      error: String(error?.message || error)
    });
  }
}
