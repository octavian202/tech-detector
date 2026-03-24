'use strict'

const { fetchText, fetchTextWithMeta } = require('./http-fetch')

/** Endpoint probes: path -> tech if body matches pattern */
const ENDPOINT_PROBES = [
  { path: '/wp-json/wp/v2/', tech: 'WordPress', re: /wp:featuredmedia|wp:term|wp:categories|"id":\s*\d+/ },
  { path: '/wp-json/', tech: 'WordPress', re: /"namespace"|"name":\s*"wp\/v2"/ },
  { path: '/graphql', tech: 'GraphQL', re: /"data"|"errors"|__schema|"query"/ },
  { path: '/api/graphql', tech: 'GraphQL', re: /"data"|"errors"|__schema|"query"/ },
  { path: '/humans.txt', tech: null, re: null },
]

/** humans.txt body patterns */
const HUMANS_TXT_RULES = [
  { re: /wordpress/i, tech: 'WordPress' },
  { re: /shopify/i, tech: 'Shopify' },
  { re: /react/i, tech: 'React' },
  { re: /next\.js/i, tech: 'Next.js' },
  { re: /gatsby/i, tech: 'Gatsby' },
]

function add(out, seen, name, proof) {
  if (!name || seen.has(name)) {
    return
  }
  seen.add(name)
  out.push({ name, version: null, proof })
}

function detectFromText(text, out, seen, source) {
  const t = String(text || '')
  if (!t) {
    return
  }
  if (/\/wp-admin|\/wp-content|wp-sitemap/i.test(t)) {
    add(out, seen, 'WordPress', `Proof: ${source} references WordPress paths`)
  }
  if (/\/skin\/frontend|\/mage|\/static\/version/i.test(t)) {
    add(out, seen, 'Magento', `Proof: ${source} references Magento paths`)
  }
  if (/\/sites\/default|\/core\//i.test(t)) {
    add(out, seen, 'Drupal', `Proof: ${source} references Drupal paths`)
  }
  if (/nginx/i.test(t) && /404|not found/i.test(t)) {
    add(out, seen, 'Nginx', `Proof: ${source} has Nginx-style 404 signature`)
  }
  if (/apache/i.test(t) && /404|not found/i.test(t)) {
    add(out, seen, 'Apache HTTP Server', `Proof: ${source} has Apache-style 404 signature`)
  }
}

async function analyzeHiddenSurfaces(url, hostname) {
  const out = []
  const seen = new Set()
  const baseHttps = `https://${hostname}`

  const robots = await fetchText(`${baseHttps}/robots.txt`, {
    timeoutMs: 7000,
    maxRedirects: 4,
  }).catch(() => '')
  detectFromText(robots, out, seen, 'robots.txt')

  const sitemap = await fetchText(`${baseHttps}/sitemap.xml`, {
    timeoutMs: 7000,
    maxRedirects: 4,
  }).catch(() => '')
  detectFromText(sitemap, out, seen, 'sitemap.xml')

  const forced404 = await fetchText(`${url.replace(/\/$/, '')}/this-page-does-not-exist-123`, {
    timeoutMs: 9000,
    maxRedirects: 2,
  }).catch(() => '')
  detectFromText(forced404, out, seen, 'forced 404 page')

  const base = baseHttps.replace(/\/$/, '')
  for (const probe of ENDPOINT_PROBES) {
    try {
      const res = await fetchTextWithMeta(`${base}${probe.path}`, {
        timeoutMs: 6000,
        maxRedirects: 2,
      })
      if (!res.body || (res.statusCode && res.statusCode !== 200)) continue
      if (probe.tech && probe.re && probe.re.test(res.body)) {
        add(out, seen, probe.tech, `Proof: ${probe.path} returned ${probe.tech} signature`)
      }
      if (probe.path === '/humans.txt' && String(res.body || '').length > 5) {
        for (const r of HUMANS_TXT_RULES) {
          if (r.re.test(res.body)) add(out, seen, r.tech, `Proof: humans.txt references ${r.tech}`)
        }
      }
    } catch {
      // ignore probe failures
    }
  }

  return out
}

module.exports = {
  analyzeHiddenSurfaces,
}
