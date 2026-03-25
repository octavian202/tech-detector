'use strict'

const parquet = require('parquetjs-lite')

const DOMAIN_COLUMN_CANDIDATES = [
  'domain',
  'root_domain',
  'hostname',
  'host',
  'url',
  'website',
  'site',
]

/**
 * @param {{ fields: Record<string, unknown> }} schema
 * @returns {string}
 */
function resolveDomainColumnName(schema) {
  const topLevel = Object.keys(schema.fields || {})
  const preferred = DOMAIN_COLUMN_CANDIDATES.find((name) =>
    topLevel.includes(name)
  )
  if (preferred) {
    return preferred
  }
  if (topLevel.length === 1) {
    return topLevel[0]
  }
  throw new Error(
    `Could not pick a domain column. Top-level columns: ${topLevel.join(', ')}. ` +
      `Expected one of: ${DOMAIN_COLUMN_CANDIDATES.join(', ')}`
  )
}

/**
 * @param {string} filePath
 * @returns {Promise<{ domains: string[], columnUsed: string }>}
 */
async function readParquetDomains(filePath) {
  const reader = await parquet.ParquetReader.openFile(filePath)
  try {
    const columnName = resolveDomainColumnName(reader.getSchema())
    const cursor = reader.getCursor([columnName])
    const domains = []
    let row
    while ((row = await cursor.next())) {
      const d = row[columnName]
      if (d != null && String(d).trim() !== '') {
        domains.push(String(d).trim())
      }
    }
    return { domains, columnUsed: columnName }
  } finally {
    await reader.close()
  }
}

module.exports = {
  readParquetDomains,
}
