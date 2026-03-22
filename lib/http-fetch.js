'use strict'

const http = require('http')
const https = require('https')
const { URL } = require('url')

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Minimal GET with timeout and redirect following (for HTML / robots).
 * @param {string} urlString
 * @param {{ timeoutMs?: number, maxRedirects?: number }} [opts]
 * @returns {Promise<string>}
 */
function fetchText(urlString, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 10_000
  const maxRedirects = opts.maxRedirects ?? 5

  return fetchOnce(urlString, timeoutMs, maxRedirects, 0)
}

/**
 * @param {string} urlString
 * @param {number} timeoutMs
 * @param {number} maxRedirects
 * @param {number} depth
 * @returns {Promise<string>}
 */
function fetchOnce(urlString, timeoutMs, maxRedirects, depth) {
  if (depth > maxRedirects) {
    return Promise.resolve('')
  }

  return new Promise((resolve, reject) => {
    let url
    try {
      url = new URL(urlString)
    } catch {
      resolve('')
      return
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      resolve('')
      return
    }

    const lib = url.protocol === 'https:' ? https : http

    const req = lib.request(
      url,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'User-Agent': DEFAULT_UA,
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        },
        rejectUnauthorized: false,
      },
      (res) => {
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          let next
          try {
            next = new URL(res.headers.location, url).href
          } catch {
            res.resume()
            resolve('')
            return
          }
          res.resume()
          fetchOnce(next, timeoutMs, maxRedirects, depth + 1)
            .then(resolve)
            .catch(() => resolve(''))
          return
        }

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          res.resume()
          resolve('')
          return
        }

        res.setEncoding('utf8')
        let body = ''
        res.on('data', (chunk) => {
          body += chunk
          if (body.length > 2_000_000) {
            req.destroy()
            resolve(body.slice(0, 2_000_000))
          }
        })
        res.on('end', () => resolve(body))
        res.on('error', () => resolve(''))
      }
    )

    req.on('timeout', () => {
      req.destroy()
      resolve('')
    })
    req.on('error', () => resolve(''))
    req.end()
  })
}

module.exports = {
  fetchText,
  DEFAULT_UA,
}
