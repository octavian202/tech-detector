# Tech Detector - Website Technology Fingerprinting

## A) Executive Summary

This project identifies **what technologies power a website** (e.g., Shopify, WordPress, CDNs, analytics pixels, auth providers) across a batch of domains. The business use-case is competitor intelligence: if you can reliably label “who runs Shopify + Klaviyo + Stripe” (or “who uses HubSpot + Segment”), you can:

- **Build targeted lead lists** for marketing/sales campaigns.
- **Map competitor ecosystems** (which vendors co-occur, which stacks dominate which niches).
- **Prioritize outreach** using high-signal, explainable evidence (not black-box guesses).

The solution is intentionally built as a **mini system**, not a one-off script: it fuses multiple independent signals (HTTP, DNS, TLS, HTML, runtime browser network/DOM) and produces **per-detection proof** so results are auditable and actionable.

### TL;DR (results from the included run)

- **Domains processed**: 200
- **Domains with ≥1 technology**: 189
- **Distinct technologies found**: **476** 
- **Total detections**: 3,675
- **Wall time**: ~46m21s (≈ 13.9s/domain, rough)

## B) The Engineering Journey (The “Path”)

This is the story of how the solution evolved.

### V1. Start with “known-good”, then measure

My starting point was the industry baseline: **Wappalyzer** rules and a browser-driven scan. The real problem wasn’t “detect tech on one domain”, it was building something that is **batch-safe**: predictable runtime, partial results when something breaks, and evidence you can trust.

Early on, I enumerated the highest-signal “traces” technologies leave behind:

- **HTTP headers** (`server`, `x-powered-by`, CDN headers)
- **HTML/meta** (`<meta name="generator">`, CMS fingerprints)
- **Script/resource URLs** (e.g. `cdn.shopify.com`, `googletagmanager.com`)
- **DOM / runtime globals** (`window.__NEXT_DATA__`, `window.dataLayer`)
- **Cookies** (`_shopify_`, `wordpress_`)

### Pivot 1: Add “cheap” layers before expensive ones (win coverage, protect runtime)

Wappalyzer+browser is powerful, but expensive. I added independent, fast layers that often catch obvious infrastructure without Chromium:

- **DNS analysis** (e.g. provider hints like GoDaddy)
- **TLS certificate issuer** (e.g. Let’s Encrypt)
- **robots.txt** parsing
- **one HTML fetch** (to seed internal link discovery and non-JS signals)

Result: distinct-tech coverage climbed from an early baseline (**~332 → ~365**), while keeping the pipeline resilient when a single layer fails.

### Pivot 2: Dynamic/runtime signals without blowing the budget

Many analytics/trackers and SPA frameworks don’t show up in static HTML. I added a **dynamic Puppeteer pass** that:

- waits for `networkidle2`
- waits a short extra window for hydration/microtasks
- performs a small scroll to trigger lazy-loaded tags
- inspects **network URLs**, **response headers**, **script[src]**, **cookies**, and **window globals**

This added high-signal SaaS detections (Stripe/Segment/HubSpot/etc.) while keeping evidence explainable (“network contains …”, “cookie … set”, “window.**NEXT_DATA** present”).

### Pivot 3: Performance rewrite: avoid “one Chromium per URL”

A big performance trap: deep-crawling multiple internal URLs and launching Chromium for each. I reworked the dynamic layer to use:

- **one Chromium instance per domain**
- scan homepage + a bounded list of internal URLs **in series**
- enforce a **batch timeout** for the whole dynamic layer

This was a major runtime win (saving multiple Chromium launches per domain) **without sacrificing detections**.

### Pivot 4: “More rules” without turning the project into a fork zoo

Two rule-related upgrades improved coverage without hardcoding everything:

- **Wappalyzer rules sync + merge**: pull from multiple Wappalyzer repos and merge technology definitions (plus a digest so we don’t re-download everything when only merge logic changes).
- **WebAnalyzer supplement**: sync and convert additional signatures into a JSON supplement that can be applied alongside custom rules.

### A conscious rollback (ownership over novelty)

I explored “long tail” expansions (e.g., deeper storage/source-map/websocket/login redirect analysis). I explicitly **reverted** when complexity/time cost wasn’t justified for the challenge scope (coverage didn’t improve enough relative to runtime and operational risk).

That trade-off is deliberate: I optimized for **robustness + explainability + predictable runtime**, not feature maximalism.

## C) Architecture & Decision Log

### Tech Stack (and why)

- **Python (considered, rejected early)**: great ecosystem for scraping, but for this challenge the core value is **browser-grade JS/runtime visibility** and tight integration with Wappalyzer’s JS-native engine. Mixing stacks would add operational surface area without improving the main metric (distinct technologies found).
- **Node.js**: concurrency is I/O-heavy by nature (many network calls). Node is strong “by default” here and keeps the code close to browser tooling.
- **Wappalyzer (Node)**: industry-standard tech fingerprint database + built-in pattern reporting (critical for “proof”).
- **Puppeteer**: reliable headless Chromium integration; used for dynamic runtime signals that static scraping misses.
- **p-queue**: explicit concurrency control so we don’t melt the machine by launching too many headless sessions.
- **parquetjs-lite**: reads domains from the provided Parquet input.

### What I optimized for (explicit goals)

- **Correctness you can audit**: every detection should have a reason (“proof”), not just a label.
- **Graceful degradation**: a single broken domain/layer should not kill the run.
- **Bounded cost**: time budgets everywhere; headless only where it adds real signal.
- **Maximize distinct technologies**: throughout the project, the north star metric was **how many unique technologies** we can reliably surface across the full domain set.

### High-level pipeline (layers)

For each domain, `lib/analyze-domain.js` runs a **multi-layer fingerprinting** pipeline:

1. **DNS / robots / TLS** in parallel (cheap, independent signals)
2. **HTML fetch** (homepage) for lightweight parsing + internal URL discovery
3. **Wappalyzer pass (desktop)**, then **Wappalyzer pass (mobile viewport)** for different delivery paths
4. **Dynamic Puppeteer batch** (homepage + a small set of internal URLs) to extract runtime/network/cookie/window signals
5. **Signal scanners** (HTML comments, CSP domains, link rel preconnect/dns-prefetch, meta generator)
6. **Custom rules** applied to merged signals (HTML, headers, script src, window keys)
7. **Merge + dedupe** into a final per-domain technology list

### Key files (where the core logic lives)

- `index.js`: CLI entrypoint (rules sync, input/output wiring, timing, concurrency runner)
- `lib/analyze-domain.js`: the full per-domain pipeline (layers + merge)
- `lib/dynamic-analysis.js`: Puppeteer runtime scan (network, headers, cookies, window globals)
- `lib/wappalyzer-proof.js`: turns rule hits into human-readable proof strings
- `lib/run-domains.js`: bounded concurrency + per-domain timeouts

### The “Proof” mechanism (what counts as evidence)

Detections come with a `proof` string that explains *why* a technology was reported. Proof is collected from multiple independent surfaces:

- **Wappalyzer pattern hits**: a human-readable explanation derived from Wappalyzer “extended” output (e.g., matched in headers / HTML / scripts / JS globals).
- **Headers**: explicit matches like `server: nginx`, `x-powered-by: PHP`, CDN headers, platform hints.
- **Network runtime**: observed third-party requests such as `js.stripe.com`, `cdn.segment.com`, etc.
- **Cookies**: platform cookies (`_shopify_`*, `wordpress_`*, `woocommerce_*`, `__Host-next-auth*`).
- **Window globals**: SPA/framework signatures (`__NEXT_DATA__`, `__NUXT__`, `dataLayer`, etc.).
- **HTML signals**: meta generator, CSP references, comment fingerprints, link-rel preconnects.
- **TLS**: issuer hints like Let’s Encrypt.

### Concurrency & resilience

- **Bounded concurrency**: `p-queue` runs domains with fixed concurrency (`CONCURRENCY = 12`), preventing Chromium overload.
- **Hard time budgets**:
  - per-domain timeout (`DOMAIN_ANALYZE_TIMEOUT_MS = 420s`)
  - per-page dynamic timeout (`DYNAMIC_PAGE_TIMEOUT_MS = 32s`)
  - dynamic layer batch timeout (`DYNAMIC_BATCH_TIMEOUT_MS = 220s`)
- **Failure isolation**: if a layer fails (DNS/robots/Wappalyzer/dynamic), the pipeline returns partial results rather than crashing the run.

## D) Performance & Results

### Coverage vs. the challenge benchmark

- **Domains processed**: 200
- **Domains with ≥1 technology**: 189
- **Distinct technologies found**: **476**
- **Total detections (domain × technology)**: 3,675

These numbers come from `output-results.json` (aggregated from `output.json`).

### Runtime

The most complete run that hit **476 distinct technologies** took **~46m21s** wall time for 200 domains.

- **Average wall time/domain (rough)**: \frac{46m21s}{200} \approx 13.9s

Note: because the run is concurrent, “per-domain time” is best interpreted as *work per domain under this machine + concurrency + network conditions*, not a strict serialized cost.

Iteration checkpoints I recorded while developing (distinct technologies found): **332 → 365 → 378 → 386 → 394 → 402 → 405 → 464 → 476**.

## E) The Debate Topics (Strategic Thinking)

### Main issues right now (and how I’d tackle them)

- **Cost dominated by headless**: Puppeteer is the most expensive layer (CPU/RAM + time), but it’s also the layer that unlocks a large portion of runtime-only detections (analytics pixels, chat widgets, injected tags, SPA globals).
  - Tackle: keep a **baseline dynamic pass** for every domain, but make it cheaper via browser reuse, strict budgets, and better target selection (which internal URLs to visit).
- **Bot detection / IP throttling**: some sites block, degrade, or “lie” under automation.
  - Tackle: proxy rotation + pacing + per-domain backoff; keep a “blocked” label and retry on a different egress; avoid infinite retries.
- **JS timing variance**: “`networkidle2` + small waits” is a heuristic; some sites load trackers after user interaction/consent.
  - Tackle: add **interaction scripts** for common consent UIs (click “accept”), cap time; record whether consent was required.
- **Evidence quality is uneven**: some detections are “implied/indirect”.
  - Tackle: technologies with a low number of domains detected on could be double-checked in-depth.
- **Resource usage under concurrency**: concurrency is bounded, but the memory profile still spikes on heavy pages.
  - Tackle: isolate dynamic work in a separate worker process pool, enforce memory limits, and restart workers after N domains to avoid leaks/handle buildup.

### Scaling to millions of domains (1–2 months plan)

If I had 1–2 months to scale this to millions of domains *while still maximizing distinct technologies*, I would not rely on “skip headless when you already found something” as the core strategy (it would systematically miss runtime-only tech). Instead, I’d scale headless **as a managed compute service** and control cost with smarter reuse and budgets:

- **Queue-driven distributed workers**:
  - Use RabbitMQ/SQS/Kafka; workers are stateless containers with explicit SLAs and retries.
  - Retries with backoff + dead-letter queues; explicit outcomes like “timeout”, “blocked”, “dns-fail”.
- **Headless as a pooled resource (the main scaling lever)**:
  - Browser pools per worker node (reuse Chromium; recycle aggressively).
  - Per-domain “dynamic budget” with hard caps (time, number of navigations, max responses sampled).
  - Progressive deepening inside the same budget: homepage → a few high-yield internal URLs (login/account/app/docs/pricing) → stop when budget is exhausted.
- **Egress strategy (anti-blocking)**:
  - Proxy rotation, pacing, and geo strategy controlled by the scheduler.
  - Reputation-aware pools (datacenter vs residential) and routing policies for hard targets.
- **Throughput engineering**:
  - Keep concurrency high at the cluster level while preventing per-node memory spikes (worker recycling, memory limits, isolation).
  - Cache and reuse rule sets; avoid per-task initialization overhead (rules sync is not on the hot path).
- **Data plane & observability**:
  - Write raw detections as JSONL; batch to **Parquet** for analytics.
  - Store proof as structured evidence events (source/type/snippet/url) to support debugging and future model/rule improvements.
  - Track metrics per layer: time, yield (new tech found), block rate, timeout rate - so performance tuning is evidence-driven.

### Discovering new technologies (unknown unknowns)

Rule databases will always lag reality. I’d treat discovery as a product loop, not a one-time rules update:

- **Harvest unknown signatures at scale**:
  - frequent third-party script domains not mapped to a tech
  - repeated `window` keys / global objects
  - stable DOM markers / meta tags / response headers / CSP domains
- **Cluster + score**:
  - group unknowns by eTLD+1 + path patterns; compute co-occurrence with known stacks.
  - prioritize clusters that appear on many domains and have stable signatures.
- **Track drift over time**:
  - monitor changes in script URLs/CSP on a rolling cohort; new vendors show up as new stable clusters.
- **LLM-assisted labeling (with guardrails)**:
  - use an LLM to propose labels for clusters (what category? analytics? chat? A/B testing?).
  - promotion requires verification: a small follow-up crawl + a human review sample.
  - once validated, convert to rules (and add tests/metrics to prevent “rule rot”).

## How to run

### Install

```bash
npm install
```

### Run the detector

```bash
node index.js <input.parquet> [output.json]
```

Defaults:

- input: `domains.snappy.parquet`
- output: `output.json`

### Aggregate results (distinct tech counts)

```bash
node analyze-output.js [output.json] [output-results.json]
```

## Output format

Per-domain output (`output.json`) is an array of:

- `domain`: string
- `technologies`: array of `{ name, version, proof }`

Aggregated output (`output-results.json`) contains:

- `summary`: domain counts + total detections + `distinctTechnologyCount`
- `technologies`: ranked list with `detectionCount` and `domainCount`

