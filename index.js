'use strict'

const fs = require('fs/promises')
const path = require('path')
const os = require('os')
const { performance } = require('perf_hooks')

// `wappalyzer` reads `CHROMIUM_DATA_DIR` when `driver.js` loads; set before require.
if (!process.env.CHROMIUM_DATA_DIR) {
  process.env.CHROMIUM_DATA_DIR = path.join(
    os.tmpdir(),
    'wappalyzer-chromium-profile'
  )
}

const { analyzeDomain } = require('./lib/analyze-domain')
const { isWhatWebAvailable } = require('./lib/whatweb-worker')
const { ensureLatestWappalyzerRules } = require('./lib/wappalyzer-rules-sync')
const {
  DEFAULT_RULES_PATH,
  loadCustomRules,
} = require('./lib/custom-rules')
const { syncWebanalyzerRules } = require('./lib/webanalyzer-sync')
const { readParquetDomains } = require('./lib/parquet-domains')
const { formatDurationMs } = require('./lib/async-utils')
const { runDomainsWithConcurrency } = require('./lib/run-domains')
const {
  DEFAULT_INPUT,
  DEFAULT_OUTPUT,
  CONCURRENCY,
  DOMAIN_ANALYZE_TIMEOUT_MS,
} = require('./lib/constants')

process.setMaxListeners(Math.max(20, CONCURRENCY * 5))

async function main() {
  const inputPath =
    process.argv[2] || process.env.INPUT_FILE || DEFAULT_INPUT
  const outputPath =
    process.argv[3] || process.env.OUTPUT_FILE || DEFAULT_OUTPUT

  await ensureLatestWappalyzerRules()
  const webanalyzerCount = (await syncWebanalyzerRules()).length
  if (webanalyzerCount > 0) {
    console.log(`[rules] WebAnalyzer supplement: ${webanalyzerCount} technologies loaded`)
  }
  const customRulesPath = process.env.CUSTOM_RULES_FILE || DEFAULT_RULES_PATH
  const customRules = await loadCustomRules(customRulesPath)
  const whatwebAvailable = await isWhatWebAvailable()
  if (whatwebAvailable) {
    console.log('[detector] WhatWeb detected — enabling supplemental scan')
  }

  await fs.access(inputPath).catch(() => {
    throw new Error(
      `Input file not found: ${path.resolve(inputPath)}. Place your Parquet file there or pass a path: node index.js <input.parquet> [output.json]`
    )
  })

  console.log(`Reading domains from ${path.resolve(inputPath)}`)
  const { domains, columnUsed } = await readParquetDomains(inputPath)
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
  const results = await runDomainsWithConcurrency(
    domains,
    (d) => analyzeDomain(d, customRules, whatwebAvailable),
    { concurrency: CONCURRENCY, perDomainTimeoutMs: DOMAIN_ANALYZE_TIMEOUT_MS }
  )
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
