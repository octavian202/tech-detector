'use strict'

/**
 * Idempotent patch: inject scroll-after-load into wappalyzer's driver (lazy scripts).
 * Re-runs safely on every npm install.
 */

const fs = require('fs')
const path = require('path')

const driverPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'wappalyzer',
  'driver.js'
)

if (!fs.existsSync(driverPath)) {
  process.exit(0)
}

let s = fs.readFileSync(driverPath, 'utf8')

if (s.includes('scrollPageForLazyContent')) {
  process.exit(0)
}

const SCROLL_FN = `
/**
 * Scroll the page to trigger lazy-loaded scripts (widgets, trackers, below-the-fold).
 * Best-effort; failures are ignored.
 * @param {import('puppeteer').Page} page
 */
async function scrollPageForLazyContent(page) {
  try {
    await page.evaluate(async () => {
      const delay = (ms) => new Promise((r) => setTimeout(r, ms))
      const step = () =>
        Math.max(320, Math.floor((window.innerHeight || 600) * 0.85))
      for (let i = 0; i < 7; i++) {
        const h = document.body ? document.body.scrollHeight : 0
        if (h < 1) break
        const remaining = h - (window.scrollY + (window.innerHeight || 0))
        if (remaining < 80) break
        window.scrollBy(0, step())
        await delay(380)
      }
      if (document.body) {
        window.scrollTo(0, document.body.scrollHeight)
        await delay(650)
        window.scrollTo(0, 0)
        await delay(220)
      }
    })
  } catch {
    // ignore
  }
}
`

const getJsAnchor = '\n\nfunction getJs(page, technologies = Wappalyzer.technologies) {'
if (!s.includes(getJsAnchor)) {
  process.stderr.write(
    'patch-wappalyzer-scroll: getJs anchor not found; skip (unexpected wappalyzer version?)\n'
  )
  process.exit(0)
}

s = s.replace(getJsAnchor, '\n' + SCROLL_FN + getJsAnchor)

const gotoSleepBlock = `      if (!this.options.noScripts) {
        await sleep(1000)
      }

      // page.on('console', (message) => this.log(message.text()))`

const gotoSleepBlockPatched = `      if (!this.options.noScripts) {
        await sleep(1000)
        await scrollPageForLazyContent(page)
      }

      // page.on('console', (message) => this.log(message.text()))`

if (!s.includes(gotoSleepBlock)) {
  process.stderr.write(
    'patch-wappalyzer-scroll: post-goto sleep block not found; skip\n'
  )
  process.exit(0)
}

s = s.replace(gotoSleepBlock, gotoSleepBlockPatched)
fs.writeFileSync(driverPath, s)
process.stderr.write('patch-wappalyzer-scroll: applied\n')
