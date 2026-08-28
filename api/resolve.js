const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function isMercadoLivreHost(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'mercadolivre.com.br' || host.endsWith('.mercadolivre.com.br') || host === 'meli.la';
  } catch {
    return false;
  }
}

function cleanUrl(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function findProductUrl(html, baseUrl) {
  const candidates = [];
  const patterns = [
    /https?:\\?\/\\?\/[^\"'<>\\\s]+?\/p\/MLB\d+[^\"'<>\\\s]*/gi,
    /https?:\/\/[^\"'<>\s]+?\/p\/MLB\d+[^\"'<>\s]*/gi,
    /\"permalink\"\s*:\s*\"([^\"]+)\"/gi,
    /\"url\"\s*:\s*\"([^\"]*\/p\/MLB\d+[^\"]*)\"/gi,
    /href=[\"']([^\"']*\/p\/MLB\d+[^\"']*)[\"']/gi
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const raw = cleanUrl(match[1] || match[0]);
      if (!raw) continue;
      try {
        const absolute = new URL(raw, baseUrl).toString();
        if (isMercadoLivreHost(absolute) && /\/p\/MLB\d+/i.test(absolute)) candidates.push(absolute);
      } catch {
        // ignora candidato inválido
      }
    }
  }

  return unique(candidates)[0] || null;
}

function findProductId(value) {
  const match = String(value || '').match(/\/p\/(MLB\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

async function follow(url) {
  const response = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    cache: 'no-store',
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; MavuriResolver/1.0)',
      'accept-language': 'pt-BR,pt;q=0.9'
    }
  });
  return response;
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
    const html = await first.text();

    let productUrl = findProductUrl(socialUrl, socialUrl);
    if (!productUrl) productUrl = findProductUrl(html, socialUrl);

    const productId = findProductId(productUrl);

    return res.status(200).json({
      ok: Boolean(productUrl),
      affiliateUrl: parsed.toString(),
      socialUrl,
      productUrl,
      productId,
      resolverVersion: '2026.08.28.01',
      message: productUrl
        ? 'Anúncio do produto localizado.'
        : 'O link foi resolvido até a página intermediária, mas o anúncio ainda não foi localizado automaticamente.'
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      affiliateUrl: parsed.toString(),
      message: 'Não foi possível resolver o link do Mercado Livre.',
      error: String(error?.message || error)
    });
  }
}
