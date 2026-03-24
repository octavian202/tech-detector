'use strict'

/**
 * @typedef {{ name: string, version: string|null, proof: string }} Technology
 */

/**
 * Canonical names for Wappalyzer / custom-rule duplicates (same product, different slug).
 *
 * Other ways to reduce duplicate *distinct* names in aggregates (not all wired here):
 * - Post-process `output.json` with the same map (`normalizeName` / `NAME_ALIASES`).
 * - Heuristic clustering (see analyze-output.js `namesLookSimilar`) for reporting only.
 * - IMPLIES: merge parent→child (e.g. drop “Google Ads Conversion Tracking” if “Google Ads” present).
 * - Fork/patch Wappalyzer `technologies.json` so rules emit one canonical name.
 */
/** @type {Record<string, string>} */
const NAME_ALIASES = {
  nginx: 'Nginx',
  apache: 'Apache HTTP Server',
  'apache http server': 'Apache HTTP Server',
  cloudflare: 'Cloudflare',
  vercel: 'Vercel',
  wordpress: 'WordPress',
  shopify: 'Shopify',
  'next.js': 'Next.js',
  nextjs: 'Next.js',
  react: 'React',
  express: 'Express',
  'node.js': 'Node.js',
  nodejs: 'Node.js',
  graphql: 'GraphQL',
  php: 'PHP',
  drupal: 'Drupal',
  joomla: 'Joomla',
  magento: 'Magento',
  gatsby: 'Gatsby',
  'nuxt.js': 'Nuxt.js',
  nuxtjs: 'Nuxt.js',
  'vue.js': 'Vue.js',
  vuejs: 'Vue.js',
  webpack: 'Webpack',
  angular: 'AngularJS',
  angularjs: 'AngularJS',

  // Duplicate detections (slug / casing / rebrand)
  jquery: 'jQuery',
  'google analytics': 'Google Analytics',
  'adobe experience manager': 'Adobe Experience Manager',
  'facebook pixel': 'Meta Pixel',
  'meta pixel': 'Meta Pixel',
  'demandware ecommerce system': 'Salesforce Commerce Cloud',
  'akamai-global-host': 'Akamai',
  'akamai global host': 'Akamai',
  // Same signal (fonts.googleapis.com); one product-facing name
  'google font api': 'Google Fonts',
  'google fonts': 'Google Fonts',
}

/** Implies: if A detected, also add B (only when B not already present) */
const IMPLIES = {
  'Next.js': ['React'],
  'Nuxt.js': ['Vue.js'],
  'Gatsby': ['React'],
}

/**
 * Lowercase, hyphen-as-space for alias lookup (covers `Google-Analytics` vs `Google Analytics`).
 * @param {string} raw
 * @returns {string}
 */
function normalizeName(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  const spaced = lower.replace(/-/g, ' ').replace(/\s+/g, ' ')
  const canon = NAME_ALIASES[lower] || NAME_ALIASES[spaced]
  return canon || trimmed
}

/**
 * Deduplicate by canonical name; on conflict keep the entry with the longer `proof`.
 * Applies alias normalization and implied technologies.
 *
 * @param {...Technology[]} arrays
 * @returns {Technology[]}
 */
function mergeTechnologies(...arrays) {
  /** @type {Technology[]} */
  const flat = []
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue
    for (const t of arr) {
      if (!t || typeof t.name !== 'string') continue
      const ver =
        t.version === undefined || t.version === null || t.version === ''
          ? null
          : String(t.version)
      const canon = normalizeName(t.name)
      if (!canon) continue
      flat.push({
        name: canon,
        version: ver,
        proof: typeof t.proof === 'string' ? t.proof : String(t.proof ?? ''),
      })
    }
  }

  /** @type {Map<string, Technology>} */
  const byName = new Map()

  for (const t of flat) {
    const existing = byName.get(t.name)
    if (!existing) {
      byName.set(t.name, { ...t })
      continue
    }
    const pl = (t.proof || '').length
    const el = (existing.proof || '').length
    if (pl > el) {
      byName.set(t.name, { ...t })
    }
  }

  for (const [tech, implied] of Object.entries(IMPLIES)) {
    if (!byName.has(tech)) continue
    for (const imp of implied) {
      if (!byName.has(imp)) {
        byName.set(imp, {
          name: imp,
          version: null,
          proof: `Proof: implied by ${tech}`,
        })
      }
    }
  }

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

module.exports = {
  mergeTechnologies,
  normalizeName,
  NAME_ALIASES,
}
