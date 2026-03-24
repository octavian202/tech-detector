#!/usr/bin/env node
'use strict'

/**
 * Downloads Wappalyzer-compatible technology trees from multiple sources,
 * deep-merges overlapping products, folds in rules/webanalyzer-supplement.json,
 * writes rules/merged/ and copies into node_modules/wappalyzer.
 *
 * Env:
 *   MERGE_SKIP_SOURCES=comma list of source ids to skip (e.g. httparchive,aliasio)
 *   MERGE_DRY_RUN=1 — fetch and count only, no write
 */

const { mergeAllTechnologyRules } = require('../lib/merge-all-technology-rules')

const skip = (process.env.MERGE_SKIP_SOURCES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const dryRun = process.env.MERGE_DRY_RUN === '1'

mergeAllTechnologyRules({ skipSources: skip, dryRun })
  .then((r) => {
    console.log('[merge-all-technologies] Done.', r)
    process.exit(0)
  })
  .catch((err) => {
    console.error('[merge-all-technologies] Failed:', err.message)
    process.exit(1)
  })
