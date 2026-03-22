'use strict'

/**
 * Idempotent: allow `new Wappalyzer({ viewport: { width, height, ... } })` for mobile passes.
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

if (s.includes('this.options.viewport')) {
  process.exit(0)
}

const before = `    await page.setUserAgent(this.options.userAgent)

    page.on('dialog', (dialog) => dialog.dismiss())`

const after = `    await page.setUserAgent(this.options.userAgent)

    if (this.options.viewport && typeof this.options.viewport === 'object') {
      try {
        await page.setViewport(this.options.viewport)
      } catch {
        // ignore
      }
    }

    page.on('dialog', (dialog) => dialog.dismiss())`

if (!s.includes(before)) {
  process.stderr.write(
    'patch-wappalyzer-viewport: anchor not found; skip (unexpected wappalyzer version?)\n'
  )
  process.exit(0)
}

s = s.replace(before, after)
fs.writeFileSync(driverPath, s)
process.stderr.write('patch-wappalyzer-viewport: applied\n')
