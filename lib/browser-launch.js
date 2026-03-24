'use strict'

const puppeteer = require('./puppeteer-stealth')

/**
 * Chromium args for the dynamic scan browser.
 * Optional env:
 * - PUPPETEER_PROXY / WAPPALYZER_PROXY — e.g. http://host:port or socks5://host:port (residential or datacenter)
 * - CHROMIUM_EXTRA_ARGS — space-separated extra flags
 */
function buildLaunchArgs() {
  const args = ['--no-sandbox', '--disable-setuid-sandbox']
  const proxy = process.env.PUPPETEER_PROXY || process.env.WAPPALYZER_PROXY
  if (proxy && !args.some((a) => a.startsWith('--proxy-server='))) {
    args.push(`--proxy-server=${proxy}`)
  }
  const extra = process.env.CHROMIUM_EXTRA_ARGS
  if (extra) {
    args.push(...String(extra).split(/\s+/).filter(Boolean))
  }
  return args
}

module.exports = {
  puppeteer,
  buildLaunchArgs,
}
