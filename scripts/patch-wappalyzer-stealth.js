#!/usr/bin/env node
'use strict'

/**
 * Idempotent: point wappalyzer's driver at project lib/puppeteer-stealth.js so
 * Wappalyzer and dynamic-analysis share one stealth-configured Puppeteer.
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

if (s.includes('PATCH_TECH_DETECTOR_STEALTH')) {
  process.exit(0)
}

const oldLine = `const puppeteer = require('puppeteer')`
const newBlock = `// PATCH_TECH_DETECTOR_STEALTH: shared stealth puppeteer (see lib/puppeteer-stealth.js)
const puppeteer = require(path.join(__dirname, '..', '..', 'lib', 'puppeteer-stealth.js'))`

if (!s.includes(oldLine)) {
  process.exit(0)
}

s = s.replace(oldLine, newBlock)
fs.writeFileSync(driverPath, s, 'utf8')
