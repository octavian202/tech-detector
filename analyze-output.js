'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_INPUT = path.join(__dirname, 'output.json')

function main() {
  const inputPath = process.argv[2] || DEFAULT_INPUT
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
  const countsPerDomain = []
  for (const row of data) {
    const techs = Array.isArray(row.technologies) ? row.technologies : []
    countsPerDomain.push(techs.length)
    for (const t of techs) {
      uniqueTechNames.add(t.name ?? '(unnamed)')
    }
  }

  const sorted = [...countsPerDomain].sort((a, b) => a - b)
  const n = sorted.length
  const median =
    n === 0 ? 0 : n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
  const avg = n === 0 ? 0 : totalDetections / n
  const min = n === 0 ? 0 : sorted[0]
  const max = n === 0 ? 0 : sorted[n - 1]

  console.log('=== wappalyzer-results summary ===\n')
  console.log(`Domains in file: ${data.length}`)
  console.log(
    `Domains with zero technologies: ${domainsWithNoTechnologies}`
  )
  console.log(
    `Total detections (sum of all “technologies” entries across domains): ${totalDetections}`
  )
  console.log(
    `Per domain: avg ${avg.toFixed(2)} | median ${median} | min ${min} | max ${max}`
  )
  console.log(
    `Distinct technology names (across all domains): ${uniqueTechNames.size}`
  )
  console.log(
    '\nNotes:'
  )
  console.log(
    '  • Total = sum of per-domain counts (after merge/dedup inside each domain).'
  )
  console.log(
    '  • Comparing totals across runs with different domain counts or different rulesets is misleading.'
  )
  console.log(
    '  • If total dropped sharply with the same Parquet: check USE_MERGED_RULES=0 (skips rules/merged), sync failures, or domain-level timeouts (empty technologies[]).'
  )
}

main()
