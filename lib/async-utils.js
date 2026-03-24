'use strict'

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<T>}
 */
function withTimeout(promise, ms, label) {
  let timeoutId
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`))
    }, ms)
  })
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeoutPromise,
  ])
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDurationMs(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)} ms`
  }
  const totalSeconds = ms / 1000
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(2)} s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  if (minutes < 60) {
    return `${minutes} min ${seconds} s`
  }
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return `${hours} h ${remMin} min ${seconds} s`
}

module.exports = {
  withTimeout,
  formatDurationMs,
}
