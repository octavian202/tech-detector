'use strict'

const { URL } = require('url')

const Wappalyzer = require('wappalyzer')

const { analyzeDns } = require('./dns-analysis')
const { analyzeRobots } = require('./robots-analysis')
const { analyzeSsl } = require('./ssl-analysis')
const { analyzeDynamicBatch } = require('./dynamic-analysis')
const { analyzeHiddenSurfaces } = require('./hidden-analysis')
const { scanSignals } = require('./signal-scanners')
const { runWhatWeb } = require('./whatweb-worker')
const { mergeTechnologies } = require('./merge-technologies')
const { collectExtraWappalyzerUrls } = require('./internal-link')
const { fetchTextWithMeta } = require('./http-fetch')
const { mapWappalyzerTechnologies } = require('./wappalyzer-proof')
const { applyCustomRules } = require('./custom-rules')
const { withTimeout } = require('./async-utils')
const {
  DESKTOP_USER_AGENT,
  MOBILE_USER_AGENT,
  MOBILE_VIEWPORT,
} = require('./wappalyzer-profiles')
const {
  WAPPALYZER_MAX_WAIT_MS,
  WAPPALYZER_DELAY_MS,
  HTML_FETCH_MS,
  MAX_EXTRA_WAPPALYZER_URLS,
  MAX_MOBILE_EXTRA_WAPPALYZER_URLS,
  MAX_DYNAMIC_CRAWL_URLS,
  DYNAMIC_PAGE_TIMEOUT_MS,
  DYNAMIC_BATCH_TIMEOUT_MS,
} = require('./constants')

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
 * Multi-layer fingerprinting: DNS, robots.txt, SSL, Wappalyzer (desktop + mobile),
 * dynamic Puppeteer pass, hidden surfaces, signal scanners, custom rules, optional WhatWeb.
 *
 * @param {string} domain
 * @param {unknown[]} customRules
 * @param {boolean} whatwebAvailable
 * @returns {Promise<{ domain: string, technologies: Array<{ name: string, version: string|null, proof: string }> }>}
 */
async function analyzeDomain(domain, customRules, whatwebAvailable) {
  const url = normalizeUrl(domain)

  let hostname
  try {
    hostname = new URL(url).hostname
  } catch {
    return { domain, technologies: [] }
  }

  const [dnsTechs, robotsTechs, sslTechs, pageMeta] = await Promise.all([
    analyzeDns(hostname).catch(() => []),
    analyzeRobots(hostname).catch(() => []),
    analyzeSsl(hostname).catch(() => []),
    fetchTextWithMeta(url, { timeoutMs: HTML_FETCH_MS, maxRedirects: 6 }).catch(
      () => ({ body: '', headers: {}, finalUrl: url })
    ),
  ])
  const html = pageMeta.body || ''

  /** @type {Array<Array<{ name: string, version: string|null, proof: string }>>} */
  const layers = [dnsTechs, robotsTechs, sslTechs]

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

  const deepUrls = collectExtraWappalyzerUrls(html, url, MAX_DYNAMIC_CRAWL_URLS)
  const dynamicTargets = [url, ...deepUrls].slice(0, MAX_DYNAMIC_CRAWL_URLS + 1)
  const dynamicResults = await withTimeout(
    analyzeDynamicBatch(dynamicTargets, {
      perPageTimeoutMs: DYNAMIC_PAGE_TIMEOUT_MS,
      batchTimeoutMs: DYNAMIC_BATCH_TIMEOUT_MS,
    }),
    DYNAMIC_BATCH_TIMEOUT_MS + 15_000,
    'dynamic batch'
  ).catch(() =>
    dynamicTargets.map((u) => ({ technologies: [], signals: { url: u } }))
  )

  for (const r of dynamicResults) {
    layers.push(r.technologies || [])
  }

  const hiddenTechs = await analyzeHiddenSurfaces(url, hostname).catch(() => [])
  layers.push(hiddenTechs)

  const signalTechs = scanSignals({
    html,
    headers: pageMeta.headers || {},
  })
  layers.push(signalTechs)

  const mergedSignals = {
    url: pageMeta.finalUrl || url,
    html,
    headers: pageMeta.headers || {},
    scriptSrc: dynamicResults.flatMap((r) => r.signals?.scriptSrc || []),
    windowKeys: dynamicResults.flatMap((r) => r.signals?.windowKeys || []),
  }
  const customTechs = applyCustomRules(customRules, mergedSignals)
  layers.push(customTechs)

  if (whatwebAvailable) {
    const whatwebTechs = await runWhatWeb(url, { timeoutMs: 20_000 }).catch(() => [])
    layers.push(whatwebTechs)
  }

  const technologies = mergeTechnologies(...layers)
  return { domain, technologies }
}

module.exports = {
  analyzeDomain,
}
