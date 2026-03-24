'use strict'

const PQueue = require('p-queue').default

const { withTimeout } = require('./async-utils')

/**
 * Run `analyzer(domain)` for each domain with a bounded concurrency queue.
 * Logs progress to the console; on error returns `{ domain, technologies: [] }`.
 *
 * @param {string[]} domains
 * @param {(d: string) => Promise<object>} analyzer
 * @param {{ concurrency: number, perDomainTimeoutMs: number }} opts
 * @returns {Promise<object[]>}
 */
async function runDomainsWithConcurrency(domains, analyzer, opts) {
  const { concurrency, perDomainTimeoutMs } = opts
  const total = domains.length
  let finished = 0
  const queue = new PQueue({ concurrency })

  return Promise.all(
    domains.map((domain) =>
      queue.add(async () => {
        try {
          const result = await withTimeout(
            analyzer(domain),
            perDomainTimeoutMs,
            `analyze ${domain}`
          )
          finished += 1
          console.log(`[${finished}/${total}] processed ${domain}`)
          return result
        } catch (err) {
          finished += 1
          const msg = err instanceof Error ? err.message : String(err)
          console.error(`[${finished}/${total}] ERROR ${domain}: ${msg}`)
          return { domain, technologies: [] }
        }
      })
    )
  )
}

module.exports = {
  runDomainsWithConcurrency,
}
