'use strict'

const fs = require('fs/promises')
const path = require('path')
const https = require('https')

const RULES_CACHE_DIR = path.join(process.cwd(), 'rules', 'wappalyzer')
const RULES_META_FILE = path.join(RULES_CACHE_DIR, 'sync-meta.json')
const WAPPALYZER_DIR = path.join(process.cwd(), 'node_modules', 'wappalyzer')
const MAX_AGE_MS = 24 * 60 * 60 * 1000

const REMOTE_BASE_CANDIDATES = [
  'https://raw.githubusercontent.com/enthec/webappanalyzer/main/src',
  'https://raw.githubusercontent.com/aliasio/wappalyzer/master/src',
  'https://raw.githubusercontent.com/dochne/wappalyzer/main/src',
]

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

  if (syncNeeded) {
    let synced = null
    let lastErr = null

    for (const base of REMOTE_BASE_CANDIDATES) {
      try {
        synced = await syncFromBase(base)
        await writeRulesCache(synced)
        await fs.writeFile(
          RULES_META_FILE,
          JSON.stringify(
            {
              syncedAt: Date.now(),
              source: base,
            },
            null,
            2
          ),
          'utf8'
        )
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
