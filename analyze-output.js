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
  for (const row of data) {
    const techs = Array.isArray(row.technologies) ? row.technologies : []
    for (const t of techs) {
      uniqueTechNames.add(t.name ?? '(unnamed)')
    }
  }

  console.log('=== wappalyzer-results summary ===\n')
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
}

main()
