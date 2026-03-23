'use strict'

/**
 * @typedef {{ name: string, version: string|null, proof: string }} Technology
 */

/** Normalize tech names to canonical form (case + aliases) */
const NAME_ALIASES = {
  'nginx': 'Nginx',
  'apache': 'Apache HTTP Server',
  'apache http server': 'Apache HTTP Server',
  'cloudflare': 'Cloudflare',
  'vercel': 'Vercel',
  'wordpress': 'WordPress',
  'shopify': 'Shopify',
  'next.js': 'Next.js',
  'nextjs': 'Next.js',
  'react': 'React',
  'express': 'Express',
  'node.js': 'Node.js',
  'nodejs': 'Node.js',
  'graphql': 'GraphQL',
  'php': 'PHP',
  'drupal': 'Drupal',
  'joomla': 'Joomla',
  'magento': 'Magento',
  'gatsby': 'Gatsby',
  'nuxt.js': 'Nuxt.js',
  'nuxtjs': 'Nuxt.js',
  'vue.js': 'Vue.js',
  'vuejs': 'Vue.js',
  'webpack': 'Webpack',
  'angular': 'AngularJS',
  'angularjs': 'AngularJS',
}

/** Implies: if A detected, also add B (only when B not already present) */
const IMPLIES = {
  'Next.js': ['React'],
  'Nuxt.js': ['Vue.js'],
  'Gatsby': ['React'],
}

function normalizeName(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  return NAME_ALIASES[lower] || trimmed
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
}
