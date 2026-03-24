'use strict'

/**
 * Single shared Puppeteer instance with stealth plugin (puppeteer-extra).
 * Used by dynamic analysis and (via postinstall patch) Wappalyzer's driver.
 */
const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')

puppeteer.use(StealthPlugin())

module.exports = puppeteer
