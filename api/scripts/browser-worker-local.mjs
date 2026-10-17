import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright-core"

const PORT = Number(process.env.MAVURI_CHROME_PORT || 9222)
const PROFILE_DIR = process.env.MAVURI_CHROME_PROFILE ||
  String.raw`${process.env.LOCALAPPDATA || process.env.USERPROFILE + "/AppData/Local"}/MavuriChromeProfile`

const HUB_URL = "https://www.mercadolivre.com.br/afiliados/hub?is_affiliate=true#menu-user"
const SEARCH_URL = "https://www.mercadolivre.com.br/affiliate-program/api/hub/search?is_affiliate=true&device=desktop"

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function chromeJson(path) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`)
  if (!response.ok) throw new Error(`Chrome CDP HTTP ${response.status}`)
  return response.json()
}

async function isChromeReady() {
  try {
    await chromeJson("/json/version")
    return true
  } catch {
    return false
  }
}

function chromeExecutable() {
  const candidates = [
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env["PROGRAMFILES(X86)"] && `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ].filter(Boolean)

  const found = candidates.find(existsSync)
  if (!found) {
    throw new Error("Google Chrome não encontrado. Defina CHROME_PATH com o caminho do chrome.exe.")
  }
  return found
}

async function startChromeIfNeeded() {
  if (await isChromeReady()) {
    console.log(`[Mavuri] Chrome CDP já está ativo na porta ${PORT}.`)
    return
  }

  await mkdir(PROFILE_DIR, { recursive: true })
  const executable = process.env.CHROME_PATH || chromeExecutable()

  console.log("[Mavuri] Iniciando Chrome dedicado para o Worker...")
  console.log(`[Mavuri] Perfil: ${PROFILE_DIR}`)
  console.log(`[Mavuri] Porta CDP: ${PORT}`)

  const child = spawn(executable, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    HUB_URL,
  ], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  })

  child.unref()

  for (let i = 0; i < 30; i++) {
    if (await isChromeReady()) return
    await sleep(500)
  }

  throw new Error("Chrome iniciou, mas a porta CDP não ficou disponível.")
}

async function discover(page) {
  return page.evaluate(async ({ searchUrl }) => {
    const response = await fetch(searchUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        search: "",
        sort: "relevance",
        filters: [],
        offset: 0,
      }),
    })

    const text = await response.text()
    let data = null
    try {
      data = JSON.parse(text)
    } catch {}

    return {
      status: response.status,
      ok: response.ok,
      data,
      text: data ? null : text.slice(0, 1000),
    }
  }, { searchUrl: SEARCH_URL })
}

function componentByType(card, type) {
  return card?.components?.find(component => component?.type === type)?.[type] || null
}

function absoluteMercadoLivreUrl(value) {
  if (!value) return null
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  return `https://${value}`
}

function normalizeCard(card, index) {
  const metadata = card?.metadata || {}
  const titleComponent = componentByType(card, "title")
  const priceComponent = componentByType(card, "price")

  return {
    index: index + 1,
    id: metadata.id || null,
    product_id: metadata.product_id || null,
    type: metadata.type || null,
    title: titleComponent?.text || null,
    price: priceComponent?.current_price?.value ?? null,
    previous_price: priceComponent?.previous_price?.value ?? null,
    discount: priceComponent?.discount_label?.text || null,
    url: absoluteMercadoLivreUrl(metadata.url),
    extra_commission: metadata.extra_commission === "true",
  }
}

async function main() {
  await startChromeIfNeeded()

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  const context = browser.contexts()[0]
  if (!context) throw new Error("Nenhum contexto Chrome encontrado.")

  const pages = context.pages()
  let page = pages.find(p => p.url().includes("mercadolivre.com.br")) || pages[0]
  if (!page) page = await context.newPage()

  await page.goto(HUB_URL, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {})
  await sleep(2500)

  console.log("")
  console.log("======================================================")
  console.log(" MAVURI — LOCAL CHROME WORKER / POC")
  console.log("======================================================")
  console.log("Chrome aberto com perfil dedicado.")
  console.log("Se o Mercado Livre pedir login, faça o login normalmente.")
  console.log("NÃO é necessário fornecer senha, cookie ou token ao Mavuri.")
  console.log("")

  let authenticated = false

  for (let i = 0; i < 60; i++) {
    const url = page.url()
    const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase()

    authenticated =
      url.includes("/afiliados/hub") &&
      !url.includes("/login") &&
      !url.includes("/identification") &&
      (
        body.includes("produtos selecionados") ||
        body.includes("central de afiliados") ||
        body.includes("lucasbrasildf")
      )

    if (authenticated) break

    console.log(`[Mavuri] Aguardando login... (${i + 1}/60)`)
    await sleep(3000)
  }

  if (!authenticated) {
    console.log("")
    console.log("[Mavuri] Não consegui confirmar a Central de Afiliados.")
    console.log("[Mavuri] Deixe o Chrome aberto e execute o worker novamente após concluir o login.")
    await browser.close()
    return
  }

  console.log("[Mavuri] Sessão autenticada detectada.")
  console.log("[Mavuri] Consultando /affiliate-program/api/hub/search...")

  const result = await discover(page)

  console.log("")
  console.log(`[Mavuri] HTTP ${result.status}`)

  if (!result.ok) {
    console.log("[Mavuri] O Mercado Livre rejeitou a chamada.")
    console.log(JSON.stringify(result.data || result.text, null, 2))
    await browser.close()
    process.exitCode = 2
    return
  }

  const cards = result.data?.polycard_client_model?.polycards || []
  console.log(`[Mavuri] Produtos retornados: ${cards.length}`)

  const products = cards.map(normalizeCard)

  console.log(JSON.stringify(products.slice(0, 10), null, 2))
  console.log("")
  console.log("[Mavuri] POC concluída. Nenhum dado de sessão foi enviado ao servidor.")
  await browser.close()
}

main().catch(error => {
  console.error("[Mavuri] ERRO:", error?.message || error)
  process.exitCode = 1
})
