'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')

const RULES_CACHE_DIR = path.join(process.cwd(), 'rules', 'wappalyzer')
const RULES_META_FILE = path.join(RULES_CACHE_DIR, 'sync-meta.json')
const WAPPALYZER_DIR = path.join(process.cwd(), 'node_modules', 'wappalyzer')
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/** Bump when MERGE_RULE_BASES / merge logic changes (triggers supplemental merge without full re-sync). */
const MERGE_RULE_DIGEST = 1

/**
 * Primary sync: first reachable base wins (full categories + technologies).
 * Verified HTTP 200 (GitHub raw): enthec, HTTPArchive, dochne.
 * (aliasio/wappalyzer was removed — mirror no longer available.)
 */
const REMOTE_BASE_CANDIDATES = [
  'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src',
  'https://raw.githubusercontent.com/HTTPArchive/wappalyzer/main/src',
  'https://raw.githubusercontent.com/dochne/wappalyzer/main/src',
]

/**
 * After primary sync, merge technology definitions from other forks on top of the
 * cached files (union of patterns / keys), so one run benefits from multiple sources.
 */
const MERGE_RULE_BASES = [
  'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src',
  'https://raw.githubusercontent.com/HTTPArchive/wappalyzer/main/src',
  'https://raw.githubusercontent.com/dochne/wappalyzer/main/src',
]

/** Fields where primary copy wins entirely (no overlay). */
const PRESERVE_PRIMARY_FIELDS = new Set([
  'description',
  'website',
  'icon',
  'cpe',
  'saas',
  'oss',
  'group',
  'groups',
])

/** String fields treated as mergeable regex / pattern text. */
const MERGE_STRING_PATTERN_FIELDS = new Set([
  'html',
  'scriptSrc',
  'css',
  'dom',
  'text',
  'url',
  'xhr',
  'dns',
  'probe',
  'robots',
  'stylesheet',
  'certIssuer',
])

function mergePatternStrings(a, b) {
  const s = String(a ?? '').trim()
  const t = String(b ?? '').trim()
  if (!t) {
    return s
  }
  if (!s) {
    return t
  }
  if (s === t) {
    return s
  }
  if (s.includes(t) || t.includes(s)) {
    return s.length >= t.length ? s : t
  }
  return `${s}|${t}`
}

function mergeObjectFields(primary, supplemental) {
  return { ...supplemental, ...primary }
}

/**
 * @param {Record<string, unknown>} primary
 * @param {Record<string, unknown>} supplemental
 */
function mergeTechDefinition(primary, supplemental) {
  const out = { ...primary }
  for (const [k, v] of Object.entries(supplemental)) {
    if (v === undefined || v === null) {
      continue
    }
    if (!(k in out) || out[k] === undefined || out[k] === null || out[k] === '') {
      out[k] = v
      continue
    }
    if (PRESERVE_PRIMARY_FIELDS.has(k)) {
      continue
    }
    if (k === 'implies') {
      continue
    }
    const ov = out[k]
    if (typeof ov === 'string' && typeof v === 'string') {
      if (MERGE_STRING_PATTERN_FIELDS.has(k)) {
        out[k] = mergePatternStrings(ov, v)
      }
      continue
    }
    if (
      typeof ov === 'object' &&
      typeof v === 'object' &&
      ov !== null &&
      v !== null &&
      !Array.isArray(ov) &&
      !Array.isArray(v)
    ) {
      out[k] = mergeObjectFields(ov, v)
      continue
    }
    if (Array.isArray(ov) && Array.isArray(v)) {
      if (k === 'cats') {
        out[k] = [...new Set([...ov, ...v])].sort((a, b) => Number(a) - Number(b))
      } else if (k === 'pricing') {
        out[k] = [...new Set([...ov, ...v])]
      }
    }
  }
  return out
}

/**
 * @param {Record<string, unknown>} primaryObj
 * @param {Record<string, unknown>} supplementalObj
 */
function mergeTechnologyObjects(primaryObj, supplementalObj) {
  const out = { ...primaryObj }
  for (const [name, sDef] of Object.entries(supplementalObj)) {
    if (!sDef || typeof sDef !== 'object') {
      continue
    }
    if (!out[name]) {
      out[name] = sDef
    } else if (typeof out[name] === 'object' && out[name] !== null) {
      out[name] = mergeTechDefinition(
        /** @type {Record<string, unknown>} */ (out[name]),
        /** @type {Record<string, unknown>} */ (sDef)
      )
    }
  }
  return out
}

/**
 * @param {string} techDir
 * @param {string} primarySource
 * @returns {Promise<string[]>} Labels of merge bases that contributed at least one file
 */
async function mergeSupplementalRuleSources(techDir, primarySource) {
  const files = (await fs.readdir(techDir)).filter((f) => f.endsWith('.json'))
  const contributed = new Set()

  for (const fileName of files) {
    const filePath = path.join(techDir, fileName)
    let obj
    try {
      obj = JSON.parse(await fs.readFile(filePath, 'utf8'))
    } catch {
      continue
    }
    for (const base of MERGE_RULE_BASES) {
      if (base === primarySource) {
        continue
      }
      try {
        const raw = await fetchText(`${base}/technologies/${fileName}`)
        const supObj = JSON.parse(raw)
        obj = mergeTechnologyObjects(obj, supObj)
        contributed.add(base)
      } catch {
        // ignore unreachable or invalid supplement for this file
      }
    }
    await fs.writeFile(filePath, JSON.stringify(obj), 'utf8')
  }

  return Array.from(contributed)
}

function shortSourceLabel(url) {
  const s = String(url)
  let m = s.match(/github\.com\/([^/]+\/[^/]+)/i)
  if (!m) {
    m = s.match(/githubusercontent\.com\/([^/]+\/[^/]+)/i)
  }
  return m ? m[1] : s
}

function fetchText(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('end', () => resolve(body))
      res.on('error', reject)
    })
    req.on('timeout', () => {
      req.destroy(new Error(`Timeout for ${url}`))
    })
    req.on('error', reject)
  })
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

async function getTechnologyFilesFromPackage() {
  const techDir = path.join(WAPPALYZER_DIR, 'technologies')
  const files = await fs.readdir(techDir)
  return files.filter((f) => f.endsWith('.json'))
}

async function syncFromBase(baseUrl) {
  const technologyFiles = await getTechnologyFilesFromPackage()
  const categoriesText = await fetchText(`${baseUrl}/categories.json`)
  JSON.parse(categoriesText)

  const out = {
    categoriesText,
    technologies: {},
  }

  for (const fileName of technologyFiles) {
    const raw = await fetchText(`${baseUrl}/technologies/${fileName}`)
    JSON.parse(raw)
    out.technologies[fileName] = raw
  }

  return out
}

async function writeRulesCache(syncData) {
  const techDir = path.join(RULES_CACHE_DIR, 'technologies')
  await fs.mkdir(techDir, { recursive: true })
  await fs.writeFile(
    path.join(RULES_CACHE_DIR, 'categories.json'),
    syncData.categoriesText,
    'utf8'
  )

  for (const [fileName, content] of Object.entries(syncData.technologies)) {
    await fs.writeFile(path.join(techDir, fileName), content, 'utf8')
  }
}

async function applyCacheToWappalyzer() {
  const techSrcDir = path.join(RULES_CACHE_DIR, 'technologies')
  const techDestDir = path.join(WAPPALYZER_DIR, 'technologies')
  const techFiles = await fs.readdir(techSrcDir)

  await fs.copyFile(
    path.join(RULES_CACHE_DIR, 'categories.json'),
    path.join(WAPPALYZER_DIR, 'categories.json')
  )

  for (const fileName of techFiles) {
    await fs.copyFile(
      path.join(techSrcDir, fileName),
      path.join(techDestDir, fileName)
    )
  }
}

async function shouldSync() {
  const meta = await readJsonSafe(RULES_META_FILE)
  if (!meta || !meta.syncedAt) {
    return true
  }
  return Date.now() - Number(meta.syncedAt) > MAX_AGE_MS
}

async function ensureLatestWappalyzerRules() {
  await fs.mkdir(RULES_CACHE_DIR, { recursive: true })
  const syncNeeded = await shouldSync()
  const metaBefore = await readJsonSafe(RULES_META_FILE)

  if (syncNeeded) {
    let synced = null
    let lastErr = null

    for (const base of REMOTE_BASE_CANDIDATES) {
      try {
        synced = await syncFromBase(base)
        await writeRulesCache(synced)
        const techDir = path.join(RULES_CACHE_DIR, 'technologies')
        const mergedFrom = await mergeSupplementalRuleSources(techDir, base)
        await fs.writeFile(
          RULES_META_FILE,
          JSON.stringify(
            {
              syncedAt: Date.now(),
              source: base,
              mergedFrom: mergedFrom.map(shortSourceLabel),
              mergeDigest: MERGE_RULE_DIGEST,
            },
            null,
            2
          ),
          'utf8'
        )
        if (mergedFrom.length > 0) {
          console.log(
            `[rules] Merged supplemental Wappalyzer sources: ${mergedFrom.map(shortSourceLabel).join(', ')}`
          )
        }
        break
      } catch (err) {
        lastErr = err
      }
    }

    if (!synced && lastErr) {
      console.warn(
        `[rules] Could not refresh Wappalyzer rules, using local package defaults: ${lastErr.message}`
      )
      return
    }
  } else if (
    metaBefore &&
    metaBefore.source &&
    Number(metaBefore.mergeDigest) !== MERGE_RULE_DIGEST
  ) {
    try {
      const techDir = path.join(RULES_CACHE_DIR, 'technologies')
      const mergedFrom = await mergeSupplementalRuleSources(
        techDir,
        String(metaBefore.source)
      )
      await fs.writeFile(
        RULES_META_FILE,
        JSON.stringify(
          {
            ...metaBefore,
            mergedFrom: mergedFrom.map(shortSourceLabel),
            mergeDigest: MERGE_RULE_DIGEST,
            mergeRefreshedAt: Date.now(),
          },
          null,
          2
        ),
        'utf8'
      )
      if (mergedFrom.length > 0) {
        console.log(
          `[rules] Supplemental merge refreshed (${MERGE_RULE_DIGEST}): ${mergedFrom.map(shortSourceLabel).join(', ')}`
        )
      }
    } catch (err) {
      console.warn(`[rules] Supplemental merge refresh skipped: ${err.message}`)
    }
  }

  try {
    await applyCacheToWappalyzer()
  } catch (err) {
    console.warn(`[rules] Could not apply cached rules to Wappalyzer: ${err.message}`)
  }
}

module.exports = {
  ensureLatestWappalyzerRules,
}
