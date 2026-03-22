'use strict'

const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { performance } = require('perf_hooks')
const { URL } = require('url')

// `wappalyzer` reads `CHROMIUM_DATA_DIR` when `driver.js` loads; set before require.
if (!process.env.CHROMIUM_DATA_DIR) {
  process.env.CHROMIUM_DATA_DIR = path.join(
    os.tmpdir(),
    'wappalyzer-chromium-profile'
  )
}

const parquet = require('parquetjs-lite')
const PQueue = require('p-queue').default
const Wappalyzer = require('wappalyzer')

const { analyzeDns } = require('./lib/dns-analysis')
const { analyzeRobots } = require('./lib/robots-analysis')
const { mergeTechnologies } = require('./lib/merge-technologies')
const { collectExtraWappalyzerUrls } = require('./lib/internal-link')
const { fetchText } = require('./lib/http-fetch')
const { mapWappalyzerTechnologies } = require('./lib/wappalyzer-proof')
const {
  DESKTOP_USER_AGENT,
  MOBILE_USER_AGENT,
  MOBILE_VIEWPORT,
} = require('./lib/wappalyzer-profiles')

const DEFAULT_INPUT = 'domains.snappy.parquet'
const DEFAULT_OUTPUT = 'output.json'
const CONCURRENCY = 20

/** Puppeteer / Wappalyzer navigation & script budget (lazy trackers, hydration). */
const WAPPALYZER_MAX_WAIT_MS = 45_000
/** Spacing between recursive steps and probe batches (Wappalyzer internal). */
const WAPPALYZER_DELAY_MS = 2500
/** Homepage HTML fetch for internal link discovery. */
const HTML_FETCH_MS = 22_000
/** Extra URLs after desktop homepage (HTML + static fallbacks). */
const MAX_EXTRA_WAPPALYZER_URLS = 4
/** Mobile pass: homepage + up to this many extra URLs (keep small for runtime). */
const MAX_MOBILE_EXTRA_WAPPALYZER_URLS = 1
/**
 * Whole-domain budget: DNS + robots + desktop (1 + MAX_EXTRA) + mobile (1 + MAX_MOBILE_EXTRA)
 * Wappalyzer runs + probes. Scroll/viewport patches in `wappalyzer` driver.
 */
const DOMAIN_ANALYZE_TIMEOUT_MS = 420_000

process.setMaxListeners(Math.max(20, CONCURRENCY * 5))

const DOMAIN_COLUMN_CANDIDATES = [
  'domain',
  'root_domain',
  'hostname',
  'host',
  'url',
  'website',
  'site',
]

/**
 * @param {{ fields: Record<string, unknown> }} schema
 * @returns {string}
 */
function resolveDomainColumnName(schema) {
  const topLevel = Object.keys(schema.fields || {})
  const preferred = DOMAIN_COLUMN_CANDIDATES.find((name) =>
    topLevel.includes(name)
  )
  if (preferred) {
    return preferred
  }
  if (topLevel.length === 1) {
    return topLevel[0]
  }
  throw new Error(
    `Could not pick a domain column. Top-level columns: ${topLevel.join(', ')}. ` +
      `Expected one of: ${DOMAIN_COLUMN_CANDIDATES.join(', ')}`
  )
}

/**
 * @param {string} filePath
 * @returns {Promise<{ domains: string[], columnUsed: string }>}
 */
async function readParquet(filePath) {
  const reader = await parquet.ParquetReader.openFile(filePath)
  try {
    const columnName = resolveDomainColumnName(reader.getSchema())
    const cursor = reader.getCursor([columnName])
    const domains = []
    let row
    while ((row = await cursor.next())) {
      const d = row[columnName]
      if (d != null && String(d).trim() !== '') {
        domains.push(String(d).trim())
      }
    }
    return { domains, columnUsed: columnName }
  } finally {
    await reader.close()
  }
}

/**
 * @param {string} domain
 * @returns {string}
 */
function normalizeUrl(domain) {
  const trimmed = domain.trim()
  if (!trimmed) {
    throw new Error('Empty domain')
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

/**
 * @param {string} userAgent
 * @param {object|null} viewport Puppeteer viewport or null for default window size.
 */
function buildWappalyzerOptions(userAgent, viewport) {
  const o = {
    maxWait: WAPPALYZER_MAX_WAIT_MS,
    delay: WAPPALYZER_DELAY_MS,
    extended: true,
    recursive: false,
    maxUrls: 1,
    maxDepth: 1,
    probe: 'full',
    userAgent,
  }
  if (viewport) {
    o.viewport = viewport
  }
  return o
}

/**
 * @param {string} url
 * @param {string} html
 * @param {Array<Array<{ name: string, version: string|null, proof: string }>>} layers
 * @param {{ userAgent: string, viewport: object|null, maxExtra: number }} profile
 */
async function appendWappalyzerPass(url, html, layers, profile) {
  const driver = new Wappalyzer(
    buildWappalyzerOptions(profile.userAgent, profile.viewport)
  )
  await driver.init()
  try {
    let site = await driver.open(url)
    try {
      layers.push(mapWappalyzerTechnologies(await site.analyze()))
    } finally {
      await site.destroy().catch(() => {})
    }

    const extraUrls = collectExtraWappalyzerUrls(html, url, profile.maxExtra)
    for (const internalUrl of extraUrls) {
      site = await driver.open(internalUrl)
      try {
        layers.push(mapWappalyzerTechnologies(await site.analyze()))
      } finally {
        await site.destroy().catch(() => {})
      }
    }
  } finally {
    await driver.destroy().catch(() => {})
  }
}

/**
 * Multi-layer fingerprinting: DNS, robots.txt, Wappalyzer (homepage + several internal URLs, full probe).
 *
 * @param {string} domain
 * @returns {Promise<{ domain: string, technologies: Array<{ name: string, version: string|null, proof: string }> }>}
 */
async function analyzeDomain(domain) {
  const url = normalizeUrl(domain)

  let hostname
  try {
    hostname = new URL(url).hostname
  } catch {
    return { domain, technologies: [] }
  }

  const [dnsTechs, robotsTechs, html] = await Promise.all([
    analyzeDns(hostname).catch(() => []),
    analyzeRobots(hostname).catch(() => []),
    fetchText(url, { timeoutMs: HTML_FETCH_MS, maxRedirects: 6 }).catch(
      () => ''
    ),
  ])

  /** @type {Array<Array<{ name: string, version: string|null, proof: string }>>} */
  const layers = [dnsTechs, robotsTechs]

  await appendWappalyzerPass(url, html, layers, {
    userAgent: DESKTOP_USER_AGENT,
    viewport: null,
    maxExtra: MAX_EXTRA_WAPPALYZER_URLS,
  })

  await appendWappalyzerPass(url, html, layers, {
    userAgent: MOBILE_USER_AGENT,
    viewport: MOBILE_VIEWPORT,
    maxExtra: MAX_MOBILE_EXTRA_WAPPALYZER_URLS,
  })

  const technologies = mergeTechnologies(...layers)
  return { domain, technologies }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
/**
 * @param {number} ms
 * @returns {string}
 */
function formatDurationMs(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(2)} s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes < 60) {
    return `${minutes} min ${seconds} s`
  }
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours} h ${remMin} min ${seconds} s`
}

function withTimeout(promise, ms, label) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ])
}

/**
 * @param {string[]} domains
 * @param {(d: string) => Promise<object>} analyzer
 * @returns {Promise<object[]>}
 */
async function runWithConcurrency(domains, analyzer) {
  const total = domains.length
  let finished = 0
  const queue = new PQueue({ concurrency: CONCURRENCY })

  return Promise.all(
    domains.map((domain) =>
      queue.add(async () => {
        try {
          const result = await withTimeout(
            analyzer(domain),
            DOMAIN_ANALYZE_TIMEOUT_MS,
            `analyze ${domain}`
          )
          finished += 1
          console.log(`[${finished}/${total}] processed ${domain}`)
          return result
        } catch (err) {
          finished += 1
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[${finished}/${total}] ERROR ${domain}: ${msg}`)
          return { domain, technologies: [] }
        }
      })
    )
  )
}

async function main() {
  const inputPath =
    process.argv[2] || process.env.INPUT_FILE || DEFAULT_INPUT
  const outputPath =
    process.argv[3] || process.env.OUTPUT_FILE || DEFAULT_OUTPUT

  await fs.access(inputPath).catch(() => {
    throw new Error(
      `Input file not found: ${path.resolve(inputPath)}. Place your Parquet file there or pass a path: node index.js <input.parquet> [output.json]`
    )
  })

  console.log(`Reading domains from ${path.resolve(inputPath)}`)
  const { domains, columnUsed } = await readParquet(inputPath)
  console.log(
    `Using Parquet column "${columnUsed}". Loaded ${domains.length} domain(s). Concurrency: ${CONCURRENCY}`
  )

  if (domains.length === 0) {
    await fs.writeFile(outputPath, '[]\n', 'utf8')
    console.log(`No domains; wrote empty array to ${path.resolve(outputPath)}`)
    process.exit(0)
    return
  }

  const processingStartedAt = performance.now()
  const results = await runWithConcurrency(domains, analyzeDomain)
  const processingMs = performance.now() - processingStartedAt

  console.log(
    `Finished processing all ${domains.length} domain(s) in ${formatDurationMs(processingMs)} (${Math.round(processingMs)} ms wall time)`
  )

  await fs.writeFile(outputPath, JSON.stringify(results, null, 2), 'utf8')
  console.log(`Wrote ${results.length} record(s) to ${path.resolve(outputPath)}`)
  // Puppeteer/Chromium often leaves child processes or handles that keep the event loop
  // from draining; explicit exit matches typical CLI behavior after work is done.
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
