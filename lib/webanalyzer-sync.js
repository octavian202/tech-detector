'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')

const SUPPLEMENT_PATH = path.join(process.cwd(), 'rules', 'webanalyzer-supplement.json')
const META_PATH = path.join(process.cwd(), 'rules', 'webanalyzer-sync-meta.json')
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_FILES = 450
const CONCURRENCY = 12
const FETCH_TIMEOUT_MS = 10000

/** High-priority techs to fetch first (by filename without .json) */
const PRIORITY_NAMES = new Set([
  'wordpress', 'drupal', 'joomla', 'shopify', 'magento', 'woocommerce',
  'react', 'vue', 'angular', 'next', 'nuxt', 'gatsby', 'laravel',
  'express', 'nginx', 'apache', 'bootstrap', 'jquery', 'tailwind',
  'cloudflare', 'vercel', 'netlify', 'stripe', 'analytics', 'google-analytics',
  'ghost', 'squarespace', 'wix', 'webflow', 'elementor',
])

const UA = 'Mozilla/5.0 (compatible; tech-detector/1.0)'

function fetchUrl(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const opts = { timeout: timeoutMs, headers: { 'User-Agent': UA } }
    const req = https.get(url, opts, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c) => { body += c })
      res.on('end', () => resolve(body))
      res.on('error', reject)
    })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
  })
}

function parseSearch(search) {
  if (!search) return { type: 'html', key: null }
  const m = String(search).match(/^headers\[([^\]]+)\]$/i)
  if (m) return { type: 'headers', key: m[1].toLowerCase().replace(/_/g, '-') }
  if (/^body|text$/i.test(search)) return { type: 'html', key: null }
  if (/^title$/i.test(search)) return { type: 'html', key: null }
  if (/^all$/i.test(search)) return { type: 'html', key: null }
  return { type: 'html', key: null }
}

function rubyRegexToJs(rubyRegex) {
  if (!rubyRegex || typeof rubyRegex !== 'string') return null
  let s = rubyRegex
  const mix = s.match(/^\(\?-?[mix]*:(.*)\)$/s)
  if (mix) s = mix[1]
  s = s.replace(/\\\//g, '/')
  try {
    new RegExp(s, 'i')
    return s
  } catch {
    return null
  }
}

function convertRule(raw) {
  const name = raw.name
  if (!name || typeof name !== 'string') return null
  const matches = Array.isArray(raw.matches) ? raw.matches : []
  const out = { name, html: [], headers: [] }
  const seen = new Set()

  for (const m of matches) {
    if (m.url) continue
    const { type, key } = parseSearch(m.search)
    let regex = null
    if (m.regexp) regex = rubyRegexToJs(m.regexp)
    else if (m.text) regex = String(m.text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (!regex) continue

    const keyStr = `${type}:${key || ''}:${regex.slice(0, 50)}`
    if (seen.has(keyStr)) continue
    seen.add(keyStr)

    if (type === 'headers') {
      out.headers.push({ key: key || 'unknown', regex })
    } else {
      out.html.push({ regex })
    }
  }

  if (out.html.length === 0 && out.headers.length === 0) return null
  return out
}

async function fetchFileList() {
  const url = 'https://api.github.com/repos/webanalyzer/rules/contents/whatweb'
  const data = await fetchUrl(url).then((b) => JSON.parse(b))
  if (!Array.isArray(data)) return []
  return data
    .filter((f) => f.name && f.name.endsWith('.json'))
    .map((f) => ({
      name: f.name.replace(/\.json$/, ''),
      downloadUrl: f.download_url || `https://raw.githubusercontent.com/webanalyzer/rules/master/whatweb/${f.name}`,
    }))
}

async function fetchRule(downloadUrl) {
  const raw = await fetchUrl(downloadUrl).then((b) => JSON.parse(b))
  return convertRule(raw)
}

async function runWithConcurrency(items, fn) {
  const results = []
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      try {
        results[i] = await fn(items[i])
      } catch {
        results[i] = null
      }
    }
  }
  const workers = Array(Math.min(CONCURRENCY, items.length))
    .fill(null)
    .map(() => worker())
  await Promise.all(workers)
  return results
}

async function shouldSync() {
  try {
    const meta = JSON.parse(await fs.readFile(META_PATH, 'utf8'))
    return !meta.syncedAt || Date.now() - Number(meta.syncedAt) > MAX_AGE_MS
  } catch {
    return true
  }
}

async function syncWebanalyzerRules() {
  await fs.mkdir(path.dirname(SUPPLEMENT_PATH), { recursive: true })

  if (!(await shouldSync())) {
    return loadSupplement()
  }

  let fileList = []
  try {
    fileList = await fetchFileList()
  } catch (err) {
    console.warn(`[webanalyzer] Could not fetch file list: ${err.message}`)
    return loadSupplement()
  }

  const prioritized = fileList.sort((a, b) => {
    const pa = PRIORITY_NAMES.has(a.name.toLowerCase())
    const pb = PRIORITY_NAMES.has(b.name.toLowerCase())
    if (pa && !pb) return -1
    if (!pa && pb) return 1
    return a.name.localeCompare(b.name)
  })

  const toFetch = prioritized.slice(0, MAX_FILES)
  const results = await runWithConcurrency(toFetch, async (item) => {
    if (!item.downloadUrl) return null
    return fetchRule(item.downloadUrl)
  })

  const techs = results.filter(Boolean)

  const byName = new Map()
  for (const t of techs) {
    const existing = byName.get(t.name)
    if (!existing) {
      byName.set(t.name, t)
      continue
    }
    existing.html = [...(existing.html || []), ...(t.html || [])]
    existing.headers = [...(existing.headers || []), ...(t.headers || [])]
    if (t.scriptSrc?.length) existing.scriptSrc = [...(existing.scriptSrc || []), ...t.scriptSrc]
    if (t.url?.length) existing.url = [...(existing.url || []), ...t.url]
  }

  const supplement = {
    technologies: Array.from(byName.values()),
  }

  await fs.writeFile(SUPPLEMENT_PATH, JSON.stringify(supplement, null, 2), 'utf8')
  await fs.writeFile(
    META_PATH,
    JSON.stringify({ syncedAt: Date.now(), count: supplement.technologies.length }, null, 2),
    'utf8'
  )

  return supplement.technologies
}

async function loadSupplement() {
  try {
    const data = JSON.parse(await fs.readFile(SUPPLEMENT_PATH, 'utf8'))
    return Array.isArray(data.technologies) ? data.technologies : []
  } catch {
    return []
  }
}

module.exports = {
  syncWebanalyzerRules,
  loadSupplement,
  SUPPLEMENT_PATH,
}
