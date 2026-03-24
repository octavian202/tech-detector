'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')

const MERGED_DIR = path.join(process.cwd(), 'rules', 'merged')
const MERGED_META = path.join(MERGED_DIR, 'merge-meta.json')
const RULES_CACHE_DIR = path.join(process.cwd(), 'rules', 'wappalyzer')
const SUPPLEMENT_PATH = path.join(process.cwd(), 'rules', 'webanalyzer-supplement.json')
const WAPPALYZER_DIR = path.join(process.cwd(), 'node_modules', 'wappalyzer')

const UA = 'Mozilla/5.0 (compatible; tech-detector-merge/1.0)'
const FETCH_TIMEOUT_MS = 20000

/** Primary + optional extra Wappalyzer-compatible trees (same src layout). */
const REMOTE_SOURCES = [
  { id: 'webappanalyzer', base: 'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src' },
  { id: 'aliasio', base: 'https://raw.githubusercontent.com/aliasio/wappalyzer/master/src' },
  { id: 'httparchive', base: 'https://raw.githubusercontent.com/HTTPArchive/wappalyzer/main/src' },
]

const DEFAULT_MISC_CAT = 19

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { timeout: FETCH_TIMEOUT_MS, headers: { 'User-Agent': UA } },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new Error(`HTTP ${res.statusCode} ${url}`))
          return
        }
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (c) => { body += c })
        res.on('end', () => resolve(body))
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

function asLines(v) {
  if (v == null || v === '') return ''
  if (Array.isArray(v)) return v.filter(Boolean).join('\n')
  return String(v)
}

function mergePattern(a, b) {
  const A = asLines(a)
  const B = asLines(b)
  if (!B) return A
  if (!A) return B
  if (A === B) return A
  return `${A}\n${B}`
}

function mergeHeaders(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) }
  if (!b || typeof b !== 'object') return out
  for (const [k, v] of Object.entries(b)) {
    const key = k
    const existing = out[key]
    out[key] = mergePattern(existing, v)
  }
  return out
}

function mergeJs(a, b) {
  return { ...(a && typeof a === 'object' ? a : {}), ...(b && typeof b === 'object' ? b : {}) }
}

function mergeMeta(a, b) {
  return mergeHeaders(a, b)
}

function mergeCookies(a, b) {
  return { ...(a && typeof a === 'object' ? a : {}), ...(b && typeof b === 'object' ? b : {}) }
}

function mergeImplies(a, b) {
  const sa = a == null ? '' : Array.isArray(a) ? a.join('; ') : String(a)
  const sb = b == null ? '' : Array.isArray(b) ? b.join('; ') : String(b)
  if (!sb) return sa || undefined
  if (!sa) return sb
  const set = new Set()
  sa.split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((x) => set.add(x))
  sb.split(/[;,]/).map((s) => s.trim()).filter(Boolean).forEach((x) => set.add(x))
  return Array.from(set).join('; ')
}

function mergeTech(primary, secondary) {
  if (!secondary || typeof secondary !== 'object') return { ...primary }
  if (!primary || typeof primary !== 'object') return { ...secondary }

  const out = { ...primary }

  const patternKeys = [
    'html', 'scriptSrc', 'css', 'text', 'url', 'xhr', 'robots', 'certIssuer',
    'probe', 'scripts',
  ]
  for (const k of patternKeys) {
    if (secondary[k] != null) {
      out[k] = mergePattern(out[k], secondary[k])
    }
  }

  if (secondary.headers) out.headers = mergeHeaders(out.headers, secondary.headers)
  if (secondary.dns) out.dns = mergeHeaders(out.dns, secondary.dns)
  if (secondary.cookies) out.cookies = mergeCookies(out.cookies, secondary.cookies)
  if (secondary.js) out.js = mergeJs(out.js, secondary.js)
  if (secondary.meta) out.meta = mergeMeta(out.meta, secondary.meta)
  if (secondary.dom != null) {
    out.dom = mergePattern(out.dom, secondary.dom)
  }

  if (secondary.implies != null) {
    const m = mergeImplies(out.implies, secondary.implies)
    if (m) out.implies = m
  }

  if (secondary.cats?.length) {
    const u = new Set([...(out.cats || []), ...secondary.cats])
    out.cats = Array.from(u).sort((a, b) => a - b)
  }

  const preferSecondaryIfEmpty = ['description', 'website', 'icon']
  for (const k of preferSecondaryIfEmpty) {
    if ((out[k] == null || out[k] === '') && secondary[k] != null) {
      out[k] = secondary[k]
    }
  }

  if (secondary.pricing && !out.pricing) out.pricing = secondary.pricing

  return out
}

function supplementRuleToTech(rule) {
  const o = {
    cats: [DEFAULT_MISC_CAT],
    website: '',
  }
  if (rule.html?.length) {
    o.html = rule.html.map((x) => x.regex).join('\n')
  }
  if (rule.headers?.length) {
    o.headers = {}
    for (const h of rule.headers) {
      const k = String(h.key || '').toLowerCase()
      if (!k) continue
      o.headers[k] = o.headers[k] ? `${o.headers[k]}\n${h.regex}` : h.regex
    }
  }
  if (rule.scriptSrc?.length) {
    o.scriptSrc = rule.scriptSrc.map((x) => x.regex).join('\n')
  }
  if (rule.url?.length) {
    o.url = rule.url.map((x) => x.regex).join('\n')
  }
  return o
}

async function fetchTechnologyFileList(baseUrl) {
  const categoriesUrl = `${baseUrl}/categories.json`
  await fetchText(categoriesUrl)
  const pkgDir = path.join(process.cwd(), 'node_modules', 'wappalyzer', 'technologies')
  try {
    const files = await fs.readdir(pkgDir)
    return files.filter((f) => f.endsWith('.json'))
  } catch {
    return ['_.json', 'a.json', 'b.json', 'c.json', 'd.json', 'e.json', 'f.json', 'g.json', 'h.json', 'i.json', 'j.json', 'k.json', 'l.json', 'm.json', 'n.json', 'o.json', 'p.json', 'q.json', 'r.json', 's.json', 't.json', 'u.json', 'v.json', 'w.json', 'x.json', 'y.json', 'z.json']
  }
}

async function loadSource(baseUrl) {
  const files = await fetchTechnologyFileList(baseUrl)
  const combined = {}
  for (const fileName of files) {
    try {
      const raw = await fetchText(`${baseUrl}/technologies/${fileName}`)
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') {
        Object.assign(combined, obj)
      }
    } catch {
      // skip missing file for this fork
    }
  }
  return combined
}

async function loadCategories(baseUrl) {
  const raw = await fetchText(`${baseUrl}/categories.json`)
  return raw
}

function techFileForName(name) {
  const c = String(name)[0]
  if (/[a-z]/i.test(c)) return `${c.toLowerCase()}.json`
  return '_.json'
}

function allTechFilenames() {
  const out = ['_.json']
  for (let i = 0; i < 26; i += 1) {
    out.push(`${String.fromCharCode(97 + i)}.json`)
  }
  return out
}

function splitToFiles(mergedMap) {
  const buckets = {}
  for (const f of allTechFilenames()) {
    buckets[f] = {}
  }
  for (const [name, def] of Object.entries(mergedMap)) {
    const fn = techFileForName(name)
    if (!buckets[fn]) buckets[fn] = {}
    buckets[fn][name] = def
  }
  return buckets
}

/**
 * Merge all remote Wappalyzer-compatible sources + webanalyzer supplement into rules/merged and apply to node_modules/wappalyzer.
 *
 * @param {{ skipSources?: string[], dryRun?: boolean }} opts
 */
async function mergeAllTechnologyRules(opts = {}) {
  const skipList = opts.skipSources || (process.env.MERGE_SKIP_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const skip = new Set(skipList)
  const sources = REMOTE_SOURCES.filter((s) => !skip.has(s.id))

  let categoriesText = ''
  const merged = {}

  for (const src of sources) {
    try {
      const cat = await loadCategories(src.base)
      if (!categoriesText) categoriesText = cat

      const techs = await loadSource(src.base)
      for (const [name, def] of Object.entries(techs)) {
        if (!name || !def || typeof def !== 'object') continue
        if (merged[name]) {
          merged[name] = mergeTech(merged[name], def)
        } else {
          merged[name] = { ...def }
        }
      }
      console.log(`[merge-rules] ${src.id}: loaded ${Object.keys(techs).length} entries → total unique names ${Object.keys(merged).length}`)
    } catch (err) {
      console.warn(`[merge-rules] Skipping source ${src.id}: ${err.message}`)
    }
  }

  if (!categoriesText) {
    throw new Error('[merge-rules] No categories.json could be loaded')
  }

  try {
    const supRaw = await fs.readFile(SUPPLEMENT_PATH, 'utf8')
    const sup = JSON.parse(supRaw)
    const list = Array.isArray(sup.technologies) ? sup.technologies : []
    let n = 0
    for (const rule of list) {
      if (!rule?.name) continue
      const stub = supplementRuleToTech(rule)
      if (!stub.html && !stub.headers && !stub.scriptSrc && !stub.url) continue
      if (merged[rule.name]) {
        merged[rule.name] = mergeTech(merged[rule.name], stub)
      } else {
        merged[rule.name] = stub
      }
      n += 1
    }
    console.log(`[merge-rules] webanalyzer-supplement: merged ${n} rule sets`)
  } catch {
    console.warn('[merge-rules] No webanalyzer-supplement.json or empty; skip')
  }

  if (opts.dryRun) {
    return { technologyCount: Object.keys(merged).length, categoriesBytes: categoriesText.length }
  }

  await fs.mkdir(path.join(MERGED_DIR, 'technologies'), { recursive: true })
  await fs.writeFile(path.join(MERGED_DIR, 'categories.json'), categoriesText, 'utf8')

  const buckets = splitToFiles(merged)
  for (const [fileName, obj] of Object.entries(buckets)) {
    await fs.writeFile(
      path.join(MERGED_DIR, 'technologies', fileName),
      JSON.stringify(obj, null, 2),
      'utf8'
    )
  }

  await fs.writeFile(
    MERGED_META,
    JSON.stringify(
      {
        mergedAt: Date.now(),
        technologyCount: Object.keys(merged).length,
        sources: sources.map((s) => s.id),
      },
      null,
      2
    ),
    'utf8'
  )

  console.log(`[merge-rules] Wrote ${Object.keys(merged).length} technologies to ${MERGED_DIR}`)

  await applyMergedToWappalyzer()

  return { technologyCount: Object.keys(merged).length }
}

async function applyMergedToWappalyzer() {
  const srcBase = MERGED_DIR
  const destBase = WAPPALYZER_DIR

  await fs.copyFile(path.join(srcBase, 'categories.json'), path.join(destBase, 'categories.json'))

  const techSrc = path.join(srcBase, 'technologies')
  const techDest = path.join(destBase, 'technologies')
  const files = await fs.readdir(techSrc)
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    await fs.copyFile(path.join(techSrc, f), path.join(techDest, f))
  }
}

async function hasMergedBundle() {
  try {
    await fs.access(path.join(MERGED_DIR, 'categories.json'))
    await fs.access(path.join(MERGED_DIR, 'technologies', 'a.json'))
    return true
  } catch {
    return false
  }
}

/**
 * Load all technology definitions from a technologies/ folder (a.json … _.json).
 * @param {string} techDir
 * @returns {Promise<Record<string, object>>}
 */
async function loadAllTechnologiesFromDir(techDir) {
  const out = {}
  let files
  try {
    files = await fs.readdir(techDir)
  } catch {
    return out
  }
  for (const f of files) {
    if (!f.endsWith('.json')) continue
    try {
      const raw = await fs.readFile(path.join(techDir, f), 'utf8')
      const obj = JSON.parse(raw)
      if (obj && typeof obj === 'object') {
        Object.assign(out, obj)
      }
    } catch {
      // skip bad file
    }
  }
  return out
}

/**
 * Merge live sync cache (`rules/wappalyzer`) with offline bundle (`rules/merged`)
 * and write the union to `node_modules/wappalyzer`. Sync is primary for metadata;
 * merged adds / augments patterns (aliasio, HTTPArchive, webanalyzer supplement).
 */
async function combineSyncAndMergedApplyToWappalyzer() {
  const syncMap = await loadAllTechnologiesFromDir(
    path.join(RULES_CACHE_DIR, 'technologies')
  )
  const mergedMap = await loadAllTechnologiesFromDir(
    path.join(MERGED_DIR, 'technologies')
  )
  const names = new Set([...Object.keys(syncMap), ...Object.keys(mergedMap)])
  const combined = {}
  for (const name of names) {
    const a = syncMap[name]
    const b = mergedMap[name]
    if (a && b) {
      combined[name] = mergeTech({ ...a }, b)
    } else if (a) {
      combined[name] = { ...a }
    } else if (b) {
      combined[name] = { ...b }
    }
  }

  const syncCat = path.join(RULES_CACHE_DIR, 'categories.json')
  const mergedCat = path.join(MERGED_DIR, 'categories.json')
  let catSrc = syncCat
  try {
    await fs.access(syncCat)
  } catch {
    catSrc = mergedCat
  }
  await fs.copyFile(catSrc, path.join(WAPPALYZER_DIR, 'categories.json'))

  const buckets = splitToFiles(combined)
  for (const [fileName, obj] of Object.entries(buckets)) {
    await fs.writeFile(
      path.join(WAPPALYZER_DIR, 'technologies', fileName),
      JSON.stringify(obj, null, 2),
      'utf8'
    )
  }

  return { technologyCount: Object.keys(combined).length }
}

/**
 * If rules/merged exists, copy to node_modules/wappalyzer (fast). Otherwise no-op.
 */
async function applyMergedBundleIfPresent() {
  if (await hasMergedBundle()) {
    await applyMergedToWappalyzer()
    return true
  }
  return false
}

module.exports = {
  mergeAllTechnologyRules,
  applyMergedToWappalyzer,
  applyMergedBundleIfPresent,
  combineSyncAndMergedApplyToWappalyzer,
  hasMergedBundle,
  MERGED_DIR,
  RULES_CACHE_DIR,
  REMOTE_SOURCES,
}
