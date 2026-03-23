'use strict'

const { spawn } = require('child_process')

const WHATWEB_TIMEOUT_MS = 25_000

/**
 * Run WhatWeb as subprocess and parse JSON output.
 * Returns [] when WhatWeb is not installed or fails.
 *
 * @param {string} url
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Array<{ name: string, version: string|null, proof: string }>>}
 */
async function runWhatWeb(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? WHATWEB_TIMEOUT_MS
  return new Promise((resolve) => {
    let resolved = false
    const done = (result) => {
      if (resolved) return
      resolved = true
      try {
        sub?.kill('SIGKILL')
      } catch {}
      resolve(result)
    }

    const sub = spawn('whatweb', ['--color=never', '--no-errors', '-a', '1', '-j', url], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const timeout = setTimeout(() => {
      done([])
    }, timeoutMs)

    let stdout = ''
    let stderr = ''
    sub.stdout?.on('data', (chunk) => { stdout += chunk })
    sub.stderr?.on('data', (chunk) => { stderr += chunk })

    sub.on('error', () => {
      clearTimeout(timeout)
      done([])
    })
    sub.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0 || !stdout.trim()) {
        done([])
        return
      }
      try {
        const data = JSON.parse(stdout.trim())
        const targets = Array.isArray(data) ? data : [data]
        const techs = []
        const seen = new Set()
        for (const t of targets) {
          const plugins = t.plugins || {}
          for (const [name, info] of Object.entries(plugins)) {
            if (!name || seen.has(name)) continue
            seen.add(name)
            const version = info.version?.[0] ?? null
            const proof = info.string?.[0] || info.matches?.[0]?.string?.[0] || `WhatWeb detected ${name}`
            techs.push({
              name: String(name),
              version: version ? String(version) : null,
              proof: `Proof: WhatWeb — ${String(proof).slice(0, 180)}`,
            })
          }
        }
        done(techs)
      } catch {
        done([])
      }
    })
  })
}

/**
 * Check if WhatWeb is available on PATH.
 * @returns {Promise<boolean>}
 */
async function isWhatWebAvailable() {
  return new Promise((resolve) => {
    const sub = spawn('whatweb', ['--version'], { stdio: 'ignore', windowsHide: true })
    sub.on('error', () => resolve(false))
    sub.on('close', (code) => resolve(code === 0))
    setTimeout(() => {
      try { sub.kill('SIGKILL') } catch {}
      resolve(false)
    }, 3000)
  })
}

module.exports = {
  runWhatWeb,
  isWhatWebAvailable,
}
