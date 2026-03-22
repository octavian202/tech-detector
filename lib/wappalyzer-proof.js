'use strict'

const PROOF_SNIPPET_MAX = 220

/** @type {Record<string, string>} */
const PATTERN_TYPE_LABELS = {
  headers: 'HTTP response headers',
  cookies: 'cookies',
  css: 'CSS',
  dns: 'DNS records',
  certIssuer: 'TLS certificate',
  html: 'HTML markup',
  meta: 'meta tags',
  scripts: 'inline or embedded script content',
  scriptSrc: 'external script URLs',
  js: 'JavaScript globals (window)',
  dom: 'DOM / page elements',
  text: 'visible page text',
  url: 'the page URL',
  robots: 'robots.txt',
  probe: 'probe requests',
  xhr: 'XHR / network responses',
}

/**
 * @param {string} [type]
 * @returns {string}
 */
function patternLocationPhrase(type) {
  if (!type) {
    return 'the page scan'
  }
  const t = String(type)
  if (t.startsWith('dom.')) {
    return 'DOM / page elements'
  }
  return PATTERN_TYPE_LABELS[t] || t.replace(/\./g, ' ')
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function truncateForProof(v) {
  const s = v == null ? '' : String(v)
  if (s.length <= PROOF_SNIPPET_MAX) {
    return s
  }
  return `${s.slice(0, PROOF_SNIPPET_MAX)}…`
}

/**
 * @param {object} p
 * @returns {string}
 */
function patternEvidencePhrase(p) {
  const match =
    p.match != null && String(p.match).trim() !== '' ? String(p.match) : ''
  const value = p.value
  if (match) {
    return truncateForProof(match)
  }
  if (value === true) {
    return 'a match (no short snippet)'
  }
  if (value != null && String(value).trim() !== '') {
    return truncateForProof(value)
  }
  return 'a match (no short snippet)'
}

/**
 * @param {object} tech
 * @param {Record<string, Array<object>>|undefined} patternsByName
 * @returns {string}
 */
function buildProof(tech, patternsByName) {
  const name = tech.name || 'this technology'
  const patternHits = patternsByName?.[tech.name] || []

  if (patternHits.length === 0) {
    const root = tech.rootPath === true ? ' (main document only)' : ''
    return (
      `No pattern detail was recorded in extended output${root}. ` +
      `${name} is still listed—usually because it was implied by another technology or matched indirectly.`
    )
  }

  const lines = patternHits.map((p) => {
    const where = patternLocationPhrase(p.type)
    const what = patternEvidencePhrase(p)
    return `Found “${what}” in ${where}.`
  })

  const closing = `That is why we report ${name} for this site.`
  return `${lines.join(' ')}\n${closing}`
}

/**
 * @param {{ technologies?: object[], patterns?: Record<string, object[]> }} results
 */
function mapWappalyzerTechnologies(results) {
  const patterns = results.patterns || {}
  return (results.technologies || []).map((tech) => ({
    name: tech.name,
    version: tech.version || null,
    proof: buildProof(tech, patterns),
  }))
}

module.exports = {
  buildProof,
  mapWappalyzerTechnologies,
}
