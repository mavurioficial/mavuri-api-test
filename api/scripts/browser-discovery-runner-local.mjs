import { spawn } from "node:child_process"
import { appendFile, mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const DISCOVERY_SCRIPT = HERE + "/browser-discovery-v1.mjs"
const INTERVAL_MINUTES = Math.max(5, Number(process.env.MAVURI_DISCOVERY_INTERVAL_MINUTES || 30))
const LOG_FILE = process.env.MAVURI_DISCOVERY_RUNNER_LOG ||
  ((process.env.LOCALAPPDATA || process.env.USERPROFILE + "/AppData/Local") + "/MavuriChromeProfile/mavuri-discovery-runner.log")
const RUN_ON_START = !/^(0|false|no)$/i.test(process.env.MAVURI_DISCOVERY_RUN_ON_START || "true")

let stopping = false
let child = null

async function log(message) {
  const line = "[" + new Date().toISOString() + "] " + message
  console.log(line)
  try {
    await mkdir(dirname(LOG_FILE), { recursive: true })
    await appendFile(LOG_FILE, line + "\n", "utf8")
  } catch (error) {
    console.warn("[Mavuri] Não foi possível gravar o log em " + LOG_FILE + ": " + (error?.message || error))
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function runDiscovery() {
  return new Promise((resolve) => {
    const node = process.execPath
    child = spawn(node, [DISCOVERY_SCRIPT], {
      cwd: HERE,
      env: process.env,
      stdio: "inherit",
      windowsHide: false,
    })

    child.on("error", error => {
      log("Falha ao iniciar Discovery V1: " + (error?.message || error))
      child = null
      resolve(1)
    })

    child.on("exit", (code, signal) => {
      child = null
      resolve(code ?? (signal ? 1 : 0))
    })
  })
}

async function stop() {
  if (stopping) return
  stopping = true
  await log("Runner encerrado.")
  if (child && !child.killed) {
    child.kill("SIGINT")
  }
}

process.on("SIGINT", stop)
process.on("SIGTERM", stop)

async function main() {
  await log("Runner iniciado. Intervalo=" + INTERVAL_MINUTES + " min. Log=" + LOG_FILE)

  let first = true
  while (!stopping) {
    if (!first || RUN_ON_START) {
      await log("Iniciando ciclo Discovery V1...")
      const code = await runDiscovery()
      if (code === 0) {
        await log("Ciclo Discovery V1 concluído com sucesso.")
      } else {
        await log("Ciclo Discovery V1 terminou com código " + code + ". O próximo ciclo continuará normalmente.")
      }
    }

    first = false
    if (stopping) break

    await log("Aguardando " + INTERVAL_MINUTES + " minutos até o próximo ciclo...")
    await sleep(INTERVAL_MINUTES * 60 * 1000)
  }
}

main().catch(async error => {
  await log("Erro fatal no Runner: " + (error?.message || error))
  process.exitCode = 1
})
