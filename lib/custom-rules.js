'use strict'

const fs = require('fs/promises')
const path = require('path')
const { loadSupplement } = require('./webanalyzer-sync')

const DEFAULT_RULES_PATH = path.join(process.cwd(), 'rules', 'custom-rules.json')

const DEFAULT_RULES = {
  technologies: [
    { name: 'Cloudflare', headers: [{ key: 'server', regex: 'cloudflare' }, { key: 'cf-ray', regex: '.+' }], scriptSrc: [{ regex: '/cdn-cgi/' }] },
    { name: 'Vercel', headers: [{ key: 'x-vercel-id', regex: '.+' }], url: [{ regex: 'vercel\\.app' }] },
    { name: 'Next.js', html: [{ regex: '__NEXT_DATA__' }], scriptSrc: [{ regex: '/_next/static/' }], window: [{ key: '__NEXT_DATA__' }] },
    { name: 'Nuxt.js', html: [{ regex: '__NUXT__|__NUXT_DATA__' }], scriptSrc: [{ regex: '/_nuxt/' }], window: [{ key: '__NUXT__' }] },
    { name: 'Gatsby', scriptSrc: [{ regex: '/webpack\\.runtime|gatsby' }], html: [{ regex: 'gatsby' }] },
    { name: 'WordPress', html: [{ regex: '/wp-content/|wp-includes|wp-json' }], scriptSrc: [{ regex: '/wp-content/|wp-includes/' }], url: [{ regex: 'wp-json' }] },
    { name: 'Shopify', html: [{ regex: 'Shopify|shopify' }], scriptSrc: [{ regex: 'cdn\\.shopify|myshopify' }], url: [{ regex: 'shopify|myshopify' }] },
    { name: 'React', scriptSrc: [{ regex: 'react\\.production|react-dom|react\\.development' }], html: [{ regex: 'data-reactroot|__react' }], window: [{ key: 'React' }] },
    { name: 'Vue.js', scriptSrc: [{ regex: 'vue\\.runtime|vue\\.min' }], html: [{ regex: 'v-app|data-v-' }], window: [{ key: 'Vue' }] },
    { name: 'jQuery', scriptSrc: [{ regex: 'jquery[.-]' }], html: [{ regex: 'jquery' }], window: [{ key: 'jQuery' }] },
    { name: 'Bootstrap', html: [{ regex: 'bootstrap' }], scriptSrc: [{ regex: 'bootstrap' }] },
    { name: 'Tailwind CSS', html: [{ regex: 'tailwind' }], scriptSrc: [{ regex: 'tailwind' }] },
    { name: 'Google Analytics', scriptSrc: [{ regex: 'google-analytics|googletagmanager\\.com/gtag' }], url: [{ regex: 'google-analytics|googletagmanager' }] },
    { name: 'Google Tag Manager', scriptSrc: [{ regex: 'googletagmanager' }], url: [{ regex: 'googletagmanager' }] },
    { name: 'Hotjar', scriptSrc: [{ regex: 'static\\.hotjar' }], url: [{ regex: 'hotjar' }] },
    { name: 'Stripe', scriptSrc: [{ regex: 'js\\.stripe\\.com' }], url: [{ regex: 'stripe\\.com' }] },
    { name: 'Intercom', scriptSrc: [{ regex: 'intercom' }], url: [{ regex: 'intercom' }] },
    { name: 'Sentry', scriptSrc: [{ regex: 'sentry' }], url: [{ regex: 'sentry' }] },
    { name: 'Algolia', scriptSrc: [{ regex: 'algolia' }], url: [{ regex: 'algolia' }] },
    { name: 'Netlify', headers: [{ key: 'x-nf-request-id', regex: '.+' }], url: [{ regex: 'netlify' }] },
  ],
}

async function ensureDefaultRulesFile(filePath = DEFAULT_RULES_PATH) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_RULES, null, 2), 'utf8')
  }
}

async function loadCustomRules(filePath = DEFAULT_RULES_PATH) {
  await ensureDefaultRulesFile(filePath)
  let custom = []
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (parsed && Array.isArray(parsed.technologies)) {
      custom = parsed.technologies
    }
  } catch {
    // ignore
  }
  const supplement = await loadSupplement()
  return mergeRulesByName(custom, supplement)
}

function mergeRulesByName(primary, secondary) {
  const byName = new Map()
  for (const r of primary) {
    if (!r?.name) continue
    byName.set(r.name, { ...r })
  }
  for (const r of secondary) {
    if (!r?.name) continue
    const existing = byName.get(r.name)
    if (!existing) {
      byName.set(r.name, { ...r })
      continue
    }
    existing.html = [...(existing.html || []), ...(r.html || [])]
    existing.headers = [...(existing.headers || []), ...(r.headers || [])]
    existing.scriptSrc = [...(existing.scriptSrc || []), ...(r.scriptSrc || [])]
    existing.url = [...(existing.url || []), ...(r.url || [])]
    existing.window = [...(existing.window || []), ...(r.window || [])]
  }
  return Array.from(byName.values())
}

function testRegex(value, regex) {
  try {
    return new RegExp(regex, 'i').test(String(value || ''))
  } catch {
    return false
  }
}

function applyCustomRules(techRules, signals = {}) {
  const out = []
  const seen = new Set()

  for (const rule of techRules) {
    if (!rule || !rule.name) {
      continue
    }
    let matched = false
    let proof = ''

    for (const p of rule.html || []) {
      if (testRegex(signals.html || '', p.regex)) {
        matched = true
        proof = `Proof: custom rule matched HTML regex ${p.regex}`
        break
      }
    }
    if (!matched) {
      for (const p of rule.url || []) {
        if (testRegex(signals.url || '', p.regex)) {
          matched = true
          proof = `Proof: custom rule matched URL regex ${p.regex}`
          break
        }
      }
    }
    if (!matched) {
      for (const p of rule.scriptSrc || []) {
        if ((signals.scriptSrc || []).some((u) => testRegex(u, p.regex))) {
          matched = true
          proof = `Proof: custom rule matched script URL regex ${p.regex}`
          break
        }
      }
    }
    if (!matched) {
      for (const p of rule.headers || []) {
        const val = signals.headers?.[String(p.key || '').toLowerCase()]
        if (val && testRegex(val, p.regex)) {
          matched = true
          proof = `Proof: custom rule matched header ${p.key} with regex ${p.regex}`
          break
        }
      }
    }
    if (!matched) {
      for (const p of rule.window || []) {
        if ((signals.windowKeys || []).includes(p.key)) {
          matched = true
          proof = `Proof: custom rule matched window key ${p.key}`
          break
        }
      }
    }

    if (matched && !seen.has(rule.name)) {
      seen.add(rule.name)
      out.push({ name: rule.name, version: null, proof })
    }
  }

  return out
}

module.exports = {
  DEFAULT_RULES_PATH,
  ensureDefaultRulesFile,
  loadCustomRules,
  applyCustomRules,
}
