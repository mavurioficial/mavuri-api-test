const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
]);

const BASE_RESOLVER = 'https://mavuri-api-test.vercel.app/api/resolve';
const RESOLVER_VERSION = '2026.08.28.05-stable-html';

function cors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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

    return res.status(response.status).json({
      ...payload,
      resolverVersion: RESOLVER_VERSION
    });
  } catch (error) {
    return res.status(502).json({
      ok: false,
      resolverVersion: RESOLVER_VERSION,
      message: 'Não foi possível consultar o resolver HTML estável.',
      error: String(error?.message || error)
    });
  }
}
