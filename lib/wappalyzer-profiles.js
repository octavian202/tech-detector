'use strict'

/** Desktop Chrome UA (explicit; aligns with typical headless fingerprinting). */
const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Mobile Safari–like UA for a second pass (different bundles / trackers). */
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

/** iPhone-sized viewport for scripts that branch on viewport / touch. */
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
}

module.exports = {
  DESKTOP_USER_AGENT,
  MOBILE_USER_AGENT,
  MOBILE_VIEWPORT,
}
