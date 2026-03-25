'use strict'

/** Default Parquet input and JSON output (overridable via argv / env). */
const DEFAULT_INPUT = 'domains.snappy.parquet'
const DEFAULT_OUTPUT = 'output.json'

/** How many domains are analyzed in parallel (Puppeteer-heavy). */
const CONCURRENCY = 12

/** Puppeteer / Wappalyzer navigation & script budget (lazy trackers, hydration). */
const WAPPALYZER_MAX_WAIT_MS = 45_000
/** Spacing between recursive steps and probe batches (Wappalyzer internal). */
const WAPPALYZER_DELAY_MS = 2500
/** Homepage HTML fetch for internal link discovery. */
const HTML_FETCH_MS = 22_000
/** Extra URLs after desktop homepage (HTML + static fallbacks). */
const MAX_EXTRA_WAPPALYZER_URLS = 5
/** Mobile pass: homepage + up to this many extra URLs (keep small for runtime). */
const MAX_MOBILE_EXTRA_WAPPALYZER_URLS = 2
/** Deep crawl dynamic pages (single Chromium: homepage + up to N extras in series). */
const MAX_DYNAMIC_CRAWL_URLS = 5
/** Per dynamic page (~networkidle2 + SPA waits); batch uses one browser. */
const DYNAMIC_PAGE_TIMEOUT_MS = 32_000
/** Whole-domain budget for the dynamic layer (all targets in one Chromium). */
const DYNAMIC_BATCH_TIMEOUT_MS = 220_000
/**
 * Whole-domain budget: DNS + robots + desktop (1 + MAX_EXTRA) + mobile (1 + MAX_MOBILE_EXTRA)
 * Wappalyzer runs + probes. Scroll/viewport patches in `wappalyzer` driver.
 */
const DOMAIN_ANALYZE_TIMEOUT_MS = 420_000

module.exports = {
  DEFAULT_INPUT,
  DEFAULT_OUTPUT,
  CONCURRENCY,
  WAPPALYZER_MAX_WAIT_MS,
  WAPPALYZER_DELAY_MS,
  HTML_FETCH_MS,
  MAX_EXTRA_WAPPALYZER_URLS,
  MAX_MOBILE_EXTRA_WAPPALYZER_URLS,
  MAX_DYNAMIC_CRAWL_URLS,
  DYNAMIC_PAGE_TIMEOUT_MS,
  DYNAMIC_BATCH_TIMEOUT_MS,
  DOMAIN_ANALYZE_TIMEOUT_MS,
}
