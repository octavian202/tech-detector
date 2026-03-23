'use strict'

/**
 * Scans HTML, headers, and other signals for technology fingerprints
 * not covered by Wappalyzer: HTML comments, CSP, link rel, meta generator.
 */

function add(out, seen, name, proof) {
  if (!name || seen.has(name)) return
  seen.add(name)
  out.push({ name, version: null, proof })
}

/** HTML comment patterns: <!-- ... --> */
const HTML_COMMENT_RULES = [
  { re: /<!--\s*wordpress/i, tech: 'WordPress' },
  { re: /<!--\s*generator:?\s*wordpress/i, tech: 'WordPress' },
  { re: /<!--\s*built with\s*shopify/i, tech: 'Shopify' },
  { re: /<!--\s*shopify/i, tech: 'Shopify' },
  { re: /<!--\s*wix\.com/i, tech: 'Wix' },
  { re: /<!--\s*\[if\s+IE\]/i, tech: 'Microsoft Internet Explorer' },
  { re: /<!--\s*weebly/i, tech: 'Weebly' },
  { re: /<!--\s*powered by\s*joomla/i, tech: 'Joomla' },
  { re: /<!--\s*joomla/i, tech: 'Joomla' },
  { re: /<!--\s*drupal/i, tech: 'Drupal' },
  { re: /<!--\s*react[- ]?(native|dom)?/i, tech: 'React' },
  { re: /<!--\s*nginx/i, tech: 'Nginx' },
  { re: /<!--\s*php/i, tech: 'PHP' },
  { re: /<!--\s*ghost/i, tech: 'Ghost' },
  { re: /<!--\s*elementor/i, tech: 'Elementor' },
  { re: /<!--\s*gatsby/i, tech: 'Gatsby' },
  { re: /<!--\s*nuxt/i, tech: 'Nuxt.js' },
  { re: /<!--\s*next\.js/i, tech: 'Next.js' },
]

/** CSP directive domain patterns */
const CSP_DOMAIN_RULES = [
  { re: /['"]https?:\/\/[^'"]*\.stripe\.com/i, tech: 'Stripe' },
  { re: /['"]https?:\/\/[^'"]*\.segment\.com/i, tech: 'Segment' },
  { re: /['"]https?:\/\/[^'"]*\.google-analytics\.com/i, tech: 'Google Analytics' },
  { re: /['"]https?:\/\/[^'"]*googletagmanager\.com/i, tech: 'Google Tag Manager' },
  { re: /['"]https?:\/\/[^'"]*\.facebook\.net/i, tech: 'Meta Pixel' },
  { re: /['"]https?:\/\/[^'"]*\.algolia\.net/i, tech: 'Algolia' },
  { re: /['"]https?:\/\/[^'"]*\.intercom\.io/i, tech: 'Intercom' },
  { re: /['"]https?:\/\/[^'"]*\.sentry\.io/i, tech: 'Sentry' },
  { re: /['"]https?:\/\/[^'"]*\.hotjar\.com/i, tech: 'Hotjar' },
  { re: /['"]https?:\/\/[^'"]*\.cloudflare\.com/i, tech: 'Cloudflare' },
]

/** link rel dns-prefetch / preconnect href domains */
const LINK_REL_DOMAIN_RULES = [
  { re: /googleapis\.com|gstatic\.com/, tech: 'Google Fonts' },
  { re: /fonts\.googleapis\.com/, tech: 'Google Fonts' },
  { re: /googletagmanager\.com|google-analytics\.com/, tech: 'Google Tag Manager' },
  { re: /stripe\.com/, tech: 'Stripe' },
  { re: /facebook\.net|connect\.facebook\.net/, tech: 'Meta Pixel' },
  { re: /cloudflare\.com/, tech: 'Cloudflare' },
  { re: /cdn\.shopify\.com|myshopify\.com/, tech: 'Shopify' },
  { re: /vercel\.com|vercel\.insights/, tech: 'Vercel' },
  { re: /segment\.com/, tech: 'Segment' },
  { re: /intercom\.io/, tech: 'Intercom' },
  { re: /sentry\.io/, tech: 'Sentry' },
  { re: /algolia\.net/, tech: 'Algolia' },
]

/** meta generator patterns */
const META_GENERATOR_RULES = [
  { re: /wordpress/i, tech: 'WordPress' },
  { re: /joomla/i, tech: 'Joomla' },
  { re: /drupal/i, tech: 'Drupal' },
  { re: /shopify/i, tech: 'Shopify' },
  { re: /wix/i, tech: 'Wix' },
  { re: /squarespace/i, tech: 'Squarespace' },
  { re: /webflow/i, tech: 'Webflow' },
  { re: /ghost/i, tech: 'Ghost' },
  { re: /elementor/i, tech: 'Elementor' },
  { re: /gatsby/i, tech: 'Gatsby' },
  { re: /next\.js/i, tech: 'Next.js' },
  { re: /nuxt/i, tech: 'Nuxt.js' },
]

function scanHtmlComments(html, out, seen) {
  const s = String(html || '')
  const comments = s.match(/<!--[\s\S]*?-->/g) || []
  const joined = comments.join(' ')
  for (const rule of HTML_COMMENT_RULES) {
    if (rule.re.test(joined)) {
      add(out, seen, rule.tech, `Proof: HTML comment contains ${rule.tech} fingerprint`)
    }
  }
}

function scanCsp(headers, out, seen) {
  const csp = headers?.['content-security-policy'] || headers?.['content-security-policy-report-only'] || ''
  if (!csp) return
  for (const rule of CSP_DOMAIN_RULES) {
    if (rule.re.test(csp)) {
      add(out, seen, rule.tech, `Proof: CSP header references ${rule.tech}`)
    }
  }
}

function scanLinkRel(html, out, seen) {
  const s = String(html || '')
  const matches = s.matchAll(
    /<link[^>]+rel\s*=\s*["']?(?:dns-prefetch|preconnect)["']?[^>]+href\s*=\s*["']([^"']+)["']/gi
  )
  for (const m of matches) {
    const href = (m[1] || '').toLowerCase()
    for (const rule of LINK_REL_DOMAIN_RULES) {
      if (rule.re.test(href)) {
        add(out, seen, rule.tech, `Proof: link rel dns-prefetch/preconnect to ${rule.tech} domain`)
      }
    }
  }
  const hrefMatches = s.matchAll(/<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']?(?:dns-prefetch|preconnect)["']?/gi)
  for (const m of hrefMatches) {
    const href = (m[1] || '').toLowerCase()
    for (const rule of LINK_REL_DOMAIN_RULES) {
      if (rule.re.test(href)) {
        add(out, seen, rule.tech, `Proof: link rel dns-prefetch/preconnect to ${rule.tech} domain`)
      }
    }
  }
}

function scanMetaGenerator(html, out, seen) {
  const s = String(html || '')
  const genMatch = s.match(/<meta[^>]+name\s*=\s*["']generator["'][^>]+content\s*=\s*["']([^"']+)["']/i)
  if (!genMatch) return
  const content = genMatch[1] || ''
  for (const rule of META_GENERATOR_RULES) {
    if (rule.re.test(content)) {
      add(out, seen, rule.tech, `Proof: meta generator="${content.slice(0, 80)}"`)
    }
  }
}

/**
 * Run all signal scanners and return detected technologies.
 *
 * @param {{ html?: string, headers?: Record<string, string> }} signals
 * @returns {Array<{ name: string, version: string|null, proof: string }>}
 */
function scanSignals(signals = {}) {
  const out = []
  const seen = new Set()
  const html = signals.html || ''
  const headers = signals.headers || {}

  scanHtmlComments(html, out, seen)
  scanCsp(headers, out, seen)
  scanLinkRel(html, out, seen)
  scanMetaGenerator(html, out, seen)

  return out
}

module.exports = {
  scanSignals,
}
