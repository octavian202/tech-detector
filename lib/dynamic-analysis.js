'use strict'

const puppeteer = require('puppeteer')

/** Third-party URLs observed in the network log (~50+ SaaS/CDN patterns). */
const THIRD_PARTY_RULES = [
  { re: /js\.stripe\.com|api\.stripe\.com|m\.stripe\.network/i, tech: 'Stripe' },
  { re: /segment\.com|cdn\.segment\.com|cdn\.segment\.io/i, tech: 'Segment' },
  { re: /hubspot\.com|js\.hs-scripts\.com|js\.hsforms\.com|js\.hs-banner\.com|hs-analytics\.net/i, tech: 'HubSpot' },
  { re: /pardot\.com|go\.pardot\.com|pi\.pardot\.com/i, tech: 'Pardot' },
  { re: /zendesk\.com|zdassets\.com|zdusercontent\.com/i, tech: 'Zendesk' },
  { re: /drift\.com|js\.driftt\.com/i, tech: 'Drift' },
  { re: /crisp\.chat|client\.crisp\.chat/i, tech: 'Crisp' },
  { re: /fullstory\.com|rs\.fullstory\.com|edge\.fullstory\.com/i, tech: 'FullStory' },
  { re: /logrocket\.com|cdn\.lr-ingest\.io|lr-ingest\.io/i, tech: 'LogRocket' },
  { re: /datadoghq\.com|datadoghq-browser-agent\.com|browser-intake-datadoghq/i, tech: 'Datadog' },
  { re: /newrelic\.com|nr-data\.net|bam\.nr-data\.net/i, tech: 'New Relic' },
  { re: /auth0\.com|cdn\.auth0\.com/i, tech: 'Auth0' },
  { re: /okta\.com|oktacdn\.com|oktapreview\.com/i, tech: 'Okta' },
  { re: /firebaseio\.com|firebaseapp\.com|googleapis\.com\/identitytoolkit|gstatic\.com\/firebase/i, tech: 'Firebase' },
  { re: /algolia\.net|algolianet\.com|algolia\.com/i, tech: 'Algolia' },
  { re: /googletagmanager\.com/i, tech: 'Google Tag Manager' },
  { re: /google-analytics\.com|googletagmanager\.com\/gtag|analytics\.google\.com/i, tech: 'Google Analytics' },
  { re: /facebook\.net\/.*fbevents|connect\.facebook\.net/i, tech: 'Meta Pixel' },
  { re: /intercom\.io|intercomcdn\.com/i, tech: 'Intercom' },
  { re: /sentry\.io|browser\.sentry-cdn\.com|ingest\.sentry\.io/i, tech: 'Sentry' },
  { re: /cdn\.shopify\.com|shopifycdn\.com|myshopify\.com/i, tech: 'Shopify' },
  { re: /cdn\.vercel-insights\.com|vercel\.app|vercel-insights\.com/i, tech: 'Vercel' },
  { re: /cloudfront\.net|cloudfront\.com/i, tech: 'Amazon CloudFront' },
  { re: /fastly\.net|fastly\.io|fastlylb\.net/i, tech: 'Fastly' },
  { re: /akamai(hd)?\.net|akamaized\.net|edgesuite\.net/i, tech: 'Akamai' },
  { re: /cloudflare\.com|cdnjs\.cloudflare\.com|static\.cloudflareinsights\.com/i, tech: 'Cloudflare' },
  { re: /pusher\.com|sockjs\.pusher\.com/i, tech: 'Pusher' },
  { re: /socket\.io\/|cdn\.socket\.io/i, tech: 'Socket.io' },
  { re: /braze\.com|appboy\.com|sdk\.iad-01\.braze\.com/i, tech: 'Braze' },
  { re: /klaviyo\.com|static\.klaviyo\.com|a\.klaviyo\.com/i, tech: 'Klaviyo' },
  { re: /mailchimp\.com|list-manage\.com|chimpstatic\.com/i, tech: 'Mailchimp' },
  { re: /google\.com\/recaptcha|gstatic\.com\/recaptcha|recaptcha\.net/i, tech: 'reCAPTCHA' },
  { re: /cookiebot\.com|consent\.cookiebot\.com/i, tech: 'Cookiebot' },
  { re: /onetrust\.com|cdn\.cookielaw\.org|geolocation\.onetrust\.com/i, tech: 'OneTrust' },
  { re: /hotjar\.com|static\.hotjar\.com|insights\.hotjar\.com/i, tech: 'Hotjar' },
  { re: /mixpanel\.com|cdn\.mxpnl\.com/i, tech: 'Mixpanel' },
  { re: /amplitude\.com|cdn\.amplitude\.com|api\.amplitude\.com/i, tech: 'Amplitude' },
  { re: /heap\.io|cdn\.heapanalytics\.com/i, tech: 'Heap' },
  { re: /launchdarkly\.com|app\.launchdarkly\.com/i, tech: 'LaunchDarkly' },
  { re: /optimizely\.com|cdn\.optimizely\.com/i, tech: 'Optimizely' },
  { re: /crazyegg\.com|script\.crazyegg\.com/i, tech: 'Crazy Egg' },
  { re: /mouseflow\.com|cdn\.mouseflow\.com/i, tech: 'Mouseflow' },
  { re: /contentsquare\.net|t\.contentsquare\.net/i, tech: 'Contentsquare' },
  { re: /salesforce\.com|force\.com|salesforceliveagent\.com|cdn\.salesforceliveagent\.com/i, tech: 'Salesforce' },
  { re: /marketo\.com|mktoresp\.com|mktoutil\.com/i, tech: 'Marketo' },
  { re: /eloqua\.com|en25\.com/i, tech: 'Eloqua' },
  { re: /criteo\.com|static\.criteo\.net|dynamic\.criteo\.com/i, tech: 'Criteo' },
  { re: /taboola\.com|cdn\.taboola\.com|trc\.taboola\.com/i, tech: 'Taboola' },
  { re: /outbrain\.com|widgets\.outbrain\.com|log\.outbrain\.com/i, tech: 'Outbrain' },
  { re: /linkedin\.com\/px|snap\.licdn\.com/i, tech: 'LinkedIn Insight Tag' },
  { re: /twitter\.com\/i\/adsct|t\.co\/i\/adsct|static\.ads-twitter\.com/i, tech: 'X (Twitter) Ads' },
  { re: /tiktok\.com\/i18n\/pixel|analytics\.tiktok\.com/i, tech: 'TikTok Pixel' },
  { re: /pinimg\.com\/ct\/|ct\.pinterest\.com/i, tech: 'Pinterest Tag' },
  { re: /snapchat\.com\/p\/|sc-static\.net\/scevent/i, tech: 'Snap Pixel' },
  { re: /bing\.com\/bat\.js|bat\.bing\.com/i, tech: 'Microsoft Advertising' },
  { re: /doubleclick\.net|googlesyndication\.com|googleadservices\.com/i, tech: 'Google Ads' },
  { re: /typeform\.com|embed\.typeform\.com/i, tech: 'Typeform' },
  { re: /calendly\.com|assets\.calendly\.com/i, tech: 'Calendly' },
  { re: /churnzero\.net|churnzero\.com/i, tech: 'ChurnZero' },
  { re: /gainsight\.com|px\.gainsight\.com/i, tech: 'Gainsight PX' },
  { re: /pendo\.io|cdn\.pendo\.io/i, tech: 'Pendo' },
  { re: /qualtrics\.com|siteintercept\.qualtrics\.com/i, tech: 'Qualtrics' },
  { re: /surveymonkey\.com|smcx\.io/i, tech: 'SurveyMonkey' },
  { re: /livechatinc\.com|cdn\.livechatinc\.com/i, tech: 'LiveChat' },
  { re: /olark\.com|static\.olark\.com/i, tech: 'Olark' },
  { re: /tawk\.to|embed\.tawk\.to/i, tech: 'Tawk.to' },
  { re: /freshdesk\.com|freshchat\.com|wchat\.freshchat\.com/i, tech: 'Freshdesk' },
  { re: /helpscout\.net|beacon-v2\.helpscout\.net/i, tech: 'Help Scout' },
  { re: /gorgias\.com|config\.gorgias\.chat/i, tech: 'Gorgias' },
  { re: /rechargecdn\.com|rechargepayments\.com/i, tech: 'ReCharge' },
  { re: /klarna\.com|klarnacdn\.net/i, tech: 'Klarna' },
  { re: /paypal\.com|paypalobjects\.com/i, tech: 'PayPal' },
  { re: /braintreegateway\.com|braintree-api\.com/i, tech: 'Braintree' },
  { re: /adyen\.com|checkoutshopper-live\.adyen\.com/i, tech: 'Adyen' },
  { re: /squareup\.com|square\.site|squarecdn\.com/i, tech: 'Square' },
  { re: /mapbox\.com|api\.mapbox\.com/i, tech: 'Mapbox' },
  { re: /googleapis\.com\/maps\/api|maps\.googleapis\.com/i, tech: 'Google Maps' },
  { re: /vimeo\.com\/api|player\.vimeo\.com/i, tech: 'Vimeo' },
  { re: /youtube\.com\/iframe_api|www\.youtube\.com\/s\/player/i, tech: 'YouTube' },
  { re: /wistia\.com|fast\.wistia\.com|embed\.wistia\.com/i, tech: 'Wistia' },
  { re: /mux\.com|stream\.mux\.com|cdn\.mux\.com/i, tech: 'Mux' },
  { re: /brightcove\.com|players\.brightcove\.net/i, tech: 'Brightcove' },
  { re: /cloudinary\.com|res\.cloudinary\.com/i, tech: 'Cloudinary' },
  { re: /imgix\.net|imgix\.com/i, tech: 'imgix' },
  { re: /unpkg\.com|jsdelivr\.net|cdnjs\.com/i, tech: 'JavaScript CDN' },
]

const HEADER_RULES = [
  { key: 'x-powered-by', re: /express/i, tech: 'Express' },
  { key: 'x-powered-by', re: /next\.js/i, tech: 'Next.js' },
  { key: 'x-nextjs-cache', re: /.+/i, tech: 'Next.js' },
  { key: 'x-shopify-stage', re: /.+/i, tech: 'Shopify' },
  {
    key: 'x-served-by',
    re: /fastly|cloudflare|varnish|akamai|highwinds|incapsula|edgio|limelight|cache/i,
    tech: 'CDN / edge',
  },
  { key: 'via', re: /cloudflare/i, tech: 'Cloudflare' },
  { key: 'via', re: /varnish/i, tech: 'Varnish' },
  { key: 'via', re: /1\.1\s+vegur|heroku/i, tech: 'Heroku' },
  { key: 'x-amz-cf-id', re: /.+/i, tech: 'Amazon CloudFront' },
  { key: 'x-fastly-request-id', re: /.+/i, tech: 'Fastly' },
  { key: 'x-nf-request-id', re: /.+/i, tech: 'Netlify' },
  { key: 'x-vercel-id', re: /.+/i, tech: 'Vercel' },
  { key: 'cf-ray', re: /.+/i, tech: 'Cloudflare' },
  { key: 'server', re: /cloudflare/i, tech: 'Cloudflare' },
  { key: 'server', re: /nginx/i, tech: 'Nginx' },
  { key: 'server', re: /apache/i, tech: 'Apache HTTP Server' },
  { key: 'server', re: /microsoft-iis/i, tech: 'Microsoft IIS' },
  { key: 'server', re: /gunicorn/i, tech: 'Gunicorn' },
  { key: 'server', re: /openresty/i, tech: 'OpenResty' },
  { key: 'server', re: /caddy/i, tech: 'Caddy' },
  { key: 'server', re: /lighttpd/i, tech: 'lighttpd' },
  { key: 'server', re: /tomcat/i, tech: 'Apache Tomcat' },
  { key: 'server', re: /jetty/i, tech: 'Jetty' },
  { key: 'server', re: /cowboy/i, tech: 'Cowboy' },
  { key: 'server', re: /uvicorn/i, tech: 'Uvicorn' },
  { key: 'server', re: /phusion passenger/i, tech: 'Phusion Passenger' },
  { key: 'x-powered-by', re: /asp\.net/i, tech: 'ASP.NET' },
  { key: 'x-powered-by', re: /php/i, tech: 'PHP' },
  { key: 'x-generator', re: /wordpress/i, tech: 'WordPress' },
  { key: 'x-drupal-cache', re: /.+/i, tech: 'Drupal' },
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
  { key: '__SENTRY__', tech: 'Sentry' },
  { key: 'dataLayer', tech: 'Google Tag Manager' },
]

/** Cap response header objects stored per page (memory / time). */
const MAX_RESPONSE_SAMPLES_PER_PAGE = 140
/** After networkidle2: microtasks / hydration. */
const SPA_POST_NETWORKIDLE_MS = 420
/** Short scroll then wait for lazy below-the-fold content. */
const SPA_SCROLL_WAIT_MS = 220

/**
 * @param {Record<string, string>|undefined} headers
 * @param {string} key
 * @returns {string|undefined}
 */
function getHeader(headers, key) {
  if (!headers || typeof headers !== 'object') {
    return undefined
  }
  const want = String(key).toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) {
      return v
    }
  }
  return undefined
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
    const v = getHeader(headers, rule.key)
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

/**
 * Core scan: one navigation on an existing page (listeners attached per call).
 *
 * @param {import('puppeteer').Page} page
 * @param {string} url
 * @param {{ timeoutMs?: number }} opts
 */
async function scanDynamicPage(page, url, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 45000
  const out = []
  const seen = new Set()
  const networkUrls = new Set()
  const responseHeaders = []
  const scriptSrcs = new Set()
  let windowKeys = []

  const onRequest = (req) => {
    networkUrls.add(req.url())
  }
  const onResponse = (res) => {
    networkUrls.add(res.url())
    if (responseHeaders.length < MAX_RESPONSE_SAMPLES_PER_PAGE) {
      responseHeaders.push(res.headers() || {})
    }
  }
  page.on('request', onRequest)
  page.on('response', onResponse)

  try {
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: timeoutMs,
    })

    await new Promise((r) => setTimeout(r, SPA_POST_NETWORKIDLE_MS))

    await page
      .evaluate(() => {
        const h =
          document.documentElement?.scrollHeight ||
          document.body?.scrollHeight ||
          400
        window.scrollBy(0, Math.min(900, Math.max(200, h * 0.25)))
      })
      .catch(() => {})

    await new Promise((r) => setTimeout(r, SPA_SCROLL_WAIT_MS))

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
    page.off('request', onRequest)
    page.off('response', onResponse)
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

async function analyzeDynamicDetailed(url, opts = {}) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(false)
    return await scanDynamicPage(page, url, opts)
  } finally {
    await browser.close().catch(() => {})
  }
}

/**
 * One Chromium instance: homepage + extra URLs in series (not one browser per URL).
 *
 * @param {string[]} urls
 * @param {{ perPageTimeoutMs?: number, batchTimeoutMs?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<Array<{ technologies: Array<{ name: string, version: string|null, proof: string }>, signals: object }>>}
 */
async function analyzeDynamicBatch(urls, opts = {}) {
  const list = [...new Set((urls || []).filter(Boolean))]
  const perPageTimeoutMs = opts.perPageTimeoutMs ?? 32_000
  const batchTimeoutMs = opts.batchTimeoutMs ?? 220_000
  const started = Date.now()
  /** @type {Array<{ technologies: Array<{ name: string, version: string|null, proof: string }>, signals: object }>} */
  const results = []

  if (list.length === 0) {
    return []
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  })

  try {
    const page = await browser.newPage()
    await page.setRequestInterception(false)

    for (const url of list) {
      const elapsed = Date.now() - started
      if (elapsed >= batchTimeoutMs) {
        results.push({
          technologies: [],
          signals: { url, batchSkipped: true },
        })
        continue
      }
      const remaining = batchTimeoutMs - elapsed
      const thisTimeout = Math.min(perPageTimeoutMs, remaining)
      if (thisTimeout < 3000) {
        results.push({
          technologies: [],
          signals: { url, batchSkipped: true },
        })
        continue
      }

      const r = await scanDynamicPage(page, url, {
        ...opts,
        timeoutMs: thisTimeout,
      }).catch(() => ({
        technologies: [],
        signals: { url },
      }))
      results.push(r)
    }
  } finally {
    await browser.close().catch(() => {})
  }

  return results
}

async function analyzeDynamic(url, opts = {}) {
  const detailed = await analyzeDynamicDetailed(url, opts)
  return detailed.technologies
}

module.exports = {
  analyzeDynamic,
  analyzeDynamicDetailed,
  analyzeDynamicBatch,
  MAX_RESPONSE_SAMPLES_PER_PAGE,
  SPA_POST_NETWORKIDLE_MS,
  SPA_SCROLL_WAIT_MS,
}
