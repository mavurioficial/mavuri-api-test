import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"

const PORT = Number(process.env.MAVURI_CHROME_PORT || 9222)
const PROFILE_DIR = process.env.MAVURI_CHROME_PROFILE ||
  String.raw`${process.env.LOCALAPPDATA || process.env.USERPROFILE + "/AppData/Local"}/MavuriChromeProfile`
const HUB_URL = "https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true#menu-user"
const SEARCH_URL = "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop"
const LINK_URL = "https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink"

const PAGE_SIZE = Math.max(1, Number(process.env.MAVURI_HUB_PAGE_SIZE || 16))
const MAX_PAGES = Math.min(20, Math.max(1, Number(process.env.MAVURI_HUB_PAGES || 5)))
const SORT = process.env.MAVURI_HUB_SORT || "relevance"
const SEARCH = process.env.MAVURI_HUB_SEARCH || ""
const FILTERS = parseJson("MAVURI_HUB_FILTERS", [])
const STATE_FILE = process.env.MAVURI_DISCOVERY_STATE || String.raw`${PROFILE_DIR}/mavuri-discovery-state.json`
const OUTPUT_FILE = process.env.MAVURI_DISCOVERY_OUTPUT || String.raw`${PROFILE_DIR}/mavuri-discovery-latest.json`
const GENERATE_LINKS = /^(1|true|yes)$/i.test(process.env.MAVURI_GENERATE_AFFILIATE_LINKS || "false")
const MAX_LINKS = Math.max(1, Number(process.env.MAVURI_MAX_NEW_LINKS || 10))
const AFFILIATE_TAG = process.env.MAVURI_AFFILIATE_TAG || null

function parseJson(name, fallback) {
  if (!process.env[name]) return fallback
  try { return JSON.parse(process.env[name]) } catch {
    console.warn(`[Mavuri] ${name} inválido; usando padrão.`)
    return fallback
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

async function chromeReady() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    return r.ok
  } catch { return false }
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean)
  const found = candidates.find(existsSync)
  if (!found) throw new Error("Google Chrome não encontrado.")
  return found
}

async function startChrome() {
  if (await chromeReady()) return
  await mkdir(PROFILE_DIR, { recursive: true })
  const child = spawn(chromePath(), [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    HUB_URL,
  ], { detached: true, stdio: "ignore", windowsHide: false })
  child.unref()
  for (let i = 0; i < 40; i++) {
    if (await chromeReady()) return
    await sleep(500)
  }
  throw new Error("Chrome iniciou, mas CDP não ficou disponível.")
}

async function pageFetch(page, url, body) {
  return page.evaluate(async ({ url, body }) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    return { status: r.status, ok: r.ok, data, text: data ? null : text.slice(0, 1000) }
  }, { url, body })
}

function component(card, type) {
  return card?.components?.find(c => c?.type === type)?.[type] || null
}

function absUrl(value) {
  if (!value) return null
  return /^https?:\\/\\//i.test(value) ? value : `https://${value}`
}

function normalize(card) {
  const m = card?.metadata || {}
  const title = component(card, "title")
  const price = component(card, "price")
  const picture = component(card, "picture") || component(card, "image")
  return {
    id: m.id || null,
    product_id: m.product_id || null,
    type: m.type || null,
    title: title?.text || null,
    price: price?.current_price?.value ?? null,
    previous_price: price?.previous_price?.value ?? null,
    discount: price?.discount_label?.text || null,
    coupon: price?.coupon_label?.text || null,
    url: absUrl(m.url),
    image_url: picture?.url || picture?.src || null,
    extra_commission: m.extra_commission === true || m.extra_commission === "true",
    list_url: absUrl(m.list_url),
  }
}

function key(p) { return p.id || p.product_id || p.url || p.title }
function snapshot(p) {
  return JSON.stringify([p.id, p.product_id, p.price, p.previous_price, p.discount, p.coupon, p.extra_commission])
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_FILE, "utf8")) } catch { return { version: 1, products: {} } }
}

async function save(path, data) {
  await mkdir(PROFILE_DIR, { recursive: true })
  await writeFile(path, JSON.stringify(data, null, 2), "utf8")
}

async function generateLink(page, product) {
  if (!product.id || !product.url) return { ok: false, status: 0, reason: "missing_id_or_url" }
  return page.evaluate(async ({ url, itemId, productUrl, tag }) => {
    const body = {
      itemId,
      type: "product",
      extraCommission: "false",
      ...(tag ? { tag } : {}),
      urls: [productUrl],
    }
    const r = await fetch(url, {
      method: "POST",
      headers: { "Accept": "application/json, text/plain, */*", "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    })
    const text = await r.text()
    let data = null
    try { data = JSON.parse(text) } catch {}
    return { ok: r.ok, status: r.status, data, text: data ? null : text.slice(0, 1000) }
  }, { url, itemId: product.id, productUrl: product.url, tag: AFFILIATE_TAG })
}

async function main() {
  await startChrome()
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const context = browser.contexts()[0]
  if (!context) throw new Error("Nenhum contexto Chrome encontrado.")
  let page = context.pages().find(p => p.url().includes("mercadolivre.com.br")) || context.pages()[0]
  if (!page) page = await context.newPage()

  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
  await sleep(2000)

  let auth = false
  for (let i = 0; i < 60; i++) {
    const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase()
    const url = page.url()
    auth = url.includes("/afiliados/hub") && !url.includes("/login") && !url.includes("/identification") &&
      (body.includes("produtos selecionados") || body.includes("central de afiliados") || body.includes("lucasbrasildf"))
    if (auth) break
    console.log(`[Mavuri] Aguardando login... (${i + 1}/60)`)
    await sleep(3000)
  }
  if (!auth) throw new Error("Sessão autenticada da Central não foi detectada.")

  console.log(`[Mavuri] Discovery V1: até ${MAX_PAGES} páginas x ${PAGE_SIZE} itens.`)
  const unique = new Map()

  for (let n = 0; n < MAX_PAGES; n++) {
    const offset = n * PAGE_SIZE
    const result = await pageFetch(page, SEARCH_URL, { search: SEARCH, sort: SORT, filters: FILTERS, offset })
    console.log(`[Mavuri] Página ${n + 1}/${MAX_PAGES}: HTTP ${result.status}`)
    if (!result.ok) {
      if (n === 0) throw new Error(`Hub search HTTP ${result.status}: ${JSON.stringify(result.data || result.text)}`)
      break
    }
    const cards = result.data?.polycard_client_model?.polycards || []
    for (const card of cards) {
      const p = normalize(card)
      if (key(p) && !unique.has(key(p))) unique.set(key(p), p)
    }
    if (cards.length < PAGE_SIZE) break
  }

  const state = await loadState()
  const products = [...unique.values()]
  const changed = []

  for (const p of products) {
    const k = key(p)
    const s = snapshot(p)
    const old = state.products[k]
    p.discovery_status = !old ? "new" : old.snapshot === s ? "unchanged" : "changed"
    if (p.discovery_status !== "unchanged") changed.push(p)
    p.discovered_at = new Date().toISOString()
    if (old?.affiliate_url) p.affiliate_url = old.affiliate_url
    state.products[k] = {
      snapshot: s,
      last_seen_at: p.discovered_at,
      title: p.title,
      price: p.price,
      affiliate_url: p.affiliate_url || null,
    }
  }

  let linksCreated = 0
  if (GENERATE_LINKS) {
    console.log(`[Mavuri] Geração de links ATIVA; máximo ${MAX_LINKS} nesta execução.`)
    for (const p of changed) {
      if (linksCreated >= MAX_LINKS || p.affiliate_url) continue
      const result = await generateLink(page, p)
      p.affiliate_link_status = result.status
      if (result.ok) {
        p.affiliate_url = result.data?.short_url || result.data?.shortUrl || result.data?.url || result.data?.affiliate_url || null
        if (p.affiliate_url) {
          state.products[key(p)].affiliate_url = p.affiliate_url
          linksCreated++
        }
      }
    }
  } else {
    console.log("[Mavuri] Geração de links desativada: modo dry-run.")
  }

  const output = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: { marketplace: "mercadolivre", hub_url: HUB_URL, search_url: SEARCH_URL, search: SEARCH, sort: SORT, filters: FILTERS, pages: MAX_PAGES, page_size: PAGE_SIZE },
    totals: { products: products.length, new_or_changed: changed.length, unchanged: products.length - changed.length, links_created: linksCreated },
    products,
    new_or_changed: changed,
  }

  await save(STATE_FILE, state)
  await save(OUTPUT_FILE, output)

  console.log("")
  console.log("======================================================")
  console.log(" MAVURI — DISCOVERY V1 CONCLUÍDA")
  console.log("======================================================")
  console.log(`Produtos únicos: ${products.length}`)
  console.log(`Novos/alterados: ${changed.length}`)
  console.log(`Sem alteração: ${products.length - changed.length}`)
  console.log(`Links criados: ${linksCreated}`)
  console.log(`JSON: ${OUTPUT_FILE}`)
  console.log("[Mavuri] Cookies, senha e tokens permanecem no Chrome local.")

  await browser.close()
}

main().catch(error => {
  console.error("[Mavuri] ERRO:", error?.message || error)
  process.exitCode = 1
})
