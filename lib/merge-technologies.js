'use strict'

/**
 * @typedef {{ name: string, version: string|null, proof: string }} Technology
 */

/**
 * Deduplicate by `name`; on conflict keep the entry with the longer `proof`.
 *
 * @param {...Technology[]} arrays
 * @returns {Technology[]}
 */
function mergeTechnologies(...arrays) {
  /** @type {Technology[]} */
  const flat = []
  for (const arr of arrays) {
    if (!Array.isArray(arr)) {
      continue
    }
    for (const t of arr) {
      if (!t || typeof t.name !== 'string') {
        continue
      }
      const ver =
        t.version === undefined || t.version === null || t.version === ''
          ? null
          : String(t.version)
      flat.push({
        name: t.name.trim(),
        version: ver,
        proof: typeof t.proof === 'string' ? t.proof : String(t.proof ?? ''),
      })
    }
  }

  /** @type {Map<string, Technology>} */
  const byName = new Map()

  for (const t of flat) {
    if (!t.name) {
      continue
    }
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

  return Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name)
  )
}

module.exports = {
  mergeTechnologies,
}
