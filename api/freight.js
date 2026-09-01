const ALLOWED_ORIGINS = new Set([
  'https://mavurioficial.github.io',
  'https://mavuri-api-test.vercel.app'
])

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36'

function cors(req, res) {
  const origin = req.headers.origin || ''
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function clean(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function money(value) {
  const match = String(value || '').match(/[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?/)
  return match ? `R$ ${match[0]}` : ''
}

function findFreight(text) {
  const source = clean(text)

  if (/frete\s+gr[aá]tis/i.test(source)) {
    return 'Frete grátis'
  }

  const priced = source.match(/frete\s+(?:a\s+partir\s+de|por|de)\s*(R\$\s*[0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/i)
  if (priced) {
    return `Frete ${money(priced[1])}`
  }

  if (/frete\s+(?:calculado|a\s+calcular)/i.test(source)) {
    return 'Frete calculado no checkout'
  }

  return ''
}

async function get(url) {
  try {
    return await fetch(url, {
      redirect: 'follow',
      cache: 'no-store',
      headers: {
        'user-agent': UA,
        'accept-language': 'pt-BR,pt;q=0.9',
        accept: 'text/html,application/xhtml+xml'
      }
    })
  } catch {
    return null
  }
}

async function jina(url) {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, {
      cache: 'no-store',
      headers: {
        'user-agent': UA,
        accept: 'text/plain'
      }
    })
    if (!response.ok) return ''
    return await response.text()
  } catch {
    return ''
  }
}

export default async function handler(req, res) {
  cors(req, res)

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ message: 'Método não permitido.' })

  const productUrl = String(req.query?.url || '').trim()
  if (!productUrl) return res.status(400).json({ ok: false, message: 'Informe a URL do produto.' })

  try {
    const response = await get(productUrl)
    const html = response ? await response.text() : ''
    const freightFromHtml = findFreight(html)
    if (freightFromHtml) {
      return res.status(200).json({ ok: true, freight: freightFromHtml, source: 'product-page-html' })
    }

    const proxy = await jina(productUrl)
    const freightFromProxy = findFreight(proxy)
    if (freightFromProxy) {
      return res.status(200).json({ ok: true, freight: freightFromProxy, source: 'jina-product-page' })
    }

    return res.status(200).json({ ok: true, freight: '', source: 'not-found' })
  } catch (error) {
    return res.status(502).json({
      ok: false,
      freight: '',
      message: 'Não foi possível consultar o frete.',
      error: String(error?.message || error)
    })
  }
}
