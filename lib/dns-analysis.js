'use strict'

const dns = require('dns/promises')

/** @typedef {{ name: string, version: null, proof: string }} DnsTech */

/**
 * Map MX exchange hostnames to Wappalyzer technology names (exact catalog names).
 * @param {string} exchange
 * @returns {string|null}
 */
function mapMxTechnology(exchange) {
  const h = exchange.toLowerCase()

  if (
    h.includes('google.com') ||
    h.includes('googlemail.com') ||
    h.includes('aspmx') ||
    h.includes('smtp.google.com')
  ) {
    return 'Google Workspace'
  }
  if (
    h.includes('outlook.com') ||
    h.includes('protection.outlook.com') ||
    h.includes('microsoft.com') ||
    h.includes('hotmail.com') ||
    h.includes('office365')
  ) {
    return 'Microsoft 365'
  }
  if (h.includes('zoho')) {
    return 'Zoho Mail'
  }
  if (h.includes('protonmail') || h.includes('proton.me')) {
    return 'Proton Mail'
  }
  if (h.includes('mailgun')) {
    return 'Mailgun'
  }
  if (h.includes('sendgrid')) {
    return 'SendGrid'
  }
  if (h.includes('amazonses') || h.includes('amazonaws.com')) {
    return 'Amazon SES'
  }
  if (h.includes('mimecast')) {
    return null
  }
  if (h.includes('yahoo.com') || h.includes('yahoodns')) {
    return null
  }

  return null
}

/**
 * Scan flattened TXT content for SPF / verification tokens.
 * @param {string} text
 * @returns {Array<{ name: string, proof: string }>}
 */
function mapTxtTechnologies(text) {
  const lower = text.toLowerCase()
  /** @type {Array<{ name: string, proof: string }>} */
  const out = []

  const push = (name, proof) => {
    if (!out.some((x) => x.name === name)) {
      out.push({ name, proof })
    }
  }

  if (lower.includes('include:sendgrid.net') || lower.includes('sendgrid')) {
    push(
      'SendGrid',
      `Proof: TXT record references SendGrid (${truncate(text, 200)})`
    )
  }
  if (lower.includes('include:mailgun.org') || lower.includes('mailgun')) {
    push(
      'Mailgun',
      `Proof: TXT record references Mailgun (${truncate(text, 200)})`
    )
  }
  if (
    lower.includes('include:amazonses.com') ||
    lower.includes('amazonses.com')
  ) {
    push(
      'Amazon SES',
      `Proof: TXT record references Amazon SES (${truncate(text, 200)})`
    )
  }
  if (
    lower.includes('include:_spf.google.com') ||
    lower.includes('include:spf.google.com')
  ) {
    push(
      'Google Workspace',
      `Proof: TXT/SPF includes Google (_spf.google.com) (${truncate(text, 200)})`
    )
  }
  if (
    lower.includes('include:spf.protection.outlook.com') ||
    lower.includes('spf.protection.outlook.com')
  ) {
    push(
      'Microsoft 365',
      `Proof: TXT/SPF includes Microsoft 365 (spf.protection.outlook.com) (${truncate(text, 200)})`
    )
  }
  if (lower.includes('stripe-verification')) {
    push(
      'Stripe',
      `Proof: TXT record contains stripe-verification (${truncate(text, 200)})`
    )
  }
  if (lower.includes('atlassian-domain-verification')) {
    push(
      'Atlassian Jira',
      `Proof: TXT record contains atlassian-domain-verification (${truncate(text, 200)})`
    )
  }

  return out
}

/**
 * @param {string} s
 * @param {number} max
 */
function truncate(s, max) {
  if (s.length <= max) {
    return s
  }
  return `${s.slice(0, max)}…`
}

/**
 * @param {string} hostname
 * @returns {Promise<DnsTech[]>}
 */
async function analyzeDns(hostname) {
  const apex = hostname.replace(/^www\./i, '')
  /** @type {DnsTech[]} */
  const results = []
  const seen = new Set()

  try {
    const mxRecords = await dns.resolveMx(apex)
    for (const { exchange } of mxRecords) {
      const tech = mapMxTechnology(exchange)
      if (!tech || seen.has(tech)) {
        continue
      }
      seen.add(tech)
      results.push({
        name: tech,
        version: null,
        proof: `Proof: MX record contains ${exchange}`,
      })
    }
  } catch {
    // ENODATA, ENOTFOUND, etc.
  }

  try {
    const txtChunks = await dns.resolveTxt(apex)
    const flat = txtChunks.map((a) => a.join('')).join('\n')
    for (const { name, proof } of mapTxtTechnologies(flat)) {
      if (seen.has(name)) {
        continue
      }
      seen.add(name)
      results.push({
        name,
        version: null,
        proof,
      })
    }
  } catch {
    // ignore
  }

  const cnameTechHints = [
    {
      name: 'Cloudflare',
      match: (t) => t.includes('cdn.cloudflare.net') || t.includes('cloudflare'),
    },
    { name: 'Fastly', match: (t) => t.includes('fastly.net') },
    { name: 'Shopify', match: (t) => t.includes('myshopify.com') },
    {
      name: 'Vercel',
      match: (t) => t.includes('vercel-dns.com') || t.includes('vercel.app'),
    },
    { name: 'Netlify', match: (t) => t.includes('netlify.app') },
  ]

  try {
    const cname = await dns.resolveCname(hostname)
    for (const target of cname) {
      const t = String(target).toLowerCase()
      for (const hint of cnameTechHints) {
        if (hint.match(t) && !seen.has(hint.name)) {
          seen.add(hint.name)
          results.push({
            name: hint.name,
            version: null,
            proof: `Proof: CNAME target contains ${target}`,
          })
        }
      }
    }
  } catch {
    // ignore
  }

  return results
}

module.exports = {
  analyzeDns,
}
