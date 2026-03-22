'use strict'

const { fetchText } = require('./http-fetch')

const ROBOTS_TIMEOUT_MS = 5000

/** @typedef {{ name: string, version: null, proof: string }} RobotsTech */

/**
 * @param {string} line
 * @returns {RobotsTech[]}
 */
function lineToTechnologies(line) {
  /** @type {RobotsTech[]} */
  const out = []
  const raw = line.trim()
  if (!raw || raw.startsWith('#')) {
    return out
  }

  const l = raw.toLowerCase()

  if (l.includes('wp-admin')) {
    out.push({
      name: 'WordPress',
      version: null,
      proof: `Proof: robots.txt line references wp-admin — ${raw}`,
    })
  }
  if (l.includes('magento')) {
    out.push({
      name: 'Magento',
      version: null,
      proof: `Proof: robots.txt line references Magento — ${raw}`,
    })
  }
  if (/\/core\//i.test(raw) || /\/node\//i.test(raw)) {
    out.push({
      name: 'Drupal',
      version: null,
      proof: `Proof: robots.txt line references /core/ or /node/ (Drupal paths) — ${raw}`,
    })
  }
  if (/\/ghost\//i.test(raw)) {
    out.push({
      name: 'Ghost',
      version: null,
      proof: `Proof: robots.txt line references /ghost/ — ${raw}`,
    })
  }

  return out
}

/**
 * @param {string} hostname
 * @returns {Promise<RobotsTech[]>}
 */
async function analyzeRobots(hostname) {
  const clean = hostname.replace(/^www\./i, '')
  /** @type {RobotsTech[]} */
  const acc = []
  const seen = new Set()

  const urls = [
    `https://${clean}/robots.txt`,
    `http://${clean}/robots.txt`,
  ]

  for (const u of urls) {
    try {
      const text = await fetchText(u, {
        timeoutMs: ROBOTS_TIMEOUT_MS,
        maxRedirects: 3,
      })
      if (!text || text.length < 3) {
        continue
      }

      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        for (const t of lineToTechnologies(line)) {
          const key = `${t.name}:${line.trim()}`
          if (seen.has(key)) {
            continue
          }
          seen.add(key)
          acc.push(t)
        }
      }

      if (acc.length > 0) {
        break
      }
    } catch {
      // try next URL
    }
  }

  return acc
}

module.exports = {
  analyzeRobots,
}
