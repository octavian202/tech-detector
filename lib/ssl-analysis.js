'use strict'

const tls = require('tls')

function truncate(value, max = 220) {
  if (!value) {
    return ''
  }
  const s = String(value)
  return s.length <= max ? s : `${s.slice(0, max)}...`
}

function pushTech(acc, seen, name, proof) {
  if (!name || seen.has(name)) {
    return
  }
  seen.add(name)
  acc.push({ name, version: null, proof })
}

function detectFromCertificate(cert, out, seen) {
  if (!cert) {
    return
  }
  const issuer = cert.issuer || {}
  const issuerStr = JSON.stringify(issuer).toLowerCase()
  const san = String(cert.subjectaltname || '').toLowerCase()

  if (issuerStr.includes("let's encrypt") || issuerStr.includes('letsencrypt')) {
    pushTech(out, seen, "Let's Encrypt", `Proof: TLS issuer ${truncate(issuerStr)}`)
  }
  if (issuerStr.includes('cloudflare')) {
    pushTech(out, seen, 'Cloudflare', `Proof: TLS issuer ${truncate(issuerStr)}`)
  }
  if (issuerStr.includes('amazon') || san.includes('amazonaws.com')) {
    pushTech(
      out,
      seen,
      'Amazon Web Services',
      `Proof: TLS issuer/SAN references AWS (${truncate(issuerStr || san)})`
    )
  }
  if (issuerStr.includes('digicert')) {
    pushTech(out, seen, 'DigiCert', `Proof: TLS issuer ${truncate(issuerStr)}`)
  }
  if (issuerStr.includes('sectigo') || issuerStr.includes('comodo')) {
    pushTech(out, seen, 'Sectigo', `Proof: TLS issuer ${truncate(issuerStr)}`)
  }
}

function getPeerCertificate(hostname, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: hostname,
        port: 443,
        servername: hostname,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate(true)
          socket.end()
          resolve(cert)
        } catch (err) {
          socket.destroy()
          reject(err)
        }
      }
    )

    socket.setTimeout(timeoutMs, () => {
      socket.destroy(new Error('TLS timeout'))
    })
    socket.on('error', reject)
  })
}

async function analyzeSsl(hostname, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 7000
  const out = []
  const seen = new Set()
  try {
    const cert = await getPeerCertificate(hostname, timeoutMs)
    detectFromCertificate(cert, out, seen)
  } catch {
    // ignore
  }
  return out
}

module.exports = {
  analyzeSsl,
}
