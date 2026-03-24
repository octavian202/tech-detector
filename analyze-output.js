'use strict'

const fs = require('fs')
const path = require('path')

const { normalizeName: canonicalTechName } = require('./lib/merge-technologies')

const DEFAULT_INPUT = path.join(__dirname, 'output.json')
const DEFAULT_OUTPUT = path.join(__dirname, 'output-results.json')

/** Lowercase, trim, collapse internal spaces — for comparison only. */
function normalizeName(s) {
  return String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

/** Classic Levenshtein distance (iterative, two rows). */
function levenshtein(a, b) {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    let cur0 = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      const ins = prev[j] + 1
      const del = cur0 + 1
      const sub = prev[j - 1] + cost
      const next = Math.min(ins, del, sub)
      prev[j - 1] = cur0
      cur0 = next
    }
    prev[n] = cur0
  }
  return prev[n]
}

/**
 * Heuristic: same tech / typo / parent–child name (e.g. "Squarespace" vs "Squarespace Commerce").
 * Avoids matching "java" inside "javascript" by requiring prefix + space for containment.
 * Levenshtein budget scales with length (avoids chaining unrelated 3–4 letter acronyms).
 */
function namesLookSimilar(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true

  const maxL = Math.max(na.length, nb.length)
  /** Avoid unrelated 3-letter acronyms (e.g. MUI vs YUI) matching by edit distance. */
  if (maxL <= 3) return false

  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na]
  if (short.length >= 4 && long.startsWith(short + ' ')) return true

  const lev = levenshtein(na, nb)
  /** Stricter on multi-word names (reduces “Google Ads” vs “Google Maps” spurious links). */
  const bothMultiWord = na.includes(' ') && nb.includes(' ')
  const scale = bothMultiWord ? 0.15 : 0.2
  const maxLev = Math.min(3, Math.max(1, Math.floor(maxL * scale)))
  if (lev <= maxLev) return true
  if (maxL > 12 && lev / maxL <= 0.15) return true
  return false
}

/**
 * For **merging aggregate counts** only: no “prefix + space” rule (avoids React vs React Native).
 * Slightly stricter Levenshtein than `namesLookSimilar`.
 */
function namesLookSimilarForMerge(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return false
  if (na === nb) return true

  const maxL = Math.max(na.length, nb.length)
  if (maxL <= 3) return false

  const lev = levenshtein(na, nb)
  const bothMultiWord = na.includes(' ') && nb.includes(' ')
  const scale = bothMultiWord ? 0.12 : 0.18
  const maxLev = Math.min(2, Math.max(1, Math.floor(maxL * scale)))
  if (lev <= maxLev) return true
  if (maxL > 14 && lev / maxL <= 0.11) return true
  return false
}

class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i)
  }
  find(i) {
    if (this.p[i] !== i) this.p[i] = this.find(this.p[i])
    return this.p[i]
  }
  union(i, j) {
    const pi = this.find(i)
    const pj = this.find(j)
    if (pi !== pj) this.p[pi] = pj
  }
}

function collectFieldStats(data) {
  const rowKeys = new Set()
  const techKeys = new Set()
  let techCount = 0
  let versionNull = 0
  let versionNonNull = 0
  let proofMissing = 0
  let proofEmpty = 0
  let nameMissing = 0
  const proofLengths = []

  for (const row of data) {
    if (row && typeof row === 'object') {
      for (const k of Object.keys(row)) rowKeys.add(k)
    }
    const techs = Array.isArray(row?.technologies) ? row.technologies : []
    for (const t of techs) {
      techCount += 1
      if (t && typeof t === 'object') {
        for (const k of Object.keys(t)) techKeys.add(k)
        if (t.name == null || t.name === '') nameMissing += 1
        if (t.version == null) versionNull += 1
        else versionNonNull += 1
        if (!('proof' in t)) proofMissing += 1
        else if (t.proof === '') proofEmpty += 1
        if (typeof t.proof === 'string') proofLengths.push(t.proof.length)
      }
    }
  }

  proofLengths.sort((a, b) => a - b)
  const median =
    proofLengths.length === 0
      ? 0
      : proofLengths.length % 2 === 1
        ? proofLengths[(proofLengths.length - 1) / 2]
        : (proofLengths[proofLengths.length / 2 - 1] +
            proofLengths[proofLengths.length / 2]) /
          2

  return {
    rowKeys: [...rowKeys].sort(),
    techKeys: [...techKeys].sort(),
    techCount,
    versionNull,
    versionNonNull,
    proofMissing,
    proofEmpty,
    nameMissing,
    proofLenMin: proofLengths[0] ?? 0,
    proofLenMax: proofLengths[proofLengths.length - 1] ?? 0,
    proofLenMedian: median,
  }
}

/**
 * Per raw name: total detections and set of domains (for domainCount).
 * @param {Array<{ domain?: string, technologies?: unknown[] }>} data
 * @returns {{ counts: Map<string, number>, domainsByName: Map<string, Set<string>> }}
 */
function aggregateTechnologyCounts(data) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @type {Map<string, Set<string>>} */
  const domainsByName = new Map()

  for (const row of data) {
    const domain = row?.domain != null ? String(row.domain) : ''
    const techs = Array.isArray(row?.technologies) ? row.technologies : []
    for (const t of techs) {
      const name = t?.name != null && t.name !== '' ? String(t.name) : '(unnamed)'
      counts.set(name, (counts.get(name) || 0) + 1)
      if (!domainsByName.has(name)) domainsByName.set(name, new Set())
      if (domain) domainsByName.get(name).add(domain)
    }
  }

  return { counts, domainsByName }
}

/**
 * Same as aggregateTechnologyCounts but keys by merge-technologies canonical name.
 * @param {Array<{ domain?: string, technologies?: unknown[] }>} data
 * @returns {{ counts: Map<string, number>, domainsByName: Map<string, Set<string>> }}
 */
function aggregateCanonicalCounts(data) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  /** @type {Map<string, Set<string>>} */
  const domainsByName = new Map()

  for (const row of data) {
    const domain = row?.domain != null ? String(row.domain) : ''
    const techs = Array.isArray(row?.technologies) ? row.technologies : []
    for (const t of techs) {
      const raw = t?.name != null && t.name !== '' ? String(t.name) : '(unnamed)'
      const name = canonicalTechName(raw) || raw
      counts.set(name, (counts.get(name) || 0) + 1)
      if (!domainsByName.has(name)) domainsByName.set(name, new Set())
      if (domain) domainsByName.get(name).add(domain)
    }
  }

  return { counts, domainsByName }
}

/**
 * Alias-uri (merge-technologies) + același nume indiferent de majuscule → o singură intrare,
 * cu reuniune de domenii (domainCount corect, fără dublare la același site).
 *
 * @returns {Array<{ name: string, detectionCount: number, domainCount: number, domains: Set<string> }>}
 */
function aggregateCaseFoldedCanonical(data) {
  /** @type {Map<string, { count: number, domains: Set<string>, variants: Map<string, number> }>} */
  const byLower = new Map()

  for (const row of data) {
    const domain = row?.domain != null ? String(row.domain) : ''
    const techs = Array.isArray(row?.technologies) ? row.technologies : []
    for (const t of techs) {
      const raw = t?.name != null && t.name !== '' ? String(t.name) : '(unnamed)'
      const canon = canonicalTechName(raw) || raw.trim()
      const key = canon === '(unnamed)' ? '(unnamed)' : canon.toLowerCase()
      if (!byLower.has(key)) {
        byLower.set(key, {
          count: 0,
          domains: new Set(),
          variants: new Map(),
        })
      }
      const b = byLower.get(key)
      b.count += 1
      if (domain) {
        b.domains.add(domain)
      }
      b.variants.set(canon, (b.variants.get(canon) || 0) + 1)
    }
  }

  const items = []
  for (const [key, b] of byLower) {
    let displayName = key
    let maxV = 0
    for (const [variant, c] of b.variants) {
      if (c > maxV || (c === maxV && String(variant).length > displayName.length)) {
        maxV = c
        displayName = variant
      }
    }
    items.push({
      name: displayName,
      detectionCount: b.count,
      domainCount: b.domains.size,
      domains: b.domains,
    })
  }
  return items
}

/**
 * Union-find pe nume după `namesLookSimilarForMerge`; însumează detecții și reuniune de domenii.
 *
 * @param {Array<{ name: string, detectionCount: number, domainCount: number, domains: Set<string> }>} items
 * @returns {{ list: Array<{ name: string, detectionCount: number, domainCount: number }>, distinctBefore: number, distinctAfter: number }}
 */
function mergeSimilarReportingItems(items) {
  const names = items.map((i) => i.name)
  const n = names.length
  const uf = new UnionFind(n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (namesLookSimilarForMerge(names[i], names[j])) {
        uf.union(i, j)
      }
    }
  }

  const roots = new Map()
  for (let i = 0; i < n; i++) {
    const r = uf.find(i)
    if (!roots.has(r)) {
      roots.set(r, [])
    }
    roots.get(r).push(items[i])
  }

  const list = []
  for (const group of roots.values()) {
    const domains = new Set()
    let detectionCount = 0
    /** @type {Map<string, number>} */
    const weightByName = new Map()
    for (const g of group) {
      detectionCount += g.detectionCount
      for (const d of g.domains) {
        domains.add(d)
      }
      weightByName.set(g.name, (weightByName.get(g.name) || 0) + g.detectionCount)
    }
    let repName = group[0].name
    let maxW = -1
    for (const [nm, w] of weightByName) {
      if (w > maxW || (w === maxW && nm.localeCompare(repName) < 0)) {
        maxW = w
        repName = nm
      }
    }
    list.push({
      name: repName,
      detectionCount,
      domainCount: domains.size,
    })
  }

  list.sort(
    (a, b) =>
      b.detectionCount - a.detectionCount || a.name.localeCompare(b.name)
  )

  return {
    list,
    distinctBefore: items.length,
    distinctAfter: list.length,
  }
}

function findSimilarNameGroups(names) {
  const list = [...names].sort((a, b) => a.localeCompare(b))
  const n = list.length
  const uf = new UnionFind(n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (namesLookSimilar(list[i], list[j])) uf.union(i, j)
    }
  }
  const rootToMembers = new Map()
  for (let i = 0; i < n; i++) {
    const r = uf.find(i)
    if (!rootToMembers.has(r)) rootToMembers.set(r, [])
    rootToMembers.get(r).push(list[i])
  }
  const groups = []
  for (const members of rootToMembers.values()) {
    if (members.length < 2) continue
    const sorted = [...members].sort((a, b) => a.localeCompare(b))
    groups.push(sorted)
  }
  groups.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]))
  return groups
}

/**
 * @param {Map<string, number>} counts
 * @param {Map<string, Set<string>>} domainsByName
 * @returns {Array<{ name: string, detectionCount: number, domainCount: number }>}
 */
function mapCountsToSortedList(counts, domainsByName) {
  const list = []
  for (const [name, detectionCount] of counts) {
    const domainCount = domainsByName.get(name)?.size ?? 0
    list.push({ name, detectionCount, domainCount })
  }
  list.sort(
    (a, b) =>
      b.detectionCount - a.detectionCount || a.name.localeCompare(b.name)
  )
  return list
}

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT
  const outputPath = process.argv[3] || DEFAULT_OUTPUT
  const raw = fs.readFileSync(inputPath, 'utf8')
  const data = JSON.parse(raw)

  if (!Array.isArray(data)) {
    console.error('File must be an array of per-domain results.')
    process.exit(1)
  }

  let totalDetections = 0
  let domainsWithNoTechnologies = 0

  for (const row of data) {
    const techs = Array.isArray(row.technologies) ? row.technologies : []
    totalDetections += techs.length
    if (techs.length === 0) {
      domainsWithNoTechnologies += 1
    }
  }

  const uniqueTechNames = new Set()
  for (const row of data) {
    const techs = Array.isArray(row.technologies) ? row.technologies : []
    for (const t of techs) {
      uniqueTechNames.add(t.name ?? '(unnamed)')
    }
  }

  const fieldStats = collectFieldStats(data)
  const { counts, domainsByName } = aggregateTechnologyCounts(data)
  const canonicalAgg = aggregateCanonicalCounts(data)
  const technologiesSorted = mapCountsToSortedList(counts, domainsByName)
  const technologiesCanonicalSorted = mapCountsToSortedList(
    canonicalAgg.counts,
    canonicalAgg.domainsByName
  )

  const foldedItems = aggregateCaseFoldedCanonical(data)
  const mergedReporting = mergeSimilarReportingItems(foldedItems)

  const similarGroups = findSimilarNameGroups(uniqueTechNames)

  /** Fișier de output: doar tehnologii distincte (canonical NAME_ALIASES + fold case + merge similitudine). */
  const outputPayload = {
    summary: {
      domainCount: data.length,
      domainsWithAtLeastOneTechnology: data.length - domainsWithNoTechnologies,
      domainsWithZeroTechnologies: domainsWithNoTechnologies,
      totalTechnologyDetections: totalDetections,
      distinctTechnologyCount: mergedReporting.distinctAfter,
    },
    technologies: mergedReporting.list,
  }

  fs.writeFileSync(outputPath, JSON.stringify(outputPayload, null, 2), 'utf8')

  console.log(`Written: ${path.resolve(outputPath)}\n`)
  console.log('=== wappalyzer-results summary ===\n')

  console.log('--- Tipul datelor (structură) ---')
  console.log(
    'Fișierul este un JSON: tablou de obiecte, câte unul per domeniu analizat.'
  )
  console.log(
    `Chei observate la nivel de rând: ${fieldStats.rowKeys.join(', ') || '(niciuna)'}`
  )
  console.log(
    `Chei observate pe fiecare intrare din “technologies”: ${fieldStats.techKeys.join(', ') || '(niciuna)'}`
  )
  console.log(
    'Semantica tipică: `domain` = hostname; `technologies` = listă de detectări; fiecare are `name`, opțional `version`, și `proof` (text explicativ).'
  )
  console.log('')
  console.log(`Intrări în tablou (domenii): ${data.length}`)
  console.log(`Total înregistrări “technologies” (detecții): ${fieldStats.techCount}`)
  console.log(`  • cu version null: ${fieldStats.versionNull}`)
  console.log(`  • cu version setat: ${fieldStats.versionNonNull}`)
  console.log(`  • name lipsă/gol: ${fieldStats.nameMissing}`)
  console.log(
    `  • proof lipsă ca proprietate: ${fieldStats.proofMissing}; proof string gol: ${fieldStats.proofEmpty}`
  )
  if (fieldStats.techCount > 0) {
    console.log(
      `  • lungime proof (caractere): min ${fieldStats.proofLenMin}, mediană ~${Math.round(fieldStats.proofLenMedian)}, max ${fieldStats.proofLenMax}`
    )
  }
  console.log('')

  console.log('--- Agregate (ca înainte) ---')
  console.log(`Domains in file: ${data.length}`)
  console.log(
    `Domains with zero technologies: ${domainsWithNoTechnologies}`
  )
  console.log(
    `Total detections (sum of all “technologies” entries across domains): ${totalDetections}`
  )
  console.log(
    `Distinct technology names (across all domains): ${uniqueTechNames.size}`
  )
  console.log(
    `(consolă) După doar aliasuri NAME_ALIASES: ${canonicalAgg.counts.size} nume`
  )
  console.log(
    `După alias + fold case: ${foldedItems.length} nume distincte`
  )
  console.log(
    `După + merge similitudine → scris în fișier ca distinctTechnologyCount: ${mergedReporting.distinctAfter} (reduse față de fold cu ${mergedReporting.distinctBefore - mergedReporting.distinctAfter})`
  )
  console.log(
    'Fișierul JSON: doar `technologies` (distincte canonice) + `summary`.'
  )
  console.log('')

  console.log('--- (doar consolă) Nume foarte similare în date brute ---')
  console.log(
    'Reguli: același text după normalizare (ex. diferențe de majuscule); prefix “Nume …” (ex. părinte–copil); distanță Levenshtein mică (prag mai strict dacă ambele nume au mai multe cuvinte).'
  )
  if (similarGroups.length === 0) {
    console.log('Nu s-au găsit perechi/grupuri de nume similare.')
  } else {
    console.log(`Grupuri găsite: ${similarGroups.length}\n`)
    for (let g = 0; g < similarGroups.length; g++) {
      const grp = similarGroups[g]
      console.log(`[${g + 1}] (${grp.length} nume)`)
      for (const name of grp) {
        console.log(`    • ${name}`)
      }
      console.log('')
    }
  }
}

main()
