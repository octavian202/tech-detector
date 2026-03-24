'use strict'

const { puppeteer, buildLaunchArgs } = require('./browser-launch')

/** Third-party URLs → Wappalyzer-style product names (high recall for SaaS). */
const THIRD_PARTY_RULES = [
  { re: /js\.stripe\.com|api\.stripe\.com|m\.stripe\.network/i, tech: 'Stripe' },
  { re: /segment\.com|cdn\.segment\.com|api\.segment\.io/i, tech: 'Segment' },
  { re: /algolia\.net|algolianet\.com|algolia\.io/i, tech: 'Algolia' },
  { re: /googletagmanager\.com/i, tech: 'Google Tag Manager' },
  { re: /google-analytics\.com|googleadservices\.com|doubleclick\.net/i, tech: 'Google Analytics' },
  { re: /facebook\.net\/.*fbevents|connect\.facebook\.net/i, tech: 'Meta Pixel' },
  { re: /intercom\.io|intercomcdn\.com|js\.intercomcdn\.com/i, tech: 'Intercom' },
  { re: /sentry\.io|browser\.sentry-cdn\.com|ingest\.sentry\.io/i, tech: 'Sentry' },
  { re: /cdn\.shopify\.com|shopifycdn\.com|myshopify\.com/i, tech: 'Shopify' },
  { re: /cdn\.vercel-insights\.com|vercel\.app|vercel\.com\/insights/i, tech: 'Vercel' },
  { re: /mixpanel\.com|cdn\.mxpnl\.com/i, tech: 'Mixpanel' },
  { re: /amplitude\.com|cdn\.amplitude\.com/i, tech: 'Amplitude' },
  { re: /hotjar\.com|static\.hotjar\.com/i, tech: 'Hotjar' },
  { re: /clarity\.ms|www\.clarity\.ms/i, tech: 'Microsoft Clarity' },
  { re: /hubspot\.com|js\.hs-scripts\.com|js\.hsforms\.net/i, tech: 'HubSpot' },
  { re: /pardot\.com|go\.pardot\.com/i, tech: 'Pardot' },
  { re: /marketo\.com|mktoresp\.com/i, tech: 'Marketo' },
  { re: /salesforce\.com|cdn\.salesforceliveagent\.com/i, tech: 'Salesforce' },
  { re: /zendesk\.com|zdassets\.com/i, tech: 'Zendesk' },
  { re: /drift\.com|js\.driftt\.com/i, tech: 'Drift' },
  { re: /crisp\.chat|client\.crisp\.chat/i, tech: 'Crisp' },
  { re: /tawk\.to|embed\.tawk\.to/i, tech: 'Tawk.to' },
  { re: /fullstory\.com|rs\.fullstory\.com/i, tech: 'FullStory' },
  { re: /logrocket\.com|cdn\.lr-ingest\.io/i, tech: 'LogRocket' },
  { re: /datadoghq\.com|datadoghq-browser-agent/i, tech: 'Datadog' },
  { re: /newrelic\.com|nr-data\.net|js-agent\.newrelic\.com/i, tech: 'New Relic' },
  { re: /launchdarkly\.com|app\.launchdarkly\.com/i, tech: 'LaunchDarkly' },
  { re: /optimizely\.com|cdn\.optimizely\.com/i, tech: 'Optimizely' },
  { re: /crazyegg\.com|script\.crazyegg\.com/i, tech: 'Crazy Egg' },
  { re: /mouseflow\.com|cdn\.mouseflow\.com/i, tech: 'Mouseflow' },
  { re: /paypal\.com|paypalobjects\.com/i, tech: 'PayPal' },
  { re: /braintreegateway\.com|js\.braintreegateway\.com/i, tech: 'Braintree' },
  { re: /klarna\.com|klarnacdn\.net/i, tech: 'Klarna' },
  { re: /afterpay\.com|static\.afterpay\.com/i, tech: 'Afterpay' },
  { re: /auth0\.com|cdn\.auth0\.com/i, tech: 'Auth0' },
  { re: /okta\.com|oktacdn\.com/i, tech: 'Okta' },
  { re: /firebaseio\.com|identitytoolkit\.googleapis\.com|\.firebaseapp\.com/i, tech: 'Firebase' },
  { re: /mapbox\.com|api\.mapbox\.com/i, tech: 'Mapbox' },
  { re: /googleapis\.com\/maps|maps\.googleapis\.com/i, tech: 'Google Maps' },
  { re: /typekit\.net|use\.typekit\.net|fonts\.adobe\.com/i, tech: 'Adobe Fonts' },
  { re: /cloudfront\.net|amazonaws\.com\/.*\.cloudfront/i, tech: 'Amazon CloudFront' },
  { re: /fastly\.net|fastlylb\.net/i, tech: 'Fastly' },
  { re: /akamaihd\.net|akamaized\.net|edgesuite\.net/i, tech: 'Akamai' },
  { re: /cloudflare\.com|cf-ray/i, tech: 'Cloudflare' },
  { re: /netlify\.com|netlify\.app/i, tech: 'Netlify' },
  { re: /azurewebsites\.net|azurefd\.net/i, tech: 'Microsoft Azure' },
  { re: /appspot\.com|googleusercontent\.com/i, tech: 'Google Cloud' },
  { re: /herokuapp\.com/i, tech: 'Heroku' },
  { re: /pusher\.com|sockjs\.pusher\.com/i, tech: 'Pusher' },
  { re: /ably\.io|ably-realtime\.com/i, tech: 'Ably' },
  { re: /socket\.io|socket\.io\//i, tech: 'Socket.io' },
  { re: /customer\.io|track\.customer\.io/i, tech: 'Customer.io' },
  { re: /braze\.com|sdk\.braze\.com/i, tech: 'Braze' },
  { re: /klaviyo\.com|static\.klaviyo\.com/i, tech: 'Klaviyo' },
  { re: /mailchimp\.com|list-manage\.com|chimpstatic\.com/i, tech: 'Mailchimp' },
  { re: /recaptcha|google\.com\/recaptcha/i, tech: 'reCAPTCHA' },
  { re: /hcaptcha\.com|newassets\.hcaptcha\.com/i, tech: 'hCaptcha' },
  { re: /cookiebot\.com|consent\.cookiebot\.com/i, tech: 'Cookiebot' },
  { re: /onetrust\.com|cdn\.cookielaw\.org/i, tech: 'OneTrust' },
  { re: /posthog\.com|cdn\.posthog\.com|eu\.posthog\.com/i, tech: 'PostHog' },
  { re: /plausible\.io/i, tech: 'Plausible' },
  { re: /usefathom\.com|cdn\.usefathom\.com/i, tech: 'Fathom' },
  { re: /umami\.is|analytics\.umami/i, tech: 'Umami' },
  { re: /rudderstack\.com|rudderlabs\.com/i, tech: 'Rudder' },
]

const HEADER_RULES = [
  { key: 'x-powered-by', re: /express/i, tech: 'Express' },
  { key: 'x-powered-by', re: /next\.js/i, tech: 'Next.js' },
  { key: 'x-powered-by', re: /php/i, tech: 'PHP' },
  { key: 'server', re: /cloudflare/i, tech: 'Cloudflare' },
  { key: 'server', re: /nginx/i, tech: 'Nginx' },
  { key: 'server', re: /apache/i, tech: 'Apache HTTP Server' },
  { key: 'server', re: /microsoft-iis/i, tech: 'Microsoft IIS' },
  { key: 'server', re: /gunicorn/i, tech: 'Gunicorn' },
  { key: 'server', re: /openresty/i, tech: 'OpenResty' },
  { key: 'x-vercel-id', re: /.+/i, tech: 'Vercel' },
  { key: 'cf-ray', re: /.+/i, tech: 'Cloudflare' },
  { key: 'x-nextjs-cache', re: /.+/i, tech: 'Next.js' },
  { key: 'x-shopify-stage', re: /.+/i, tech: 'Shopify' },
  { key: 'x-served-by', re: /cache|fastly/i, tech: 'Fastly' },
  { key: 'via', re: /varnish/i, tech: 'Varnish' },
  { key: 'x-amz-cf-id', re: /.+/i, tech: 'Amazon CloudFront' },
  { key: 'x-fastly-request-id', re: /.+/i, tech: 'Fastly' },
  { key: 'x-nf-request-id', re: /.+/i, tech: 'Netlify' },
]

/** `key in window` — common framework globals. */
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
  { key: '__SENTRY__', tech: 'Sentry' },
  { key: 'dataLayer', tech: 'Google Tag Manager' },
  { key: '__PRELOADED_STATE__', tech: 'Redux' },
  { key: '__svelte', tech: 'Svelte' },
  { key: '__SVELTE', tech: 'Svelte' },
  { key: '__GATSBY', tech: 'Gatsby' },
  { key: '__docusaurus', tech: 'Docusaurus' },
]

/**
 * `typeof window[name] !== 'undefined'` — catches non-own properties.
 * @type {Array<{ names: string[], tech: string }>}
 */
const WINDOW_GLOBAL_NAMES = [
  { names: ['React', 'ReactDOM'], tech: 'React' },
  { names: ['jQuery'], tech: 'jQuery' },
  { names: ['Vue'], tech: 'Vue.js' },
  { names: ['angular'], tech: 'AngularJS' },
  { names: ['Ember'], tech: 'Ember.js' },
  { names: ['Backbone'], tech: 'Backbone' },
]

/** Cookie name → technology (high recall). */
const COOKIE_RULES = [
  { re: /^XSRF-TOKEN$/i, tech: 'Laravel' },
  { re: /^laravel_session$/i, tech: 'Laravel' },
  { re: /^wp-settings/i, tech: 'WordPress' },
  { re: /^wordpress_logged_in/i, tech: 'WordPress' },
  { re: /^woocommerce_/i, tech: 'WooCommerce' },
  { re: /^_shopify_/i, tech: 'Shopify' },
  { re: /^__Host-next-auth/i, tech: 'NextAuth.js' },
  { re: /^_ga($|_)/i, tech: 'Google Analytics' },
  { re: /^_gid$/i, tech: 'Google Analytics' },
  { re: /^_gat/i, tech: 'Google Analytics' },
  { re: /^_fbp$/i, tech: 'Meta Pixel' },
  { re: /^hubspotutk$/i, tech: 'HubSpot' },
  { re: /^__hs/i, tech: 'HubSpot' },
  { re: /^intercom/i, tech: 'Intercom' },
  { re: /^PHPSESSID$/i, tech: 'PHP' },
  { re: /^ASP\.NET_SessionId/i, tech: 'Microsoft ASP.NET' },
  { re: /^cf_clearance$/i, tech: 'Cloudflare' },
  { re: /^__cf_bm$/i, tech: 'Cloudflare' },
  { re: /^__stripe/i, tech: 'Stripe' },
  { re: /^ajs_/i, tech: 'Segment' },
  { re: /^amplitude/i, tech: 'Amplitude' },
]

function normalizeHeaders(h) {
  const out = {}
  for (const [k, v] of Object.entries(h || {})) {
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join('; ') : String(v)
  }
  return out
}

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
      addTechnology(out, seen, rule.tech, `Proof: network URL ${value.slice(0, 120)}`)
    }
  }
  if (/\/graphql(?:\?|$|\/)/i.test(value)) {
    addTechnology(out, seen, 'GraphQL', `Proof: GraphQL endpoint (${value.slice(0, 120)})`)
  }
  if (/\/wp-json(?:\/|$|\?)/i.test(value)) {
    addTechnology(out, seen, 'WordPress', `Proof: wp-json (${value.slice(0, 120)})`)
  }
}

function detectFromHeaders(headers, out, seen) {
  const h = normalizeHeaders(headers)
  for (const rule of HEADER_RULES) {
    if (!rule.tech) continue
    const v = h[rule.key]
    if (v && rule.re.test(String(v))) {
      addTechnology(out, seen, rule.tech, `Proof: header ${rule.key}: ${String(v).slice(0, 80)}`)
    }
  }
}

function detectFromCookies(cookies, out, seen) {
  for (const c of cookies || []) {
    const name = c && c.name ? String(c.name) : ''
    if (!name) continue
    for (const rule of COOKIE_RULES) {
      if (rule.re.test(name)) {
        addTechnology(out, seen, rule.tech, `Proof: cookie ${name}`)
      }
    }
  }
}

async function detectWindowSignatures(page, out, seen) {
  const found = await page.evaluate((signatures, globalChecks) => {
    const matched = []
    const dedupe = new Set()

    function push(key, tech) {
      const id = `${key}\0${tech}`
      if (dedupe.has(id)) return
      dedupe.add(id)
      matched.push({ key, tech })
    }

    function hasKey(k) {
      try {
        return k in window
      } catch {
        return false
      }
    }

    for (const sig of signatures) {
      if (hasKey(sig.key)) {
        push(sig.key, sig.tech)
      }
    }
    try {
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__) {
        push('__REACT_DEVTOOLS_GLOBAL_HOOK__', 'React')
      }
    } catch {
      // ignore
    }

    for (const g of globalChecks) {
      const hit = g.names.some((n) => {
        try {
          return typeof window[n] !== 'undefined'
        } catch {
          return false
        }
      })
      if (hit) {
        push(g.names[0], g.tech)
      }
    }

    return matched
  }, WINDOW_SIGNATURES, WINDOW_GLOBAL_NAMES)

  for (const sig of found) {
    addTechnology(out, seen, sig.tech, `Proof: window.${sig.key} (dynamic scan)`)
  }
  return found.map((s) => s.key)
}

/**
 * Prefer `load` (scripts executed; images/fonts may be blocked). Fallback: DOM ready.
 */
async function gotoWithFallback(page, url, perPageMs) {
  const budget = Math.max(4000, perPageMs)
  const primaryTimeout = Math.min(budget, 38_000)
  try {
    await page.goto(url, {
      waitUntil: 'load',
      timeout: primaryTimeout,
    })
  } catch {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: Math.min(20_000, Math.max(8000, budget - primaryTimeout)),
      })
    } catch {
      // best-effort: page may be partially usable
    }
  }
}

/**
 * One browser, sequential pages — faster than N separate launches; caps listeners per page.
 */
async function analyzeDynamicBatchDetailed(urls, opts = {}) {
  const maxPages = Math.min(opts.maxPages ?? 6, (urls || []).length)
  const perPageMs = opts.perPageTimeoutMs ?? 32_000
  const spaPostMs = opts.spaPostMs ?? 950
  const hydrationPostMs = opts.hydrationPostMs ?? 900
  const maxResponsesPerPage = opts.maxResponsesPerPage ?? 160
  const envBlock = process.env.DYNAMIC_BLOCK_HEAVY_ASSETS
  const blockHeavyAssets =
    opts.blockHeavyAssets !== false &&
    envBlock !== '0' &&
    !/^false$/i.test(String(envBlock || ''))

  const urlsToVisit = (urls || []).slice(0, maxPages)
  const out = []
  const seen = new Set()
  const allNetworkUrls = []
  const allScriptSrc = []
  const allWindowKeys = []
  /** @type {Record<string, string>} */
  let mergedDocHeaders = {}

  if (urlsToVisit.length === 0) {
    return {
      technologies: [],
      signals: {
        url: '',
        networkUrls: [],
        scriptSrc: [],
        headers: {},
        windowKeys: [],
      },
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    ignoreHTTPSErrors: true,
    args: buildLaunchArgs(),
  })

  try {
    for (const pageUrl of urlsToVisit) {
      const page = await browser.newPage()
      const networkUrls = new Set()
      const responseHeaders = []
      let respCount = 0

      const onResponse = (res) => {
        try {
          const u = res.url()
          networkUrls.add(u)
          if (respCount >= maxResponsesPerPage) return
          respCount += 1
          const h = res.headers() || {}
          responseHeaders.push(h)
          const req = res.request()
          const rt = req.resourceType()
          if (rt === 'document' || rt === 'xhr' || rt === 'fetch') {
            const nh = normalizeHeaders(h)
            Object.assign(mergedDocHeaders, nh)
          }
        } catch {
          // ignore
        }
      }
      page.on('response', onResponse)

      if (blockHeavyAssets) {
        await page.setRequestInterception(true).catch(() => {})
        page.on('request', (req) => {
          try {
            networkUrls.add(req.url())
          } catch {
            // ignore
          }
          const rt = req.resourceType()
          if (rt === 'image' || rt === 'media' || rt === 'font') {
            req.abort().catch(() => {})
          } else {
            req.continue().catch(() => {})
          }
        })
      } else {
        page.on('request', (req) => {
          try {
            networkUrls.add(req.url())
          } catch {
            // ignore
          }
        })
      }

      try {
        await gotoWithFallback(page, pageUrl, perPageMs)

        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), spaPostMs)
        await page.evaluate(() => {
          try {
            const h = document.body ? document.body.scrollHeight : 0
            window.scrollTo(0, Math.min(900, h))
          } catch {
            // ignore
          }
        })
        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), 240)
        await page.evaluate((ms) => new Promise((r) => setTimeout(r, ms)), hydrationPostMs)

        const scriptSrcList = await page
          .$$eval('script[src]', (nodes) => nodes.map((n) => n.src).filter(Boolean))
          .catch(() => [])
        scriptSrcList.forEach((u) => {
          networkUrls.add(u)
          allScriptSrc.push(u)
        })

        const cookies = await page.cookies().catch(() => [])
        detectFromCookies(cookies, out, seen)

        for (const u of networkUrls) {
          detectFromUrl(u, out, seen)
          allNetworkUrls.push(u)
        }
        for (const h of responseHeaders) {
          detectFromHeaders(h, out, seen)
        }

        const wk = await detectWindowSignatures(page, out, seen)
        allWindowKeys.push(...wk)
      } catch {
        // page failed; continue with next URL
      } finally {
        await page.close().catch(() => {})
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  const uniqNet = [...new Set(allNetworkUrls)]
  const uniqScript = [...new Set(allScriptSrc)]
  const uniqWin = [...new Set(allWindowKeys)]

  return {
    technologies: out,
    signals: {
      url: urlsToVisit[0] || '',
      networkUrls: uniqNet,
      scriptSrc: uniqScript,
      headers: mergedDocHeaders,
      windowKeys: uniqWin,
    },
  }
}

/** @deprecated Prefer analyzeDynamicBatchDetailed for multiple URLs */
async function analyzeDynamicDetailed(url, opts = {}) {
  const r = await analyzeDynamicBatchDetailed([url], opts)
  return {
    technologies: r.technologies,
    signals: { ...r.signals, url },
  }
}

async function analyzeDynamic(url, opts = {}) {
  const detailed = await analyzeDynamicDetailed(url, opts)
  return detailed.technologies
}

module.exports = {
  analyzeDynamic,
  analyzeDynamicDetailed,
  analyzeDynamicBatchDetailed,
}
