'use strict'

const { URL } = require('url')

/**
 * E‑commerce / conversion paths (higher score = scan first).
 */
const ECOMMERCE_PATH_RE =
  /\/(product|products|shop|cart|item|checkout|collection|collections|store|catalog|blog|contact|apps|pages|my-account|product-category|a\/checkout)(\/|$)/i

/**
 * Static paths probed when HTML has few links (storefront, CMS, Shopify/Woo-style).
 * Order: higher-value commerce routes first, then content/support.
 */
const FALLBACK_PATHS = [
  '/cart',
  '/checkout',
  '/checkout/cart',
  '/a/checkout',
  '/products',
  '/shop',
  '/collections/all',
  '/store',
  '/catalog',
  '/product-category',
  '/my-account',
  '/blog',
  '/pages/contact',
  '/contact',
  '/apps',
]

/**
 * @param {string} href
 * @returns {string}
 */
function urlKey(href) {
  try {
    return new URL(href).href.split('#')[0]
  } catch {
    return href
  }
}

/**
 * Collect same-site http(s) links from HTML.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string[]}
 */
function collectInternalHrefs(html, baseUrl) {
  if (!html || !baseUrl) {
    return []
  }

  let base
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const baseHost = base.hostname.replace(/^www\./i, '')
  const hrefRe = /\bhref\s*=\s*["']([^"']+)["']/gi
  const candidates = []
  const seen = new Set()
  let m

  while ((m = hrefRe.exec(html)) !== null) {
    const raw = (m[1] || '').trim()
    if (
      !raw ||
      raw.startsWith('#') ||
      raw.toLowerCase().startsWith('javascript:') ||
      raw.toLowerCase().startsWith('mailto:') ||
      raw.toLowerCase().startsWith('tel:')
    ) {
      continue
    }

    let u
    try {
      u = new URL(raw, base)
    } catch {
      continue
    }

    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      continue
    }

    const linkHost = u.hostname.replace(/^www\./i, '')
    if (linkHost !== baseHost) {
      continue
    }

    const p = u.pathname.replace(/\/$/, '') || '/'
    const bp = base.pathname.replace(/\/$/, '') || '/'
    if (p === bp && u.search === base.search) {
      continue
    }

    const norm = u.href.split('#')[0]
    if (seen.has(norm)) {
      continue
    }
    seen.add(norm)
    candidates.push(norm)
  }

  return candidates
}

/**
 * Prefer e‑commerce paths, then shorter URLs (often more “root” pages).
 *
 * @param {string[]} hrefs
 * @returns {string[]}
 */
function sortByEcommercePriority(hrefs) {
  const scored = hrefs.map((href) => {
    let pathname = ''
    try {
      pathname = new URL(href).pathname
    } catch {
      pathname = ''
    }
    const ecommerce = ECOMMERCE_PATH_RE.test(pathname) ? 1 : 0
    return { href, ecommerce }
  })

  scored.sort((a, b) => {
    if (b.ecommerce !== a.ecommerce) {
      return b.ecommerce - a.ecommerce
    }
    return a.href.length - b.href.length
  })

  return scored.map((s) => s.href)
}

/**
 * Up to `maxCount` internal URLs from HTML, e‑commerce first.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} maxCount
 * @returns {string[]}
 */
function pickInternalPageUrls(html, baseUrl, maxCount) {
  if (maxCount <= 0) {
    return []
  }
  const raw = collectInternalHrefs(html, baseUrl)
  const sorted = sortByEcommercePriority(raw)
  return sorted.slice(0, maxCount)
}

/**
 * @param {string} baseUrl
 * @returns {string[]}
 */
function fallbackProbeUrls(baseUrl) {
  let base
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const out = []
  for (const p of FALLBACK_PATHS) {
    try {
      out.push(new URL(p, base).href)
    } catch {
      // skip
    }
  }
  return out
}

/**
 * Extra URLs for Wappalyzer: HTML-derived (priority) + static fallbacks until `maxExtra`.
 *
 * @param {string} html
 * @param {string} baseUrl
 * @param {number} maxExtra
 * @returns {string[]}
 */
function collectExtraWappalyzerUrls(html, baseUrl, maxExtra) {
  if (maxExtra <= 0) {
    return []
  }

  const homeKey = urlKey(baseUrl)
  const seen = new Set([homeKey])
  /** @type {string[]} */
  const out = []

  for (const href of pickInternalPageUrls(html, baseUrl, maxExtra + 8)) {
    const k = urlKey(href)
    if (seen.has(k)) {
      continue
    }
    seen.add(k)
    out.push(href)
    if (out.length >= maxExtra) {
      return out
    }
  }

  for (const href of sortByEcommercePriority(fallbackProbeUrls(baseUrl))) {
    const k = urlKey(href)
    if (seen.has(k)) {
      continue
    }
    seen.add(k)
    out.push(href)
    if (out.length >= maxExtra) {
      break
    }
  }

  return out
}

/**
 * @param {string} html
 * @param {string} baseUrl
 * @returns {string|null}
 */
function pickInternalPageUrl(html, baseUrl) {
  const u = pickInternalPageUrls(html, baseUrl, 1)
  return u[0] ?? null
}

module.exports = {
  pickInternalPageUrl,
  pickInternalPageUrls,
  collectExtraWappalyzerUrls,
  fallbackProbeUrls,
  ECOMMERCE_PATH_RE,
}
