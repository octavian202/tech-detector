'use strict'

const puppeteer = require('puppeteer')

const THIRD_PARTY_RULES = [
  { re: /js\.stripe\.com|api\.stripe\.com/i, tech: 'Stripe' },
  { re: /segment\.com|cdn\.segment\.com/i, tech: 'Segment' },
  { re: /algolia\.net|algolianet\.com/i, tech: 'Algolia' },
  { re: /googletagmanager\.com/i, tech: 'Google Tag Manager' },
  { re: /google-analytics\.com|googletagmanager\.com\/gtag/i, tech: 'Google Analytics' },
  { re: /facebook\.net\/.*fbevents|connect\.facebook\.net/i, tech: 'Meta Pixel' },
  { re: /intercom\.io|intercomcdn\.com/i, tech: 'Intercom' },
  { re: /sentry\.io|browser\.sentry-cdn\.com/i, tech: 'Sentry' },
  { re: /cdn\.shopify\.com|myshopify\.com/i, tech: 'Shopify' },
  { re: /cdn\.vercel-insights\.com|vercel\.app/i, tech: 'Vercel' },
]

const HEADER_RULES = [
  { key: 'x-powered-by', re: /express/i, tech: 'Express' },
  { key: 'x-powered-by', re: /next\.js/i, tech: 'Next.js' },
  { key: 'server', re: /cloudflare/i, tech: 'Cloudflare' },
  { key: 'server', re: /nginx/i, tech: 'Nginx' },
  { key: 'server', re: /apache/i, tech: 'Apache HTTP Server' },
  { key: 'x-vercel-id', re: /.+/i, tech: 'Vercel' },
  { key: 'cf-ray', re: /.+/i, tech: 'Cloudflare' },
]

const WINDOW_SIGNATURES = [
  { key: '__NEXT_DATA__', tech: 'Next.js' },
  { key: '__NUXT__', tech: 'Nuxt.js' },
  { key: '__remixContext', tech: 'Remix' },
  { key: '__APOLLO_STATE__', tech: 'Apollo' },
  { key: 'webpackJsonp', tech: 'Webpack' },
  { key: 'webpackChunk_N_E', tech: 'Webpack' },
  { key: '__VUE__', tech: 'Vue.js' },
  { key: 'angular', tech: 'AngularJS' },
  { key: '__sapper__', tech: 'Sapper' },
]

function addTechnology(out, seen, name, proof) {
  if (!name || seen.has(name)) {
    return
  }
  seen.add(name)
  out.push({ name, version: null, proof })
}

function detectFromUrl(url, out, seen) {
  const value = String(url)
  for (const rule of THIRD_PARTY_RULES) {
    if (rule.re.test(value)) {
      addTechnology(out, seen, rule.tech, `Proof: Browser network contains ${value}`)
    }
  }
  if (/\/graphql(?:\?|$|\/)/i.test(value)) {
    addTechnology(out, seen, 'GraphQL', `Proof: GraphQL endpoint observed (${value})`)
  }
  if (/\/wp-json(?:\/|$|\?)/i.test(value)) {
    addTechnology(out, seen, 'WordPress', `Proof: wp-json endpoint observed (${value})`)
  }
}

function detectFromHeaders(headers, out, seen) {
  for (const rule of HEADER_RULES) {
    const v = headers?.[rule.key]
    if (v && rule.re.test(String(v))) {
      addTechnology(out, seen, rule.tech, `Proof: Response header ${rule.key}: ${v}`)
    }
  }
}

async function detectWindowSignatures(page, out, seen) {
  const found = await page.evaluate((signatures) => {
    const matched = []
    for (const sig of signatures) {
      try {
        if (Object.prototype.hasOwnProperty.call(window, sig.key)) {
          matched.push(sig)
        }
      } catch {
        // ignore
      }
    }
    if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
      matched.push({ key: '__REACT_DEVTOOLS_GLOBAL_HOOK__', tech: 'React' })
    }
    return matched
  }, WINDOW_SIGNATURES)

  for (const sig of found) {
    addTechnology(
      out,
      seen,
      sig.tech,
      `Proof: window.${sig.key} found during dynamic runtime scan`
    )
  }
  return found.map((s) => s.key)
}

async function analyzeDynamicDetailed(url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 45000
  const out = []
  const seen = new Set()
  const networkUrls = new Set()
  const responseHeaders = []
  const scriptSrcs = new Set()
  let windowKeys = []

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setRequestInterception(false)
    page.on('request', (req) => {
      networkUrls.add(req.url())
    })
    page.on('response', async (res) => {
      networkUrls.add(res.url())
      responseHeaders.push(res.headers() || {})
    })

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: timeoutMs,
    })

    const scriptSrcList = await page.$$eval('script[src]', (nodes) =>
      nodes.map((n) => n.src).filter(Boolean)
    )
    scriptSrcList.forEach((u) => {
      scriptSrcs.add(u)
      networkUrls.add(u)
    })

    const cookies = await page.cookies().catch(() => [])
    for (const c of cookies) {
      if (/^woocommerce_/i.test(c.name)) {
        addTechnology(out, seen, 'WooCommerce', `Proof: Cookie ${c.name} was set`)
      }
      if (/^wordpress_/i.test(c.name)) {
        addTechnology(out, seen, 'WordPress', `Proof: Cookie ${c.name} was set`)
      }
      if (/^__Host-next-auth/i.test(c.name)) {
        addTechnology(out, seen, 'NextAuth.js', `Proof: Cookie ${c.name} was set`)
      }
      if (/^_shopify_/i.test(c.name)) {
        addTechnology(out, seen, 'Shopify', `Proof: Cookie ${c.name} was set`)
      }
    }

    for (const u of networkUrls) {
      detectFromUrl(u, out, seen)
    }
    for (const h of responseHeaders) {
      detectFromHeaders(h, out, seen)
    }

    windowKeys = await detectWindowSignatures(page, out, seen)
  } catch {
    // ignore dynamic analysis failures; keep pipeline resilient
  } finally {
    await browser.close().catch(() => {})
  }

  return {
    technologies: out,
    signals: {
      url,
      networkUrls: Array.from(networkUrls),
      scriptSrc: Array.from(scriptSrcs),
      headers: responseHeaders[0] || {},
      windowKeys,
    },
  }
}

async function analyzeDynamic(url, opts = {}) {
  const detailed = await analyzeDynamicDetailed(url, opts)
  return detailed.technologies
}

module.exports = {
  analyzeDynamic,
  analyzeDynamicDetailed,
}
